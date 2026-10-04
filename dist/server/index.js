import {breakdownRoute,breakdownWebhook} from './breakdowns.js';
import {checkBookingMode,reconcileBookings,maintenanceStatus,maintenanceMcp} from './maintenance.js';
import {requireOwner,checkLive,cleanupTests,previewTests,probeLive,receiveLiveProbe} from './setup.js';
import {Problem,stripeEnvironment,configured,cleanPayload,slotsForDate,lockedSlots,overlaps,nowSeconds,TZ,validSlot,CALENDAR} from './domain.js';
import {stripe,freeBusy,calendarEvent,verifySignature,google} from './providers.js';
import {assets} from './assets.js';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const one=(env,id)=>env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join('');
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
function ready(env){if(!configured(env))throw new Problem('Online booking is not open yet. You can still send a session request by email.',503);}
function origin(env){const o=env.SITE_ORIGIN;if(!o||!/^https:\/\/[^/]+$/.test(o))throw new Problem('Online booking is not ready yet.',503);return o;}
async function parse(req){if(Number(req.headers.get('content-length')||0)>12000)throw new Problem('Request too large.',413);const raw=await req.text();if(raw.length>12000)throw new Problem('Request too large.',413);try{return JSON.parse(raw)}catch{throw new Problem('Invalid request.');}}
function sameOrigin(req,env){if(req.headers.get('Origin')!==origin(env))throw new Problem('Please book from the Leeway website.',403);}
async function release(env,b){await env.DB.batch([env.DB.prepare("UPDATE bookings SET state='expired' WHERE id=? AND state IN ('creating','pending')").bind(b.id),env.DB.prepare("DELETE FROM slot_locks WHERE booking=? AND EXISTS (SELECT 1 FROM bookings WHERE id=? AND state='expired')").bind(b.id,b.id)]);}
async function paid(env,b,session){
 if(session.metadata?.booking_id!==b.id||session.amount_total!==b.amount||session.currency!=='usd'||session.mode!=='payment')throw new Problem('Payment details need review. Please contact Coach Lee.',409);
 if(session.payment_status!=='paid')return one(env,b.id);
 // Compare against database state, never a snapshot taken before a provider request.
 // Expired/terminated bookings cannot be revived without reacquiring capacity.
 const current=await env.DB.prepare("UPDATE bookings SET state='paid' WHERE id=? AND state IN ('creating','pending','paid') RETURNING *").bind(b.id).first();
 if(!current)return one(env,b.id);
 let event,error;
 try{event=await calendarEvent(env,current);}catch(e){error=e;}
 if(event)await env.DB.prepare("UPDATE bookings SET state='confirmed', event=? WHERE id=? AND state='paid' AND start=? AND end=?").bind(event,b.id,current.start,current.end).run();
 const latest=await one(env,b.id);
 // Cancellation may finish while Google's create call is in flight. Remove a
 // late event, without changing cancellation into a successful booking.
 if(['cancelled','cancelling','test_cleanup','test_cancelled'].includes(latest.state)){
  try{
   const path='calendars/'+encodeURIComponent(CALENDAR)+'/events/'+('b'+b.id.replaceAll('-',''));
   const found=await google(env,path);
   if(found.ok&&found.data.status!=='cancelled'){
    if(found.data.extendedProperties?.private?.leewayBooking!==b.id)throw new Problem('Calendar identity mismatch.',409);
    const removed=await google(env,path+'?sendUpdates=all','DELETE');
    if(!removed.ok&&![404,410].includes(removed.status))throw new Problem('Calendar cleanup needs a retry.',503);
   }else if(!found.ok&&![404,410].includes(found.status))throw new Problem('Calendar cleanup needs a retry.',503);
  }catch(e){
   await env.DB.prepare("UPDATE bookings SET state=CASE WHEN state='cancelled' THEN 'cancelling' WHEN state='test_cancelled' THEN 'test_cleanup' ELSE state END WHERE id=? AND state IN ('cancelled','test_cancelled')").bind(b.id).run();
   throw e;
  }
  return one(env,b.id);
 }
 if(error&&latest.state==='paid')throw error;
 return latest;
}
async function sessionFor(env,b){
 checkBookingMode(b,env);
 if(b.session)return stripe(env,'checkout/sessions/'+encodeURIComponent(b.session));
 if(b.state!=='creating')return null;
 // Retrying the same key also recovers a session after a network timeout.
 const p=JSON.parse(b.payload);
 const result=await stripe(env,'checkout/sessions',{
 mode:'payment',ui_mode:'form',billing_address_collection:'auto',
 'phone_number_collection[enabled]':'false','automatic_tax[enabled]':'false',
 submit_type:'auto',integration_identifier:'custom_embedded_web_0001',
 'metadata[booking_id]':b.id,
 return_url:`${origin(env)}/booking-confirmation#id=${encodeURIComponent(b.id)}&token=${encodeURIComponent(b.token)}`,
 'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(b.amount),
 'line_items[0][price_data][product_data][name]':`Leeway ${b.type} coaching — ${b.minutes} minutes`,
 'line_items[0][price_data][product_data][description]':`${p.players.length} player(s). Court fees included.`,
 'line_items[0][quantity]':'1',expires_at:String(b.expires)
 },'leeway-checkout-'+b.id);
 await env.DB.prepare("UPDATE bookings SET session=?, checkout_url=?, state=CASE WHEN state='creating' THEN 'pending' ELSE state END WHERE id=?").bind(result.id,result.url||null,b.id).run();return result;
}
async function recoverSession(env,b){
 checkBookingMode(b,env);
 if(b.session||b.state!=='creating'||b.expires>=nowSeconds()+1800)return sessionFor(env,b);
 // Search every recent page before declaring an interrupted creation unpaid.
 let after='';
 for(let page=0;page<20;page++){
  const list=await stripe(env,'checkout/sessions?limit=100&created[gte]='+b.created+(after?'&starting_after='+encodeURIComponent(after):''));
  const found=list.data?.find(s=>s.metadata?.booking_id===b.id);
  if(found){await env.DB.prepare("UPDATE bookings SET session=?, state='pending' WHERE id=? AND state='creating'").bind(found.id,b.id).run();return found;}
  if(!Array.isArray(list.data))throw new Problem('Checkout recovery needs review.',503);
  if(!list.has_more){if(b.expires<nowSeconds())await release(env,b);return null;}
  after=list.data.at(-1)?.id;if(!after)break;
 }
 throw new Problem('Checkout recovery needs owner review.',503);
}
async function manageBooking(req,env){
 const body=await parse(req),b=await one(env,String(body.id||''));if(!b)throw new Problem('Booking not found.',404);checkBookingMode(b,env);
 if(body.action==='retry'&&b.state==='cancelling')body.action='cancel';if(body.action==='retry'&&b.state==='rescheduling'){body.action='reschedule';body.start=JSON.parse(b.payload).rescheduleStart;}
 if(body.action==='retry'){const s=await recoverSession(env,b);if(s?.payment_status==='paid')await paid(env,b,s);else if(s?.status==='expired')await release(env,b);return json({ok:true});}
 if(body.action==='refund-status'){if(!b.session)throw new Problem('No payment session.');const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(b.session));if(session.metadata?.booking_id!==b.id)throw new Problem('Payment mismatch.',409);const pi=session.payment_intent?await stripe(env,'payment_intents/'+encodeURIComponent(session.payment_intent)+'?expand[]=latest_charge'):null;const cents=pi?.latest_charge?.amount_refunded||0;const payload={...JSON.parse(b.payload),refund:cents?'$'+(cents/100).toFixed(2)+' refunded':'No refund recorded by Stripe'};await env.DB.prepare('UPDATE bookings SET payload=? WHERE id=?').bind(JSON.stringify(payload),b.id).run();return json({ok:true,message:payload.refund});}
 if(!['cancel','reschedule'].includes(body.action))throw new Problem('Choose an action.');
 if(!['confirmed','paid','cancelling','rescheduling','cancelled'].includes(b.state))throw new Problem('Resolve payment before changing this booking.',409);
 const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(b.session));
 if(session.metadata?.booking_id!==b.id||session.amount_total!==b.amount||session.livemode!==(env.STRIPE_MODE==='live'))throw new Problem('Payment environment does not match this booking.',409);
 const path='calendars/'+encodeURIComponent(CALENDAR)+'/events/'+('b'+b.id.replaceAll('-',''));
 const event=await google(env,path);if(event.ok&&event.data.extendedProperties?.private?.leewayBooking!==b.id)throw new Problem('Calendar identity mismatch.',409);
 if(!event.ok&&![404,410].includes(event.status))throw new Problem('Calendar unavailable.',503);
 if(body.action==='cancel'){
  await env.DB.prepare("UPDATE bookings SET state='cancelling' WHERE id=?").bind(b.id).run();
  if(event.ok&&event.data.status!=='cancelled'){const r=await google(env,path+'?sendUpdates=all','DELETE');if(!r.ok&&![404,410].includes(r.status))throw new Problem('Retry cancellation to finish calendar removal.',503);}
  await env.DB.batch([env.DB.prepare("UPDATE bookings SET state='cancelled' WHERE id=?").bind(b.id),env.DB.prepare('DELETE FROM slot_locks WHERE booking=?').bind(b.id)]);
  return json({ok:true,message:'Cancelled and time released. Refunds must be processed separately in Stripe.'});
 }
 if(b.state==='cancelled'||b.state==='cancelling')throw new Problem('Cancelled bookings cannot be rescheduled.',409);
 const start=Number(body.start),end=start+b.minutes*60;if(!validSlot(start,b.minutes))throw new Problem('Choose a valid future start time.');
 if(!event.ok)throw new Problem('Retry calendar confirmation before rescheduling.',409);
 if(start===b.start)return json({ok:true});
 const busy=await freeBusy(env,start,end);if(!(b.state==='rescheduling'&&Date.parse(event.data.start?.dateTime)/1000===start)&&overlaps(start,end,busy))throw new Problem('Choose a time without a calendar conflict.',409);
 const target=lockedSlots(start,end,Number(env.BUFFER_MINUTES));
 try{await env.DB.batch([env.DB.prepare("UPDATE bookings SET state='rescheduling',payload=? WHERE id=?").bind(JSON.stringify({...JSON.parse(b.payload),rescheduleStart:start}),b.id),...target.map(slot=>env.DB.prepare('INSERT INTO slot_locks (slot,booking) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM slot_locks WHERE slot=? AND booking=?)').bind(slot,b.id,slot,b.id))]);}catch{throw new Problem('That time is reserved. Choose another.',409);}
 const changed=await google(env,path+'?sendUpdates=all','PATCH',{start:{dateTime:new Date(start*1000).toISOString(),timeZone:TZ},end:{dateTime:new Date(end*1000).toISOString(),timeZone:TZ}});
 if(!changed.ok)throw new Problem('Calendar update needs review. Both times remain protected; contact support before retrying.',503);
 const payload={...JSON.parse(b.payload),start,end};
 await env.DB.batch([env.DB.prepare("UPDATE bookings SET start=?,end=?,payload=?,state='confirmed' WHERE id=?").bind(start,end,JSON.stringify(payload),b.id),env.DB.prepare('DELETE FROM slot_locks WHERE booking=? AND (slot < ? OR slot >= ?)').bind(b.id,start,end+Number(env.BUFFER_MINUTES)*60)]);
 return json({ok:true,message:'Rescheduled. Calendar invitation updated.'});
}
async function bookingList(env){
 const rows=(await env.DB.prepare('SELECT * FROM bookings ORDER BY created DESC LIMIT 100').all()).results;
 return json({bookings:rows.map(b=>{const p=JSON.parse(b.payload);return {id:b.id,state:b.state,start:b.start,minutes:b.minutes,amount:b.amount,name:p.name,email:p.email,type:b.type,refund:p.refund||'Not recorded'};})});
}
async function reconcileDate(env,start,end){
 const rows=(await env.DB.prepare("SELECT * FROM bookings WHERE start < ? AND end > ? AND state IN ('pending','creating','paid') LIMIT 20").bind(end,start).all()).results;
 for(const b of rows){try{const session=await recoverSession(env,b);if(!session)continue;if(session.payment_status==='paid')await paid(env,b,session);else if(session.status==='expired')await release(env,b);}catch{console.error('Booking reconciliation delayed',b.id);}}
}
async function available(req,env){
 ready(env);const u=new URL(req.url),date=u.searchParams.get('date'),month=u.searchParams.get('month'),minutes=Number(u.searchParams.get('minutes'));
 if(![30,60,90,120].includes(minutes))throw new Problem('Choose a valid duration.');
 let dates;
 if(month){if(!/^\d{4}-\d{2}$/.test(month)||Number(month.slice(5))<1||Number(month.slice(5))>12)throw new Problem('Choose a valid month.');const count=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();dates=Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));}
 else dates=[date];
 const byDate=dates.map(date=>({date,candidates:slotsForDate(date,minutes,nowSeconds(),minutes===30)})),all=byDate.flatMap(d=>d.candidates),buffer=Number(env.BUFFER_MINUTES);
 let busy=[],locks=[];
 if(all.length){const start=all[0]-buffer*60,end=all.at(-1)+minutes*60+buffer*60;await reconcileDate(env,start,end);busy=(await freeBusy(env,start,end)).map(b=>({...b,end:b.end+buffer*60}));locks=(await env.DB.prepare('SELECT l.slot,b.state FROM slot_locks l JOIN bookings b ON b.id=l.booking WHERE l.slot >= ? AND l.slot < ?').bind(start-1800,end).all()).results;}
 const results=byDate.map(({date,candidates})=>{const times=candidates.map(start=>{const held=locks.filter(l=>lockedSlots(start,start+minutes*60,buffer).includes(l.slot));const reason=held.length?(held.some(l=>['creating','pending'].includes(l.state))?'Temporarily held for checkout':'Booked — coaching session'):overlaps(start,start+minutes*60+buffer*60,busy)?'Blocked — Coach Lee is unavailable':null;return {start,available:!reason,reason};});return {date,times,slots:times.filter(t=>t.available).map(t=>t.start),reason:!times.length?'Outside coaching hours or booking window':times.every(t=>!t.available)?'Fully booked or blocked for this duration':null};});
 return json(month?{timezone:TZ,days:results}:{timezone:TZ,...results[0]});
}
function checkoutResponse(env,b,session){return json({client_secret:session.client_secret,confirmation:`${origin(env)}/booking-confirmation#id=${b.id}&token=${b.token}`});}
async function checkout(req,env){ready(env);sameOrigin(req,env);const body=await parse(req);if(!/^[a-f0-9-]{36}$/.test(body.requestId||''))throw new Problem('Refresh the booking form and try again.');if(body.policyAccepted!==true||body.policyVersion!=='2026-10-02')throw new Problem('Please review and accept the cancellation and refund policy.');if(body.recoveryToken!==undefined&&!/^[a-f0-9]{64}$/.test(body.recoveryToken))throw new Problem('Invalid recovery request.');const p=cleanPayload(body,env);p.policyVersion='2026-10-02';const fingerprint=await digest(JSON.stringify(p)),id=body.requestId;let b=await one(env,id);
 if(b){if(b.fingerprint!==fingerprint)throw new Problem('Your session details changed. Please choose your time again.',409);if(['confirmed','paid'].includes(b.state))return json({confirmation:`${origin(env)}/booking-confirmation#id=${b.id}&token=${b.token}`});if(['expired','test_cleanup','test_cancelled'].includes(b.state))throw new Problem('Your hold expired. Choose a time again.',409);const s=await sessionFor(env,b);return checkoutResponse(env,b,s);}
 const recent=await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings WHERE created > ?').bind(nowSeconds()-600).first();if(recent.n>=20)throw new Problem('Booking is busy. Please try again in a few minutes.',429);
 // Restrict repeated holds for the same contact. Prices and times never come from the browser unchecked.
 const holds=await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE created > ? AND json_extract(payload, '$.email') = ?").bind(nowSeconds()-3600,p.email).first();if(holds.n>=5)throw new Problem('Too many recent booking attempts. Please contact Coach Lee or try later.',429);
 const buffer=Number(env.BUFFER_MINUTES);const busy=await freeBusy(env,p.start-buffer*60,p.end+buffer*60);if(overlaps(p.start,p.end+buffer*60,busy.map(x=>({...x,end:x.end+buffer*60}))))throw new Problem('That time is no longer available. Please choose another.',409);
 const token=randomToken(),expires=nowSeconds()+1860;
 const recoveryHash=body.recoveryToken?await digest(body.recoveryToken):null;
 try{await env.DB.batch([env.DB.prepare("INSERT INTO bookings (id,token,fingerprint,type,start,end,minutes,amount,payload,state,expires,created) VALUES (?,?,?,?,?,?,?,?,?,'creating',?,?)").bind(id,token,fingerprint,p.type,p.start,p.end,p.minutes,p.amount,JSON.stringify({...p,policyAcceptedAt:nowSeconds(),recoveryHash,stripeMode:env.STRIPE_MODE}),expires,nowSeconds()),...lockedSlots(p.start,p.end,buffer).map(s=>env.DB.prepare('INSERT INTO slot_locks (slot,booking) VALUES (?,?)').bind(s,id))]);}catch(e){b=await one(env,id);if(b&&b.fingerprint===fingerprint){const session=await sessionFor(env,b);return checkoutResponse(env,b,session);}throw new Problem('That time was just taken. Please choose another.',409);}
 b=await one(env,id);const session=await sessionFor(env,b);return checkoutResponse(env,b,session);
}
async function recoverCheckout(req,env){
 sameOrigin(req,env);const body=await parse(req);
 if(!/^[a-f0-9-]{36}$/.test(body.id||'')||!/^[a-f0-9]{64}$/.test(body.recoveryToken||''))throw new Problem('Booking recovery link is unavailable.',404);
 const b=await one(env,body.id);
 if(!b||JSON.parse(b.payload).recoveryHash!==await digest(body.recoveryToken))throw new Problem('No saved checkout was found. If you paid, contact Coach Lee before booking again.',404);
 checkBookingMode(b,env);
 return json({confirmation:`${origin(env)}/booking-confirmation#id=${b.id}&token=${b.token}`,state:b.state});
}
async function status(req,env){if(!env.DB||!env.STRIPE_SECRET_KEY)throw new Problem('Booking status is temporarily unavailable.',503);sameOrigin(req,env);const body=await parse(req),b=await one(env,String(body.id||''));if(!b||b.token!==body.token)throw new Problem('Booking not found.',404);let current=b,session=null;
 if(!['expired','confirmed','cancelled','cancelling','rescheduling','test_cleanup','test_cancelled'].includes(b.state)){try{const s=await recoverSession(env,b);session=s;current=await one(env,b.id);if(s?.payment_status==='paid')current=await paid(env,b,s);else if(s?.status==='expired'){await release(env,b);current=await one(env,b.id);}}catch{current=await one(env,b.id);}}
 return json({hasSessionReturnUrl:!!session?.return_url,state:current.state,amount:current.amount,start:current.start,minutes:current.minutes,type:current.type,expires:current.expires,players:JSON.parse(current.payload).players,location:env.COURT_LOCATION,client_secret:current.state==='pending'&&session?.status==='open'?session.client_secret:null,url:current.state==='pending'?current.checkout_url:null});
}
async function webhook(req,env,rawEnv){const raw=await req.text();if(raw.length>1000000)throw new Problem('Request too large.',413);if(rawEnv.STRIPE_WEBHOOK_SECRET&&await verifySignature(raw,req.headers.get('stripe-signature'),rawEnv.STRIPE_WEBHOOK_SECRET)){let probe;try{probe=JSON.parse(raw)}catch{throw new Problem('Invalid event.');}if(await receiveLiveProbe(rawEnv,probe))return json({received:true});}if(!env.DB||!env.STRIPE_SECRET_KEY||!env.STRIPE_WEBHOOK_SECRET)throw new Problem('Webhook not configured.',503);if(raw.length>1000000||!await verifySignature(raw,req.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET))throw new Problem('Invalid signature.',400);let event;try{event=JSON.parse(raw)}catch{throw new Problem('Invalid event.');}if(!['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded'].includes(event.type))return json({received:true});const obj=event.data.object;if(await breakdownWebhook(env,obj))return json({received:true});const id=obj.metadata?.booking_id;if(!id)return json({received:true});const b=await one(env,id);if(!b||['cancelled','cancelling','rescheduling','test_cleanup','test_cancelled'].includes(b.state))return json({received:true});if(b.session&&b.session!==obj.id)throw new Problem('Session mismatch.',400);const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(obj.id));
 if(session.metadata?.booking_id!==b.id||session.amount_total!==b.amount||session.currency!=='usd')throw new Problem('Payment mismatch.',400);
 await env.DB.prepare('UPDATE bookings SET session=COALESCE(session,?) WHERE id=?').bind(session.id,b.id).run();
 if(session.payment_status==='paid')await paid(env,b,session);else if(session.status==='expired')await release(env,b);return json({received:true});}
