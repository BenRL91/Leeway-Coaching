export const TZ='America/New_York';
export const CALENDAR='leewaypb@gmail.com';
export class Problem extends Error {constructor(message,status=400){super(message);this.status=status;}}
export const nowSeconds=()=>Math.floor(Date.now()/1000);
export function localParts(sec){return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(sec*1000)).map(p=>[p.type,p.value]));}
export function dateKey(sec){const p=localParts(sec);return `${p.year}-${p.month}-${p.day}`;}
export function validSlot(start,minutes,now=nowSeconds(),allowCall=false){
 if(!Number.isInteger(start)||!(allowCall?[30,60,90,120]:[60,90,120]).includes(minutes)||start<now+3600||start>now+60*86400)return false;
 const p=localParts(start),e=localParts(start+minutes*60),m=+p.hour*60+ +p.minute;
 const open=1020,close=1320;
 return p.weekday==='Thu'&&['00','30'].includes(p.minute)&&start%60===0&&m>=open&&m<=1260&&m+minutes<=close&&dateKey(start)===dateKey(start+minutes*60)&&(+e.hour*60+ +e.minute)<=close;
}
export function slotsForDate(date,minutes,now=nowSeconds(),allowCall=false){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z')))throw new Problem('Choose a valid date.');
 const base=Date.parse(date+'T00:00:00Z')/1000,out=[];
 for(let s=base;s<base+36*3600;s+=1800)if(dateKey(s)===date&&validSlot(s,minutes,now,allowCall))out.push(s);
 return out;
}
export function price(type,minutes,n,env={}){
 if(![60,90,120].includes(minutes))throw new Problem('Choose a 60, 90, or 120-minute session.');
 if(type==='individual'&&n===1)return Math.round(99*minutes/60)*100;
 if(type==='doubles'&&n===2)return Math.round(59*minutes/60)*2*100;
 if(type==='group'&&n>=3&&n<=8){
  let rates;try{rates=JSON.parse(env.GROUP_RATES_JSON||'null')}catch{}
  if(!rates)throw new Problem('Group pricing is being finalized. Please request a quote by email.',409);
  let prev=Infinity;for(let c=3;c<=8;c++){const r=rates[c];if(!Number.isInteger(r)||r<2500||r>4000||r>=prev)throw new Problem('Group booking is not ready yet.',503);prev=r;}
  return Math.round(rates[n]/100*minutes/60)*n*100;
 }
 throw new Problem('Check the session type and player count.');
}
export function cleanPayload(b,env,now=nowSeconds()){
 if(!b||typeof b!=='object'||!Array.isArray(b.players))throw new Problem('Enter the player details.');
 const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase();
 if(!name||name.length>100||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180)throw new Problem('Enter a valid name and email.');
 const players=b.players.map(p=>String(p).trim());if(players.some(p=>!p||p.length>100))throw new Problem('Enter a name for every player.');
 const type=b.type,minutes=Number(b.minutes),start=Number(b.start),amount=price(type,minutes,players.length,env);
 if(!validSlot(start,minutes,now))throw new Problem('Choose a Thursday start between 5 and 9 p.m. Eastern, ending by 10 p.m.');
 return {type,minutes,start,end:start+minutes*60,amount,name,email,players,goals:String(b.goals||'').slice(0,2000)};
}
export function lockedSlots(start,end,buffer=0){const slots=[];for(let s=start;s<end+buffer*60;s+=1800)slots.push(s);return slots;}
export function overlaps(start,end,busy){return busy.some(b=>start<b.end&&end>b.start);}
export const configured=env=>env.BOOKING_ENABLED==='true'&&!!env.DB&&['STRIPE_PUBLISHABLE_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','COURT_LOCATION'].every(k=>!!env[k])&&['0','15','30'].includes(env.BUFFER_MINUTES);

// Select one environment only; sandbox never falls back to live credentials.
export function stripeEnvironment(env){
 const mode=env.STRIPE_MODE||'sandbox',sandbox=mode==='sandbox';
 const pk=String((sandbox?env.STRIPE_SANDBOX_PUBLISHABLE_KEY:env.STRIPE_PUBLISHABLE_KEY)||'').trim();
 const sk=String((sandbox?env.STRIPE_SANDBOX_SECRET_KEY:env.STRIPE_SECRET_KEY)||'').trim();
 const valid=['sandbox','live'].includes(mode)&&new RegExp('^pk_'+(sandbox?'test':'live')+'_').test(pk||'')&&new RegExp('^[sr]k_'+(sandbox?'test':'live')+'_').test(sk||'');
 return {...env,STRIPE_MODE:mode,STRIPE_PUBLISHABLE_KEY:valid?pk:'',STRIPE_SECRET_KEY:valid?sk:'',STRIPE_WEBHOOK_SECRET:valid?(sandbox?env.STRIPE_SANDBOX_WEBHOOK_SECRET:env.STRIPE_WEBHOOK_SECRET)||'':''};
}
