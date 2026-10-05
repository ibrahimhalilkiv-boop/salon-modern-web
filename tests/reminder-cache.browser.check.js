// Local browser fixture with real CacheStorage; notification display is mocked.
// No production login, push, customer data or notification permission is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const source=fs.readFileSync('sw.js','utf8');
function boot(source){
  const handlers={},calls=[];
  const worker={registration:{scope:location.origin+'/',getNotifications:async()=>[],showNotification:async(title,options)=>calls.push({title,tag:options.tag})},clients:{claim:async()=>{},matchAll:async()=>[]},addEventListener:(n,f)=>handlers[n]=f};
  new Function('self',source)(worker);
  window.fixtureCalls=calls;
  window.fixtureActivate=async()=>{let task;handlers.activate({waitUntil:p=>task=p});await task};
  window.fixtureReminder=async(data,type='push')=>{let task;handlers[type]({data:type==='push'?{json:()=>data}:{type:'SALON_REMINDER_FALLBACK',data},source:{url:location.origin+'/salon-modern.html'},waitUntil:p=>task=p});if(task)await task};
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();await page.route('https://salon.test/**',r=>r.fulfill({contentType:'text/html',body:'<title>Local reminder fixture</title>'}));
    await page.goto('https://salon.test/salon-modern.html');await page.evaluate(boot,source);await page.evaluate(()=>fixtureActivate());
    const payload={notificationId:'fixture-real-cache',appointmentId:'a1',kind:'appointment_reminder',reminderFor:new Date(Date.now()+3600000).toISOString(),createdAt:new Date(Date.now()+60000).toISOString(),title:'Fixture',body:'Fixture'};
    await page.evaluate(async data=>{await Promise.all([fixtureReminder(data,'message'),fixtureReminder(data),fixtureReminder(data)]);},payload);
    assert.equal(await page.evaluate(()=>fixtureCalls.length),1,'Real CacheStorage must dedup concurrent push and page fallback');
    await page.reload();await page.evaluate(boot,source);await page.evaluate(()=>fixtureActivate());
    await page.evaluate(async data=>{await fixtureReminder(data);await fixtureReminder(data,'message');},payload);
    assert.equal(await page.evaluate(()=>fixtureCalls.length),0,'Dismissal/page restart/worker activation must not replay already displayed reminder');
    const receipt=await page.evaluate(async()=>{const cache=await caches.open('salon-modern-push-receipts-v1');return (await cache.match(location.origin+'/__salon_push_receipts__/fixture-real-cache')).json()});
    assert(receipt.shownAt&&receipt.pushReceivedAt);assert.equal(receipt.lastError,null);assert(!('body' in receipt));
    await page.evaluate(data=>fixtureReminder({...data,notificationId:'old-history',createdAt:'2020-01-01T00:00:00Z'},'message'),payload);
    assert.equal(await page.evaluate(()=>fixtureCalls.length),0,'An update must not replay old notification history');
    console.log('PASS browser reminder receipts: real CacheStorage, concurrent dedup, restart/update persistence and no pre-upgrade replay');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
