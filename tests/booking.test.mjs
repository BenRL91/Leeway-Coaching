import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
import {validSlot,slotsForDate,price,cleanPayload,lockedSlots} from '../worker/domain.js';
import {verifySignature} from '../worker/providers.js';
const sec=s=>Date.parse(s)/1000;
test('Eastern time, DST, duration, buffer and capacity rules',()=>{
 const before=sec('2026-10-01T00:00:00Z');
 assert(validSlot(sec('2026-10-08T21:00:00Z'),120,before));
 assert(validSlot(sec('2026-10-09T01:00:00Z'),60,before));
 assert(!validSlot(sec('2026-10-09T01:30:00Z'),60,before));
 assert(!validSlot(sec('2026-10-09T01:00:00Z'),90,before));
 assert(validSlot(sec('2026-10-09T00:00:00Z'),120,before));
 assert(!validSlot(sec('2026-10-08T20:30:00Z'),60,before));
 assert(!validSlot(sec('2026-10-06T21:00:00Z'),60,before));
 assert.equal(slotsForDate('2026-10-03',60,before).length,0);
 assert(validSlot(sec('2026-11-05T22:00:00Z'),120,before));
 assert(!validSlot(sec('2026-11-05T21:00:00Z'),60,before));
 assert.equal(slotsForDate('2026-10-08',60,before).length,9);
 assert.equal(slotsForDate('2026-10-08',90,before).length,8);
 assert.equal(slotsForDate('2026-10-08',120,before).length,7);
 assert.equal(price('individual',90,1),14900);assert.equal(price('doubles',120,2),23600);
 assert.throws(()=>price('group',60,9));assert.throws(()=>price('doubles',60,3));assert.throws(()=>price('group',60,4));
 assert.equal(lockedSlots(0,3600,15).length,3);
 assert.throws(()=>cleanPayload({type:'individual',players:['A'],minutes:60,start:sec('2026-10-06T21:00:00Z'),name:'A',email:'invalid'},{},before));
});
async function signature(raw,secret='whsec_test',ts=Math.floor(Date.now()/1000)){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const out=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${ts}.${raw}`));return `t=${ts},v1=${Buffer.from(out).toString('hex')}`;}
test('Webhook signatures reject forgery, tampering, replay and stale timestamps',async()=>{const raw='{"ok":true}',sig=await signature(raw);assert(await verifySignature(raw,sig,'whsec_test'));assert(!await verifySignature(raw+' ',sig,'whsec_test'));assert(!await verifySignature(raw,sig,'wrong'));assert(!await verifySignature(raw,await signature(raw,'whsec_test',1),'whsec_test'));});
function database(){const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync('drizzle/'+fs.readdirSync('drizzle').find(f=>f.endsWith('.sql')),'utf8'));const adapter={prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return db.prepare(sql).run(...args)},execute(){return db.prepare(sql).run(...args)}}}}},async batch(stmts){db.exec('BEGIN');try{const r=stmts.map(s=>s.execute());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};return {db,adapter};}
const origin='https://leeway-pickleball.leeohsunshine.chatgpt.site';
const request=(path,body,headers={})=>new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
function setup(){const {db,adapter}=database();return {db,env:{SITE_ACCESS_MODE:'public',DB:adapter,BOOKING_ENABLED:'true',SITE_ORIGIN:origin,STRIPE_MODE:'sandbox',STRIPE_SANDBOX_PUBLISHABLE_KEY:'pk_test_test',STRIPE_SANDBOX_SECRET_KEY:'sk_test_test',STRIPE_SANDBOX_WEBHOOK_SECRET:'whsec_test',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GOOGLE_REFRESH_TOKEN:'test',COURT_LOCATION:'Test Court',BUFFER_MINUTES:'0'}};}
function nextSlot(){const now=Math.floor(Date.now()/1000);for(let s=Math.ceil((now+86400)/1800)*1800;s<now+14*86400;s+=1800)if(validSlot(s,60,now))return s;}
test('End-to-end mocked providers: atomic holds, price integrity, verified payment, one calendar event, expiration',async()=>{
 const {db,env}=setup(),originalFetch=globalThis.fetch;const sessions=new Map(),events=new Map(),keys=new Map();let serial=0,calendarWrites=0,busy=[];
 globalThis.fetch=async(url,opts={})=>{url=String(url);if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
 if(url.includes('/freeBusy'))return Response.json({calendars:{'leewaypb@gmail.com':{busy}}});
 if(url.includes('googleapis.com/calendar/v3/calendars/')){if(opts.method==='POST'){const e=JSON.parse(opts.body);if(events.has(e.id))return Response.json({}, {status:409});events.set(e.id,e);calendarWrites++;return Response.json(e);}const id=url.split('/').at(-1);return events.has(id)?Response.json(events.get(id)):Response.json({}, {status:404});}
 if(url.includes('api.stripe.com/v1/checkout/sessions')){if(opts.method==='POST'){const key=opts.headers['Idempotency-Key'];if(keys.has(key))return Response.json(keys.get(key));assert.equal(opts.headers['Stripe-Version'],'2026-03-25.dahlia; custom_checkout_payment_form_preview=v1');const form=new URLSearchParams(opts.body);assert.equal(form.get('ui_mode'),'form');assert.equal(form.get('billing_address_collection'),'auto');assert.equal(form.get('phone_number_collection[enabled]'),'false');assert.equal(form.get('automatic_tax[enabled]'),'false');assert.equal(form.get('submit_type'),'auto');assert.equal(form.get('integration_identifier'),'custom_embedded_web_0001');assert(!form.has('payment_method_collection'));assert(!form.has('success_url'));const returnUrl=new URL(form.get('return_url'));assert.equal(returnUrl.pathname,'/booking-confirmation');assert.equal(returnUrl.origin,origin);assert.equal(new URLSearchParams(returnUrl.hash.slice(1)).get('id'),form.get('metadata[booking_id]'));assert(new URLSearchParams(returnUrl.hash.slice(1)).get('token'));assert(+form.get('expires_at')>Date.now()/1000);const s={id:'cs_test_'+ ++serial,url:null,client_secret:'cs_secret_'+serial,metadata:{booking_id:form.get('metadata[booking_id]')},amount_total:+form.get('line_items[0][price_data][unit_amount]'),currency:'usd',mode:'payment',status:'open',payment_status:'unpaid'};sessions.set(s.id,s);keys.set(key,s);return Response.json(s);}return Response.json(sessions.get(url.split('/').at(-1)));}throw Error('Unexpected fetch '+url);};
 try{const start=nextSlot(),payload={policyAccepted:true,policyVersion:'2026-10-02',recoveryToken:'a'.repeat(64),requestId:crypto.randomUUID(),type:'individual',minutes:60,start,name:'Test Player',email:'player@example.com',players:['Test Player'],goals:'Practice',amount:1};
 assert.equal((await worker.fetch(request('/api/checkout',{...payload,policyAccepted:false}),env)).status,400);
 let r=await worker.fetch(request('/api/checkout',payload),env);assert.equal(r.status,200);assert.equal((await r.json()).client_secret,'cs_secret_1');assert.equal(sessions.size,1);const recovered=await worker.fetch(request('/api/booking/recover',{id:payload.requestId,recoveryToken:payload.recoveryToken}),env);assert.equal(recovered.status,200);assert.equal(new URL((await recovered.json()).confirmation).pathname,'/booking-confirmation');assert.equal([...sessions.values()][0].amount_total,9900);assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks').get().n,2);
 r=await worker.fetch(request('/api/checkout',payload),env);assert.equal(r.status,200);assert.equal(sessions.size,1);
 r=await worker.fetch(request('/api/checkout',{...payload,requestId:crypto.randomUUID(),email:'other@example.com'}),env);assert.equal(r.status,409);assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,1);
 const b=db.prepare('SELECT * FROM bookings').get();assert.equal(JSON.parse(b.payload).policyVersion,'2026-10-02');assert(Number.isInteger(JSON.parse(b.payload).policyAcceptedAt));r=await worker.fetch(request('/api/booking/status',{id:b.id,token:'wrong'}),env);assert.equal(r.status,404);
 let body=JSON.stringify({type:'checkout.session.completed',data:{object:[...sessions.values()][0]}});r=await worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',body}),env);assert.equal(r.status,400);assert.equal(calendarWrites,0);
 const s=[...sessions.values()][0];s.payment_status='paid';s.status='complete';body=JSON.stringify({type:'checkout.session.completed',data:{object:s}});for(let i=0;i<2;i++){r=await worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':await signature(body)},body}),env);assert.equal(r.status,200);}assert.equal(calendarWrites,1);assert.equal(db.prepare('SELECT state FROM bookings').get().state,'confirmed');assert.equal([...events.values()][0].attendees[0].email,'player@example.com');
 const second={...payload,requestId:crypto.randomUUID(),start:start+7*86400};r=await worker.fetch(request('/api/checkout',second),env);assert.equal(r.status,200);const pending=[...sessions.values()][1];pending.status='expired';body=JSON.stringify({type:'checkout.session.expired',data:{object:pending}});r=await worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':await signature(body)},body}),env);assert.equal(r.status,200);assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks WHERE booking=?').get(second.requestId).n,0);
 const third={...payload,requestId:crypto.randomUUID(),start:start+14*86400};busy=[{start:new Date(third.start*1000).toISOString(),end:new Date((third.start+3600)*1000).toISOString()}];r=await worker.fetch(request('/api/checkout',third),env);assert.equal(r.status,409);
 }finally{globalThis.fetch=originalFetch;db.close();}
});
test('Setup mode fails closed and serves website without external calls',async()=>{const r=await worker.fetch(request('/api/booking/config'),{SITE_ACCESS_MODE:'public'});assert.equal((await r.json()).enabled,false);assert.equal((await worker.fetch(request('/api/checkout',{}),{SITE_ACCESS_MODE:'public'})).status,503);const page=await worker.fetch(request('/'),{SITE_ACCESS_MODE:'public'});assert.equal(page.status,200);assert((await page.text()).includes('Online booking is being prepared'));});

test('Sandbox selection blocks live fallback and mismatched keys',async()=>{
 const {stripeEnvironment}=await import('../worker/domain.js');
 const live={STRIPE_PUBLISHABLE_KEY:'pk_live_example',STRIPE_SECRET_KEY:'rk_live_example',STRIPE_WEBHOOK_SECRET:'whsec_live'};
 assert.equal(stripeEnvironment(live).STRIPE_SECRET_KEY,'');
 const sandbox={...live,STRIPE_MODE:'sandbox',STRIPE_SANDBOX_PUBLISHABLE_KEY:'pk_test_example',STRIPE_SANDBOX_SECRET_KEY:'rk_test_example',STRIPE_SANDBOX_WEBHOOK_SECRET:'whsec_sandbox'};
 assert.equal(stripeEnvironment(sandbox).STRIPE_SECRET_KEY,'rk_test_example');
 assert.equal(stripeEnvironment(sandbox).STRIPE_WEBHOOK_SECRET,'whsec_sandbox');
 assert.equal(stripeEnvironment({...sandbox,STRIPE_SANDBOX_SECRET_KEY:'rk_live_example'}).STRIPE_SECRET_KEY,'');
 assert.equal(stripeEnvironment({...live,STRIPE_MODE:'live'}).STRIPE_SECRET_KEY,'rk_live_example');
});

 test('Owner gate protects pages, assets and APIs; only signed webhooks bypass identity',async()=>{
 const {db,env}=setup();env.SITE_ACCESS_MODE='owner';env.SITE_OWNER_EMAIL='owner@example.com';
 const owner={'oai-authenticated-user-id':'site-user','oai-authenticated-user-email':'owner@example.com'};
 try{
 for(const path of ['/', '/index.html','/booking.js','/api/booking/config','/api/availability']){
 const anonymous=await worker.fetch(request(path),env);assert([302,403].includes(anonymous.status));
 const wrong=await worker.fetch(request(path,undefined,{...owner,'oai-authenticated-user-email':'other@example.com'}),env);assert.equal(wrong.status,403);
 }
 assert.equal((await worker.fetch(request('/api/checkout',{}),env)).status,403);
 assert.equal((await worker.fetch(request('/api/stripe/webhook'),env)).status,403);
 assert.equal((await worker.fetch(request('/api/booking/config',undefined,owner),env)).status,200);
 const page=await worker.fetch(request('/',undefined,owner),env);assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');
 assert.equal((await worker.fetch(request('/',undefined,owner),{...env,SITE_OWNER_EMAIL:''})).status,403);
 assert.equal((await worker.fetch(request('/api/stripe/webhook',{}),env)).status,400);
 const body=JSON.stringify({type:'checkout.session.completed',data:{object:{metadata:{}}}});
 assert.equal((await worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',body,headers:{'stripe-signature':await signature(body)}}),env)).status,200);
 }finally{db.close();}
 });

test('Only information pages are public while booking remains private',async()=>{for(const path of ['/booking-info','/privacy','/terms']){const r=await worker.fetch(request(path),{});assert.equal(r.status,200);assert((await r.text()).includes('Leeway Pickleball'));assert.equal((await worker.fetch(request(path,{}),{})).status,403);}assert.equal((await worker.fetch(request('/api/booking/config'),{})).status,403);assert.equal((await worker.fetch(request('/booking-confirmation'),{})).status,302);});

test('Owner setup stays protected even after public launch; cleanup retries and blocks replay',async()=>{
 const {db,env}=setup(),originalFetch=globalThis.fetch;env.SITE_OWNER_EMAIL='owner@example.com';
 const headers={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
 const id=crypto.randomUUID(),event='b'+id.replaceAll('-','');let failDelete=true,deletes=0;
 db.prepare("INSERT INTO bookings (id,token,fingerprint,type,start,end,minutes,amount,payload,state,expires,created,session,event) VALUES (?,?,?,'individual',100,3700,60,9900,'{}','confirmed',4000,0,'cs_test_cleanup',?)").run(id,'token','fingerprint',event);
 db.prepare('INSERT INTO slot_locks (slot,booking) VALUES (100,?)').run(id);
 globalThis.fetch=async(url,options={})=>{
  if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'test'});
  if(String(url).includes('api.stripe.com'))return Response.json({id:'cs_test_cleanup',livemode:false,status:'complete',metadata:{booking_id:id},amount_total:9900});
  if(options.method==='DELETE'){deletes++;return failDelete?Response.json({}, {status:503}):new Response(null,{status:204});}
  return Response.json({extendedProperties:{private:{leewayBooking:id}}});
 };
 try{
  assert.equal((await worker.fetch(request('/api/owner/cleanup-tests',{}),env)).status,403);
  assert.equal((await worker.fetch(request('/owner-setup.html'),env)).status,403);
  assert.equal((await worker.fetch(request('/api/owner/cleanup-tests',{confirm:true,ids:[id]},headers),{...env,STRIPE_MODE:'live'})).status,409);
  assert.equal((await worker.fetch(request('/api/owner/cleanup-tests',{confirm:true,ids:[id]},headers),env)).status,503);
  assert.equal(db.prepare('SELECT state FROM bookings').get().state,'test_cleanup');assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks').get().n,1);
  failDelete=false;assert.equal((await worker.fetch(request('/api/owner/cleanup-tests',{confirm:true,ids:[id]},headers),env)).status,200);
  assert.equal(db.prepare('SELECT state FROM bookings').get().state,'test_cancelled');assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks').get().n,0);
  assert.equal((await worker.fetch(request('/api/owner/cleanup-tests',{confirm:true,ids:[id]},headers),env)).status,200);assert.equal(deletes,2);
  const body=JSON.stringify({type:'checkout.session.completed',data:{object:{id:'cs_test_cleanup',metadata:{booking_id:id}}}});
  assert.equal((await worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',body,headers:{'stripe-signature':await signature(body)}}),env)).status,200);
  assert.equal(db.prepare('SELECT state FROM bookings').get().state,'test_cancelled');
 }finally{globalThis.fetch=originalFetch;db.close();}
});

 test('Live readiness uses live server key while bookings remain sandbox',async()=>{
 const {checkLive}=await import('../worker/setup.js');const {env,db}=setup();const previous=globalThis.fetch;
 env.STRIPE_SECRET_KEY='rk_live_fixture';env.STRIPE_PUBLISHABLE_KEY='pk_live_fixture';env.STRIPE_WEBHOOK_SECRET='whsec_live_fixture';
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push(options.headers.Authorization);return Response.json(String(url).endsWith('/account')?{id:'acct_1UKUIK19LNJrqieL',charges_enabled:true,payouts_enabled:true}:{object:'list',data:[]});};
 try{const result=await checkLive(env);assert.equal(result.accountMatches,true);assert.equal(result.activePaymentMode,'sandbox');assert.equal(env.STRIPE_SECRET_KEY,'rk_live_fixture');assert.deepEqual(calls,Array(5).fill('Bearer rk_live_fixture'));
 await assert.rejects(checkLive({...env,STRIPE_SECRET_KEY:'sk_test_fixture'}),/sandbox server key/);
 }finally{globalThis.fetch=previous;db.close();}
 });

test('Unpaid live probe expires and verifies only a live-signed matching webhook in sandbox mode',async()=>{
 const {env,db}=setup(),previous=globalThis.fetch;env.SITE_OWNER_EMAIL='owner@example.com';env.STRIPE_SECRET_KEY='sk_live_fixture';env.STRIPE_PUBLISHABLE_KEY='pk_live_fixture';env.STRIPE_WEBHOOK_SECRET='whsec_live_fixture';
 const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
 const s={id:'cs_live_probe',livemode:true,status:'open',payment_status:'unpaid',metadata:{leeway_prelaunch_probe:'leeway-prelaunch-2026-10-03-v1'}};let writes=0;
 globalThis.fetch=async(url,opts={})=>{url=String(url);assert.equal(opts.headers.Authorization,'Bearer sk_live_fixture');if(url.endsWith('/account'))return Response.json({id:'acct_1UKUIK19LNJrqieL',charges_enabled:true,payouts_enabled:true});if(url.includes('?limit=1'))return Response.json({object:'list',data:[]});if(url.endsWith('/expire'))s.status='expired';else if(opts.method==='POST'&&url.endsWith('/cs_live_probe')){s.metadata.leeway_probe_webhook='verified';writes++;}return Response.json(s);};
 try{
  assert.equal((await worker.fetch(request('/api/owner/probe-live',{}),env)).status,403);
  const probe=await worker.fetch(request('/api/owner/probe-live',{},owner),env);assert.equal(probe.status,200);assert.equal((await probe.json()).charged,false);assert.equal(s.status,'expired');
  const event={id:'evt_live_probe',type:'checkout.session.expired',livemode:true,data:{object:s}},body=JSON.stringify(event);
  const deliver=async(secret)=>worker.fetch(new Request(origin+'/api/stripe/webhook',{method:'POST',body,headers:{'stripe-signature':await signature(body,secret)}}),env);
  assert.equal((await deliver('wrong')).status,400);assert.equal(writes,0);
  assert.equal((await deliver('whsec_live_fixture')).status,200);assert.equal(writes,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,0);
  const again=await worker.fetch(request('/api/owner/probe-live',{},owner),env);assert.equal((await again.json()).webhookVerified,true);assert.equal(env.STRIPE_MODE,'sandbox');
 }finally{globalThis.fetch=previous;db.close();}
});

test('Canonical host redirects before form use; owner listing never exposes booking tokens',async()=>{
 const {db,env}=setup();env.SITE_ORIGIN='https://leewaypb.com';env.SITE_OWNER_EMAIL='owner@example.com';
 const r=await worker.fetch(new Request('https://www.leewaypb.com/?x=1'),env);assert.equal(r.status,308);assert.equal(r.headers.get('location'),'https://leewaypb.com/?x=1');
 assert.equal((await worker.fetch(new Request('https://leewaypb.com/api/owner/bookings'),env)).status,403);db.close();
});
test('Interrupted creation releases only after a complete Stripe search confirms no session',async()=>{
 const {db,env}=setup(),old=globalThis.fetch,id=crypto.randomUUID(),now=Math.floor(Date.now()/1000),start=nextSlot();
 db.prepare("INSERT INTO bookings(id,token,fingerprint,type,start,end,minutes,amount,payload,state,expires,created) VALUES (?,?,?,'individual',?,?,60,9900,?,'creating',?,?)").run(id,'token','fingerprint',start,start+3600,JSON.stringify({players:['A']}),now-1,now-1900);
 db.prepare('INSERT INTO slot_locks(slot,booking) VALUES (?,?)').run(start,id);
 globalThis.fetch=async()=>Response.json({data:[],has_more:false});
 try{const r=await worker.fetch(request('/api/booking/status',{id,token:'token'}),env);assert.equal(r.status,200);assert.equal((await r.json()).state,'expired');assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks').get().n,0);}finally{globalThis.fetch=old;db.close();}
});
test('Owner cancellation releases reservations and remains cancelled on retry',async()=>{
 const {db,env}=setup(),old=globalThis.fetch,id=crypto.randomUUID(),start=nextSlot();env.SITE_OWNER_EMAIL='owner@example.com';
 db.prepare("INSERT INTO bookings(id,token,fingerprint,type,start,end,minutes,amount,payload,state,expires,created,session) VALUES (?,?,?,'individual',?,?,60,9900,?,'confirmed',?,?,?)").run(id,'token','fp',start,start+3600,JSON.stringify({players:['A']}),start,start,'cs_test_cancel');db.prepare('INSERT INTO slot_locks(slot,booking) VALUES (?,?)').run(start,id);
 globalThis.fetch=async url=>String(url).includes('stripe.com')?Response.json({metadata:{booking_id:id},amount_total:9900,livemode:false}):String(url).includes('oauth2')?Response.json({access_token:'test'}):Response.json({}, {status:404});
 try{for(let n=0;n<2;n++){const r=await worker.fetch(request('/api/owner/manage-booking',{id,action:'cancel'},{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}),env);assert.equal(r.status,200);}assert.equal(db.prepare('SELECT state FROM bookings').get().state,'cancelled');assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks').get().n,0);}finally{globalThis.fetch=old;db.close();}
});
test('Rescheduling moves calendar and reservations together',async()=>{
 const {db,env}=setup(),old=globalThis.fetch,id=crypto.randomUUID(),start=nextSlot(),target=start+7*86400;env.SITE_OWNER_EMAIL='owner@example.com';
 db.prepare("INSERT INTO bookings(id,token,fingerprint,type,start,end,minutes,amount,payload,state,expires,created,session) VALUES (?,?,?,'individual',?,?,60,9900,?,'confirmed',?,?,?)").run(id,'token','fp',start,start+3600,JSON.stringify({players:['A']}),start,start,'cs_test_move');db.prepare('INSERT INTO slot_locks(slot,booking) VALUES (?,?)').run(start,id);
 let patched=false;globalThis.fetch=async(url,options={})=>{url=String(url);if(url.includes('stripe.com'))return Response.json({metadata:{booking_id:id},amount_total:9900,livemode:false});if(url.includes('oauth2'))return Response.json({access_token:'test'});if(url.includes('freeBusy'))return Response.json({calendars:{'leewaypb@gmail.com':{busy:[]}}});if(options.method==='PATCH'){patched=true;return Response.json({});}return Response.json({extendedProperties:{private:{leewayBooking:id}},start:{dateTime:new Date(start*1000).toISOString()}});};
 try{const r=await worker.fetch(request('/api/owner/manage-booking',{id,action:'reschedule',start:target},{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}),env);assert.equal(r.status,200);assert(patched);assert.equal(db.prepare('SELECT start FROM bookings').get().start,target);assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks WHERE slot=?').get(start).n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks').get().n,2);}finally{globalThis.fetch=old;db.close();}
});
test('Manage bookings navigation is rendered only to authenticated owner even in public mode',async()=>{
 const {db,env}=setup();env.SITE_OWNER_EMAIL='owner@example.com';
 for(const [headers,visible] of [[{},false],[{'oai-authenticated-user-id':'other','oai-authenticated-user-email':'other@example.com'},false],[{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'},true]]){const r=await worker.fetch(new Request(origin+'/',{headers}),env);assert.equal((await r.text()).includes('class="owner-nav"'),visible);}
 db.close();
});

test('Public customers can load confirmation but cannot load admin pages or controls',async()=>{const {db,env}=setup();env.SITE_OWNER_EMAIL='owner@example.com';for(const headers of [{},{'oai-authenticated-user-id':'customer','oai-authenticated-user-email':'customer@example.com'}]){const page=await worker.fetch(request('/booking-confirmation',undefined,headers),env);assert.equal(page.status,200);assert.equal(page.headers.get('location'),null);assert(!(await page.text()).includes('/owner-setup'));for(const path of ['/owner-setup.html','/api/owner/bookings'])assert.equal((await worker.fetch(request(path,undefined,headers),env)).status,403);}db.close();});
