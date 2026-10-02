// Browser fixture only: no production URL or database connection.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const html=fs.readFileSync('salon-modern.html','utf8'),admin=fs.readFileSync('booking-schedule-admin-2.4.1.js','utf8');
const helperNames=['appointmentFormDuration','appointmentOverlaps','appointmentConflictFor','appointmentOverlapText','appointmentActionConfirm'];
const helpers=helperNames.map(name=>html.split(/\r?\n/).find(line=>line.startsWith('function '+name+'('))).join('\n');
const setup=`var currentUser={id:'manager',role:'yonetici',name:'Yönetici'},editingAppointmentId=null,remoteClients=[],teamCalendarMode='day',teamCalendarMember='';
var staff=[['Halil'],['Talip']],remoteProfiles=[{id:'e1',full_name:'Halil',active:true},{id:'e2',full_name:'Talip',active:true}],remoteClosedSlots=[];
var appts=[{id:'a1',customer:'Test',operation:'Hizmet',serviceId:'s1',employeeId:'e1',staff:'Halil',date:'2026-10-05',time:'10:45',duration:25,amount:100,phone:''}],calls=[],failure=false,opened=0;
function selectedTeamDate(){return '2026-10-05'}function localDate(){return '2026-10-01'}function appointmentDate(x){return x.date}function closedSlotStamp(d,t){return Date.parse(d+'T'+t+':00+03:00')}function closedSlotFor(){return null}function serviceByName(){return {id:'s1',duration_minutes:45}}function profileForEmployeeName(n){return remoteProfiles.find(p=>p.full_name===n)}function remoteSchedule(d,t){return d+'T'+t+':00+03:00'}function appointmentClick(){opened++}function showAppToast(t,b){window.lastToast=t+' '+b}function appointmentUpdateNeedsWhatsApp(){return false}function whatsappAppointmentUpdateUrl(){throw Error('Unexpected WhatsApp')}function reloadRemoteData(){return Promise.resolve()}function calendarAppointmentsForMember(){return appts}function friendlyDate(d){return d}function safe(x){return String(x).replace(/</g,'&lt;').replace(/"/g,'&quot;')}function jsAttr(x){return '&quot;'+x+'&quot;'}function timeForCalendar(t){return t}function appointmentHasOpenDebt(){return false}function toIstanbul(v){return {date:v.slice(0,10),time:v.slice(11,16)}}function renderCalendar(){}function openSlotChoice(t,s){window.lastSlot=[t,s]}function selectTeamMember(){}function moveTeamCalendar(){}function openTeamMonth(){};
var salonDb={from(){return {update(payload){return {eq(k,id){return {select(){calls.push({id,payload});return Promise.resolve({data:failure?null:[{id}],error:failure?{message:'Test failure'}:null})}}}}}}}};
var settings={open:540,close:1200,enabled:true},overrides=new Map(),DEFAULT_OPEN=540,DEFAULT_CLOSE=1140;`;
const renderer=admin.split(/\r?\n/).filter(line=>/^(function (minutes|label|effective|manager|range)\(|renderCalendar=function)/.test(line)).join('\n');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const context=await browser.newContext({viewport:{width:430,height:850},hasTouch:true,isMobile:true});const page=await context.newPage();
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>.duration-hour-grid{display:grid;height:700px}.duration-cell{min-height:12px}.duration-event{z-index:7}.modal{position:fixed;inset:0;background:#ddd;z-index:100}.sheet{padding:20px}</style><div id="calendarContent"></div>');
 await page.addScriptTag({content:setup+'\n'+helpers+'\nvar beforeRender=renderCalendar;\n'+renderer+'\nrenderCalendar();'});
 await page.addScriptTag({content:fs.readFileSync('appointment-form-actions-2.3.30.js','utf8')});
 const cell=(time,staff)=>page.locator('[data-calendar-time="'+time+'"][data-calendar-staff="'+staff+'"]');
 assert.equal(await cell('10:15','Halil').count(),1);await cell('10:15','Halil').click();assert.deepEqual(await page.evaluate(()=>lastSlot),['10:15','Halil']);
 await page.locator('[data-appointment-id="a1"]').click();assert.equal(await page.evaluate(()=>opened),1);
 await page.locator('[data-appointment-id="a1"]').dragTo(cell('11:15','Talip'));
 assert.equal(await page.locator('#appointmentActionConfirmation').count(),1);assert.equal(await page.evaluate(()=>calls.length),0);
 await page.getByRole('button',{name:'Vazgeç',exact:true}).click();assert.equal(await page.evaluate(()=>calls.length),0);
 const session=await context.newCDPSession(page),card=await page.locator('[data-appointment-id="a1"]').boundingBox(),target=await cell('11:15','Halil').boundingBox();
 const touch=(type,x,y)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}],modifiers:0});
 await touch('touchStart',card.x+10,card.y+5);await touch('touchMove',card.x+10,card.y+30);await touch('touchEnd');assert.equal(await page.locator('#appointmentActionConfirmation').count(),0,'Early scroll must not drag');
 await page.waitForTimeout(650);await page.locator('[data-appointment-id="a1"]').scrollIntoViewIfNeeded();const freshCard=await page.locator('[data-appointment-id="a1"]').boundingBox(),freshTarget=await cell('11:15','Halil').boundingBox();await touch('touchStart',freshCard.x+10,freshCard.y+5);await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>!!window.salonCalendarDragging),true,'Long press activates drag');await touch('touchMove',freshTarget.x+10,freshTarget.y+5);await touch('touchEnd');
 assert.equal(await page.locator('#appointmentActionConfirmation').count(),1);await page.getByRole('button',{name:'Taşı',exact:true}).click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>calls.length),1);assert.equal(await page.evaluate(()=>calls[0].payload.scheduled_at),'2026-10-05T11:15:00+03:00');
 await page.evaluate(()=>{appts.push({id:'busy',customer:'Busy',employeeId:'e2',date:'2026-10-05',time:'11:00',duration:60});});
 await page.locator('[data-appointment-id="a1"]').dragTo(cell('11:30','Talip'));assert.equal(await page.locator('#appointmentActionConfirmation').count(),0);assert.match(await page.evaluate(()=>lastToast),/Bu saat dolu/);assert.equal(await page.evaluate(()=>calls.length),1);
 await page.evaluate(()=>{appts.pop();failure=true});await page.locator('[data-appointment-id="a1"]').dragTo(cell('11:30','Talip'));await page.getByRole('button',{name:'Taşı',exact:true}).click();await page.waitForTimeout(30);assert.match(await page.evaluate(()=>lastToast),/Taşınamadı/);assert.equal(await page.locator('[data-appointment-id="a1"]').count(),1);
 await page.evaluate(()=>{failure=false;currentUser={id:'e1',role:'calisan',name:'Halil'}});await page.locator('[data-appointment-id="a1"]').dragTo(cell('12:00','Talip'));assert.equal(await page.locator('#appointmentActionConfirmation').count(),0,'Employee cannot reassign');
 assert.equal(await page.evaluate(()=>appointmentOverlaps('2026-10-05','11:00',30,'e1').length),1);assert.equal(await page.evaluate(()=>appointmentOverlaps('2026-10-05','11:00',30,'e1')[0].minutes),10);assert.equal(await page.evaluate(()=>appointmentOverlaps('2026-10-05','11:10',30,'e1').length),0);
 await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<input id="appointmentOperation" value="Hizmet">');editingAppointmentId='a1'});assert.equal(await page.evaluate(()=>appointmentFormDuration()),25,'Date/time-only edit preserves saved duration');await page.evaluate(()=>{editingAppointmentId=null});assert.equal(await page.evaluate(()=>appointmentFormDuration()),45,'New booking uses service duration');
 console.log('PASS browser: quarter-hour targets, tap, 400ms long press, early scroll, desktop move/cancel, one write, failure, employee transfer restriction, exact 10-minute overlap and equality boundary');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
