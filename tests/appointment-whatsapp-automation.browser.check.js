const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<div id="target"></div><div id="appointmentActionModal"><div class="sheet"></div></div>');
    await page.evaluate(()=>{
      window.currentUser={role:'yonetici'};window.rows=[];window.appointmentClick=()=>document.getElementById('appointmentActionModal').classList.add('show');window.openAppointmentModal=()=>{};
      window.salonDb={rpc:async()=>({data:window.rows})};
    });
    await page.addScriptTag({content:fs.readFileSync('appointment-whatsapp-status.js','utf8')});
    assert.equal(await page.evaluate(()=>typeof SalonAppointmentWhatsApp.draftUrl),'undefined');
    const statuses=['queued','sending','sent','delivered','read','failed','delivery_unknown'];
    await page.evaluate(async statuses=>{window.rows=statuses.map((status,index)=>({id:String(index),template_key:'appointment_confirmation',status,can_manual:status==='failed'}));await SalonAppointmentWhatsApp.renderInto('a1',document.getElementById('target'))},statuses);
    const text=await page.locator('#target').innerText();
    for(const label of ['Gönderim bekleniyor','Gönderiliyor',"WhatsApp'a gönderildi",'Teslim edildi','Okundu','Gönderilemedi','Durum belirsiz'])assert.ok(text.includes(label),label);
    assert.equal(await page.locator('#target button').count(),0,'Historical failure must not offer manual fallback');
    await page.evaluate(()=>appointmentClick('a1'));
    assert.equal(await page.locator('#appointmentActionWhatsApp').count(),0,'Old reminder shortcut must be removed');
    await page.waitForFunction(()=>document.querySelector('#appointmentActionModal #appointmentWhatsappStatus')?.textContent.includes('Gönderilemedi'));
    await page.evaluate(async()=>{window.rows=[{id:'pending',template_key:'appointment_reminder',status:'manual_pending',can_manual:true,can_mark:true}];await SalonAppointmentWhatsApp.renderInto('a1',document.getElementById('target'))});
    assert.equal(await page.locator('#target button').count(),0,'Reserved manual draft must not reopen');
    await page.evaluate(async()=>{window.currentUser.role='personel';await SalonAppointmentWhatsApp.renderInto('a1',document.getElementById('target'))});
    assert.equal(await page.locator('#target button').count(),0,'Staff cannot see manager-only controls');
    console.log('PASS status labels and manager guard without appointment WhatsApp drafts');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
