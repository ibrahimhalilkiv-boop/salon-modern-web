// Browser fixture only: verifies calendar geometry without production data.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const code=fs.readFileSync('booking-schedule-controls-2.4.3.js','utf8');
const fit=code.slice(code.indexOf('function fitCalendar(){'),code.indexOf('function removeAdminFromStaff(){'));
const watch=code.match(/function watchCalendarLayout\([^\n]+/)[0];

(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const [width,height,staffCount] of [[430,850,4],[393,780,1],[360,640,4],[800,430,1],[1366,900,4]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<600,hasTouch:width<600});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}.header{height:130px}.duration-hour-grid{display:grid;min-height:570px;grid-template-columns:40px repeat('+staffCount+',1fr)}.calendar-hint{height:24px;margin:7px 0 0}.duration-end,.duration-end-cell{height:0;overflow:hidden}</style><div class="header"></div><div id="calendarContent"></div>');
  await page.addScriptTag({content:fit+'\n'+watch+'\nfunction updateCurrentTimeLine(){window.lineUpdates=(window.lineUpdates||0)+1};watchCalendarLayout();watchCalendarLayout();'});
  for(let i=0;i<3;i++){
   await page.evaluate(count=>{const heads=Array.from({length:count+1},()=>'<div class="team-head"></div>').join('');const cells=Array.from({length:10*count},(_,i)=>'<div class="duration-cell" style="grid-column:'+((i%count)+2)+';grid-row:'+(Math.floor(i/count)+2)+'"></div>').join('');document.getElementById('calendarContent').innerHTML='<div class="duration-hour-grid" style="grid-template-rows:auto repeat(10,8px) 20px">'+heads+cells+'<div class="duration-end" style="grid-row:12">20.00</div></div><div class="calendar-hint">Takvim 09.00–20.00 arasını gösterir. Online kapanış 19.00; ayar dışındaki mevcut randevular korunur.</div>'},staffCount);
   await page.waitForFunction(()=>document.querySelector('.duration-end')?.textContent==='');
   assert.match(await page.locator('.calendar-hint').textContent(),/09.00–19.00 ayarını kullanır/);
   const geometry=await page.evaluate(()=>{const grid=document.querySelector('.duration-hour-grid'),hint=document.querySelector('.calendar-hint'),cells=grid.querySelectorAll('.duration-cell'),last=cells[cells.length-1],viewport=visualViewport?.height||innerHeight;return {grid:grid.getBoundingClientRect().toJSON(),hint:hint.getBoundingClientRect().toJSON(),viewport,scrollHeight:document.documentElement.scrollHeight,last:last?.getBoundingClientRect().toJSON()}});
   assert(Math.abs(geometry.last.bottom-geometry.grid.bottom)<2,'Final time row fills the calendar grid');
   assert(geometry.hint.top>=geometry.grid.bottom,'Information text stays below the grid');
   if(geometry.viewport-geometry.grid.top-geometry.hint.height-7-14>=570){
    assert(geometry.hint.bottom<=geometry.viewport-10,'Information text stays above the mobile navigation area');
    assert(geometry.viewport-geometry.hint.bottom<=17,'Grid fills the usable viewport');
   }else assert(geometry.scrollHeight>geometry.viewport,'Small screens can scroll without shrinking rows');
  }
  assert.equal(await page.evaluate(()=>lineUpdates),3,'One observer per calendar');
  await page.setViewportSize({width:height,height:width});
  await page.evaluate(()=>fitCalendar());
  assert((await page.locator('.duration-hour-grid').boundingBox()).height>=570,'Rotation keeps readable rows');
  await page.evaluate(()=>{document.getElementById('calendarContent').innerHTML='<div class="team-month-grid">Ay görünümü</div><div class="calendar-hint">Ay bilgisi</div>';fitCalendar()});
  assert.equal(await page.locator('.team-month-grid').textContent(),'Ay görünümü','Month view remains unchanged');
  await page.close();
 }
 console.log('PASS mobile/desktop calendar height: viewport fill, safe bottom, small-screen scroll, employee columns, repaint, rotation and month view');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
