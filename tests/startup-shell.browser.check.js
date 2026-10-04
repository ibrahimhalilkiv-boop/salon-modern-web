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
  await page.goto('https://salon.test/salon-modern.html?date=2026-10-03&appointment=fixture&kind=appointment_reminder&notification=fixture-cold');
  await page.waitForFunction(()=>typeof SalonWebPush==='object'&&typeof getSalonAuthState==='function');
  assert.deepEqual(errors,[],'Removed home must not break initial inline scripts');
  assert(!await page.locator('#home').innerText().then(text=>text.includes('Haftalık gelir')));
  await page.evaluate(()=>{currentUser={id:'fixture',name:'Fixture',role:'yonetici'};salonPhase2RenderHome()});
  assert(await page.locator('.phase2-home').count());
  await page.evaluate(()=>{
   window.fixtureWhatsApp=0;
   appts=[{id:'fixture',customer:'Fixture',phone:'05321234567',date:'2026-10-03',time:'15:00',staff:'Fixture',amount:0}];
   window.getSalonAuthState=()=> 'AUTHENTICATED';
   whatsappReminderUrl=()=>{window.fixtureWhatsApp++;return '#whatsapp'};
   enterApp();
  });
  await page.waitForFunction(()=>window.fixtureWhatsApp===1,{timeout:3000});
  assert.deepEqual(errors,[]);
  const menuLabels=()=>page.evaluate(()=>Array.from(document.querySelectorAll('.drawer .menu-item')).filter(button=>!button.closest('.hidden')&&!button.hidden).map(button=>button.textContent.replace(/^[^\p{L}]+/u,'').replace(/\s+/g,' ').trim()));
  const expectedMenu=['Ana sayfa','Takvim','İstatistikler','Çalışan Performansı','Günlük kasa','Ürün ve stok','Satış','Borçlar','Müşteriler','Akıllı Müşteri Analizi','Randevu Yönetimi','Yönetim paneli','Hesaptan çıkış yap'];
  assert.deepEqual(await menuLabels(),expectedMenu,'Manager menu uses requested order without notification/recovery links');
  await page.evaluate(()=>{simplifyNavigation();toggleDrawer();toggleDrawer()});
  assert.deepEqual(await menuLabels(),expectedMenu,'Repeated installers keep menu stable');
  await page.evaluate(()=>{currentUser.role='personel';enterApp()});
  const staffMenu=await menuLabels();
  for(const label of ['Günlük kasa','Ürün ve stok','Satış','Borçlar','Müşteriler','Çalışan Performansı','Yönetim paneli'])assert(!staffMenu.includes(label),'Staff permissions retained: '+label);
  assert(staffMenu.includes('Randevu Yönetimi'));
  await page.evaluate(()=>{currentUser.role='yonetici';enterApp()});
  assert.deepEqual(await menuLabels(),expectedMenu,'Manager menu restored after role change');
  console.log('PASS requested menu order, repeated initialization and manager/staff visibility; push runtime preserved');
  await page.evaluate(()=>{
   window.fixtureWrites=[];
   const query=()=>{const q={then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)}};
    for(const method of ['select','eq','neq','gte','gt','lte','lt','in','order','limit','range','is','or'])q[method]=()=>q;
    q.maybeSingle=q.single=()=>Promise.resolve({data:null,error:null});
    for(const method of ['insert','update','delete','upsert'])q[method]=()=>{fixtureWrites.push(method);throw Error('Unexpected fixture mutation')};return q};
   window.salonDb={from:()=>query(),rpc:()=>Promise.resolve({data:{},error:null}),auth:{getSession:()=>Promise.resolve({data:{session:{access_token:'fixture'}},error:null})}};
  });
  for(const viewport of [{width:430,height:850},{width:1440,height:900}]){
   await page.setViewportSize(viewport);
   const pages=await page.evaluate(()=>Array.from(document.querySelectorAll('#app > .page')).map(p=>p.id));
   for(const id of pages){
    if(['finance','team','bookingRequests'].includes(id))continue;
    await page.evaluate(id=>showPage(id),id);
    assert(await page.locator('#'+id).count(),'Page exists: '+id);
   }
   await page.evaluate(()=>openAppointmentModal('19:30',null,'Fixture'));
   assert(await page.locator('#appointmentModal').isVisible());
   await page.evaluate(()=>closeAppointmentModal());
   await page.evaluate(()=>openFinance230('closing'));
   await page.waitForFunction(()=>document.getElementById('finance230PeriodSummary')?.textContent.includes('Seçilen dönemde kalan'));
   await page.evaluate(()=>openFinance230Products());
   console.log('PASS full-shell '+viewport.width+'px navigation: '+pages.join(', '));
  }
  assert.deepEqual(await page.evaluate(()=>fixtureWrites),[]);
  assert.deepEqual(errors,[],'Full shell page navigation must not throw');
  console.log('PASS actual local shell startup, reminder route, modern home, mobile/desktop navigation, appointment form and cash/product screens; zero fixture writes');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
