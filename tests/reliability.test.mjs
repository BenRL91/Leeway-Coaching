import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';import worker from '../dist/server/index.js';import {validSlot} from '../worker/domain.js';
function database(){const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync('drizzle/'+fs.readdirSync('drizzle').find(f=>f.endsWith('.sql')),'utf8'));const adapter={prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return db.prepare(sql).run(...args)},execute(){return db.prepare(sql).run(...args)}}}}},async batch(stmts){db.exec('BEGIN');try{const r=stmts.map(s=>s.execute());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};return {db,adapter};}
const origin='https://leeway-pickleball.leeohsunshine.chatgpt.site';
const request=(path,body,headers={})=>new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
function setup(){const {db,adapter}=database();return {db,env:{SITE_ACCESS_MODE:'public',DB:adapter,BOOKING_ENABLED:'true',SITE_ORIGIN:origin,STRIPE_MODE:'sandbox',STRIPE_SANDBOX_PUBLISHABLE_KEY:'pk_test_test',STRIPE_SANDBOX_SECRET_KEY:'sk_test_test',STRIPE_SANDBOX_WEBHOOK_SECRET:'whsec_test',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GOOGLE_REFRESH_TOKEN:'test',COURT_LOCATION:'Test Court',BUFFER_MINUTES:'0'}};}
function nextSlot(){const now=Math.floor(Date.now()/1000);for(let s=Math.ceil((now+86400)/1800)*1800;s<now+14*86400;s+=1800)if(validSlot(s,60,now))return s;}

