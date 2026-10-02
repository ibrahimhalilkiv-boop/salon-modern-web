const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const code=fs.readFileSync('booking-schedule-controls-2.4.3.js','utf8');
const funcs=['fitCalendar','watchCalendarLayout'].map(name=>code.match(new RegExp('function '+name+'\\([^\\n]+'))[0]).join('\n');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [430,1366]){const page=await browser.newPage({viewport:{width,height:850}});
 await page.setContent('<style>.duration-hour-grid{display:grid;height:500px;grid-template-columns:40px 1fr}.duration-end,.duration-end-cell{height:0;overflow:hidden}</style><div id="calendarContent"></div>');
 await page.addScriptTag({content:funcs+';function updateCurrentTimeLine(){window.lineUpdates=(window.lineUpdates||0)+1};watchCalendarLayout();watchCalendarLayout();'});
 for(let i=0;i<3;i++){await page.evaluate(()=>{const cells=Array.from({length:10},(_,i)=>'<div class="duration-cell" style="grid-column:2;grid-row:'+(i+2)+'"></div>').join('');document.getElementById('calendarContent').innerHTML='<div class="duration-hour-grid" style="grid-template-rows:auto repeat(10,8px) 20px"><div class="team-head">Saat</div><div class="team-head">Talip</div>'+cells+'<div class="duration-end" style="grid-row:12">20.00</div></div><div class="calendar-hint">Takvim 09.00–20.00 arasını gösterir. Online kapanış 19.00; ayar dışındaki mevcut randevular korunur.</div>'});await page.waitForTimeout(70);
 assert.equal(await page.locator('.duration-end').textContent(),'');assert.match(await page.locator('.calendar-hint').textContent(),/09.00–19.00 ayarını kullanır/);const grid=await page.locator('.duration-hour-grid').boundingBox(),cell=await page.locator('.duration-cell').last().boundingBox();assert(Math.abs(cell.y+cell.height-grid.y-grid.height)<2,'Repaint fills full grid height');assert(cell.height>40);}
 assert.equal(await page.evaluate(()=>lineUpdates),3,'One observer per calendar');await page.close();
 }console.log('PASS mobile/desktop repeated calendar repaint: full-height rows, hidden end label, corrected hint and singleton observer');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
