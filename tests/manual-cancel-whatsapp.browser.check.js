const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const page=await browser.newPage();await page.setContent('<div id="appointmentModal"><div class="sheet"></div></div>');
await page.evaluate(()=>{
  window.appts=[];window.editingAppointmentId=null;window.responseMode='ready';window.opened=[];window.calls=[];window.currentUser={role:'yonetici'};
  window.canManageOwnAppointment=()=>true;window.confirm=()=>true;window.safe=value=>value;
  window.friendlyDate=value=>value;window.appointmentDate=item=>item.date;
  window.renderHomeSummary=()=>{};window.render=()=>{};window.renderCalendar=()=>{};window.renderStatistics=()=>{};
  window.reloadRemoteData=async()=>{};window.closeAppointmentModal=()=>{};window.showAppToast=(title,body)=>{window.lastToast={title,body}};
  window.appointmentTemplateValues=(customer,date,time,staff)=>({'{musteri_adi}':customer,'{randevu_tarihi}':date,'{randevu_saati}':time,'{calisan_adi}':staff});
  window.renderSavedTemplate=(key,values)=>{window.templateKey=key;return 'Merhaba '+values['{musteri_adi}']+' 👋\n📅 '+values['{randevu_tarihi}']+' 🕒 '+values['{randevu_saati}']+' 👤 '+values['{calisan_adi}']};
  window.open=url=>{window.opened.push(url);return null};
  window.SalonAppointmentWhatsApp={renderInto:(id,box)=>{window.statusAppointment=id;box.textContent='Gönderim bekleniyor'}};
  window.salonDb={rpc:async(name,args)=>{window.calls.push(name);if(name==='cancel_appointment')return window.responseMode==='error'?{error:{message:'İptal reddedildi'}}:{data:{status:'cancelled',replayed:window.responseMode==='replayed'}};if(name==='get_manual_cancel_whatsapp')return {data:window.responseMode==='declined'?{status:'contact_declined'}:{status:'ready',appointment_id:args.p_appointment_id,client_name:'Ayşe Yılmaz',phone:'905321234567',scheduled_at:'2026-10-10T07:00:00Z',staff_name:'Halil Kıv'}};if(name==='mark_manual_cancel_whatsapp_sent')return {data:{status:'sent'}};throw Error(name)}};
});
await page.addScriptTag({content:fs.readFileSync('appointment-management-2.3.26.js','utf8')});
async function cancel(id,mode){await page.evaluate(({id,mode})=>{window.responseMode=mode;window.appts=[{id,customer:'Ayşe Yılmaz',date:'2026-10-10',time:'10:00',status:'confirmed'}];window.requestAppointmentDeletion(id)},{id,mode});await page.locator('#appointmentDeleteConfirm').click()}
await cancel('a1','ready');await page.waitForFunction(()=>window.statusAppointment==='a1');
assert.equal((await page.evaluate(()=>window.opened)).length,0,'Cancellation never opens WhatsApp automatically');
assert.equal((await page.evaluate(()=>window.calls)).includes('get_manual_cancel_whatsapp'),false,'Future cancellation uses automatic queue');
assert.match(await page.locator('#appointmentCancelWhatsApp').innerText(),/Durumu yenile\s+Gönderim bekleniyor/);
await page.locator('#appointmentDeleteClose').click();
await cancel('a2','error');await page.waitForFunction(()=>window.lastToast?.title==='Randevu iptal edilemedi');assert.equal((await page.evaluate(()=>window.opened)).length,0);
await cancel('a3','replayed');await page.waitForFunction(()=>!document.getElementById('appointmentDeleteModal').classList.contains('show'));assert.equal((await page.evaluate(()=>window.opened)).length,0);
console.log('PASS cancellation shows status without opening WhatsApp or marking sent');
}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
