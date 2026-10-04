import {Problem,nowSeconds} from './domain.js';
import {requireOwner} from './setup.js';

export function modeForBooking(b){
 const saved=JSON.parse(b.payload).stripeMode;
 if(['sandbox','live'].includes(saved))return saved;
 if(b.session?.startsWith('cs_test_'))return 'sandbox';
 if(b.session?.startsWith('cs_live_'))return 'live';
 return null;
}
export function checkBookingMode(b,env){
 const mode=modeForBooking(b);
 // Legacy records without an established mode require owner review.
 if(mode&&mode!==env.STRIPE_MODE)throw new Problem('This booking belongs to a different payment environment. Contact Coach Lee for help.',409);
}
export async function maintenanceStatus(env){
 const rows=(await env.DB.prepare("SELECT state,COUNT(*) AS count FROM bookings WHERE state IN ('creating','pending','paid','cancelling','rescheduling') GROUP BY state").bind().all()).results;
 return {paymentMode:env.STRIPE_MODE,automaticLiveActionsEnabled:false,counts:rows};
}
export async function reconcileBookings(env,resolve,release,paid){
 if(env.STRIPE_MODE!=='sandbox')throw new Problem('Automatic maintenance is currently enabled for sandbox bookings only.',409);
 const now=nowSeconds();
 const rows=(await env.DB.prepare("SELECT * FROM bookings WHERE state IN ('creating','pending','paid') AND COALESCE(json_extract(payload,'$.maintenanceNext'),0)<=? ORDER BY COALESCE(json_extract(payload,'$.maintenanceChecked'),0),created,id LIMIT 10").bind(now).all()).results;
 const result={checked:0,confirmed:0,expired:0,pending:0,failed:0,review:0};
 for(const b of rows){
  let failed=false;result.checked++;
  try{
   if(modeForBooking(b)!=='sandbox'){result.review++;failed=true;}
   else{
    const s=await resolve(env,b);
    if(s?.livemode===true)throw new Problem('Payment environment mismatch.',409);
    if(s?.payment_status==='paid')await paid(env,b,s);
    else if(s?.status==='expired')await release(env,b);
    const current=await env.DB.prepare('SELECT state FROM bookings WHERE id=?').bind(b.id).first();
    if(current.state==='confirmed')result.confirmed++;else if(current.state==='expired')result.expired++;else result.pending++;
   }
  }catch{failed=true;result.failed++;}
  const attempts=failed?Number(JSON.parse(b.payload).maintenanceAttempts||0)+1:0;
  const next=now+(failed?Math.min(21600,300*2**Math.min(attempts-1,6)):120);
  await env.DB.prepare("UPDATE bookings SET payload=json_set(payload,'$.maintenanceChecked',?,'$.maintenanceNext',?,'$.maintenanceAttempts',?,'$.maintenanceIssue',?) WHERE id=?").bind(now,next,attempts,failed?'Needs retry or owner review':null,b.id).run();
 }
 return result;
}
export async function maintenanceMcp(req,env,run){
 let body;try{const raw=await req.text();if(raw.length>8000)throw Error();body=JSON.parse(raw);}catch{return Response.json({error:'Invalid request.'},{status:400});}
 if(!body||body.jsonrpc!=='2.0'||typeof body.method!=='string')return Response.json({error:'Invalid request.'},{status:400});
 const reply=result=>Response.json({jsonrpc:'2.0',id:body.id,result},{headers:{'Cache-Control':'no-store'}});
 const tools=[{name:'booking_maintenance_status',description:'Read booking recovery counts for Coach Lee. No customer details or secrets.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},{name:'reconcile_sandbox_bookings',description:'Recover at most ten interrupted sandbox bookings: verify Stripe, release expired unpaid holds, retry paid calendar sync. Never charges, refunds, or changes site access/payment mode.',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
 if(body.method==='initialize')return reply({protocolVersion:body.params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'Leeway booking maintenance',version:'1.0.0'}});
 if(body.method==='notifications/initialized')return new Response(null,{status:202});
 if(body.method==='tools/list')return reply({tools});
 requireOwner(req,env);
 if(body.method!=='tools/call')return Response.json({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}});
 if(Object.keys(body.params?.arguments||{}).length)throw new Problem('This tool takes no arguments.');
 let result;
 if(body.params?.name==='booking_maintenance_status')result=await maintenanceStatus(env);
 else if(body.params?.name==='reconcile_sandbox_bookings')result=await run();
 else throw new Problem('Tool not found.',404);
 return reply({content:[{type:'text',text:JSON.stringify(result)}]});
}
