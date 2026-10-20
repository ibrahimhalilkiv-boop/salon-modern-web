(function(){
  'use strict';
  var busy=false;
  function user(){return typeof currentUser==='undefined'?null:currentUser}
  function manager(){return user()?.role==='yonetici'}
  function owned(item){return !!user()&&!!item&&(manager()||String(item.employeeId)===String(user().id))}
  function scheduled(item){return Date.parse(item?.scheduledAt||window.remoteSchedule(item.date,item.time))}
  function canMark(item){return owned(item)&&item.status==='confirmed'&&Number.isFinite(scheduled(item))&&scheduled(item)<=Date.now()}
  function canUndo(item){return manager()&&item?.status==='no_show'}
  function current(){var id=typeof editingAppointmentId==='undefined'?null:editingAppointmentId;return id&&Array.isArray(appts)?appts.find(function(item){return String(item.id)===String(id)}):null}
  function toast(title,message){window.showAppToast?.(title,message)}
  async function refresh(){await window.reloadRemoteData?.()}
  async function mark(item){
    if(busy||!canMark(item))return;
    if(!confirm(item.customer+' randevusu “Müşteri Gelmedi” olarak işaretlensin mi?'))return;
    busy=true;sync();
    try{var result=await window.salonDb.rpc('mark_appointment_no_show',{p_appointment_id:item.id});if(result.error)throw result.error;if(result.data?.status!=='no_show')throw new Error('Durum doğrulanamadı.');toast('Müşteri Gelmedi','Randevu ve müşteri geçmişi güncellendi.');window.closeAppointmentModal?.();await refresh()}
    catch(error){toast('Gelmedi kaydedilemedi',error.message||'Tekrar deneyin.')}
    finally{busy=false;sync()}
  }
  async function undo(item){
    if(busy||!canUndo(item))return;
    var reason=prompt('Gelmedi işaretini geri alma nedeni:', 'Yanlışlıkla işaretlendi');
    if(reason===null)return;
    reason=reason.trim();if(!reason){toast('Neden gerekli','Geri alma nedeni boş olamaz.');return}
    busy=true;sync();
    try{var result=await window.salonDb.rpc('undo_appointment_no_show',{p_appointment_id:item.id,p_reason:reason});if(result.error)throw result.error;if(result.data?.status!=='confirmed')throw new Error('Geri alma doğrulanamadı.');toast('Gelmedi geri alındı','Randevu yeniden aktif.');window.closeAppointmentModal?.();await refresh()}
    catch(error){toast('Geri alınamadı',error.message||'Tekrar deneyin.')}
    finally{busy=false;sync()}
  }
  function sync(){
    var form=document.querySelector('#appointmentModal form.sheet');if(!form)return;
    var button=document.getElementById('appointmentNoShowAction');
    if(!button){button=document.createElement('button');button.type='button';button.id='appointmentNoShowAction';button.className='save';button.style.cssText='display:none;margin-top:12px;background:#8b5144;color:white';var back=form.querySelector('button.back');form.insertBefore(button,back||null)}
    var item=current(),markable=canMark(item),undoable=canUndo(item),open=document.getElementById('appointmentModal')?.classList.contains('show');
    button.style.display=open&&(markable||undoable)?'block':'none';button.disabled=busy;
    button.textContent=undoable?'Gelmedi İşaretini Geri Al':'Müşteri Gelmedi';
    button.onclick=function(){var latest=current();if(undoable)undo(latest);else mark(latest)};
  }
  var modal=document.getElementById('appointmentModal');if(modal)new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class']});
  var priorOpen=window.openAppointmentModal;if(priorOpen)window.openAppointmentModal=function(){var result=priorOpen.apply(this,arguments);setTimeout(sync,0);return result};
  var priorCalendar=window.renderCalendar;if(priorCalendar)window.renderCalendar=function(){
    var result=priorCalendar.apply(this,arguments);
    document.querySelectorAll('#calendarContent [data-appointment-id]').forEach(function(card){
      var item=Array.isArray(appts)&&appts.find(function(row){return String(row.id)===String(card.getAttribute('data-appointment-id'))});
      if(item?.status==='no_show'&&!card.querySelector('.appointment-no-show-badge')){
        var badge=document.createElement('span');badge.className='appointment-no-show-badge';badge.textContent='Gelmedi';badge.style.cssText='display:inline-block;margin-left:4px;color:#9a4037;font-weight:800';card.appendChild(badge);
      }
    });
    return result;
  };
  window.SalonNoShow={canMark:canMark,canUndo:canUndo,mark:mark,undo:undo,sync:sync};
  sync();
})();
