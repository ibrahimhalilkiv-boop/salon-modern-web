const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.setContent('<div id="app"></div><div id="drawerLayer"><div class="drawer"><button onclick="drawerPage(\'admin\')">Yönetim</button></div></div>');
  await page.evaluate(()=>{
    window.currentUser={id:'manager',role:'yonetici'};window.appts=[];
    window.appointmentStatus='confirmed';window.failCompletion=false;window.completionCalls=0;
    window.enterApp=()=>{};window.showPage=()=>{};window.toggleDrawer=()=>{};
    window.reloadRemoteData=async()=>{window.completionDone=true};
    window.closeAppointmentModal=()=>{};window.closeAppointmentDeleteModal=()=>{};window.logout=()=>{};
    window.drawerPage=()=>{};window.confirm=()=>true;
    window.canManageOwnAppointment=()=>true;
    window.remoteAppointment=raw=>({id:raw.id,customer:raw.client_name,operation:raw.service_name,employeeId:raw.employee_id,staff:'Berber',date:'2026-10-08',time:'12:00',amount:400,status:raw.status});
    window.showAppToast=(title,body)=>{window.lastToast={title,body}};
    window.openManualThankYouAfterCompletion=async id=>{window.draftId=id};
    window.fetch=async()=>({ok:true,json:async()=>({sourceAppointmentIds:[]})});
    window.salonDb={
      auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})},
      from:()=>({select(){return this},gte(){return this},lt(){return this},neq(){return this},order(){return this},eq(){return this},range:async()=>({data:[{id:'appointment-1',client_name:'Müşteri',service_name:'Hizmet',employee_id:'staff',scheduled_at:'2026-10-08T09:00:00Z',status:window.appointmentStatus,amount:400}]})}),
      rpc:async name=>{if(name!=='complete_appointment')throw Error(name);window.completionCalls++;if(window.failCompletion)return {error:{message:'Kaydedilemedi'}};window.appointmentStatus='completed';return {data:{status:'completed'}}}
    };
  });
  await page.addScriptTag({content:fs.readFileSync('appointment-list-management-2.4.4.js','utf8')});
  await page.evaluate(()=>window.SalonAppointmentList.load());
  await page.locator('[data-complete]').click();
  await page.waitForFunction(()=>window.completionDone===true);
  assert.equal(await page.evaluate(()=>window.draftId),'appointment-1');
  assert.equal(await page.evaluate(()=>window.appointmentStatus),'completed');
  await page.evaluate(()=>{window.appointmentStatus='confirmed';window.failCompletion=true;window.draftId=undefined;window.completionDone=false});
  await page.evaluate(()=>window.SalonAppointmentList.load());
  await page.locator('[data-complete]').click();
  await page.waitForFunction(()=>window.lastToast?.title==='Randevu tamamlanamadı');
  assert.equal(await page.evaluate(()=>window.draftId),undefined,'Failed completion never opens WhatsApp');
  await page.evaluate(()=>{window.currentUser={id:'staff',role:'calisan'};window.failCompletion=false;window.lastToast=null});
  await page.evaluate(()=>window.SalonAppointmentList.load());
  await page.locator('[data-complete]').click();
  await page.waitForFunction(()=>window.completionDone===true);
  assert.equal(await page.evaluate(()=>window.draftId),undefined,'Staff completion never opens thank-you draft');
  console.log('PASS manager completion opens draft; failure and staff completion do not');
}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
