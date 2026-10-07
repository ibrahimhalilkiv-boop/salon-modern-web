(function(){
  'use strict';
  var pendingId=null,cancelling=false;
  function esc(value){return typeof window.safe==='function'?window.safe(String(value==null?'':value)):String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]})}
  function appointments(){return typeof appts!=='undefined'&&Array.isArray(appts)?appts:[]}
  function itemFor(id){return appointments().find(function(item){return String(item.id)===String(id)})||null}
  function mayCancel(item){return Boolean(item)&&item.status!=='cancelled'&&(typeof window.canManageOwnAppointment!=='function'||window.canManageOwnAppointment(item))}
  function dateOf(item){return typeof window.friendlyDate==='function'&&typeof window.appointmentDate==='function'?window.friendlyDate(window.appointmentDate(item)):String(item.date||'')}
  function removeLegacyManagement(){document.getElementById('drawerAppointmentManagement')?.remove();document.getElementById('appointmentManagement')?.remove();document.getElementById('appointmentStatusModal')?.remove();document.getElementById('appointmentManagementStyle')?.remove()}
  function ensureModal(){var modal=document.getElementById('appointmentDeleteModal');if(modal)return modal;modal=document.createElement('div');modal.id='appointmentDeleteModal';modal.className='modal';modal.innerHTML='<div class="sheet"><h2>Randevuyu iptal et</h2><div class="debt-delete-warning">Randevu takvimden kalkacak, geçmiş kaydı korunacaktır.</div><div id="appointmentDeleteDetails" class="notice" style="display:block"></div><button id="appointmentDeleteConfirm" type="button" class="save" style="background:#a9443f" onclick="confirmAppointmentDeletion()">Evet, İptal Et</button><button type="button" class="back" style="display:block;margin:14px auto 0" onclick="closeAppointmentDeleteModal()">Vazgeç</button></div>';document.body.appendChild(modal);return modal}
  window.requestAppointmentDeletion=function(id){var item=itemFor(id);if(!item||!mayCancel(item)){window.showAppToast?.('İptal yetkisi yok','Bu randevu iptal edilemiyor.');return}pendingId=String(item.id);var modal=ensureModal(),details=document.getElementById('appointmentDeleteDetails'),confirm=document.getElementById('appointmentDeleteConfirm');details.innerHTML='<strong>'+esc(item.customer||item.client_name||'Müşteri')+'</strong><small style="display:block;margin-top:7px">'+esc(dateOf(item))+' · '+esc(item.time||'')+'</small><small style="display:block;margin-top:7px">Randevu geçmişte korunacak ve saat yeniden müsait olacaktır.</small>';confirm.disabled=false;confirm.textContent='Evet, İptal Et';modal.classList.add('show')};
  window.closeAppointmentDeleteModal=function(){if(cancelling)return;pendingId=null;document.getElementById('appointmentDeleteModal')?.classList.remove('show')};
  window.confirmAppointmentDeletion=async function(){
    if(!pendingId||cancelling)return;var id=pendingId,item=itemFor(id);if(!item||!mayCancel(item)){pendingId=null;document.getElementById('appointmentDeleteModal')?.classList.remove('show');return}
    cancelling=true;var confirm=document.getElementById('appointmentDeleteConfirm');confirm.disabled=true;confirm.textContent='İptal ediliyor…';
    function finishUi(){appts=appointments().filter(function(row){return String(row.id)!==id});pendingId=null;document.getElementById('appointmentDeleteModal')?.classList.remove('show');if(String(editingAppointmentId||'')===id){editingAppointmentId=null;window.closeAppointmentModal?.()}window.renderHomeSummary?.();window.render?.();window.renderCalendar?.();window.renderStatistics?.()}
    try{
      var request=window.salonDb.rpc('cancel_appointment',{p_appointment_id:id,p_reason:null});
      var outcome=await Promise.race([Promise.resolve(request).then(function(result){return {result:result}}),new Promise(function(resolve){setTimeout(function(){resolve({timeout:true})},10000)})]);
      if(outcome.timeout){window.showAppToast?.('İptal isteği gönderildi','Sonuç arka planda doğrulanıyor.');Promise.resolve(request).then(function(result){if(result.error)throw result.error;finishUi();return window.reloadRemoteData?.()}).catch(function(error){console.warn('[appointment-cancel] late cancel failed',error);window.showAppToast?.('İptal doğrulanamadı','Takvimi yenileyip kaydı kontrol edin.')});return}
      var result=outcome.result;if(result.error)throw result.error;if(!result.data||result.data.status!=='cancelled')throw new Error('Randevu bulunamadı veya iptal yetkiniz yok.');finishUi();window.showAppToast?.('Randevu iptal edildi','Saat yeniden müsait; geçmiş kaydı korundu.');Promise.resolve(window.reloadRemoteData?.()).catch(function(error){console.warn('[appointment-cancel] refresh failed',error)})
    }catch(error){window.showAppToast?.('Randevu iptal edilemedi',error.message||'Tekrar deneyin.')}
    finally{cancelling=false;if(confirm){confirm.disabled=false;confirm.textContent='Evet, İptal Et'}}
  };
  window.deleteAppointment=function(id){window.requestAppointmentDeletion(id)};
  window.installDirectAppointmentDelete=function(){document.getElementById('directAppointmentDelete')?.remove()};
  window.SalonAppointmentManagement=undefined;removeLegacyManagement();
})();
