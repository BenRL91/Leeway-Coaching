const query=new URLSearchParams(location.hash.slice(1)),id=query.get('id'),token=query.get('token');const $=id=>document.getElementById(id);let holdExpires=0;
function renderHold(){const target=$('hold');const left=Math.max(0,holdExpires-Math.floor(Date.now()/1000));const text=holdExpires?(left?'Time held for '+Math.floor(left/60)+'m '+String(left%60).padStart(2,'0')+'s.':'Hold ended. Verifying your booking status…'):'';if(target.textContent!==text)target.textContent=text;}
setInterval(renderHold,1000);
let attempts=0,timer=null,paymentForm=null,mounting=false,checking=false;
async function check(manual=false){if(checking)return;clearTimeout(timer);if(!id||!token){$('heading').textContent='Open your booking link';$('message').textContent='Use the confirmation link from your checkout, or contact Coach Lee for help.';return;}checking=true;if(manual){$('status-feedback').textContent='Checking payment and calendar status…';}try{const r=await fetch('/api/booking/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,token})});const b=await r.json();if(!r.ok)throw Error(b.error||'Status check failed.');if(manual)$('status-feedback').textContent='Last checked at '+new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date())+'.';$('reference').textContent=`Booking reference: ${id}`;$('details').textContent=`${new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'full',timeStyle:'short'}).format(new Date(b.start*1000))} Eastern · ${b.minutes} minutes · $${(b.amount/100).toFixed(2)}`;$('resume').hidden=true;holdExpires=['pending','creating'].includes(b.state)?b.expires:0;renderHold();$('session-summary').textContent=`${b.type} coaching · ${(b.players||[]).join(', ')} · ${b.location||'Centennial Lakes courts, Acworth, GA'}`;
 if(['confirmed','paid','expired','cancelled','cancelling','rescheduling'].includes(b.state)){paymentForm?.destroy();paymentForm=null;$('checkout-form').hidden=true;$('payment-message').textContent='';}
 if(b.state==='confirmed'){$('heading').textContent='Your session is confirmed';$('message').textContent='Payment received. Your session has been added to Coach Lee’s calendar and a calendar invitation has been requested for your email address. Check your inbox and spam folder for the court details.';}
 else if(b.state==='paid'){$('heading').textContent='Payment received';$('message').textContent='Your calendar confirmation is still pending. Please do not pay again. If this message continues, contact Coach Lee with your booking reference.';}
 else if(['cancelled','cancelling','rescheduling'].includes(b.state)){$('heading').textContent=b.state==='cancelled'?'Booking cancelled':'Booking change in progress';$('message').textContent='Contact Coach Lee for change or refund details. Cancellation does not itself confirm a refund.';}
 else if(b.state==='expired'){$('heading').textContent='This checkout has expired';$('message').textContent='This booking was not confirmed. Return to the website to choose a time again.';}
 else{if(b.client_secret&&!paymentForm&&!mounting)await mountPayment(b.client_secret,b.hasSessionReturnUrl);$('heading').textContent='Complete your booking';$('message').textContent='Complete secure payment below before your hold expires. Your session is confirmed only after payment is verified and added to Coach Lee’s calendar.';if(b.url){const u=new URL(b.url);if(u.hostname==='checkout.stripe.com'){$('resume').href=b.url;$('resume').hidden=false;}}}
 if(!['confirmed','expired','cancelled'].includes(b.state))timer=setTimeout(()=>check(),5000);
 }catch(e){$('status-feedback').textContent='Connection interrupted. Retrying automatically…';$('heading').textContent='Unable to check your booking';$('message').textContent=e.message+' If you already paid, do not pay again. Contact Coach Lee with your booking reference.';timer=setTimeout(()=>check(),5000);}finally{checking=false;}}
check();

async function mountPayment(clientSecret,hasSessionReturnUrl){
 mounting=true;
 try{
  const response=await fetch('/api/booking/config');if(!response.ok)throw Error('Payment configuration is unavailable.');const config=await response.json();
  if(!config.publishableKey||typeof Stripe!=='function')throw Error('Secure payment could not load. Refresh this page to retry your existing booking.');
  const stripe=Stripe(config.publishableKey,{betas:['custom_checkout_payment_form_1']});
  if(typeof stripe.initCheckoutFormSdk!=='function')throw Error('Secure payment is temporarily unavailable. Contact Coach Lee before trying another booking.');
  const appearance={theme:'stripe',labels:'auto',inputs:'spaced',variables:{borderRadius:'4px',colorBackground:'#ffffff',colorDanger:'#df1b41',colorPrimary:'#0570de',colorSuccess:'#00c853',colorText:'#30313d',fontFamily:'default',fontSizeBase:'16px',spacingUnit:'4px'}};
  const checkout=stripe.initCheckoutFormSdk({clientSecret:Promise.resolve(clientSecret),appearance});
  const form=checkout.createForm({layout:'expanded'});paymentForm=form;
  $('checkout-form').hidden=false;form.mount('#checkout-form');
  const result=await checkout.loadActions();
  if(result.type!=='success')throw Error(result.error?.message||'Payment could not load. Refresh to retry.');
  form.on('confirm',async event=>{
   $('payment-message').textContent='Processing payment…';
   try{
    const confirmed=await result.actions.confirm({formConfirmEvent:event,...(!hasSessionReturnUrl?{returnUrl:new URL('/booking-confirmation',location.origin).href+'#'+new URLSearchParams({id,token}).toString()}:{}),redirect:'if_required'});
    if(confirmed.type==='error')throw Error(confirmed.error.message);
    $('payment-message').textContent='Checking payment and calendar confirmation…';attempts=0;await check();
   }catch(error){$('payment-message').textContent=error.message||'Unable to confirm payment. Check booking status before retrying.';}
  });
 }catch(error){paymentForm?.destroy();paymentForm=null;$('checkout-form').hidden=true;$('payment-message').textContent=error.message;}
 finally{mounting=false;}
}
