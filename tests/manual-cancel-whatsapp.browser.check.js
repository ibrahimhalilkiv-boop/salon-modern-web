const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const page=await browser.newPage();await page.setContent('<div id="appointmentModal"><div class="sheet"></div></div>');
await page.evaluate(()=>{
  window.appts=[];window.editingAppointmentId=null;window.responseMode='ready';window.opened=[];window.calls=[];
  window.canManageOwnAppointment=()=>true;window.confirm=()=>true;window.safe=value=>value;
  window.friendlyDate=value=>value;window.appointmentDate=item=>item.date;
  window.renderHomeSummary=()=>{};window.render=()=>{};window.renderCalendar=()=>{};window.renderStatistics=()=>{};
  window.reloadRemoteData=async()=>{};window.closeAppointmentModal=()=>{};window.showAppToast=(title,body)=>{window.lastToast={title,body}};
  window.appointmentTemplateValues=(customer,date,time,staff)=>({'{musteri_adi}':customer,'{randevu_tarihi}':date,'{randevu_saati}':time,'{calisan_adi}':staff});
  window.renderSavedTemplate=(key,values)=>{window.templateKey=key;return 'Merhaba '+values['{musteri_adi}']+' 👋\n📅 '+values['{randevu_tarihi}']+' 🕒 '+values['{randevu_saati}']+' 👤 '+values['{calisan_adi}']};
  window.open=url=>{window.opened.push(url);return null};
  window.salonDb={rpc:async(name,args)=>{window.calls.push(name);if(name==='cancel_appointment')return window.responseMode==='error'?{error:{message:'İptal reddedildi'}}:{data:{status:'cancelled',replayed:window.responseMode==='replayed'}};if(name==='get_manual_cancel_whatsapp')return {data:window.responseMode==='declined'?{status:'contact_declined'}:{status:'ready',appointment_id:args.p_appointment_id,client_name:'Ayşe Yılmaz',phone:'905321234567',scheduled_at:'2026-10-10T07:00:00Z',staff_name:'Halil Kıv'}};if(name==='mark_manual_cancel_whatsapp_sent')return {data:{status:'sent'}};throw Error(name)}};
});
await page.addScriptTag({content:fs.readFileSync('appointment-management-2.3.26.js','utf8')});
async function cancel(id,mode){await page.evaluate(({id,mode})=>{window.responseMode=mode;window.appts=[{id,customer:'Ayşe Yılmaz',date:'2026-10-10',time:'10:00',status:'confirmed'}];window.requestAppointmentDeletion(id)},{id,mode});await page.locator('#appointmentDeleteConfirm').click()}
await cancel('a1','ready');await page.locator('#appointmentCancelWhatsappOpen').waitFor();
const url=new URL((await page.evaluate(()=>window.opened))[0]);assert.equal(url.hostname,'wa.me');assert.equal(url.pathname,'/905321234567');
assert.equal(url.searchParams.get('text'),'Merhaba Ayşe Yılmaz 👋\n📅 2026-10-10 🕒 10:00 👤 Halil Kıv');
assert.equal(await page.evaluate(()=>window.templateKey),'appointment_cancelled');
assert.equal((await page.evaluate(()=>window.calls)).includes('mark_manual_cancel_whatsapp_sent'),false,'Opening does not mark sent');
await page.locator('#appointmentCancelWhatsappOpen').click();assert.equal((await page.evaluate(()=>window.opened)).length,2,'Fallback button opens draft despite blocked automatic popup');
await page.locator('#appointmentCancelWhatsappSent').click();await page.waitForFunction(()=>window.calls.includes('mark_manual_cancel_whatsapp_sent'));
await cancel('a2','error');await page.waitForFunction(()=>window.lastToast?.title==='Randevu iptal edilemedi');assert.equal((await page.evaluate(()=>window.opened)).length,2);
await cancel('a3','replayed');await page.waitForFunction(()=>!document.getElementById('appointmentDeleteModal').classList.contains('show'));assert.equal((await page.evaluate(()=>window.opened)).length,2);
await cancel('a4','declined');await page.waitForFunction(()=>window.lastToast?.title==='İptal mesajı açılmadı');assert.equal((await page.evaluate(()=>window.opened)).length,2);
console.log('PASS confirmed cancellation draft, Istanbul details, popup fallback, explicit sent, failed/replayed/opt-out guard');
}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
