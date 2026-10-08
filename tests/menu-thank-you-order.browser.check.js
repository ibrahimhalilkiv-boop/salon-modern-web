const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:780},isMobile:true,hasTouch:true});
    await page.setContent(`<div id="drawerLayer" class="open"><div class="drawer">
      <button id="home" onclick="drawerPage('home')">Ana sayfa</button>
      <button id="calendar" onclick="drawerPage('calendar')">Takvim</button>
      <button id="drawerManualThankYous" onclick="drawerPage('manualThankYous')">✦ Teşekkür Gönderilecekler</button>
      <button id="statistics" onclick="drawerPage('statistics')">İstatistikler</button>
      <button id="drawerManagedAppointments" onclick="drawerPage('managedAppointments')">▤ Randevu Yönetimi</button>
      <button id="admin" onclick="drawerPage('admin')">Yönetim</button>
    </div></div>`);
    await page.evaluate(()=>{window.drawerPage=id=>{window.clicked=id};window.enterApp=()=>{};window.toggleDrawer=()=>{};window.simplifyNavigation=()=>{}});
    await page.addScriptTag({content:fs.readFileSync('salon-menu-order.js','utf8')});
    const order=()=>page.locator('#drawerLayer .drawer > button').evaluateAll(nodes=>nodes.map(node=>node.id));
    assert.deepEqual(await order(),['home','calendar','statistics','drawerManualThankYous','drawerManagedAppointments','admin']);
    await page.locator('#drawerManualThankYous').click();assert.equal(await page.evaluate(()=>window.clicked),'manualThankYous');
    await page.locator('#drawerManagedAppointments').click();assert.equal(await page.evaluate(()=>window.clicked),'managedAppointments');
    await page.evaluate(()=>{document.getElementById('drawerManagedAppointments').after(document.getElementById('drawerManualThankYous'));window.toggleDrawer()});
    assert.deepEqual(await order(),['home','calendar','statistics','drawerManualThankYous','drawerManagedAppointments','admin']);
    assert.match(await page.locator('style').last().textContent(),/overflow-y:auto/);
    console.log('PASS thank-you menu directly above management, clicks and dynamic reorder');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
