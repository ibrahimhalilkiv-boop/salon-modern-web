// Local fixture: external requests are blocked; no production session or data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({serviceWorkers:'block'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='https://salon.test')return route.abort();
   const file=path.resolve(process.cwd(),'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(process.cwd()+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   const ext=path.extname(file),type=ext==='.js'?'application/javascript':ext==='.html'?'text/html':ext==='.css'?'text/css':'application/octet-stream';
   return route.fulfill({contentType:type,body:fs.readFileSync(file)});
  });
  await page.goto('https://salon.test/salon-modern.html');
  await page.waitForFunction(()=>typeof SalonWebPush==='object'&&typeof getSalonAuthState==='function');
  assert.deepEqual(errors,[],'Removed home must not break initial inline scripts');
  assert(!await page.locator('#home').innerText().then(text=>text.includes('Haftalık gelir')));
  await page.evaluate(()=>{currentUser={id:'fixture',name:'Fixture',role:'yonetici'};salonPhase2RenderHome()});
  assert(await page.locator('.phase2-home').count());
  assert.deepEqual(errors,[]);
  console.log('PASS actual local shell boot and modern home after retired UI removal');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
