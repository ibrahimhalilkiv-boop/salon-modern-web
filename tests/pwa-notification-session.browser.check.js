// Local browser fixture only: no real login, push delivery or WhatsApp navigation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const setup=`
var currentUser=null,appts=[],remoteClients=[],teamCalendarDate='',waCount=0,signouts=0,reloads=0,claims=0,unsubscribes=0,subscribes=0;
var mode={session:true,sessionError:null,userError:null,profileError:null,inactive:false,reloadError:false,emptyCalendar:false,subscriptionError:false,active:true};
var record={id:'a1',clientId:'c1',customer:'Fixture',phone:'05321234567',date:'2026-10-05',time:'12:00',staff:'Fixture staff',amount:100};
var listeners={},authListeners=[],sub=null;
function makeSub(id,expiration){return {endpoint:id,expirationTime:expiration,toJSON(){return {endpoint:id,keys:{p256dh:'fixture',auth:'fixture'}}},async unsubscribe(){unsubscribes++;sub=null;return true}}}
sub=makeSub('fixture-old',null);
var registration={pushManager:{getSubscription:async()=>sub,subscribe:async()=>{subscribes++;return sub=makeSub('fixture-new-'+subscribes,null)}},addEventListener(){},update:async()=>{}};
Object.defineProperty(navigator,'serviceWorker',{value:{ready:Promise.resolve(registration),controller:{},addEventListener:(n,f)=>{(listeners[n]||=[]).push(f)},removeEventListener(){}}});
window.PushManager=function(){};
Object.defineProperty(window,'Notification',{value:{permission:'granted',requestPermission:async()=> 'granted'}});
window.fetch=async()=>({ok:true,json:async()=>({publicKey:'AAAA',dispatched:{sent:1}})});
function message(data){for(var f of listeners.message||[])f({data:{type:'SALON_NOTIFICATION_OPEN',data}})}
var salonDb={auth:{
getSession:async()=>({data:{session:mode.session?{user:{id:'u1'},access_token:'fixture',refresh_token:'fixture'}:null},error:mode.sessionError}),
getUser:async()=>({data:{user:mode.userError?null:{id:'u1'}},error:mode.userError}),
refreshSession:async()=>({data:{session:null},error:{status:400,code:'refresh_token_not_found',message:'Refresh token not found'}}),
setSession:async()=>({data:{session:{user:{id:'u1'}}},error:null}),
signOut:async()=>{signouts++;mode.session=false;currentUser=null;localStorage.removeItem('sb-fixture-auth-token');for(var f of authListeners)f('SIGNED_OUT',null);return {error:null}},
onAuthStateChange:f=>{authListeners.push(f);return {data:{subscription:{unsubscribe(){}}}}}},
from(table){var query={select(){return query},eq(){return query},update(){return query},maybeSingle:async()=> table==='profiles'?{data:{id:'u1',full_name:'Fixture',role:'manager',active:!mode.inactive},error:mode.profileError}:table==='appointments'?{data:mode.targetMissing?null:record,error:null}:{data:{active:mode.active},error:null},then(resolve,reject){return Promise.resolve({data:null,error:null}).then(resolve,reject)}};return query},
rpc:async()=>{claims++;return {data:null,error:mode.subscriptionError?{message:'Fixture registration failure'}:null}}};
function enterApp(){document.getElementById('app').classList.remove('hidden');document.getElementById('auth').classList.add('hidden')}
function showPage(id){window.lastPage=id}
function showAppToast(t,b){window.lastToast=t+' '+b}
function setRemoteAuth(){document.getElementById('auth').classList.remove('hidden');document.getElementById('loginForm').classList.remove('hidden');document.getElementById('app').classList.add('hidden')}
function remoteError(m){window.lastError=m}
function profileToUser(p){return {id:p.id,name:p.full_name,role:'yonetici',remote:true}}
async function reloadRemoteData(){reloads++;if(mode.reloadError)throw {status:503,message:'Fixture network error'};appts=mode.emptyCalendar?[]:[record]}
function remoteAppointment(row){return row}
function subscribeSalon(){}
function appointmentDate(x){return x.date}
function whatsappPhone(){return '905321234567'}
function whatsappReminderUrl(){waCount++;return '#whatsapp'}
async function logout(){await salonDb.auth.signOut();setRemoteAuth(false)}
localStorage.setItem('sb-fixture-auth-token',JSON.stringify({access_token:'fixture',refresh_token:'fixture'}));
`;
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const context=await browser.newContext({viewport:{width:430,height:850},isMobile:true,hasTouch:true});
const page=await context.newPage();await page.route('https://salon.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="auth"><div id="loginForm"></div><div id="setupForm"></div></div><div id="app"><div id="home"><div class="content"></div></div><div id="calendar"></div></div>'}));
await page.goto('https://salon.test/salon-modern.html?date=2026-10-05&appointment=a1&kind=appointment_reminder&notification=n1');
await page.addScriptTag({content:setup});await page.addScriptTag({content:fs.readFileSync('salon-web-push.js','utf8')});
await page.evaluate(()=>message({notificationId:'n1',appointmentId:'a1',appointmentDate:'2026-10-05',kind:'appointment_reminder'}));
assert.equal(await page.evaluate(()=>waCount),0,'Cold notification waits for authentication');
await page.addScriptTag({content:fs.readFileSync('pwa-stability-2.3.20.js','utf8')});
await page.addScriptTag({content:fs.readFileSync('pwa-device-session-2.3.22.js','utf8')});
await page.evaluate(()=>startRemoteApp());await page.waitForFunction(()=>waCount===1);
assert.equal(await page.evaluate(()=>getSalonAuthState()),'AUTHENTICATED');assert.equal(await page.evaluate(()=>signouts),0);
await page.evaluate(()=>message({notificationId:'n1',appointmentId:'a1',appointmentDate:'2026-10-05',kind:'appointment_reminder'}));await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>waCount),1,'Same notification opens WhatsApp once');
await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));});await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>currentUser.id),'u1');assert.equal(await page.evaluate(()=>signouts),0,'Returning from WhatsApp preserves session');
await page.evaluate(()=>{mode.profileError={status:503,message:'Fixture fetch failed'};});await page.evaluate(()=>startRemoteApp());assert.equal(await page.evaluate(()=>getSalonAuthState()),'TEMPORARY_NETWORK_ERROR');assert.equal(await page.evaluate(()=>signouts),0);
await page.evaluate(()=>{mode.profileError=null;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>getSalonAuthState()==='AUTHENTICATED');
await page.evaluate(()=>{mode.reloadError=true;});await page.evaluate(()=>startRemoteApp());assert.equal(await page.evaluate(()=>getSalonAuthState()),'TEMPORARY_NETWORK_ERROR');assert.equal(await page.evaluate(()=>signouts),0);
await page.evaluate(()=>{mode.reloadError=false;window.dispatchEvent(new Event('online'));});await page.waitForFunction(()=>getSalonAuthState()==='AUTHENTICATED');
await page.evaluate(()=>{appts=[];mode.reloadError=true;message({notificationId:'n2',appointmentId:'a1',appointmentDate:'2026-10-05',kind:'appointment_reminder'});});await page.waitForTimeout(40);assert.equal(await page.evaluate(()=>waCount),1);
await page.evaluate(()=>{mode.reloadError=false;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>waCount===2);
await page.evaluate(()=>{appts=[];mode.emptyCalendar=true;message({notificationId:'n-target',appointmentId:'a1',appointmentDate:'2026-10-05',kind:'appointment_reminder'});});await page.waitForFunction(()=>waCount===3);
assert.equal(await page.evaluate(()=>appts.length),0,'Targeted resolution must not overwrite the calendar');
await page.evaluate(()=>{appts=[];mode.targetMissing=true;message({notificationId:'n-retry',appointmentId:'a1',appointmentDate:'2026-10-05',kind:'appointment_reminder'});});await page.waitForTimeout(60);
assert(await page.evaluate(()=>sessionStorage.getItem('salonPendingWebPushOpenV1')),'Unavailable appointment must remain pending, not marked handled');
await page.evaluate(()=>{mode.targetMissing=false;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>waCount===4);
await page.evaluate(()=>{mode.active=false;});await page.evaluate(()=>SalonWebPush.sync());assert((await page.evaluate(()=>unsubscribes))>=1);assert((await page.evaluate(()=>subscribes))>=1);
await page.evaluate(()=>{mode.active=true;sub.expirationTime=Date.now()-1000});const old=await page.evaluate(()=>unsubscribes);await page.evaluate(()=>SalonWebPush.sync());assert.equal(await page.evaluate(()=>unsubscribes),old+1);
await page.evaluate(()=>{mode.subscriptionError=true});await page.evaluate(()=>SalonWebPush.sync());assert.match(await page.locator('#webPushStatus').textContent(),/bağlantısı bekleniyor/);
await page.evaluate(()=>{mode.subscriptionError=false;Notification.permission='denied';SalonWebPush.render()});assert.match(await page.locator('#webPushStatus').textContent(),/engellenmiş/);
await page.evaluate(()=>{mode.userError={status:401,message:'JWT expired'}});await page.evaluate(()=>startRemoteApp());assert.equal(await page.evaluate(()=>getSalonAuthState()),'UNAUTHENTICATED');assert.equal(await page.evaluate(()=>signouts),1,'Invalid refresh token really signs out');
await page.evaluate(()=>{mode.session=true;mode.userError=null;mode.inactive=true;});await page.evaluate(()=>startRemoteApp());assert.equal(await page.evaluate(()=>getSalonAuthState()),'UNAUTHENTICATED');assert.equal(await page.evaluate(()=>signouts),2,'Inactive profile requires login');
await page.evaluate(()=>{mode.inactive=false});await page.evaluate(()=>startRemoteApp());await page.evaluate(()=>logout());await page.evaluate(()=>message({notificationId:'n3',appointmentId:'a1',kind:'appointment_reminder'}));assert.equal(await page.evaluate(()=>waCount),4);assert.equal(await page.evaluate(()=>sessionStorage.getItem('salonPendingWebPushOpenV1')),null);
console.log('PASS mobile PWA fixture: cold/warm notification, once-only WhatsApp, return session, profile/data network retry, expired subscription replacement, permission/registration errors, invalid token, inactive profile and explicit logout');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
