(function(){
'use strict';
var API='https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/web-push-dispatch',subscription=null;
function supported(){return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window}
function decode(value){var raw=atob((value+'='.repeat((4-value.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')),out=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
function toast(a,b){if(typeof showAppToast==='function')showAppToast(a,b)}
async function token(){var result=await salonDb.auth.getSession();return result.data?.session?.access_token||''}
async function server(action){var response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await token()},body:JSON.stringify({action:action})}),data=await response.json().catch(function(){return {}});if(!response.ok)throw new Error(data.error||'Bildirim sunucusuna ulaşılamadı.');return data}
async function key(){var response=await fetch(API+'?action=public-key',{cache:'no-store'}),data=await response.json();if(!data.publicKey){if(currentUser?.role==='yonetici')data=await server('bootstrap-vapid');else throw new Error('Web Push anahtarı henüz yönetici tarafından hazırlanmadı.')}return data.publicKey}
async function save(sub,active){var raw=sub.toJSON(),keys=raw.keys||{},result=await salonDb.rpc('claim_web_push_subscription',{p_endpoint:raw.endpoint,p_p256dh:keys.p256dh,p_auth_secret:keys.auth,p_user_agent:navigator.userAgent,p_device_label:(navigator.platform||'PWA cihazı').slice(0,120),p_active:active!==false});if(result.error)throw new Error('Bildirim cihazı sunucuya kaydedilemedi: '+result.error.message)}
async function existing(){if(!supported())return null;subscription=await (await navigator.serviceWorker.ready).pushManager.getSubscription();return subscription}
async function subscribeCurrent(){var registration=await navigator.serviceWorker.ready,sub=await registration.pushManager.getSubscription();if(!sub)sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(await key())});subscription=sub;await save(sub,true);return sub}
function text(){if(!supported())return 'Bu cihazda Web Push desteklenmiyor';if(Notification.permission==='denied')return 'Tarayıcı ayarlarından engellenmiş';if(Notification.permission==='granted'&&subscription)return '✓ Açık';return Notification.permission==='granted'?'İzin açık, cihaz bağlanmamış':'Kapalı'}
function render(){var status=document.getElementById('webPushStatus');if(status)status.textContent=text();var on=document.getElementById('webPushEnable'),off=document.getElementById('webPushDisable'),test=document.getElementById('webPushTest'),prompt=document.getElementById('webPushPrompt');if(on)on.disabled=!supported()||Notification.permission==='denied';if(off)off.disabled=!subscription;if(test)test.disabled=!subscription;if(prompt)prompt.hidden=Boolean(subscription)||!supported()||Notification.permission==='denied'}
async function sync(){try{var sub=await existing();if(currentUser&&Notification.permission==='granted'){if(!sub)sub=await subscribeCurrent();else await save(sub,true)}}catch(error){console.warn('Web Push eşitleme:',error);toast('Bildirim bağlantısı kurulamadı',error.message||'Bu cihaz sunucuya kaydedilemedi.')}render()}
async function enable(){try{if(!supported())throw new Error('Bu tarayıcı Web Push bildirimlerini desteklemiyor.');var permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted')throw new Error(permission==='denied'?'Bildirim izni tarayıcı ayarlarından engellenmiş.':'Bildirim izni verilmedi.');await subscribeCurrent();render();var check=await server('test');toast('Bildirimler açıldı',check.dispatched?.sent?'Test bildirimi gönderildi.':'Bu cihaz artık randevu bildirimlerini alacak.')}catch(error){toast('Bildirimler açılamadı',error.message||String(error));render()}}
async function disable(){try{var sub=await existing();if(sub&&currentUser)await salonDb.from('web_push_subscriptions').update({active:false,updated_at:new Date().toISOString()}).eq('endpoint',sub.endpoint).eq('user_id',currentUser.id);if(sub)await sub.unsubscribe();subscription=null;render();toast('Bildirimler kapatıldı','Bu cihaz artık bildirim almayacak.')}catch(error){toast('Bildirim kapatılamadı',error.message||String(error))}}
async function test(){try{if(!subscription)throw new Error('Önce bildirimleri açın.');var result=await server('test');toast('Test bildirimi',result.dispatched?.sent?'Gönderildi.':'Birkaç saniye içinde gelmeli.')}catch(error){toast('Test gönderilemedi',error.message||String(error))}}
function install(){if(document.getElementById('pushSettings'))return;var app=document.getElementById('app'),nav=app?.querySelector('.nav');if(!app)return;var page=document.createElement('section');page.id='pushSettings';page.className='page';page.innerHTML='<div class="content"><button class="back" onclick="showPage(\'home\')">‹ Ana sayfa</button><h1 class="page-title">Bildirim Ayarları</h1><div class="total"><small>Randevu bildirimleri</small><strong id="webPushStatus">Kontrol ediliyor…</strong><small>Yeni randevu, güncelleme ve 1 saatlik hatırlatma</small></div><button id="webPushEnable" class="fab" onclick="SalonWebPush.enable()">Randevu bildirimlerini aç</button><button id="webPushTest" class="fab" onclick="SalonWebPush.test()">Test bildirimi gönder</button><button id="webPushDisable" class="fab danger" onclick="SalonWebPush.disable()">Bu cihazda kapat</button><div class="security">Her telefon bildirim sistemine bir kez bağlanmalıdır. İzin yalnız bu düğmeye bastığınızda istenir. iPhone/iPad’de önce Salon Modern’i ana ekrana ekleyin.</div></div>';if(nav)app.insertBefore(page,nav);else app.appendChild(page);var homeContent=document.querySelector('#home .content');if(homeContent&&!document.getElementById('webPushPrompt')){var prompt=document.createElement('div');prompt.id='webPushPrompt';prompt.className='total';prompt.style.cssText='border:2px solid #bd8a3e;box-shadow:0 8px 24px rgba(0,0,0,.12)';prompt.innerHTML='<small>ÖNEMLİ · BİLDİRİMLER KAPALI</small><strong>Randevu bildirimlerini bu telefonda açın</strong><small>Atanan randevular ve 1 saat önceki hatırlatmalar, uygulama kapalıyken de gelir.</small><button type="button" class="fab" onclick="SalonWebPush.enable()">Şimdi bildirimleri aç</button>';homeContent.insertBefore(prompt,homeContent.firstChild)}var drawer=document.querySelector('.drawer');if(drawer){var button=document.createElement('button');button.className='menu-item';button.innerHTML='🔔 &nbsp; Bildirim Ayarları';button.onclick=function(){drawerPage('pushSettings')};var sep=drawer.querySelector('.drawer-separator');drawer.insertBefore(button,sep||null)}render()}
function isOneHourReminder(data){return data?.kind==='appointment_reminder'||data?.type==='appointment_reminder'||String(data?.title||'').toLocaleLowerCase('tr').includes('1 saat')}
function openReminderWhatsApp(data){
  var id=data?.appointmentId||data?.appointment_id||data?.id;if(!id)return false;
  var item=(typeof appts!=='undefined'&&Array.isArray(appts))?appts.find(function(row){return String(row.id)===String(id)}):null;
  if(!item||typeof whatsappReminderUrl!=='function')return false;
  var client=(typeof remoteClients!=='undefined'&&Array.isArray(remoteClients))?remoteClients.find(function(row){return String(row.id)===String(item.clientId)||String(row.full_name||'').toLocaleLowerCase('tr')===String(item.customer||'').toLocaleLowerCase('tr')}):null;
  var rawPhone=item.phone||client?.phone||'',phone=typeof whatsappPhone==='function'?whatsappPhone(rawPhone):String(rawPhone).replace(/\D/g,'');
  if(!/^90\d{10}$/.test(phone)){toast('Telefon numarası bulunamadı','Müşterinin telefon numarasını kontrol edin.');return true}
  var url=whatsappReminderUrl(item.customer,phone,typeof appointmentDate==='function'?appointmentDate(item):data?.appointmentDate,item.time,item.staff,item.amount);
  var clean=new URL(location.href);['date','appointment','kind'].forEach(function(key){clean.searchParams.delete(key)});history.replaceState(history.state,'',clean.href);
  location.assign(url);return true
}
async function route(data){
  if(!data)return;
  if(data.appointmentDate)teamCalendarDate=data.appointmentDate;
  showPage('calendar');
  if(isOneHourReminder(data)){
    if(openReminderWhatsApp(data))return;
    if(typeof reloadRemoteData==='function'){try{await reloadRemoteData()}catch(error){console.warn('[push-reminder] refresh failed',error)}}
    if(openReminderWhatsApp(data))return;
    if(typeof showAppToast==='function')showAppToast('Hatırlatma açıldı','Randevu bulunduğunda WhatsApp mesajını randevu üzerinden açabilirsiniz.');
    return
  }
  if(typeof reloadRemoteData==='function')reloadRemoteData()
}
window.addEventListener('online',function(){toast('Bağlantı geri geldi','Veriler güncelleniyor.');if(currentUser&&typeof reloadRemoteData==='function')reloadRemoteData()});
window.addEventListener('focus',function(){if(currentUser)sync()});
document.addEventListener('visibilitychange',function(){if(!document.hidden&&currentUser)sync()});
window.addEventListener('offline',function(){toast('İnternet bağlantısı yok','Canlı veriler güncellenemiyor.')});
if(navigator.serviceWorker)navigator.serviceWorker.addEventListener('message',function(event){if(event.data?.type==='SALON_NOTIFICATION_OPEN')route(event.data.data)});
var enter=window.enterApp;window.enterApp=function(){var result=enter.apply(this,arguments);install();sync();var p=new URLSearchParams(location.search);if(p.get('date'))setTimeout(function(){route({appointmentDate:p.get('date'),appointmentId:p.get('appointment'),kind:p.get('kind')||''})},0);return result};
var leave=window.logout;window.logout=async function(){try{var sub=await existing();if(sub&&currentUser)await salonDb.from('web_push_subscriptions').update({active:false,updated_at:new Date().toISOString()}).eq('endpoint',sub.endpoint).eq('user_id',currentUser.id)}catch(_){}return leave.apply(this,arguments)};
window.SalonWebPush={enable:enable,disable:disable,test:test,sync:sync,render:render};
})();
