// Browser fixture only: verifies calendar geometry without production data.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const code=fs.readFileSync('booking-schedule-controls-2.4.3.js','utf8');
const fit=code.slice(code.indexOf('function fitCalendar(){'),code.indexOf('function removeAdminFromStaff(){'));
const watch=code.match(/function watchCalendarLayout\([^\n]+/)[0];

(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const [width,height,staffCount] of [[430,850,4],[393,780,1],[360,640,4],[800,430,1],[1366,900,4]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<600,hasTouch:width<600});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}.header{height:130px}.duration-hour-grid{display:grid;box-sizing:border-box;min-height:0;grid-template-columns:40px repeat('+staffCount+',1fr)}.duration-cell,.team-head{min-height:0}.calendar-hint{display:none}.duration-end,.duration-end-cell{height:0;overflow:hidden}</style><div class="header"></div><div id="calendarContent"></div>');
  await page.addScriptTag({content:fit+'\n'+watch+'\nfunction updateCurrentTimeLine(){window.lineUpdates=(window.lineUpdates||0)+1};watchCalendarLayout();watchCalendarLayout();'});
  for(const slots of [20,40,64]){
   await page.evaluate(({count,slots})=>{const heads=Array.from({length:count+1},()=>'<div class="team-head"></div>').join('');const cells=Array.from({length:slots*count},(_,i)=>'<div class="duration-cell" style="grid-column:'+((i%count)+2)+';grid-row:'+(Math.floor(i/count)+2)+'"></div>').join('');document.getElementById('calendarContent').innerHTML='<div class="duration-hour-grid" style="grid-template-rows:auto repeat('+slots+',8px) 20px">'+heads+cells+'<div class="duration-end" style="grid-row:'+(slots+2)+'">20.00</div></div><div class="calendar-hint">Takvim 09.00–20.00 arasını gösterir. Online kapanış 19.00; ayar dışındaki mevcut randevular korunur.</div>'},{count:staffCount,slots});
   await page.waitForFunction(()=>document.querySelector('.duration-end')?.textContent==='');
   assert.match(await page.locator('.calendar-hint').textContent(),/09.00–19.00 ayarını kullanır/);
   const geometry=await page.evaluate(()=>{const grid=document.querySelector('.duration-hour-grid'),cells=grid.querySelectorAll('.duration-cell'),last=cells[cells.length-1],viewport=visualViewport?.height||innerHeight;return {grid:grid.getBoundingClientRect().toJSON(),viewport,scrollHeight:document.documentElement.scrollHeight,last:last?.getBoundingClientRect().toJSON()}});
   assert(Math.abs(geometry.last.bottom-geometry.grid.bottom)<2,'Final time row fills the calendar grid');
   assert(geometry.grid.bottom>=geometry.viewport-8&&geometry.grid.bottom<=geometry.viewport,'Configured hours fill the viewport');
   assert(geometry.scrollHeight<=geometry.viewport+1,'Day view does not scroll vertically');
  }
  assert.equal(await page.evaluate(()=>lineUpdates),3,'One observer per calendar');
  await page.setViewportSize({width:height,height:width});
  await page.evaluate(()=>fitCalendar());
  const rotated=await page.locator('.duration-hour-grid').boundingBox();
  assert(rotated.y+rotated.height>=width-8&&rotated.y+rotated.height<=width,'Rotation refits the day grid');
  await page.evaluate(()=>{document.getElementById('calendarContent').innerHTML='<div class="team-month-grid">Ay görünümü</div><div class="calendar-hint">Ay bilgisi</div>';fitCalendar()});
  assert.equal(await page.locator('.team-month-grid').textContent(),'Ay görünümü','Month view remains unchanged');
  await page.close();
 }
 console.log('PASS mobile/desktop calendar height: viewport fill without vertical scroll for changed work hours, employee columns, repaint, rotation and month view');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
