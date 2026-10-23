// Browser fixture: checks the existing team calendar without writing customer data.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const root=process.cwd();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg'};

(async()=>{
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
    const file=path.resolve(root,name);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const width of [320,360,390,1280]){
      const page=await browser.newPage({viewport:{width,height:800},isMobile:width<600,hasTouch:width<600,serviceWorkers:'block'});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://oxuwwjsakhcqimjsfris.supabase.co/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
      await page.goto(`http://127.0.0.1:${server.address().port}/salon-modern.html`,{waitUntil:'networkidle'});
      await page.evaluate(()=>{
        currentUser={id:'manager-fixture',role:'yonetici',name:'Halil Kıv'};
        staff=[['Mehmet Şafakoğlu'],['Halil Kıv'],['Cengiz Bavkır'],['Talip Köse']];
        remoteProfiles=[
          {id:'m',full_name:'Mehmet Şafakoğlu',username:'mehmet.safakoglu',calendar_color:'#ea580c',active:true},
          {id:'h',full_name:'Halil Kıv',username:'halil.kiv',calendar_color:'#2563eb',active:true},
          {id:'c',full_name:'Cengiz Bavkır',username:'cengiz.bavkir',calendar_color:'#15803d',active:true},
          {id:'t',full_name:'Talip Köse',username:'talip.kose',calendar_color:'#7c3aed',active:true}
        ];
        remoteServices=[{name:'Saç + Sakal'}];remoteClosedSlots=[];
        appts=[
          {id:'fixture-one',date:'2026-10-23',time:'10:30',customer:'Ahmet Yılmaz',staff:'Halil Kıv',operation:'Saç + Sakal',amount:750,duration:30,status:'confirmed',employeeId:'h'},
          {id:'fixture-cancel',date:'2026-10-23',time:'11:30',customer:'İptal Müşteri',staff:'Halil Kıv',operation:'Saç',amount:300,duration:30,status:'confirmed',employeeId:'h'}
        ];
        teamCalendarDate='2026-10-23';teamCalendarMode='day';teamCalendarMember=undefined;
        window.salonCalendarLoadState={status:'ready'};
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('auth').classList.add('hidden');
        document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
        document.getElementById('calendar').classList.add('active');renderCalendar();
      });
      assert.equal(await page.locator('#calendar .duration-hour-grid > button.team-head').count(),4);
      assert.deepEqual(await page.locator('#calendar .duration-hour-grid > button.team-head').allTextContents(),['Mehmet','Halil','Cengiz','Talip']);
      const card=page.locator('#calendar [data-appointment-id="fixture-one"]');
      assert.match(await card.innerText(),/Ahmet Yılmaz/);
      assert.match(await card.innerText(),/Saç \+ Sakal/);
      assert.match(await card.innerText(),/₺\s*750/);
      assert.equal(await page.locator('#calendarContent button[aria-label^="Önceki"],#calendarContent button[aria-label^="Sonraki"]').count(),0);
      assert.doesNotMatch(await page.locator('#calendarContent').innerText(),/Ay görünümü|Aylık görünüm|Tüm ekip randevuları|Çalışan seçin/);
      const geometry=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight,grid:document.querySelector('#calendar .duration-hour-grid').getBoundingClientRect().toJSON(),background:getComputedStyle(document.querySelector('[data-appointment-id="fixture-one"]')).backgroundColor,border:getComputedStyle(document.querySelector('[data-appointment-id="fixture-one"]')).borderLeftColor}));
      assert(geometry.body<=geometry.viewport+1,`No horizontal scroll at ${width}px: ${JSON.stringify(geometry)}`);
      assert(geometry.scrollHeight<=geometry.viewportHeight+1,`No vertical scroll at ${width}px: ${JSON.stringify(geometry)}`);
      assert(geometry.grid.bottom>=geometry.viewportHeight-8&&geometry.grid.bottom<=geometry.viewportHeight+1,`Calendar fills viewport at ${width}px: ${JSON.stringify(geometry)}`);
      assert.notEqual(geometry.background,'rgb(234, 216, 189)');
      assert.equal(geometry.border,'rgb(37, 99, 235)');
      const headers=await page.locator('#calendar .duration-hour-grid > button.team-head').evaluateAll(nodes=>nodes.map(node=>({background:getComputedStyle(node).backgroundColor,border:getComputedStyle(node).borderBottomColor})));
      assert.equal(new Set(headers.map(node=>node.background)).size,1,'Employee headings share a neutral background');
      assert.equal(new Set(headers.map(node=>node.border)).size,1,'Employee headings have no individual color stripe');
      await page.evaluate(()=>{appts.push({id:'fixture-large-price',date:'2026-10-23',time:'12:30',customer:'Uzun Müşteri Adı',staff:'Mehmet Şafakoğlu',operation:'Saç + Sakal',amount:9999999.99,duration:30,status:'confirmed',employeeId:'m'},{id:'fixture-missing-price',date:'2026-10-23',time:'13:30',customer:'Diğer Müşteri',staff:'Cengiz Bavkır',operation:'Saç + Sakal',amount:null,duration:30,status:'confirmed',employeeId:'c'});renderCalendar()});
      if(width===320)await page.setViewportSize({width,height:480});
      await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
      const priceGeometry=await page.locator('#calendar [data-appointment-id="fixture-large-price"]').evaluate(node=>{const price=node.querySelector('.calendar-price'),card=node.getBoundingClientRect(),bounds=price.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(price);const ink=range.getBoundingClientRect();return {text:price.textContent,clientWidth:price.clientWidth,scrollWidth:price.scrollWidth,top:bounds.top,bottom:bounds.bottom,cardTop:card.top,cardBottom:card.bottom,cardLeft:card.left,cardRight:card.right,inkLeft:ink.left,inkRight:ink.right}});
      assert.match(priceGeometry.text,/9\.999\.999,99/);
      assert(priceGeometry.scrollWidth<=priceGeometry.clientWidth+1,`Price must be fully visible at ${width}px: ${JSON.stringify(priceGeometry)}`);
      assert(priceGeometry.top>=priceGeometry.cardTop-1&&priceGeometry.bottom<=priceGeometry.cardBottom+1,`Price must fit card height at ${width}px: ${JSON.stringify(priceGeometry)}`);
      const missingPrice=await page.locator('#calendar [data-appointment-id="fixture-missing-price"]').evaluate(node=>{const price=node.querySelector('.calendar-price'),card=node.getBoundingClientRect(),bounds=price.getBoundingClientRect();return {text:price.textContent,clientWidth:price.clientWidth,scrollWidth:price.scrollWidth,top:bounds.top,bottom:bounds.bottom,cardTop:card.top,cardBottom:card.bottom}});
      assert.equal(missingPrice.text,'Ücret yok');
      assert(missingPrice.scrollWidth<=missingPrice.clientWidth+1,`Missing-price label must be fully visible at ${width}px: ${JSON.stringify(missingPrice)}`);
      assert(missingPrice.bottom<=missingPrice.cardBottom+1,`Missing-price label must fit card height at ${width}px: ${JSON.stringify(missingPrice)}`);
      const serviceStyle=await page.locator('#calendar [data-appointment-id="fixture-missing-price"] small').evaluate(node=>({whiteSpace:getComputedStyle(node).whiteSpace,display:getComputedStyle(node).display}));
      assert.equal(serviceStyle.whiteSpace,'nowrap','Service stays on one line');
      const cardOrder=await page.locator('#calendar [data-appointment-id="fixture-missing-price"]').evaluate(node=>{const service=node.querySelector('small'),price=node.querySelector('.calendar-price');return {children:Array.from(node.children).map(child=>child.className||child.tagName),serviceBottom:service.getBoundingClientRect().bottom,priceTop:price.getBoundingClientRect().top,serviceVisible:getComputedStyle(service).display!=='none'}});
      assert.deepEqual(cardOrder.children,['STRONG','SMALL','calendar-price']);
      if(cardOrder.serviceVisible)assert(cardOrder.serviceBottom<=cardOrder.priceTop+1,'Service appears above the price');
      await page.locator('#calendar [data-appointment-id="fixture-missing-price"]').click();
      assert.match(await page.locator('#smartPanelDetails').innerText(),/Ücret belirtilmemiş/,'Full missing-price detail remains available');
      await page.locator('.smart-panel-close').click();
      if(process.env.SALON_CALENDAR_SCREENSHOT&&width===320)await page.screenshot({path:process.env.SALON_CALENDAR_SCREENSHOT,fullPage:true});
      await page.evaluate(()=>{appts=appts.filter(item=>!['fixture-large-price','fixture-missing-price'].includes(item.id));renderCalendar()});
      await page.locator('#smartFilters summary').click();
      assert.equal(await page.locator('#smartService').isVisible(),true);
      await page.locator('#smartFilters summary').click();
      await page.locator('#smartColors summary').click();
      assert.equal(await page.locator('#smartColorList input[type="color"]').count(),4);
      await page.locator('#smartColors summary').click();
      if(process.env.SALON_CALENDAR_SCREENSHOT&&width===390)await page.screenshot({path:process.env.SALON_CALENDAR_SCREENSHOT,fullPage:true});
      await page.evaluate(()=>{appts.find(item=>item.id==='fixture-cancel').status='cancelled';renderCalendar()});
      assert.equal(await page.locator('#calendar [data-appointment-id="fixture-cancel"]').count(),0);
      assert.match(await page.locator('#calendar .calendar-date-title').innerText(),/1 randevu/);
      assert.equal(await page.evaluate(()=>appts.find(item=>item.id==='fixture-cancel').status),'cancelled','Cancelled record stays in appointment data');
      await page.evaluate(()=>{currentUser={id:'h',role:'personel',name:'Halil Kıv'};renderCalendar()});
      assert.equal(await page.locator('#calendar [data-appointment-id="fixture-cancel"]').count(),0,'Employee calendar hides cancelled');
      await page.evaluate(()=>{currentUser={id:'manager-fixture',role:'yonetici',name:'Halil Kıv'};renderCalendar()});
      await page.evaluate(()=>{window.salonCalendarLoadState={status:'ready'};teamCalendarMode='week';renderCalendar()});
      assert.equal(await page.locator('#calendar [data-smart-id="fixture-cancel"]').count(),0,'Week hides cancelled');
      assert.equal(await page.locator('#calendar [data-smart-id="fixture-one"]').count(),1);
      await page.evaluate(()=>{teamCalendarMode='day';renderCalendar()});
      await page.locator('#calendar .duration-hour-grid > button.team-head').filter({hasText:'Halil'}).click();
      assert.equal(await page.locator('#calendar .duration-hour-grid > button.team-head').count(),1);
      await page.locator('#calendar .duration-hour-grid > button.team-head').click();
      assert.equal(await page.locator('#calendar .duration-hour-grid > button.team-head').count(),4);
      await page.locator('#calendar .calendar-date-title').click();
      assert.equal(await page.locator('#calendar .team-month-grid').count(),1);
      assert.doesNotMatch(await page.locator('#calendarContent').innerText(),/Aylık görünüm/);
      assert.match(await page.locator('#calendar .team-month-grid button').filter({hasText:/^23/}).innerText(),/1 randevu/);
      assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+1,'Month fits viewport');
      await page.locator('#calendar .calendar-month-title').click();
      await page.locator('#teamCalendarMonthPicker').fill('2026-11');
      assert.match(await page.locator('#calendar .calendar-month-title').innerText(),/Kasım 2026/i);
      await page.locator('#calendar .team-month-grid button:not([disabled])').first().click();
      assert.equal(await page.locator('#calendar .duration-hour-grid').count(),1);
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('PASS team calendar: cancelled record retained but hidden for manager/employee in day, week and month; colors, price, service and layout intact');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
