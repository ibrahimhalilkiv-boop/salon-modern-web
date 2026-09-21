(function(){
  'use strict';
  var saving=false;
  function editingId(){return typeof editingAppointmentId!=='undefined'?editingAppointmentId:null}
  function appointment(){var id=editingId();return id&&typeof appts!=='undefined'&&Array.isArray(appts)?appts.find(function(item){return String(item.id)===String(id)})||null:null}
  function closeSuggestions(){document.getElementById('typedCustomerSuggestions')?.classList.remove('show')}
  function formAndSave(){var modal=document.getElementById('appointmentModal'),form=modal?.querySelector('form.sheet'),save=form?.querySelector('button.save:not(#permanentAppointmentDelete):not(#permanentAppointmentCancel):not(#directAppointmentDelete)');return {modal:modal,form:form,save:save}}
  async function runSave(event){
    event?.preventDefault?.();event?.stopPropagation?.();var parts=formAndSave(),form=parts.form,save=parts.save;if(!form||saving)return false;
    if(typeof form.reportValidity==='function'&&!form.reportValidity())return false;saving=true;var text=save?.textContent||'Randevuyu kaydet';if(save){save.disabled=true;save.textContent='Kaydediliyor…'}closeSuggestions();
    try{if(typeof window.saveAppointment!=='function')throw new Error('Randevu kayıt işlevi yüklenemedi.');await window.saveAppointment({preventDefault:function(){},stopPropagation:function(){},target:form,currentTarget:form,submitter:save})}
    catch(error){console.error('[appointment-actions] save failed',error);window.showAppToast?.('Randevu kaydedilemedi',error?.message||'Tekrar deneyin.')}
    finally{saving=false;if(save&&document.body.contains(save)){save.disabled=false;save.textContent=text}}return false;
  }
  function runDelete(event){event?.preventDefault?.();event?.stopPropagation?.();closeSuggestions();var id=editingId();if(!id){window.showAppToast?.('Randevu seçilemedi','Takvimden randevuyu yeniden açın.');return false}if(typeof window.requestAppointmentDeletion!=='function'){window.showAppToast?.('Silme açılamadı','Sayfayı yenileyip tekrar deneyin.');return false}window.requestAppointmentDeletion(id);return false}
  function runBack(event){event?.preventDefault?.();event?.stopPropagation?.();closeSuggestions();window.closeAppointmentModal?.();return false}
  function runShare(event){event?.preventDefault?.();event?.stopPropagation?.();closeSuggestions();var item=appointment();if(item&&typeof window.shareAppointmentWhatsApp==='function')window.shareAppointmentWhatsApp(item.id);else window.showAppToast?.('Paylaşım açılamadı','Randevu bilgisi bulunamadı.');return false}
  function bindForm(){
    var parts=formAndSave(),form=parts.form,save=parts.save;if(!form)return;form.onsubmit=runSave;
    if(save){save.type='button';save.disabled=false;save.onclick=runSave;save.dataset.appointmentAction='save'}
    var remove=document.getElementById('permanentAppointmentDelete');if(remove){remove.type='button';remove.onclick=runDelete;remove.dataset.appointmentAction='delete'}
    var back=Array.from(form.querySelectorAll('button.back')).find(function(button){return button.textContent.trim()==='Vazgeç'});if(back){back.type='button';back.onclick=runBack;back.dataset.appointmentAction='back'}
    var share=document.getElementById('shareAppointmentWhatsapp');if(share){share.type='button';share.onclick=runShare;share.dataset.appointmentAction='share'}
  }
  function installStyle(){if(document.getElementById('appointmentFormActionStyle'))return;var style=document.createElement('style');style.id='appointmentFormActionStyle';style.textContent='#appointmentModal form.sheet>button{position:relative!important;z-index:1305!important;pointer-events:auto!important;touch-action:manipulation!important}#appointmentModal .customer-suggestions:not(.show){display:none!important;pointer-events:none!important}';document.head.appendChild(style)}
  window.bindAppointmentFormActions=bindForm;window.runAppointmentFormSave=runSave;
  try{installStyle();bindForm();var modal=document.getElementById('appointmentModal');if(modal)new MutationObserver(function(){queueMicrotask(bindForm)}).observe(modal,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});document.addEventListener('click',function(event){if(event.target?.closest?.('#appointmentModal'))queueMicrotask(bindForm)},true)}catch(error){console.error('[appointment-actions] bind failed',error)}
})();