function seed(db,state='paid') {const id=crypto.randomUUID(),start=nextSlot();db.prepare("INSERT INTO bookings(id,token,fingerprint,type,start,end,minutes,amount,payload,state,expires,created,session) VALUES (?,?,?,'individual',?,?,60,9900,?,?,?,?,?)").run(id,'token','fp',start,start+3600,JSON.stringify({players:['A'],email:'test@example.com',name:'A'}),state,start,start,'cs_test_audit');db.prepare('INSERT INTO slot_locks(slot,booking) VALUES (?,?)').run(start,id);return {id,start};}
test('Calendar event failure leaves paid slot protected and unrelated times available',async()=>{const {db,env}=setup(),old=globalThis.fetch,{id,start}=seed(db);globalThis.fetch=async url=>String(url).includes('stripe.com')?Response.json({id:'cs_test_audit',metadata:{booking_id:id},amount_total:9900,currency:'usd',mode:'payment',payment_status:'paid'}):String(url).includes('oauth2')?Response.json({access_token:'test'}):String(url).includes('freeBusy')?Response.json({calendars:{'leewaypb@gmail.com':{busy:[]}}}):Response.json({}, {status:503});try{const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start*1000));const response=await worker.fetch(request('/api/availability?date='+date+'&minutes=60'),env);assert.equal(response.status,200);const available=await response.json();assert(available.slots.length>0);assert(!available.slots.includes(start));assert.equal(db.prepare('SELECT state FROM bookings').get().state,'paid');}finally{globalThis.fetch=old;db.close();}});
test('Cancellation during payment retrieval is not overwritten by confirmation',async()=>{const {db,env}=setup(),old=globalThis.fetch,{id}=seed(db);globalThis.fetch=async url=>{if(String(url).includes('stripe.com')){db.prepare("UPDATE bookings SET state='cancelled' WHERE id=?").run(id);db.prepare('DELETE FROM slot_locks WHERE booking=?').run(id);return Response.json({id:'cs_test_audit',metadata:{booking_id:id},amount_total:9900,currency:'usd',mode:'payment',payment_status:'paid'});}if(String(url).includes('oauth2'))return Response.json({access_token:'test'});return Response.json({extendedProperties:{private:{leewayBooking:id}}});};try{const response=await worker.fetch(request('/api/booking/status',{id,token:'token'}),env);assert.equal(response.status,200);assert.equal((await response.json()).state,'cancelled');assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks').get().n,0);}finally{globalThis.fetch=old;db.close();}});

test('Cancellation during calendar creation removes the late event without reviving the booking',async()=>{
 const {db,env}=setup(),old=globalThis.fetch,{id}=seed(db);env.SITE_OWNER_EMAIL='owner@example.com';
 let event=null,deleted=0,cancelled=false;
 globalThis.fetch=async(url,opts={})=>{
  url=String(url);
  if(url.includes('stripe.com'))return Response.json({id:'cs_test_audit',metadata:{booking_id:id},amount_total:9900,currency:'usd',mode:'payment',payment_status:'paid',livemode:false});
  if(url.includes('oauth2'))return Response.json({access_token:'test'});
  if(url.includes('freeBusy'))return Response.json({calendars:{'leewaypb@gmail.com':{busy:[]}}});
  if(opts.method==='POST'){
   const response=await worker.fetch(request('/api/owner/manage-booking',{id,action:'cancel'},{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}),env);
   assert.equal(response.status,200);cancelled=true;
   event=JSON.parse(opts.body);return Response.json(event);
  }
  if(opts.method==='DELETE'){event=null;deleted++;return new Response(null,{status:204});}
  return event?Response.json(event):Response.json({}, {status:404});
 };
 try{const response=await worker.fetch(request('/api/booking/status',{id,token:'token'}),env);assert.equal(response.status,200);assert(cancelled);assert.equal((await response.json()).state,'cancelled');assert.equal(event,null);assert.equal(deleted,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM slot_locks').get().n,0);}finally{globalThis.fetch=old;db.close();}
});

test('Complete calendar outage still fails availability closed instead of inventing slots',async()=>{
 const {db,env}=setup(),old=globalThis.fetch,start=nextSlot();globalThis.fetch=async()=>Response.json({error:'invalid_grant'},{status:400});
 try{const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start*1000));const response=await worker.fetch(request('/api/availability?date='+date+'&minutes=60'),env);assert.equal(response.status,503);}finally{globalThis.fetch=old;db.close();}
});

test('Expired booking cannot regain confirmed status without reservation locks',async()=>{
 const {db,env}=setup(),old=globalThis.fetch,{id}=seed(db);let calendarCalls=0;
 globalThis.fetch=async url=>{if(String(url).includes('stripe.com')){db.prepare("UPDATE bookings SET state='expired' WHERE id=?").run(id);db.prepare('DELETE FROM slot_locks WHERE booking=?').run(id);return Response.json({id:'cs_test_audit',metadata:{booking_id:id},amount_total:9900,currency:'usd',mode:'payment',payment_status:'paid'});}calendarCalls++;throw Error('Unexpected calendar operation');};
 try{const response=await worker.fetch(request('/api/booking/status',{id,token:'token'}),env);assert.equal((await response.json()).state,'expired');assert.equal(calendarCalls,0);}finally{globalThis.fetch=old;db.close();}
});

test('Month availability disables blocked dates and returns privacy-safe reasons',async()=>{
 const {db,env}=setup(),old=globalThis.fetch,{start}=seed(db,'confirmed');const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start*1000));
 globalThis.fetch=async url=>String(url).includes('oauth2')?Response.json({access_token:'test'}):Response.json({calendars:{'leewaypb@gmail.com':{busy:[{start:new Date(start*1000).toISOString(),end:new Date((start+86400)*1000).toISOString()}]}}});
 try{const response=await worker.fetch(request('/api/availability?month='+date.slice(0,7)+'&minutes=60'),env);assert.equal(response.status,200);const data=await response.json(),day=data.days.find(d=>d.date===date);assert.equal(day.slots.length,0);assert.match(day.reason,/Fully booked/);assert(day.times.some(t=>t.reason==='Booked — coaching session'));assert(day.times.some(t=>t.reason==='Blocked — Coach Lee is unavailable'));assert(!JSON.stringify(data).includes('test@example.com'));}finally{globalThis.fetch=old;db.close();}
});
