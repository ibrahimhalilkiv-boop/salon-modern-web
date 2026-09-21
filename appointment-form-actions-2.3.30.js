(function(){
  'use strict';

  var saving=false;

  function editingId(){return typeof editingAppointmentId!=='undefined'?editingAppointmentId:null}
  function appointment(){var id=editingId();return id&&typeof appts!=='undefined'&&Array.isArray(appts)?appts.find(function(item){return String(item.id)===String(id)})||null:null}
  function closeSuggestions(){document.getElementById('typedCustomerSuggestions')?.classList.remove('show')}

  function bindForm(){
    var modal=document.getElementById('appointmentModal'),form=modal?.querySelector('form.sheet');
    if(!form)return;

    var save=form.querySelector('button.save:not(#permanentAppointmentDelete):not(#permanentAppointmentCancel):not(#directAppointmentDelete)');
    if(save){
      save.type='submit';
      save.disabled=false;
    }

    form.onsubmit=async function(event){
      event.preventDefault();
      event.stopPropagation();
      if(saving)return false;
      if(typeof form.reportValidity==='function'&&!form.reportValidity())return false;
      saving=true;
      var text=save?.textContent||'Randevuyu kaydet';
      if(save){save.disabled=true;save.textContent='Kaydediliyor…'}
      closeSuggestions();
      try{
        await window.saveAppointment(event);
      }catch(error){
        window.showAppToast?.('Randevu kaydedilemedi',error?.message||'Tekrar deneyin.');
      }finally{
        saving=false;
        if(save){save.disabled=false;save.textContent=text}
      }
      return false;
    };

    var back=Array.from(form.querySelectorAll('button.back')).find(function(button){return button.textContent.trim()==='Vazgeç'});
    if(back){back.type='button';back.onclick=function(event){event.preventDefault();event.stopPropagation();closeSuggestions();window.closeAppointmentModal?.()}}

    var share=document.getElementById('shareAppointmentWhatsapp');
    if(share){share.type='button';share.onclick=function(event){event.preventDefault();event.stopPropagation();var item=appointment();if(item)window.shareAppointmentWhatsApp?.(item.id)}}
  }

  function installStyle(){
    if(document.getElementById('appointmentFormActionStyle'))return;
    var style=document.createElement('style');
    style.id='appointmentFormActionStyle';
    style.textContent='#appointmentModal .sheet>button,#appointmentModal .sheet>form>button{position:relative;z-index:4;pointer-events:auto!important;touch-action:manipulation}#appointmentModal .customer-suggestions:not(.show){display:none!important;pointer-events:none!important}';
    document.head.appendChild(style);
  }

  installStyle();
  bindForm();
  var modal=document.getElementById('appointmentModal');
  if(modal)new MutationObserver(function(){queueMicrotask(bindForm)}).observe(modal,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
  document.addEventListener('click',function(event){if(event.target?.closest?.('#appointmentModal'))queueMicrotask(bindForm)},true);
  window.bindAppointmentFormActions=bindForm;
})();
