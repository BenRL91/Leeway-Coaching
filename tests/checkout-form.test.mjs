import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const settle=()=>new Promise(r=>setTimeout(r,20));
for(const hasSessionReturnUrl of [true,false])for(const method of ['card','link'])test(String(hasSessionReturnUrl)+' '+method+' payment uses customer return URL, handles decline and waits for server confirmation',async()=>{
 const d=new JSDOM(fs.readFileSync('public/booking-confirmation.html','utf8'),{url:'https://leeway-pickleball.leeohsunshine.chatgpt.site/booking-confirmation?return_to=/owner-setup.html#id=test&token=token',runScripts:'outside-only'}),w=d.window;
 let confirm,paid=false,decline=true,mounts=0,destroyed=0;
 w.fetch=async path=>({ok:true,json:async()=>path.includes('/config')?{publishableKey:'pk_test_test'}:{hasSessionReturnUrl,state:paid?'confirmed':'pending',amount:10000,start:1791310800,minutes:60,client_secret:paid?null:'cs_secret'}});
 w.Stripe=(key,options)=>{assert.equal(key,'pk_test_test');assert.equal(options.betas[0],'custom_checkout_payment_form_1');return {initCheckoutFormSdk({clientSecret,appearance}){assert.equal(appearance.variables.colorPrimary,'#0570de');return {createForm({layout}){assert.equal(layout,'expanded');return {mount(selector){assert.equal(selector,'#checkout-form');mounts++;},destroy(){destroyed++;},on(event,fn){assert.equal(event,'confirm');confirm=fn;}};},async loadActions(){assert.equal(await clientSecret,'cs_secret');return {type:'success',actions:{async confirm(args){assert.equal(args.formConfirmEvent.marker,true);if(hasSessionReturnUrl)assert(!Object.hasOwn(args,'returnUrl'),'Session return_url must not be duplicated in confirm');else assert.equal(args.returnUrl,w.location.origin+'/booking-confirmation#id=test&token=token');assert.equal(args.formConfirmEvent.paymentMethodType,method);assert.equal(args.redirect,'if_required');if(decline)return {type:'error',error:{message:'Card declined'}};paid=true;return {type:'success'};}}};}};}};};
 try{w.eval(fs.readFileSync('public/confirmation.js','utf8'));await settle();assert.equal(mounts,1);assert.equal(w.document.getElementById('refresh'),null);await confirm({marker:true,paymentMethodType:method});assert.equal(w.document.getElementById('payment-message').textContent,'Card declined');assert.equal(w.document.getElementById('checkout-form').hidden,false);decline=false;await confirm({marker:true,paymentMethodType:method});assert.equal(w.document.getElementById('heading').textContent,'Your session is confirmed');assert.equal(destroyed,1);assert.equal(mounts,1);}finally{w.close();}
});
test('Hold renders immediately and background polling never blanks or remounts checkout',async()=>{
 const d=new JSDOM(fs.readFileSync('public/booking-confirmation.html','utf8'),{url:'https://leewaypb.com/booking-confirmation#id=test&token=token',runScripts:'outside-only'}),w=d.window;
 let poll,tick,mounts=0,now=1791310800000;w.Date.now=()=>now;
 w.setTimeout=fn=>{poll=fn;return 1;};w.clearTimeout=()=>{};w.setInterval=fn=>{tick=fn;return 1;};
 w.fetch=async path=>({ok:true,json:async()=>path.includes('/config')?{publishableKey:'pk_test_test'}:{state:'pending',amount:9900,start:1791320800,expires:1791312600,minutes:60,client_secret:'secret'}});
 w.Stripe=()=>({initCheckoutFormSdk:()=>({createForm:()=>({mount(){mounts++;},on(){},destroy(){}}),loadActions:async()=>({type:'success',actions:{}})})});
 try{w.eval(fs.readFileSync('public/confirmation.js','utf8'));await settle();const hold=w.document.getElementById('hold');assert.equal(hold.textContent,'Time held for 30m 00s.');now+=5100;await poll();assert.equal(hold.textContent,'Time held for 29m 55s.');assert.equal(w.document.getElementById('status-feedback').textContent,'');assert.equal(mounts,1);now+=65000;tick();assert.equal(hold.textContent,'Time held for 28m 50s.');}finally{w.close();}
});
