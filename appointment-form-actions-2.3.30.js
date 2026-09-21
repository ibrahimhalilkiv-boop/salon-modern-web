(function(){
  'use strict';
  var saving=false,lastTouchAt=0;
  function editingId(){return typeof editingAppointmentId!=='undefined'?editingAppointmentId:null}
  function appointment(){var id=editingId();return id&&Array.isArray(window.appts)?window.appts.find(function(item){return String(item.id)===String(id)})||null:null}
  function closeSuggestions(){var panel=document.getElementById('typedCustomerSuggestions');if(panel){panel.classList.remove('show');panel.style.pointerEvents='none'}}
  function elements(){var modal=document.getElementById('appointmentModal'),form=modal&&modal.querySelector('form.sheet'),save=form&&form.querySelector('button.save:not(#permanentAppointmentDelete):not(#permanentAppointmentCancel):not(#directAppointmentDelete)');return {modal:modal,form:form,save:save}}
  async function saveNow(event){
    event&&event.preventDefault();event&&event.stopPropagation();var parts=elements(),form=parts.form,button=parts.save;if(!form||saving)return false;
    if(form.reportValidity&&!form.reportValidity())return false;saving=true;var label=button&&button.textContent||'Randevuyu kaydet';if(button){button.disabled=true;button.textContent='Kaydediliyor…'}closeSuggestions();
    try{if(typeof window.saveAppointment!=='function')throw new Error('Randevu kayıt işlevi yüklenemedi.');await window.saveAppointment({preventDefault:function(){},stopPropagation:function(){},target:form,currentTarget:form,submitter:button})}
    catch(error){console.error('[appointment-actions] save',error);window.showAppToast&&window.showAppToast('Randevu kaydedilemedi',error&&error.message||'Tekrar deneyin.')}
    finally{saving=false;if(button&&document.body.contains(button)){button.disabled=false;button.textContent=label}}return false;
  }
  function cancelNow(event){event&&event.preventDefault();event&&event.stopPropagation();closeSuggestions();if(typeof window.closeAppointmentModal==='function')window.closeAppointmentModal();else document.getElementById('appointmentModal')?.classList.remove('show');return false}
  function deleteNow(event){event&&event.preventDefault();event&&event.stopPropagation();closeSuggestions();var id=editingId();if(id&&typeof window.requestAppointmentDeletion==='function')window.requestAppointmentDeletion(id);else window.showAppToast&&window.showAppToast('Silme açılamadı','Randevuyu takvimden yeniden açın.');return false}
  function shareNow(event){event&&event.preventDefault();event&&event.stopPropagation();closeSuggestions();var item=appointment();if(item&&typeof window.shareAppointmentWhatsApp==='function')window.shareAppointmentWhatsApp(item.id);return false}
  function touch(handler){return function(event){lastTouchAt=Date.now();return handler(event)}}
  function click(handler){return function(event){if(Date.now()-lastTouchAt<650){event.preventDefault();return false}return handler(event)}}
  function bind(){
    var parts=elements(),form=parts.form,save=parts.save;if(!form)return;form.style.position='relative';form.style.zIndex='1';form.onsubmit=saveNow;
    if(save){save.type='button';save.disabled=false;save.onclick=click(saveNow);save.ontouchend=touch(saveNow);save.dataset.appointmentAction='save'}
    var back=Array.from(form.querySelectorAll('button.back')).find(function(button){return button.textContent.trim()==='Vazgeç'});if(back){back.type='button';back.onclick=click(cancelNow);back.ontouchend=touch(cancelNow);back.dataset.appointmentAction='back'}
    var remove=document.getElementById('permanentAppointmentDelete');if(remove){remove.type='button';remove.onclick=click(deleteNow);remove.ontouchend=touch(deleteNow);remove.dataset.appointmentAction='delete'}
    var share=document.getElementById('shareAppointmentWhatsapp');if(share){share.type='button';share.onclick=click(shareNow);share.ontouchend=touch(shareNow);share.dataset.appointmentAction='share'}
    closeSuggestions();
  }
  var style=document.createElement('style');style.id='appointmentFormActionStyle231';style.textContent='#appointmentModal.show{pointer-events:auto!important}#appointmentModal form.sheet{position:relative!important;z-index:1!important;pointer-events:auto!important}#appointmentModal form.sheet>button{position:relative!important;z-index:1305!important;pointer-events:auto!important;touch-action:manipulation!important;-webkit-tap-highlight-color:transparent}#appointmentModal .customer-suggestions:not(.show){display:none!important;pointer-events:none!important}';document.head.appendChild(style);
  window.bindAppointmentFormActions=bind;window.runAppointmentFormSave=saveNow;
  var previousOpen=window.openAppointmentModal;if(typeof previousOpen==='function')window.openAppointmentModal=function(){var result=previousOpen.apply(this,arguments);bind();setTimeout(bind,0);return result};
  bind();var modal=document.getElementById('appointmentModal');if(modal)new MutationObserver(function(){setTimeout(bind,0)}).observe(modal,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
})();
