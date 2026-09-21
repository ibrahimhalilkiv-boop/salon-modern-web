(function(){
  'use strict';
  var saving=false,saveWatchdog=null;
  function editingId(){return typeof editingAppointmentId!=='undefined'?editingAppointmentId:null}
  function appointment(){var id=editingId();return id&&Array.isArray(window.appts)?window.appts.find(function(item){return String(item.id)===String(id)})||null:null}
  function closeSuggestions(){var panel=document.getElementById('typedCustomerSuggestions');if(panel){panel.classList.remove('show');panel.style.pointerEvents='none'}}
  function elements(){var modal=document.getElementById('appointmentModal'),form=modal&&modal.querySelector('form.sheet'),save=form&&form.querySelector('button.save:not(#permanentAppointmentDelete):not(#permanentAppointmentCancel):not(#directAppointmentDelete)');return {modal:modal,form:form,save:save}}
  function customerKey(value){return String(value||'').trim().toLocaleLowerCase('tr').replace(/[ç]/g,'c').replace(/[ğ]/g,'g').replace(/[ıi]/g,'i').replace(/[ö]/g,'o').replace(/[ş]/g,'s').replace(/[ü]/g,'u').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]/g,'')}
  function clientList(){try{return Array.isArray(remoteClients)?remoteClients:[]}catch(error){return []}}
  function fillCustomer(client){if(!client)return;var input=document.getElementById('appointmentCustomer'),phone=document.getElementById('appointmentPhone');if(input)input.value=String(client.full_name||'');if(phone)phone.value=String(client.phone||'').trim();try{if(typeof applyCustomerHistory==='function')applyCustomerHistory(client)}catch(error){}closeSuggestions()}
  function renderCustomerPicker(){
    var input=document.getElementById('appointmentCustomer'),panel=document.getElementById('typedCustomerSuggestions');if(!input||!panel)return;
    var term=customerKey(input.value);if(!term){panel.innerHTML='';panel.classList.remove('show');panel.style.pointerEvents='none';return}
    var matches=clientList().filter(function(client){return customerKey(client.full_name).includes(term)}).slice(0,8);
    panel.innerHTML=matches.map(function(client){var name=String(client.full_name||''),phone=String(client.phone||'');return '<button type="button" data-salon-client-id="'+String(client.id).replace(/"/g,'&quot;')+'"><strong>'+name.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</strong><small style="display:block">'+phone.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</small></button>'}).join('');
    panel.classList.toggle('show',matches.length>0);panel.style.pointerEvents=matches.length?'auto':'none';
  }
  function bindCustomerPicker(){
    var input=document.getElementById('appointmentCustomer'),panel=document.getElementById('typedCustomerSuggestions');if(!input||!panel)return;
    input.removeAttribute('list');input.oninput=renderCustomerPicker;input.onfocus=renderCustomerPicker;
    function pick(event){var button=event.target&&event.target.closest&&event.target.closest('button[data-salon-client-id]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();var client=clientList().find(function(item){return String(item.id)===String(button.getAttribute('data-salon-client-id'))});fillCustomer(client)}
    panel.onpointerdown=pick;panel.ontouchstart=pick;panel.onmousedown=pick;panel.onclick=pick;
  }
  async function saveNow(event){
    event&&event.preventDefault();event&&event.stopPropagation();var parts=elements(),form=parts.form,button=parts.save;if(!form||saving)return false;
    if(form.reportValidity&&!form.reportValidity())return false;saving=true;var label=button&&button.textContent||'Randevuyu kaydet';if(button){button.disabled=true;button.textContent='Kaydediliyor…'}closeSuggestions();
    saveWatchdog=setTimeout(function(){
      if(!saving)return;saving=false;
      if(button&&document.body.contains(button)){button.disabled=false;button.textContent=label}
      window.showAppToast&&window.showAppToast('Kayıt beklenenden uzun sürdü','Ekran serbest bırakıldı. İnternet bağlantısını kontrol edip tekrar deneyebilirsiniz.');
    },12000);
    try{
      if(typeof window.saveAppointment!=='function')throw new Error('Randevu kayıt işlevi yüklenemedi.');
      var task=Promise.resolve(window.saveAppointment({preventDefault:function(){},stopPropagation:function(){},target:form,currentTarget:form,submitter:button}));
      var outcome=await Promise.race([task.then(function(){return 'done'}),new Promise(function(resolve){setTimeout(function(){resolve('timeout')},10000)})]);
      if(outcome==='timeout'){
        window.closeAppointmentModal&&window.closeAppointmentModal();
        if(typeof window.showPage==='function')window.showPage('calendar');
        window.showAppToast&&window.showAppToast('İşlem sunucuya gönderildi','Takvim arka planda doğrulanıyor. Ekran kilitlenmedi.');
        task.catch(function(error){console.warn('[appointment-actions] late save failed',error)}).finally(function(){Promise.resolve(window.reloadRemoteData&&window.reloadRemoteData()).catch(function(error){console.warn('[appointment-actions] refresh failed',error)})});
      }
    }
    catch(error){console.error('[appointment-actions] save',error);window.showAppToast&&window.showAppToast('Randevu kaydedilemedi',error&&error.message||'Tekrar deneyin.')}
    finally{if(saveWatchdog){clearTimeout(saveWatchdog);saveWatchdog=null}saving=false;if(button&&document.body.contains(button)){button.disabled=false;button.textContent=label}}return false;
  }
  function cancelNow(event){event&&event.preventDefault();event&&event.stopPropagation();if(saveWatchdog){clearTimeout(saveWatchdog);saveWatchdog=null}saving=false;var parts=elements();if(parts.save){parts.save.disabled=false;parts.save.textContent='Randevuyu kaydet'}closeSuggestions();if(typeof window.closeAppointmentModal==='function')window.closeAppointmentModal();else document.getElementById('appointmentModal')?.classList.remove('show');return false}
  function deleteNow(event){event&&event.preventDefault();event&&event.stopPropagation();closeSuggestions();var id=editingId();if(id&&typeof window.requestAppointmentDeletion==='function')window.requestAppointmentDeletion(id);else window.showAppToast&&window.showAppToast('Silme açılamadı','Randevuyu takvimden yeniden açın.');return false}
  function shareNow(event){event&&event.preventDefault();event&&event.stopPropagation();closeSuggestions();var item=appointment();if(item&&typeof window.shareAppointmentWhatsApp==='function')window.shareAppointmentWhatsApp(item.id);return false}
  function bind(){
    var parts=elements(),form=parts.form,save=parts.save;if(!form)return;form.style.position='relative';form.style.zIndex='1';form.onsubmit=saveNow;
    if(save){save.type='button';save.disabled=false;save.onclick=saveNow;save.ontouchend=null;save.dataset.appointmentAction='save'}
    var back=Array.from(form.querySelectorAll('button.back')).find(function(button){return button.textContent.trim()==='Vazgeç'});if(back){back.type='button';back.onclick=cancelNow;back.ontouchend=null;back.dataset.appointmentAction='back'}
    var remove=document.getElementById('permanentAppointmentDelete');if(remove){remove.type='button';remove.onclick=deleteNow;remove.ontouchend=null;remove.dataset.appointmentAction='delete'}
    var share=document.getElementById('shareAppointmentWhatsapp');if(share){share.type='button';share.onclick=shareNow;share.ontouchend=null;share.dataset.appointmentAction='share'}
    closeSuggestions();bindCustomerPicker();
  }
  var style=document.createElement('style');style.id='appointmentFormActionStyle231';style.textContent='#appointmentModal.show{pointer-events:auto!important}#appointmentModal form.sheet{position:relative!important;z-index:1!important;pointer-events:auto!important}#appointmentModal form.sheet>button{position:relative!important;z-index:1305!important;pointer-events:auto!important;touch-action:manipulation!important;-webkit-tap-highlight-color:transparent}#appointmentModal .customer-suggestions:not(.show){display:none!important;pointer-events:none!important}';document.head.appendChild(style);
  window.bindAppointmentFormActions=bind;window.runAppointmentFormSave=saveNow;
  var previousOpen=window.openAppointmentModal;if(typeof previousOpen==='function')window.openAppointmentModal=function(){var result=previousOpen.apply(this,arguments);bind();setTimeout(bind,0);return result};
  bind();
  var modal=document.getElementById('appointmentModal');
  if(modal){
    var wasOpen=modal.classList.contains('show');
    new MutationObserver(function(){
      var isOpen=modal.classList.contains('show');
      if(isOpen&&!wasOpen)setTimeout(bind,0);
      wasOpen=isOpen;
    }).observe(modal,{attributes:true,attributeFilter:['class']});
  }
})();
