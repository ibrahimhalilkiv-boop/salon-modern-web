(function(){
'use strict';
var API='https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/web-push-dispatch',subscription=null,subscriptionId=null,syncBusy=false,deviceSynced=false,serverDeviceActive=null,workerState='Kontrol edilmedi',lastPushError=null,lastTestResult=null,pendingOpen=null,opening=false,explicitLogout=false;
var PENDING_KEY='salonPendingWebPushOpenV1',HANDLED_KEY='salonHandledWebPushOpenV1',TEST_KEY='salonWebPushLastDeviceTestV1';
try{lastTestResult=JSON.parse(localStorage.getItem(TEST_KEY)||'null')}catch(_){}
var reminderCheckBusy=false;
async function reminderDiagnostics(){
  if(!authReady())return [];
  var userId=currentUser.id,since=new Date(Date.now()-6*60*60*1000).toISOString();
  var result=await salonDb.from('notifications').select('id').eq('recipient_id',userId).eq('kind','appointment_reminder').gte('created_at',since).order('created_at',{ascending:false}).limit(100);
  if(result.error)throw result.error;
  var cache=await caches.open('salon-modern-push-receipts-v1'),registration=await navigator.serviceWorker.ready,records=[];
  for(var note of result.data||[]){
    if(!authReady()||currentUser.id!==userId)return [];
    var response=await cache.match(new URL('./__salon_push_receipts__/'+encodeURIComponent(note.id),registration.scope).href);
    records.push(response?await response.json():{notificationId:note.id,status:'no-device-receipt'});
  }
  return records;
}
async function catchUpReminders(){
  if(reminderCheckBusy||document.hidden||!authReady()||!supported()||Notification.permission!=='granted')return;
  reminderCheckBusy=true;
  var userId=currentUser.id;
  try{
    var since=new Date(Date.now()-6*60*60*1000).toISOString();
    // RLS and explicit ownership both apply. Do not use read_at as proof of display.
    var result=await salonDb.from('notifications').select('id,recipient_id,appointment_id,kind,title,body,reminder_for,created_at,appointment:appointments(id,scheduled_at,status)').eq('recipient_id',userId).eq('kind','appointment_reminder').gte('created_at',since).order('created_at',{ascending:false}).limit(100);
    if(result.error)throw result.error;
    var registration=await navigator.serviceWorker.ready;
    if(!registration.active)return;
    for(var note of result.data||[]){
      if(!authReady()||currentUser.id!==userId)return;
      var item=note.appointment,starts=Date.parse(item?.scheduled_at);
      if(note.recipient_id!==userId||note.kind!=='appointment_reminder'||!note.reminder_for||item?.status!=='confirmed'||!Number.isFinite(starts)||starts<=Date.now()||starts!==Date.parse(note.reminder_for))continue;
      var date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(starts));
      // Push and foreground fallback share one durable worker dedup identity.
      registration.active.postMessage({type:'SALON_REMINDER_FALLBACK',data:{notificationId:note.id,appointmentId:note.appointment_id,appointmentDate:date,reminderFor:note.reminder_for,createdAt:note.created_at,kind:'appointment_reminder',type:'appointment_reminder',title:note.title,body:note.body,tag:'salon-'+note.id}});
    }
  }catch(error){console.warn('[salon-reminder] catch-up failed',error)}
  finally{reminderCheckBusy=false}
}
var previousAssignmentDelivery=window.deliverAssignmentNotification;
if(typeof previousAssignmentDelivery==='function')window.deliverAssignmentNotification=function(item){
  if(item?.kind==='appointment_reminder'&&item.recipient_id===currentUser?.id)return catchUpReminders();
  return previousAssignmentDelivery.apply(this,arguments)
};
window.addEventListener('salon:auth-state',function(event){if(event.detail?.state==='AUTHENTICATED')catchUpReminders()});
window.addEventListener('online',catchUpReminders);
window.addEventListener('focus',catchUpReminders);
document.addEventListener('visibilitychange',function(){if(!document.hidden)catchUpReminders()});
setInterval(catchUpReminders,60*1000);
function supported(){return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window}
function decode(value){var raw=atob((value+'='.repeat((4-value.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')),out=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
function toast(a,b){if(typeof showAppToast==='function')showAppToast(a,b)}
async function token(){var result=await salonDb.auth.getSession();return result.data?.session?.access_token||''}
async function server(action,details){var response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await token()},body:JSON.stringify(Object.assign({action:action},details||{}))}),data=await response.json().catch(function(){return {}});if(!response.ok)throw new Error(data.error||'Bildirim sunucusuna ulaşılamadı.');return data}
async function key(){var response=await fetch(API+'?action=public-key',{cache:'no-store'});if(!response.ok)throw new Error('Bildirim sunucusunun anahtarına erişilemiyor.');var data=await response.json();if(!data.publicKey)throw new Error('Bildirim sunucusunun VAPID anahtarı bulunamadı.');return data.publicKey}
async function save(sub,active){var raw=sub.toJSON(),keys=raw.keys||{},result=await salonDb.rpc('claim_web_push_subscription',{p_endpoint:raw.endpoint,p_p256dh:keys.p256dh,p_auth_secret:keys.auth,p_user_agent:navigator.userAgent,p_device_label:(navigator.platform||'PWA cihazı').slice(0,120),p_active:active!==false});if(result.error)throw new Error('Bildirim cihazı sunucuya kaydedilemedi: '+result.error.message);subscriptionId=result.data;deviceSynced=active!==false;serverDeviceActive=active!==false}
async function existing(){if(!supported())return null;subscription=await (await navigator.serviceWorker.ready).pushManager.getSubscription();if(subscription&&subscription.expirationTime&&subscription.expirationTime<=Date.now()){var old=subscription;if(await old.unsubscribe()){await deactivateCurrent(old);subscription=null}else throw new Error('Süresi dolan cihaz aboneliği tarayıcıdan kaldırılamadı.')}return subscription}
async function deactivateCurrent(sub){if(!sub||!currentUser)return;var result=await salonDb.from('web_push_subscriptions').update({active:false,updated_at:new Date().toISOString()}).eq('endpoint',sub.endpoint).eq('user_id',currentUser.id);if(result.error)throw result.error;serverDeviceActive=false;deviceSynced=false;subscriptionId=null}
function safeError(error,step){var name=String(error?.name||'Error').slice(0,60),message=String(error?.message||error||'Bilinmeyen hata').replace(/https?:\/\/\S+/g,'[adres gizlendi]').replace(/[A-Za-z0-9_-]{90,}/g,'[değer gizlendi]').slice(0,300);lastPushError={name:name,message:message,step:step,time:new Date().toLocaleString('tr-TR')};return name+': '+message}
function errorHint(){if(!lastPushError)return '';var value=lastPushError.name+' '+lastPushError.message;if(/NotAllowedError|permission|izin|denied/i.test(value))return 'Chrome ve Salon Modern bildirim izinlerini kontrol edin.';if(/InvalidAccessError|applicationServerKey|VAPID/i.test(value))return 'VAPID anahtarı veya eski abonelik uyumsuz olabilir; cihaz bağlantısını yenileyin.';if(/push service|AbortError|network/i.test(value))return 'Chrome, tarayıcının push servisine kayıt olamadı. Google Play Hizmetleri ve ağ bağlantısını kontrol edin; hata sürerse adı ve mesajını destek ekibine iletin.';return 'Hata sürerse aşağıdaki ad ve mesajı destek ekibine iletin.'}
async function currentKey(){var applicationServerKey=decode(await key());if(applicationServerKey.length!==65||applicationServerKey[0]!==4)throw new Error('Sunucunun VAPID genel anahtarı geçersiz.');return applicationServerKey}
function sameKey(sub,expected){var raw=sub?.options?.applicationServerKey;if(!raw)return true;var actual=new Uint8Array(raw);return actual.length===expected.length&&actual.every(function(byte,i){return byte===expected[i]})}
async function subscribeCurrent(){var registration=await navigator.serviceWorker.ready,sub=await registration.pushManager.getSubscription(),applicationServerKey=await currentKey();if(sub&&!sameKey(sub,applicationServerKey))throw new Error('Bu tarayıcının eski VAPID aboneliği güncel anahtarla uyuşmuyor. Bu cihazın bağlantısını yenileyin.');if(!sub){try{sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationServerKey})}catch(error){safeError(error,'PushManager.subscribe');throw new Error('PushManager.subscribe() '+lastPushError.name+': '+lastPushError.message)}}subscription=sub;await save(sub,true);lastPushError=null;return sub}
function text(){if(!supported())return 'Bu cihazda Web Push desteklenmiyor';if(Notification.permission==='denied')return 'Tarayıcı ayarlarından engellenmiş';if(Notification.permission==='granted'&&subscription&&deviceSynced)return '✓ Cihaz bağlı · teslimi test edin';return Notification.permission==='granted'?'İzin açık, cihaz bağlantısı bekleniyor':'Kapalı'}
function put(id,value){var node=document.getElementById(id);if(node)node.textContent=value}
function render(){var status=document.getElementById('webPushStatus');if(status)status.textContent=text();var on=document.getElementById('webPushEnable'),off=document.getElementById('webPushDisable'),renewButton=document.getElementById('webPushRenew'),test=document.getElementById('webPushTest'),prompt=document.getElementById('webPushPrompt'),help=document.getElementById('webPushPermissionHelp');if(on)on.disabled=!supported();if(off)off.disabled=!subscription;if(renewButton)renewButton.disabled=!supported();if(test)test.disabled=!subscription||!subscriptionId||!deviceSynced;if(prompt)prompt.hidden=Boolean(subscription)||!supported();if(help)help.hidden=!supported()||Notification.permission!=='denied';put('webPushPermission',supported()?({granted:'İzin verildi',denied:'Engellendi',default:'Henüz istenmedi'}[Notification.permission]||Notification.permission):'Desteklenmiyor');put('webPushWorker',workerState);put('webPushBrowserSub',subscription?'Var':'Yok');put('webPushServerSub',serverDeviceActive===null?'Kontrol edilemedi':serverDeviceActive?'Aktif':'Pasif veya kayıt yok');put('webPushLastTest',lastTestResult?(lastTestResult.time+' · '+(lastTestResult.status==='sent'?'Push servisi kabul etti; telefonda gösterim doğrulanmadı.':lastTestResult.error||lastTestResult.status)+(lastTestResult.display?' '+lastTestResult.display:'')):'Henüz test edilmedi');put('webPushError',lastPushError?lastPushError.step+' · '+lastPushError.name+': '+lastPushError.message+' · '+errorHint():'Son abonelik hatası yok')}
async function refreshDiagnostics(){if(!supported()){render();return}try{var registration=await navigator.serviceWorker.getRegistration(location.href);workerState=registration?.active?'Etkin · '+registration.scope:registration?'Kurulum sürüyor':'Kayıt yok';subscription=registration?.active?await registration.pushManager.getSubscription():null;if(subscription&&currentUser){var state=await salonDb.from('web_push_subscriptions').select('id,active').eq('endpoint',subscription.endpoint).eq('user_id',currentUser.id).maybeSingle();if(state.error)throw state.error;subscriptionId=state.data?.id||null;serverDeviceActive=state.data?.active===true;deviceSynced=serverDeviceActive}else{subscriptionId=null;serverDeviceActive=false;deviceSynced=false}if(lastTestResult?.notificationId&&registration?.scope){var cache=await caches.open('salon-modern-push-receipts-v1'),receipt=await cache.match(new URL('./__salon_push_receipts__/'+encodeURIComponent(lastTestResult.notificationId),registration.scope).href);if(receipt){var record=await receipt.json();lastTestResult.display=record.shownAt?'Service Worker gösterme çağrısını kaydetti; telefon ekranı ayrıca doğrulanmalı.':record.lastError?'Service Worker gösterme hatası: '+record.lastError:null}}}catch(error){workerState='Kontrol edilemedi: '+safeError(error,'tanılama');serverDeviceActive=null}render()}
async function sync(){if(syncBusy)return;syncBusy=true;try{if(!supported())return;var sessionResult=await salonDb.auth.getSession(),session=sessionResult.data?.session;if(!session?.user)return;var sub=await existing();if(Notification.permission==='granted'&&sub){await save(sub,true);deviceSynced=true}}catch(error){deviceSynced=false;safeError(error,'cihaz eşitleme')}finally{syncBusy=false;await refreshDiagnostics()}}
async function enable(){lastPushError=null;try{if(!supported())throw new Error('Bu tarayıcı Web Push bildirimlerini desteklemiyor.');if(Notification.permission==='denied'){showPage('pushSettings');throw new Error('İzin engellenmiş. Aşağıdaki telefon ve tarayıcı ayarları adımlarını izleyin.')}var permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted')throw new Error(permission==='denied'?'Bildirim izni tarayıcı ayarlarından engellenmiş.':'Bildirim izni verilmedi.');await subscribeCurrent();toast('Cihaz bağlandı','Push servisi aboneliği ve sunucu kaydı hazır. Teslimi test edin.')}catch(error){if(!lastPushError)safeError(error,'bildirim açma');toast('Bildirimler açılamadı',error.message||String(error))}finally{await refreshDiagnostics()}}
async function renew(){lastPushError=null;try{if(!supported())throw new Error('Bu tarayıcı Web Push desteklemiyor.');if(Notification.permission!=='granted')return await enable();var old=await existing();if(old){var removed=await old.unsubscribe();if(!removed)throw new Error('Tarayıcı eski aboneliği kaldıramadı.');await deactivateCurrent(old);subscription=null}await subscribeCurrent();toast('Cihaz bağlantısı yenilendi','Yalnızca bu tarayıcının aboneliği yenilendi.')}catch(error){if(!lastPushError)safeError(error,'cihaz yenileme');toast('Cihaz yenilenemedi',error.message||String(error))}finally{await refreshDiagnostics()}}
async function disable(){try{var sub=await existing();if(sub){var removed=await sub.unsubscribe();if(!removed)throw new Error('Tarayıcı aboneliği kaldıramadı.');await deactivateCurrent(sub)}subscription=null;toast('Bildirimler kapatıldı','Bu cihaz artık bildirim almayacak.')}catch(error){safeError(error,'cihaz kapatma');toast('Bildirim kapatılamadı',error.message||String(error))}finally{await refreshDiagnostics()}}
async function test(){try{await sync();if(!subscriptionId||!deviceSynced)throw new Error('Önce bu cihazın bağlantısını açın veya yenileyin.');var result=await server('test',{subscriptionId:subscriptionId});lastTestResult={notificationId:result.notificationId,status:result.status,error:result.error||null,display:null,time:new Date().toLocaleString('tr-TR')};toast('Test sonucu',result.status==='sent'?'Push servisi gönderimi kabul etti. Telefon ekranında göründüğünü ayrıca kontrol edin.':'Sunucu gönderimi kabul etmedi: '+(result.error||result.status));}catch(error){lastTestResult={status:'hata',error:safeError(error,'test gönderimi'),time:new Date().toLocaleString('tr-TR')};toast('Test gönderilemedi',error.message||String(error))}finally{try{localStorage.setItem(TEST_KEY,JSON.stringify(lastTestResult))}catch(_){}await refreshDiagnostics()}}
function install(){
  if(document.getElementById('pushSettings'))return;
  var app=document.getElementById('app'),nav=app?.querySelector('.nav');if(!app)return;
  var page=document.createElement('section');page.id='pushSettings';page.className='page';
  page.innerHTML='<div class="content"><button class="back" onclick="showPage(\'home\')">‹ Ana sayfa</button><h1 class="page-title">Bildirim Ayarları</h1><div class="total"><small>Randevu bildirimleri</small><strong id="webPushStatus">Kontrol ediliyor…</strong><small>Yeni randevu, güncelleme ve otomatik hatırlatma</small></div><button id="webPushEnable" class="fab" onclick="SalonWebPush.enable()">Randevu bildirimlerini aç</button><div id="webPushPermissionHelp" class="security" hidden>Bildirim izni engellenmiş. Android Ayarlar → Uygulamalar → Salon Modern (veya kullandığınız tarayıcı) → Bildirimler bölümünden izni açın. Tarayıcıda ayrıca site ayarlarında salon-modern bildirimlerine izin verin. Sonra bu ekrana dönüp yeniden deneyin.</div><div class="security" role="status"><strong>Bu cihazın bağlantısı</strong><p>Tarayıcı izni: <span id="webPushPermission">Kontrol ediliyor…</span></p><p>Service Worker: <span id="webPushWorker">Kontrol ediliyor…</span></p><p>Push aboneliği: <span id="webPushBrowserSub">Kontrol ediliyor…</span></p><p>Sunucu cihaz kaydı: <span id="webPushServerSub">Kontrol ediliyor…</span></p><p>Son test sunucu sonucu: <span id="webPushLastTest">Henüz test edilmedi</span></p><p>Son hata: <span id="webPushError">Yok</span></p></div><button id="webPushRefresh" class="fab" onclick="SalonWebPush.refreshDiagnostics()">Bağlantı durumunu kontrol et</button><button id="webPushRenew" class="fab" onclick="SalonWebPush.renew()">Bu cihazın bağlantısını yenile</button><button id="webPushTest" class="fab" onclick="SalonWebPush.test()">Test bildirimi gönder</button><button id="webPushDisable" class="fab danger" onclick="SalonWebPush.disable()">Bu cihazda kapat</button><div class="security">Yenileme yalnızca bu tarayıcının aboneliğini değiştirir. Sunucunun gönderimi kabul etmesi, bildirimin telefonda göründüğünü kanıtlamaz. iPhone/iPad’de önce Salon Modern’i ana ekrana ekleyin.</div></div>';
  if(nav)app.insertBefore(page,nav);else app.appendChild(page);
  var homeContent=document.querySelector('#home .content');
  if(homeContent&&!document.getElementById('webPushPrompt')){var prompt=document.createElement('div');prompt.id='webPushPrompt';prompt.className='total';prompt.style.cssText='border:2px solid #bd8a3e;box-shadow:0 8px 24px rgba(0,0,0,.12)';prompt.innerHTML='<small>ÖNEMLİ · BİLDİRİMLER KAPALI</small><strong>Randevu bildirimlerini bu telefonda açın</strong><small>Atanan randevular ve otomatik hatırlatmalar, uygulama kapalıyken de gelir.</small><button type="button" class="fab" onclick="SalonWebPush.enable()">Şimdi bildirimleri aç</button>';homeContent.insertBefore(prompt,homeContent.firstChild)}
  refreshDiagnostics();
}
function isOneHourReminder(data){return data?.kind==='appointment_reminder'||data?.type==='appointment_reminder'||String(data?.title||'').toLocaleLowerCase('tr').includes('1 saat')}
async function openReminderAppointment(data){
  if(!authReady())throw new Error('Oturum doğrulaması bekleniyor.');
  var id=data.appointmentId||data.appointment_id;
  if(!id){toast('Randevu açılamadı','İlgili randevu bulunamadı. Takvimi kontrol edin.');return}
  if(typeof reloadRemoteData==='function')await reloadRemoteData();
  // The authenticated query and existing role check both have to permit this appointment.
  var result=await salonDb.from('appointments').select('*').eq('id',id).maybeSingle();
  if(result.error)throw result.error;
  if(!result.data||(result.data.status!=='confirmed'&&!(result.data.status==='completed'&&!isOneHourReminder(data)))){
    toast('Randevu açılamadı','Randevu bulunamadı veya iptal edilmiş. Takvimi kontrol edin.');return
  }
  if(typeof remoteAppointment!=='function'||typeof canManageOwnAppointment!=='function')throw new Error('Takvim henüz hazır değil.');
  var item=remoteAppointment(result.data);
  if(!canManageOwnAppointment(item)){
    toast('Randevu açılamadı','Bu randevuyu görüntüleme yetkiniz yok. Takvimi kontrol edin.');return
  }
  if(typeof appts!=='undefined'&&Array.isArray(appts)&&!appts.some(function(row){return String(row.id)===String(id)}))appts.push(item);
  if(typeof appointmentDate==='function')teamCalendarDate=appointmentDate(item);
  if(typeof teamCalendarMode!=='undefined')teamCalendarMode='day';
  if(typeof renderCalendar==='function')renderCalendar();
  if(typeof openAppointmentModal!=='function')throw new Error('Randevu ekranı henüz hazır değil.');
  openAppointmentModal('',item.id);
}
async function openNotification(data){
  if(!data)return;
  if(data.kind==='customer_return_due'||data.type==='customer_return_due'){
    if(typeof window.SalonReturnDaily?.open!=='function')throw new Error('Geri çağırma listesi henüz hazır değil.');
    await window.SalonReturnDaily.open();
    return;
  }
  if(data.kind==='mori_alert'||data.type==='mori_alert'){
    if(typeof window.MoriPhase3?.openAlert!=='function')throw new Error('MORİ uyarıları henüz hazır değil.');
    await window.MoriPhase3.openAlert(data.moriEventId||data.eventId||'');
    return
  }
  if(data.kind==='appointment_thank_you'||data.type==='appointment_thank_you'){
    var thankYouId=data.appointmentId||data.appointment_id;
    if(!thankYouId||typeof window.openManualThankYouFromNotification!=='function')throw new Error('Teşekkür ekranı henüz hazır değil.');
    await window.openManualThankYouFromNotification(thankYouId);
    return
  }
  if(data.kind==='booking_request'||data.type==='booking_request'){
    showPage('bookingRequests');
    if(window.SalonBookingRequests)window.SalonBookingRequests.load();
    return
  }
  if(data.appointmentDate)teamCalendarDate=data.appointmentDate;
  showPage('calendar');
  if(isOneHourReminder(data)){
    await openReminderAppointment(data);
    return;
  }
  if(data.appointmentId||data.appointment_id){await openReminderAppointment(data);return}
  if(typeof reloadRemoteData==='function')await reloadRemoteData()
}
function clearNotificationUrl(){var url=new URL(location.href);['date','appointment','kind','notification','event'].forEach(function(key){url.searchParams.delete(key)});history.replaceState(history.state,'',url.href)}
function identity(data){return String(data.notificationId||[data.kind||data.type,data.appointmentId||data.appointment_id,data.reminderFor||data.appointmentDate].join(':'))}
function handled(){try{return JSON.parse(sessionStorage.getItem(HANDLED_KEY)||'[]')}catch(_){return []}}
function remember(data){var keys=handled(),key=identity(data);if(!keys.includes(key))keys.push(key);sessionStorage.setItem(HANDLED_KEY,JSON.stringify(keys.slice(-100)))}
function authReady(){return !explicitLogout&&typeof currentUser!=='undefined'&&!!currentUser&&(typeof window.getSalonAuthState!=='function'||window.getSalonAuthState()==='AUTHENTICATED')}
async function flushOpen(){
  if(opening||!pendingOpen||!authReady())return;
  var data=pendingOpen;if(handled().includes(identity(data))){pendingOpen=null;sessionStorage.removeItem(PENDING_KEY);clearNotificationUrl();return}
  opening=true;
  try{await openNotification(data);remember(data);if(pendingOpen===data){pendingOpen=null;sessionStorage.removeItem(PENDING_KEY)}clearNotificationUrl()}
  catch(error){console.warn('[push-open] awaiting connection',error);toast('Bildirim bağlantı bekliyor','Oturumunuz korunuyor. Bağlantı gelince yeniden denenecek.')}
  finally{opening=false;if(pendingOpen&&pendingOpen!==data)setTimeout(flushOpen,0)}
}
function route(data){if(!data||explicitLogout)return;pendingOpen=data;sessionStorage.setItem(PENDING_KEY,JSON.stringify(data));return flushOpen()}
try{pendingOpen=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null')}catch(_){}
window.addEventListener('salon:auth-state',function(event){if(event.detail?.state==='AUTHENTICATED'){explicitLogout=false;setTimeout(flushOpen,0)}});
window.addEventListener('online',function(){toast('Bağlantı geri geldi','Veriler güncelleniyor.');if(currentUser&&typeof reloadRemoteData==='function')Promise.resolve(reloadRemoteData()).catch(function(error){console.warn('[push-online] refresh failed',error)});sync();flushOpen()});
window.addEventListener('focus',function(){sync();flushOpen()});
document.addEventListener('visibilitychange',function(){if(!document.hidden){sync();flushOpen()}});
window.addEventListener('offline',function(){toast('İnternet bağlantısı yok','Canlı veriler güncellenemiyor.')});
if(navigator.serviceWorker)navigator.serviceWorker.addEventListener('message',function(event){if(event.data?.type==='SALON_NOTIFICATION_OPEN')route(event.data.data)});
var enter=window.enterApp;window.enterApp=function(){var result=enter.apply(this,arguments);explicitLogout=false;install();sync();var p=new URLSearchParams(location.search);if(p.get('date')||p.get('kind')==='appointment_thank_you'||p.get('kind')==='mori_alert'||p.get('kind')==='customer_return_due')route({appointmentDate:p.get('date'),appointmentId:p.get('appointment'),kind:p.get('kind')||'',notificationId:p.get('notification')||'',moriEventId:p.get('event')||''});setTimeout(flushOpen,0);return result};
var leave=window.logout;window.logout=async function(){explicitLogout=true;pendingOpen=null;sessionStorage.removeItem(PENDING_KEY);clearNotificationUrl();try{var sub=await existing();if(sub&&currentUser)await salonDb.from('web_push_subscriptions').update({active:false,updated_at:new Date().toISOString()}).eq('endpoint',sub.endpoint).eq('user_id',currentUser.id)}catch(_){}deviceSynced=false;return leave.apply(this,arguments)};
if(salonDb?.auth?.onAuthStateChange)salonDb.auth.onAuthStateChange(function(event,session){if((event==='SIGNED_IN'||event==='TOKEN_REFRESHED'||event==='INITIAL_SESSION')&&session?.user)setTimeout(sync,0)});
setInterval(function(){if(!document.hidden&&Notification.permission==='granted')sync()},5*60*1000);
window.SalonWebPush={enable:enable,renew:renew,disable:disable,test:test,sync:sync,render:render,refreshDiagnostics:refreshDiagnostics,catchUpReminders:catchUpReminders,reminderDiagnostics:reminderDiagnostics,openNotification:route};
})();
