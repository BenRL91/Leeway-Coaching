import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
test('Owner page mounts booking list and all management controls',async()=>{
 const d=new JSDOM(fs.readFileSync('public/owner-setup.html','utf8'),{url:'https://leewaypb.com/owner-setup.html',runScripts:'outside-only'}),w=d.window;
 try{
 assert(w.document.querySelector('script[src="/manage-bookings.js"]'));
 w.fetch=async()=>({ok:true,json:async()=>({bookings:[{id:'example',name:'Test booking',email:'test@example.com',state:'paid',start:1791310800,minutes:60,amount:9900,refund:'Not recorded'}]})});
 w.eval(fs.readFileSync('public/manage-bookings.js','utf8'));
 await new Promise(r=>setTimeout(r,20));
 w.document.querySelector('[data-filter=all]').click();
 assert.match(w.document.getElementById('admin-status').textContent,/1 booking\(s\) need attention/);
 const buttons=[...w.document.querySelectorAll('#bookings button')].map(b=>b.textContent);
 assert.deepEqual(buttons,['Retry confirmation','Check refund status','Cancel booking']);
 }finally{w.close();}
});
test('Reschedule uses date and time controls and waits for explicit confirmation',async()=>{
 const d=new JSDOM(fs.readFileSync('public/owner-setup.html','utf8'),{url:'https://leewaypb.com/owner-setup.html',runScripts:'outside-only'}),w=d.window;let writes=0;
 const booking={id:'test',name:'Ben',state:'confirmed',start:1791310800,minutes:60,amount:9900};
 w.fetch=async(path,opts={})=>{if(opts.method==='POST')writes++;return {ok:true,json:async()=>path.includes('availability')?{slots:[1791397200]}:path.includes('manage-booking')?{message:'Rescheduled'}:{bookings:[booking]}};};
 try{w.eval(fs.readFileSync('public/manage-bookings.js','utf8'));await new Promise(r=>setTimeout(r,20));[...w.document.querySelectorAll('#bookings button')].find(b=>b.textContent==='Reschedule').click();await new Promise(r=>setTimeout(r,20));assert(w.document.querySelector('input[type=date]'));assert(w.document.querySelector('.save-change').disabled);w.document.querySelector('.time-option').click();assert.equal(writes,0);assert.match(w.document.querySelector('.change-summary').textContent,/Move from/);w.document.querySelector('.save-change').click();await new Promise(r=>setTimeout(r,20));assert.equal(writes,1);assert.equal(w.document.getElementById('admin-status').textContent,'Rescheduled');}finally{w.close();}
});
