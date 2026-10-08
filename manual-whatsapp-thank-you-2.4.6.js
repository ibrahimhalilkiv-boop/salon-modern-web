(function(){
  'use strict';
  var rows=[],focusedAppointment='',processingReturn=false;
  var HANDOFF_KEY='salonThankYouWhatsappReturnV1';
  function readHandoff(){try{var raw=sessionStorage.getItem(HANDOFF_KEY);if(!raw)return null;var data=JSON.parse(raw);if(!data||!data.appointmentId||!data.actorId||Date.now()-data.startedAt>3*60*60*1000){sessionStorage.removeItem(HANDOFF_KEY);return null}return data}catch(error){return null}}
  function saveHandoff(data){try{sessionStorage.setItem(HANDOFF_KEY,JSON.stringify(data));return true}catch(error){return false}}
  function clearHandoff(){try{sessionStorage.removeItem(HANDOFF_KEY)}catch(error){}}
  function markDeparted(){var data=readHandoff();if(data&&!data.departed){data.departed=true;saveHandoff(data)}}
  function openWhatsapp(row){if(!isManager()||!row)return;var handoff={appointmentId:String(row.appointment_id),actorId:String(user().id),startedAt:Date.now(),departed:false};saveHandoff(handoff);try{window.location.assign(whatsappUrl(row))}catch(error){clearHandoff();window.showAppToast?.('WhatsApp açılamadı','Tekrar deneyin.')}}
  async function handleReturn(){
    if(processingReturn||document.visibilityState==='hidden'||!isManager())return;
    var handoff=readHandoff();if(!handoff||!handoff.departed||handoff.actorId!==String(user().id))return;
    processingReturn=true;
    try{
      var result=await window.salonDb.rpc('mark_manual_whatsapp_thank_you_handled',{p_appointment_id:handoff.appointmentId});
      if(result.error)throw result.error;
      clearHandoff();
      rows=rows.filter(function(row){return String(row.appointment_id)!==handoff.appointmentId});
      if(focusedAppointment===handoff.appointmentId)focusedAppointment='';
      render();
      await window.loadManualThankYous();
      window.showAppToast?.('Teşekkür listesinden kaldırıldı','WhatsApp gönderimi doğrulanamaz.');
    }catch(error){window.showAppToast?.('Teşekkür kaydı güncellenemedi',error.message||'Listeyi yeniden açın.')}
    finally{processingReturn=false}
  }
  function user(){return typeof currentUser!=='undefined'?currentUser:null}
  function isManager(){return user()?.role==='yonetici'}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]})}
  function dateParts(iso){var date=new Date(iso),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul'}).format(date),time=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);return {day:day,time:time,label:new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'medium',timeStyle:'short'}).format(date)}}
  function ensure(){
    document.getElementById('drawerManualThankYous')?.remove();
    var managed=document.getElementById('managedAppointments'),content=managed?.querySelector('.content');if(!content)return;
    if(!document.getElementById('managedTabs')){
      var heading=content.querySelector('.page-title'),appointments=document.createElement('div'),thankYous=document.createElement('div'),tabs=document.createElement('div');
      appointments.id='managedAppointmentsPanel';thankYous.id='manualThankYous';thankYous.hidden=true;thankYous.className='hidden';
      thankYous.innerHTML='<p class="muted">Uygun tamamlanmış randevular gösterilir. WhatsApp’tan uygulamaya dönünce kayıt listeden otomatik kaldırılır; gönderim doğrulanamaz.</p><button type="button" class="back" onclick="loadManualThankYous()">Yenile</button><div id="manualThankYouList" aria-live="polite"></div>';
      while(heading.nextSibling)appointments.appendChild(heading.nextSibling);
      tabs.id='managedTabs';tabs.className='managed-tabs';tabs.setAttribute('role','tablist');
      tabs.innerHTML='<button type="button" id="managedAppointmentsTab" role="tab" aria-selected="true">Randevular</button><button type="button" id="managedThankYousTab" role="tab" aria-selected="false">Teşekkürler<span id="managedThankYousCount"></span></button>';
      content.appendChild(tabs);content.appendChild(appointments);content.appendChild(thankYous);
      document.getElementById('managedAppointmentsTab').onclick=function(){selectTab('appointments')};
      document.getElementById('managedThankYousTab').onclick=function(){selectTab('thankYous');window.loadManualThankYous()};
      selectTab('appointments');
    }
    document.getElementById('managedThankYousTab').hidden=!isManager();
    if(!isManager()){rows=[];document.getElementById('manualThankYouList').textContent='';document.getElementById('managedThankYousCount').textContent='';selectTab('appointments')}
  }
  function selectTab(tab){var appointments=document.getElementById('managedAppointmentsPanel'),thankYous=document.getElementById('manualThankYous');if(!appointments||!thankYous)return;var isThanks=tab==='thankYous'&&isManager();appointments.hidden=isThanks;appointments.classList.toggle('hidden',isThanks);thankYous.hidden=!isThanks;thankYous.classList.toggle('hidden',!isThanks);[['managedAppointmentsTab',!isThanks],['managedThankYousTab',isThanks]].forEach(function(entry){var button=document.getElementById(entry[0]);button?.classList.toggle('active',entry[1]);button?.setAttribute('aria-selected',String(entry[1]))})}
  function messageFor(row){var parts=dateParts(row.scheduled_at),values=window.appointmentTemplateValues(row.client_name,parts.day,parts.time,'',0,'');return window.renderSavedTemplate('appointment_thank_you',values)}
  function whatsappUrl(row){return 'https://wa.me/'+window.whatsappPhone(row.client_phone)+'?text='+encodeURIComponent(messageFor(row))}
  function render(){var holder=document.getElementById('manualThankYouList');if(!holder)return;holder.innerHTML=rows.map(function(row,index){var focused=String(row.appointment_id)===focusedAppointment;return '<article class="manual-thank-card'+(focused?' manual-thank-focused':'')+'" data-appointment="'+esc(row.appointment_id)+'"><div class="item-main"><strong>'+esc(row.client_name)+'</strong><small>Randevu: '+esc(dateParts(row.scheduled_at).label)+'</small><small>Durum: WhatsApp mesajı hazır</small></div><div class="manual-thank-actions"><button type="button" class="whatsapp" data-open="'+index+'">WhatsApp\'tan Teşekkür Et</button></div></article>'}).join('')||'<div class="empty">Şu anda teşekkür gönderilecek müşteri yok.</div>';holder.querySelectorAll('[data-open]').forEach(function(button){button.onclick=function(){var row=rows[Number(button.dataset.open)];if(row&&isManager())openWhatsapp(row)}})}
  window.loadManualThankYous=async function(){ensure();if(!isManager())return false;var actorId=user().id,holder=document.getElementById('manualThankYouList');if(holder)holder.innerHTML='<div class="empty">Liste yükleniyor…</div>';var result=await window.salonDb.rpc('list_manual_whatsapp_thank_yous');if(!isManager()||user().id!==actorId){rows=[];ensure();return false}if(result.error){rows=[];if(holder)holder.innerHTML='<div class="empty">'+esc(result.error.message)+'</div>';return false}rows=result.data||[];var count=document.getElementById('managedThankYousCount');if(count)count.textContent=rows.length?' ('+rows.length+')':'';render();return true};
  async function showRecord(appointmentId){focusedAppointment=String(appointmentId);priorShow('managedAppointments');ensure();selectTab('thankYous');if(!await window.loadManualThankYous())throw new Error('Teşekkür listesi yüklenemedi.');var row=rows.find(function(item){return String(item.appointment_id)===focusedAppointment});if(row)document.querySelector('.manual-thank-focused')?.scrollIntoView({block:'center'});return row}
  window.openManualThankYouFromNotification=async function(appointmentId){if(!user()||!appointmentId)return false;if(!isManager()){priorShow('managedAppointments');ensure();window.showAppToast?.('Yönetici yetkisi gerekli','Teşekkür mesajları yalnız yöneticiler tarafından yönetilir.');return true}var row=await showRecord(appointmentId);if(!row)window.showAppToast?.('Teşekkür kaydı bulunamadı','İzin veya gönderim durumu değişmiş olabilir.');return true};
  window.openManualThankYouAfterCompletion=async function(appointmentId){if(!isManager())return false;var row=await showRecord(appointmentId);if(!row){window.showAppToast?.('Teşekkür mesajı açılmadı','Telefon numarası, iletişim reddi veya önceki gönderim kontrol edilmeli.');return false}openWhatsapp(row)return true};


  async function loadConsentEditor(){var actor=user(),id=typeof selectedCustomerId!=='undefined'?selectedCustomerId:null,editor=document.getElementById('customerPhoneEditor');if(actor?.role!=='yonetici'||!id||!editor)return;var result=await window.salonDb.from('clients').select('id,whatsapp_marketing_opt_in,whatsapp_marketing_opt_in_at,whatsapp_marketing_opt_out_at').eq('id',id).maybeSingle();if(result.error||!result.data||String(id)!==String(selectedCustomerId))return;var box=document.createElement('label');box.className='field manual-consent';box.innerHTML='<span><input id="customerWhatsappConsent" type="checkbox" '+(result.data.whatsapp_marketing_opt_in&&!result.data.whatsapp_marketing_opt_out_at?'checked':'')+'> WhatsApp teşekkür ve pazarlama iletişim izni var</span><small>İzin müşteriden açıkça alınmış olmalıdır.</small><button type="button" class="link" onclick="saveCustomerWhatsappConsent('+JSON.stringify(String(id))+')">İzin durumunu kaydet</button>';editor.appendChild(box)}
  window.saveCustomerWhatsappConsent=async function(id){var actor=user(),allowed=document.getElementById('customerWhatsappConsent')?.checked;if(actor?.role!=='yonetici')return;var now=new Date().toISOString(),patch=allowed?{whatsapp_marketing_opt_in:true,whatsapp_marketing_opt_in_at:now,whatsapp_marketing_opt_out_at:null}:{whatsapp_marketing_opt_in:false,whatsapp_marketing_opt_in_at:null,whatsapp_marketing_opt_out_at:now},result=await window.salonDb.from('clients').update(patch).eq('id',id).select('id').single();if(result.error){window.showAppToast?.('İzin kaydedilemedi',result.error.message);return}window.showAppToast?.('İzin durumu kaydedildi',allowed?'Müşteri teşekkür listesine uygun olabilir.':'Müşteri teşekkür listesinden çıkarıldı.')};
  var priorDetail=window.renderCustomerDetail;window.renderCustomerDetail=function(){var result=priorDetail.apply(this,arguments);setTimeout(loadConsentEditor,0);return result};
  var priorShow=window.showPage;window.showPage=function(id){var result=priorShow.call(this,id==='manualThankYous'?'managedAppointments':id);ensure();if(id==='managedAppointments')handleReturn();if(id==='manualThankYous'){if(isManager()){selectTab('thankYous');window.loadManualThankYous()}else window.showAppToast?.('Yönetici yetkisi gerekli','Teşekkür mesajları yalnız yöneticiler tarafından yönetilir.')}else if(id==='managedAppointments'){selectTab('appointments');if(isManager())window.loadManualThankYous()}return result};
  var priorEnter=window.enterApp;window.enterApp=function(){var result=priorEnter.apply(this,arguments);ensure();handleReturn();return result};
  var priorDrawer=window.toggleDrawer;window.toggleDrawer=function(){ensure();return priorDrawer.apply(this,arguments)};
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')markDeparted();else handleReturn()});
  window.addEventListener('blur',markDeparted);
  window.addEventListener('pagehide',markDeparted);
  window.addEventListener('focus',handleReturn);
  window.addEventListener('pageshow',handleReturn);
  var style=document.createElement('style');style.textContent='.managed-tabs{display:flex;gap:8px;margin:18px 0}.managed-tabs button{flex:1;min-height:44px;border:1px solid var(--line);border-radius:12px;background:#fff;color:inherit;font-weight:700}.managed-tabs button.active{background:#1f7a5b;color:#fff;border-color:#1f7a5b}.manual-thank-card{margin:12px 0;padding:15px;background:#fff;border:1px solid var(--line);border-radius:16px}.manual-thank-card.manual-thank-focused{border:2px solid #1f7a5b;box-shadow:0 0 0 3px #1f7a5b22}.manual-thank-card small{display:block;margin-top:5px;color:var(--muted)}.manual-thank-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:12px}.manual-thank-actions button{min-height:44px;border-radius:12px;padding:0 13px}.manual-thank-actions .whatsapp{border:0;background:#1f7a5b;color:#fff;font-weight:750}.manual-consent{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.manual-consent small{display:block;margin:6px 0;color:var(--muted)}';document.head.appendChild(style);
  ensure();
})();