function ownerAccess(req,env,u){
 if(['GET','HEAD'].includes(req.method)&&['/booking-info','/privacy','/terms','/booking-info.html','/privacy.html','/terms.html'].includes(u.pathname))return null;
 if(u.pathname==='/mcp'&&req.method==='POST')return null;
 if(u.pathname==='/api/stripe/webhook'&&req.method==='POST')return null;
 if(env.SITE_ACCESS_MODE==='public')return null;
 const owner=(env.SITE_OWNER_EMAIL||'').trim().toLowerCase();
 const email=(req.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase();
 const userId=req.headers.get('oai-authenticated-user-id');
 if(owner&&userId&&email===owner)return null;
 if(!userId&&req.method==='GET'&&!u.pathname.startsWith('/api/'))return new Response('Sign in to view this private site.',{status:302,headers:{Location:'/signin-with-chatgpt?return_to='+encodeURIComponent(u.pathname+u.search),'Cache-Control':'no-store'}});
 return json({error:'This site is private.'},403);
}
export default {async fetch(req,env){const rawEnv=env;env=stripeEnvironment(env);try{const u=new URL(req.url);if(['GET','HEAD'].includes(req.method)&&env.SITE_ORIGIN&&u.origin!==env.SITE_ORIGIN&&['www.leewaypb.com','leeway-pickleball.leeohsunshine.chatgpt.site'].includes(u.hostname))return Response.redirect(env.SITE_ORIGIN+u.pathname+u.search,308);const denied=ownerAccess(req,env,u);if(denied)return denied;if(u.pathname==='/mcp'&&req.method==='POST')return await maintenanceMcp(req,env,()=>reconcileBookings(env,recoverSession,release,paid));if(u.pathname.startsWith('/api/owner/')||['/owner-setup.html','/owner-breakdowns.html'].includes(u.pathname)){requireOwner(req,rawEnv);if(u.pathname==='/api/owner/bookings'&&req.method==='GET')return await bookingList(env);if(req.method==='POST'){sameOrigin(req,env);if(u.pathname==='/api/owner/reconcile')return json(await reconcileBookings(env,recoverSession,release,paid));if(u.pathname==='/api/owner/manage-booking')return await manageBooking(req,env);if(u.pathname==='/api/owner/probe-live')return json(await probeLive(rawEnv));if(u.pathname==='/api/owner/check-live')return json(await checkLive(rawEnv));if(u.pathname==='/api/owner/preview-tests')return json(await previewTests(rawEnv));if(u.pathname==='/api/owner/cleanup-tests'){const body=await parse(req);if(body.confirm!==true||!Array.isArray(body.ids)||body.ids.length>100||body.ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new Problem('Preview and confirm the test bookings first.');return json(await cleanupTests(rawEnv,[...new Set(body.ids)]));}}}if(u.pathname==='/api/booking/config'&&req.method==='GET')return json({enabled:configured(env),stripeMode:env.STRIPE_MODE,publishableKey:/^pk_(test|live)_/.test(env.STRIPE_PUBLISHABLE_KEY||'')?env.STRIPE_PUBLISHABLE_KEY:null,groupEnabled:configured(env)&&!!env.GROUP_RATES_JSON,groupRates:env.GROUP_RATES_JSON?JSON.parse(env.GROUP_RATES_JSON):null,timezone:TZ,calendarEmail:'leewaypb@gmail.com'});
 const breakdownResponse=await breakdownRoute(req,env,{parse,sameOrigin});if(breakdownResponse)return breakdownResponse;
 if(u.pathname==='/api/availability'&&req.method==='GET')return await available(req,env);
 if(u.pathname==='/api/checkout'&&req.method==='POST')return await checkout(req,env);
 if(u.pathname==='/api/booking/recover'&&req.method==='POST')return await recoverCheckout(req,env);
 if(u.pathname==='/api/booking/status'&&req.method==='POST')return await status(req,env);
 if(u.pathname==='/api/stripe/webhook'&&req.method==='POST')return await webhook(req,env,rawEnv);
 if(u.pathname.startsWith('/api/'))return json({error:'Not found.'},404);
 if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405});
 const asset=assets[u.pathname==='/'?'/index.html':u.pathname];if(!asset)return new Response('Not found',{status:404});let body=asset.base64?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body;if(u.pathname==='/'||u.pathname==='/index.html'){let isOwner=false;try{requireOwner(req,rawEnv);isOwner=true;}catch{}if(isOwner)body=body.replace('<nav class="navlinks" aria-label="Main navigation">','<nav class="navlinks" aria-label="Main navigation"><a href="/owner-setup.html" class="owner-nav">Manage bookings</a>');}return new Response(req.method==='HEAD'?null:body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.stripe.com https://*.link.com; connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://link.com https://*.link.com; frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://link.com https://*.link.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
 }catch(e){if(!(e instanceof Problem))console.error('Booking operation failed');return json({error:e instanceof Problem?e.message:'The booking service is temporarily unavailable. Please try again.'},e.status||503);}}};
