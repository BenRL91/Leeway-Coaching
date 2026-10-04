import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});
for(const file of ['index.js','domain.js','providers.js','setup.js','maintenance.js','breakdowns.js'])fs.copyFileSync('worker/'+file,'dist/server/'+file);
const assets={};for(const file of fs.readdirSync('public')){const imageType=file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':null;const binary=Boolean(imageType);const type=binary?imageType:file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8';const body=fs.readFileSync('public/'+file,binary?undefined:'utf8');assets['/'+file]={body:binary?body.toString('base64'):body,base64:binary,type};}
for(const slug of ['booking-info','privacy','terms'])assets['/'+slug]=assets['/'+slug+'.html'];
assets['/booking-confirmation']=assets['/booking-confirmation.html'];fs.writeFileSync('dist/server/assets.js','export const assets='+JSON.stringify(assets)+';\n');fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');console.log('Built booking Worker and website assets.');
