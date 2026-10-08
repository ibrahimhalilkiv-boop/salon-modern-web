// Browser fixture: authenticated data stays inside the app until the staff
// member explicitly opens the draft; it never sends or marks it automatically.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.setContent('<div id="app"><section id="managedAppointments" class="page"><div class="content"><button class="back">Geri</button><h1 class="page-title">Randevu Yönetimi</h1><div id="managedList">Mevcut randevu listesi</div></div></section></div><div id="drawerLayer"><div class="drawer"><button id="drawerManualThankYous">Eski seçenek</button><button id="drawerManagedAppointments"></button></div></div>');
  await page.evaluate(()=>{
    window.currentUser={id:'manager-1',role:'yonetici'};
    window.selectedCustomerId=null;
    window.showPage=id=>{window.lastPage=id};
    window.enterApp=()=>{};window.toggleDrawer=()=>{};window.renderCustomerDetail=()=>{};
    window.appointmentTemplateValues=name=>({'{musteri_adi}':name});
    window.renderSavedTemplate=(key,values)=>{window.templateUsed=key;return 'Merhaba '+values['{musteri_adi}']+' 👋 Teşekkürler ✂️'};
    window.whatsappPhone=raw=>'90'+raw.replace(/\D/g,'').replace(/^0/,'');
    window.open=url=>{window.openedDraft=url};
    window.confirm=()=>true;
    window.fixtureRows=[
      {appointment_id:'other',client_name:'Başka Kişi',client_phone:'05321111111',scheduled_at:'2026-10-08T10:00:00Z'},
      {appointment_id:'target',client_name:'Ayşe Yılmaz',client_phone:'05322222222',scheduled_at:'2026-10-08T11:00:00Z'}
    ];
    window.listCalls=0;
    window.salonDb={rpc:async(name,args)=>{
      if(name==='list_manual_whatsapp_thank_yous'){window.listCalls++;return {data:window.fixtureRows}}
      if(name==='mark_manual_whatsapp_thank_you_sent'){window.marked=args.p_appointment_id;window.fixtureRows=[];return {data:{status:'sent'}}}
      throw Error(name)
    }};
  });
  await page.addScriptTag({content:fs.readFileSync('manual-whatsapp-thank-you-2.4.6.js','utf8')});
  assert.equal(await page.locator('#drawerManualThankYous').count(),0);
  await page.evaluate(()=>window.showPage('managedAppointments'));
  assert.equal(await page.locator('#managedAppointmentsTab').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#managedList').innerText(),'Mevcut randevu listesi');
  await page.locator('#managedThankYousTab').click();
  assert.equal(await page.locator('#managedThankYousTab').innerText(),'Teşekkürler (2)');
  await page.evaluate(()=>window.showPage('manualThankYous'));
  assert.equal(await page.evaluate(()=>window.lastPage),'managedAppointments','Legacy route opens appointment management');
  assert.equal(await page.locator('#managedThankYousTab').getAttribute('aria-selected'),'true');
  await page.evaluate(()=>window.openManualThankYouAfterCompletion('target'));
  const immediate=new URL(await page.evaluate(()=>window.openedDraft));
  assert.equal(immediate.pathname,'/905322222222','Manager completion opens the right draft');
  assert.equal(await page.evaluate(()=>window.marked),undefined,'Opening never marks sent');
  await page.evaluate(()=>{window.openedDraft=undefined});
  await page.evaluate(()=>window.openManualThankYouFromNotification('target'));
  assert.equal(await page.evaluate(()=>window.lastPage),'managedAppointments');
  assert.equal(await page.locator('#managedThankYousTab').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('.manual-thank-focused strong').first().innerText(),'Ayşe Yılmaz');
  assert.equal(await page.evaluate(()=>window.openedDraft),undefined,'Tap alone never opens or sends');
  await page.locator('.manual-thank-focused [data-open]').click();
  const url=new URL(await page.evaluate(()=>window.openedDraft));
  assert.equal(url.hostname,'wa.me');assert.equal(url.pathname,'/905322222222');
  assert.equal(url.searchParams.get('text'),'Merhaba Ayşe Yılmaz 👋 Teşekkürler ✂️');
  assert.equal(await page.evaluate(()=>window.templateUsed),'appointment_thank_you');
  assert.equal(await page.evaluate(()=>window.marked),undefined,'Opening draft is not marking sent');
  assert.match(await page.locator('.manual-thank-focused').innerText(),/Mesajı gönderdiniz mi/);
  await page.locator('.manual-thank-focused .manual-thank-confirm [data-sent]').click();
  assert.equal(await page.evaluate(()=>window.marked),'target');
  await page.evaluate(async()=>{window.openedDraft=undefined;await window.openManualThankYouAfterCompletion('target')});
  assert.equal(await page.evaluate(()=>window.openedDraft),undefined,'Sent appointment does not reopen');
  await page.evaluate(()=>window.showPage('managedAppointments'));
  assert.equal(await page.locator('#managedAppointmentsTab').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#managedList').innerText(),'Mevcut randevu listesi');
  const calls=await page.evaluate(()=>window.listCalls);
  await page.evaluate(()=>{window.currentUser={id:'staff-2',role:'calisan'};window.showPage('managedAppointments')});
  assert.equal(await page.locator('#managedThankYousTab').isVisible(),false);
  assert.equal(await page.locator('#manualThankYouList').innerText(),'');
  await page.evaluate(()=>window.openManualThankYouAfterCompletion('target'));
  await page.evaluate(()=>window.openManualThankYouFromNotification('target'));
  assert.equal(await page.evaluate(()=>window.listCalls),calls,'Staff never calls thank-you list RPC');
  console.log('PASS manager-only immediate draft, legacy tap, central template, explicit send and staff hiding');
}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
