(function(){
  'use strict';
  var labels={appointment_confirmation:'Randevu onayı',appointment_update:'Randevu güncellemesi',appointment_reminder:'Randevu hatırlatması',appointment_cancelled:'Randevu iptali'};
  var states={queued:'Gönderim bekleniyor',sending:'Gönderiliyor',sent:"WhatsApp'a gönderildi",delivered:'Teslim edildi',read:'Okundu',failed:'Gönderilemedi',delivery_unknown:'Durum belirsiz',manual_pending:'Eski manuel kayıt (devre dışı)',manual_handled:'Manuel gönderim işaretlendi',awaiting_meta_approval:'Şablon onayı bekleniyor',skipped_no_phone:'Telefon numarası yok',skipped_event_invalid:'Geçersizleşti'};
  function manager(){return typeof currentUser!=='undefined'&&currentUser?.role==='yonetici'}
  async function renderInto(id,box){
    if(!box)return;if(!manager()){box.replaceChildren();return}box.replaceChildren();box.textContent='WhatsApp durumları yükleniyor…';
    var result=await window.salonDb.rpc('appointment_whatsapp_status',{p_appointment_id:id});
    if(!box.isConnected)return;
    box.replaceChildren();if(result.error){box.textContent='WhatsApp durumu alınamadı: '+result.error.message;return}
    var rows=Array.isArray(result.data)?result.data:[];
    if(!rows.length){box.textContent='Bu randevu için WhatsApp kaydı yok.';return}
    var heading=document.createElement('strong');heading.textContent='WhatsApp gönderim durumu';box.appendChild(heading);
    rows.forEach(function(row){
      var line=document.createElement('div');line.className='appointment-whatsapp-status-row';
      var text=document.createElement('span');text.textContent=(labels[row.template_key]||'Mesaj')+': '+(states[row.status]||'İşlem bekliyor');line.appendChild(text);
      box.appendChild(line)
    })
  }
  function statusBox(parent,id){var box=parent?.querySelector('#appointmentWhatsappStatus');if(!box&&parent){box=document.createElement('div');box.id='appointmentWhatsappStatus';box.className='notice appointment-whatsapp-status';parent.appendChild(box)}if(box)renderInto(id,box)}
  var previousClick=window.appointmentClick;
  window.appointmentClick=function(id){var result=previousClick.apply(this,arguments);var modal=document.getElementById('appointmentActionModal');if(modal?.classList.contains('show')&&manager())statusBox(modal.querySelector('.sheet'),id);return result};
  var previousOpen=window.openAppointmentModal;
  window.openAppointmentModal=function(time,id){var result=previousOpen.apply(this,arguments),sheet=document.querySelector('#appointmentModal .sheet');sheet?.querySelector('#appointmentWhatsappStatus')?.remove();if(id&&manager()&&document.getElementById('appointmentModal')?.classList.contains('show'))statusBox(sheet,id);return result};
  window.SalonAppointmentWhatsApp={renderInto:renderInto};
  var style=document.createElement('style');style.textContent='.appointment-whatsapp-status{display:block;margin-top:14px}.appointment-whatsapp-status-row{display:flex;flex-wrap:wrap;gap:7px;align-items:center;justify-content:space-between;margin-top:9px}.appointment-whatsapp-status-row .link{font-size:13px}';document.head.appendChild(style);
})();
