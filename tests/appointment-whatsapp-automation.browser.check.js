const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<div id="target"></div><div id="appointmentActionModal"><div class="sheet"><button id="appointmentActionWhatsApp">Eski manuel hatırlatma</button></div></div>');
    await page.evaluate(()=>{
      window.currentUser={role:'yonetici'};window.rows=[];window.appointmentClick=()=>document.getElementById('appointmentActionModal').classList.add('show');window.openAppointmentModal=()=>{};
      window.salonDb={rpc:async()=>({data:window.rows})};
      window.appointmentTemplateValues=(name,date,time,staff,amount,service)=>({name,date,time,staff,service,url:'https://salonmodern.com.tr/konum'});
      window.renderSavedTemplate=(key,v)=>key==='appointment_confirmation'?`Merhaba ${v.name} · Hizmet: ${v.service}`:`Merhaba ${v.name} · ${v.url}`;
      window.whatsappPhone=()=> '905321234567';
    });
    await page.addScriptTag({content:fs.readFileSync('appointment-whatsapp-status.js','utf8')});
    const data={client_name:'Çağrı Çığ',phone:'05321234567',scheduled_at:'2026-10-20T11:30:00Z',staff_name:'Halil Kıv',service_name:'Saç kesimi',template_key:'appointment_confirmation'};
    const urls=await page.evaluate(data=>({confirmation:SalonAppointmentWhatsApp.draftUrl(data),reminder:SalonAppointmentWhatsApp.draftUrl({...data,template_key:'appointment_reminder'})}),data);
    assert.match(new URL(urls.confirmation).searchParams.get('text'),/Hizmet: Saç kesimi/);
    assert.match(new URL(urls.reminder).searchParams.get('text'),/https:\/\/salonmodern\.com\.tr\/konum/);
    assert.equal(new URL(urls.confirmation).pathname,'/905321234567');
    const statuses=['queued','sending','sent','delivered','read','failed','delivery_unknown'];
    await page.evaluate(async statuses=>{window.rows=statuses.map((status,index)=>({id:String(index),template_key:'appointment_confirmation',status,can_manual:status==='failed'}));await SalonAppointmentWhatsApp.renderInto('a1',document.getElementById('target'))},statuses);
    const text=await page.locator('#target').innerText();
    for(const label of ['Gönderim bekleniyor','Gönderiliyor',"WhatsApp'a gönderildi",'Teslim edildi','Okundu','Gönderilemedi','Durum belirsiz'])assert.ok(text.includes(label),label);
    assert.equal(await page.locator('#target button').count(),1,'Only final failure offers manual fallback');
    await page.evaluate(()=>appointmentClick('a1'));
    assert.equal(await page.locator('#appointmentActionWhatsApp').isVisible(),false,'Old always-on reminder shortcut is hidden');
    await page.waitForFunction(()=>document.querySelector('#appointmentActionModal #appointmentWhatsappStatus')?.textContent.includes('Gönderilemedi'));
    await page.evaluate(async()=>{window.rows=[{id:'pending',template_key:'appointment_reminder',status:'manual_pending',can_manual:true,can_mark:true}];await SalonAppointmentWhatsApp.renderInto('a1',document.getElementById('target'))});
    assert.equal(await page.locator('#target button').count(),2,'Reserved manual draft may be reopened and explicitly marked');
    await page.evaluate(async()=>{window.currentUser.role='personel';await SalonAppointmentWhatsApp.renderInto('a1',document.getElementById('target'))});
    assert.equal(await page.locator('#target button').count(),0,'Staff cannot see manager-only controls');
    console.log('PASS status labels, final-failure-only fallback, manager guard, correct draft service and short directions');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
