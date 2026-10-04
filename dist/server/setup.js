import {Problem,CALENDAR,stripeEnvironment} from './domain.js';
import {stripe,google} from './providers.js';
const TEST_IDS=['08fe4984-a082-4627-a2c8-cdb38e41fe50','a2a87b4c-0674-40e2-b224-d7b7913f1590','dbfec452-03ba-46ca-bd9a-0302a6ec3c3d'];
export function requireOwner(req,env){
 const email=(req.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase();
 if(!env.SITE_OWNER_EMAIL||!req.headers.get('oai-authenticated-user-id')||email!==env.SITE_OWNER_EMAIL.trim().toLowerCase())throw new Problem('Owner access required.',403);
}
function keyKind(value){
 if(value===undefined||value===null||value==='')return 'missing';
 if(typeof value!=='string')return 'non-text value';
 const v=value.trim();
 if(/^[sr]k_live_/.test(v))return 'live server key';
 if(/^[sr]k_test_/.test(v))return 'sandbox server key';
 if(/^pk_/.test(v))return 'publishable key';
 if(/^whsec_/.test(v))return 'webhook signing secret';
 if(/^["']/.test(v))return 'quoted value';
 if(/^(STRIPE_|export )/.test(v))return 'variable assignment instead of key only';
 if(/^(sk|rk)[_•*…]/.test(v)||/[•*…]{3}/.test(v))return 'masked or incomplete key';
 return 'unrecognized format';
}
export async function checkLive(raw){
 const kind=keyKind(raw.STRIPE_SECRET_KEY);
 if(kind!=='live server key'){
  const diagnostic={liveServerKey:kind,sandboxServerKey:keyKind(raw.STRIPE_SANDBOX_SECRET_KEY),activeMode:raw.STRIPE_MODE};
  console.error('Stripe key configuration classification',JSON.stringify(diagnostic));
  throw new Problem('Live-key diagnostic: STRIPE_SECRET_KEY contains '+kind+'. Sandbox field contains '+diagnostic.sandboxServerKey+'. No key values are displayed.',503);
 }

 const env=stripeEnvironment({...raw,STRIPE_MODE:'live'});
 if(!/^pk_live_/.test(String(raw.STRIPE_PUBLISHABLE_KEY||'').trim()))throw new Problem('Update STRIPE_PUBLISHABLE_KEY with your live publishable key (pk_live_).',503);
 if(!/^[sr]k_live_/.test(String(raw.STRIPE_SECRET_KEY||'').trim()))throw new Problem('Update STRIPE_SECRET_KEY with your live secret or restricted key (sk_live_ or rk_live_). The saved value is not a live Stripe server key.',503);
 const account=await stripe(env,'account');
 if(account.id!=='acct_1UKUIK19LNJrqieL')throw new Problem('The live key belongs to a different Stripe account.',409);
 const sessions=await stripe(env,'checkout/sessions?limit=100');
 const permissions={};for(const resource of ['payment_intents','charges','refunds']){try{const r=await stripe(env,resource+'?limit=1');permissions[resource]=r.object==='list';}catch{permissions[resource]=false;}}
 const result={permissions,accountMatches:true,chargesEnabled:account.charges_enabled===true,payoutsEnabled:account.payouts_enabled===true,checkoutReadAccess:sessions.object==='list',webhookSecretPresent:!!env.STRIPE_WEBHOOK_SECRET,activePaymentMode:raw.STRIPE_MODE,checkoutWriteTested:(sessions.data||[]).some(s=>s.metadata?.leeway_prelaunch_probe===LIVE_PROBE&&s.status==='expired'),liveWebhookVerified:(sessions.data||[]).some(s=>s.metadata?.leeway_prelaunch_probe===LIVE_PROBE&&s.metadata?.leeway_probe_webhook==='verified')};
 console.log('Owner live Stripe readiness',JSON.stringify(result));return result;
}
export async function cleanupTests(raw,selection=TEST_IDS){
 if(raw.STRIPE_MODE!=='sandbox')throw new Problem('Test cleanup is only available in sandbox mode.',409);
 const env=stripeEnvironment(raw),results=[];
 for(const id of selection){
  const b=await env.DB.prepare('SELECT * FROM bookings WHERE id=?').bind(id).first();
  if(!b||b.state==='test_cancelled'){results.push({id,state:'already_cleaned'});continue;}
  if(!b.session?.startsWith('cs_test_'))throw new Problem('Cleanup stopped: booking is not a verified sandbox session.',409);
  const s=await stripe(env,'checkout/sessions/'+encodeURIComponent(b.session));
  if(s.livemode!==false||s.metadata?.booking_id!==id||s.amount_total!==b.amount)throw new Problem('Cleanup stopped: sandbox booking verification failed.',409);
  if(s.status==='open')await stripe(env,'checkout/sessions/'+encodeURIComponent(b.session)+'/expire',{},'cleanup-'+id);
  // A durable marker makes retries safe and prevents delayed webhooks from fulfilling this test again.
  await env.DB.prepare("UPDATE bookings SET state='test_cleanup' WHERE id=?").bind(id).run();
  const eventId=b.event||'b'+id.replaceAll('-','');
  const path='calendars/'+encodeURIComponent(CALENDAR)+'/events/'+encodeURIComponent(eventId);
  const event=await google(env,path);
  if(event.ok&&event.data.status!=='cancelled'){
   if(event.data.extendedProperties?.private?.leewayBooking!==id)throw new Problem('Cleanup stopped: calendar event does not match the test booking.',409);
   const deleted=await google(env,path+'?sendUpdates=none','DELETE');
   if(!deleted.ok&&![404,410].includes(deleted.status))throw new Problem('Calendar cleanup is incomplete. Retry cleanup.',503);
  }else if(!event.ok&&![404,410].includes(event.status))throw new Problem('Calendar cleanup is incomplete. Retry cleanup.',503);
  await env.DB.batch([env.DB.prepare("UPDATE bookings SET state='test_cancelled' WHERE id=?").bind(id),env.DB.prepare('DELETE FROM slot_locks WHERE booking=?').bind(id)]);
  results.push({id,state:'cleaned'});
 }
 console.log('Owner sandbox cleanup',JSON.stringify(results));return {results};
}

// A fixed, isolated prelaunch probe: no customer, booking, payment method, or calendar event.
export const LIVE_PROBE='leeway-prelaunch-2026-10-03-v1';
export async function probeLive(raw){
 await checkLive(raw);
 const env=stripeEnvironment({...raw,STRIPE_MODE:'live'});
 const created=await stripe(env,'checkout/sessions',{
  mode:'payment',ui_mode:'form',billing_address_collection:'auto',
  'phone_number_collection[enabled]':'false','automatic_tax[enabled]':'false',
  submit_type:'auto',integration_identifier:'custom_embedded_web_0001',
  'metadata[leeway_prelaunch_probe]':LIVE_PROBE,
  'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':'9900',
  'line_items[0][price_data][product_data][name]':'Leeway prelaunch verification — do not pay',
  'line_items[0][quantity]':'1'
 },LIVE_PROBE);
 const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(created.id));
 if(session.livemode!==true||session.metadata?.leeway_prelaunch_probe!==LIVE_PROBE)throw new Problem('Live probe verification failed.',409);
 if(session.payment_status==='paid')throw new Problem('Unexpected payment on verification session. Contact Coach Lee.',409);
 let expired=session;
 if(session.status==='open')expired=await stripe(env,'checkout/sessions/'+encodeURIComponent(session.id)+'/expire',{},LIVE_PROBE+'-expire');
 if(expired.status!=='expired')throw new Problem('Verification session has not expired. Retry the live check.',503);
 console.log('Live checkout probe expired',JSON.stringify({sessionId:session.id,livemode:true,paid:false}));
 return {created:true,expired:true,charged:false,sessionId:session.id,webhookVerified:expired.metadata?.leeway_probe_webhook==='verified',activePaymentMode:raw.STRIPE_MODE};
}
export async function receiveLiveProbe(raw,event){
 const obj=event.data?.object;
 if(event.type!=='checkout.session.expired'||event.livemode!==true||obj?.metadata?.leeway_prelaunch_probe!==LIVE_PROBE)return false;
 const env=stripeEnvironment({...raw,STRIPE_MODE:'live'});
 const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(obj.id));
 if(session.livemode!==true||session.status!=='expired'||session.payment_status==='paid'||session.metadata?.leeway_prelaunch_probe!==LIVE_PROBE)throw new Problem('Invalid live verification event.',400);
 await stripe(env,'checkout/sessions/'+encodeURIComponent(session.id),{'metadata[leeway_probe_webhook]':'verified'},LIVE_PROBE+'-verified-'+session.id);
 console.log('Live checkout webhook verified',JSON.stringify({eventId:event.id,sessionId:session.id,livemode:true}));return true;
}

export async function previewTests(raw){
 if(raw.STRIPE_MODE!=='sandbox')throw new Problem('Test cleanup is only available in sandbox mode.',409);
 const env=stripeEnvironment(raw);
 const rows=(await env.DB.prepare("SELECT * FROM bookings WHERE state != 'test_cancelled' AND session LIKE 'cs_test_%' ORDER BY created LIMIT 100").all()).results;
 const bookings=[],skipped=[];
 for(const b of rows){try{const s=await stripe(env,'checkout/sessions/'+encodeURIComponent(b.session));if(s.livemode!==false||s.metadata?.booking_id!==b.id||s.amount_total!==b.amount){skipped.push(b.id);continue;}const p=JSON.parse(b.payload);bookings.push({id:b.id,name:p.name,start:b.start,minutes:b.minutes,state:b.state});}catch{skipped.push(b.id);}}
 return {bookings,skipped:skipped.length,limit:100};
}
