(function(){
  'use strict';
  var BUTTON_ID='permanentAppointmentDelete';
  function editingId(){return typeof editingAppointmentId!=='undefined'?editingAppointmentId:null}
  function editingItem(){var id=editingId();return id&&typeof appts!=='undefined'&&Array.isArray(appts)?appts.find(function(item){return String(item.id)===String(id)})||null:null}
  function canDelete(item){return Boolean(item)&&(typeof window.canManageOwnAppointment!=='function'||window.canManageOwnAppointment(item))}
  function ensureButton(){var sheet=document.querySelector('#appointmentModal .sheet');if(!sheet)return null;document.getElementById('directAppointmentDelete')?.remove();document.getElementById('permanentAppointmentCancel')?.remove();var button=document.getElementById(BUTTON_ID);if(button)return button;button=document.createElement('button');button.type='button';button.id=BUTTON_ID;button.className='save';button.textContent='Randevuyu sil';button.style.cssText='display:none;margin-top:12px;background:#a9514d;color:#fff';button.onclick=function(){var id=editingId();if(id)window.requestAppointmentDeletion(id)};var back=sheet.querySelector('button.back');if(back)sheet.insertBefore(button,back);else sheet.appendChild(button);return button}
  function sync(){document.getElementById('directAppointmentDelete')?.remove();document.getElementById('permanentAppointmentCancel')?.remove();var button=ensureButton();if(!button)return;button.style.display=document.getElementById('appointmentModal')?.classList.contains('show')&&canDelete(editingItem())?'block':'none'}
  var modal=document.getElementById('appointmentModal');sync();if(modal)new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});document.addEventListener('click',function(){queueMicrotask(sync)},true);window.syncPermanentAppointmentDeleteButton=sync;
})();
