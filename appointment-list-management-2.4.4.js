(function(){
  'use strict';
  if(window.SalonAppointmentList)return;
  var API='https://oxuwwjsakhcqimjsfris.supabase.co/functions/v1/customer-booking-request';
  var rows=[],requestNumber=0,temporary=null,filter={period:'today',source:'all',start:'',end:''};
  function user(){return typeof currentUser!=='undefined'?currentUser:null}
  function isManager(){return user()?.role==='yonetici'}
  function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul'}).format(new Date())}
  function shift(date,days){var value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10)}
  function dates(){var day=today();if(filter.period==='today')return {start:day,end:day};if(filter.period==='week'){var weekday=new Date(day+'T12:00:00Z').getUTCDay(),start=shift(day,-((weekday+6)%7));return {start:start,end:shift(start,6)}}if(filter.period==='month'){var startMonth=day.slice(0,7)+'-01',next=new Date(startMonth+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);return {start:startMonth,end:shift(next.toISOString().slice(0,10),-1)}}var start=filter.start,end=filter.end;function valid(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value}if(!valid(start)||!valid(end)||start>end)throw new Error('Başlangıç ve bitiş tarihlerini kontrol edin.');return {start:start,end:end}}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function active(){return document.getElementById('managedAppointments')?.classList.contains('active')}
  function ensure(){
    if(!user())return;
    if(!document.getElementById('managedAppointments')){
      var page=document.createElement('section');page.id='managedAppointments';page.className='page';
      page.innerHTML='<div class="content"><button class="back" onclick="showPage(\'home\')">‹ Ana sayfa</button><h1 class="page-title">Randevu Yönetimi</h1><div class="row"><label class="field">Tarih aralığı<select id="managedPeriod"><option value="today">Bugün</option><option value="week">Bu hafta</option><option value="month">Bu ay</option><option value="range">Özel tarih aralığı</option></select></label><label class="field">Kaynak<select id="managedSource"><option value="all">Tümü</option><option value="online">Online</option><option value="staff">Personelin eklediği</option></select></label></div><div id="managedDates" class="row hidden"><label class="field">Başlangıç<input id="managedStart" type="date"></label><label class="field">Bitiş<input id="managedEnd" type="date"></label></div><button id="managedRefresh" type="button" class="back">Yenile</button><div id="managedList" aria-live="polite"></div></div>';
      document.getElementById('app').appendChild(page);
      ['managedPeriod','managedSource','managedStart','managedEnd'].forEach(function(id){document.getElementById(id).addEventListener('change',function(){filter.period=document.getElementById('managedPeriod').value;filter.source=document.getElementById('managedSource').value;filter.start=document.getElementById('managedStart').value;filter.end=document.getElementById('managedEnd').value;document.getElementById('managedDates').classList.toggle('hidden',filter.period!=='range');load()})});
      document.getElementById('managedStart').value=today();document.getElementById('managedEnd').value=today();filter.start=today();filter.end=today();
      document.getElementById('managedRefresh').onclick=load;
    }
    var drawer=document.querySelector('#drawerLayer .drawer');
    document.getElementById('drawerBookingRequests')?.remove();
    if(drawer){var button=document.getElementById('drawerManagedAppointments');if(!button){button=document.createElement('button');button.id='drawerManagedAppointments';button.className='menu-item';button.textContent='▤  Randevu Yönetimi';button.onclick=function(){window.drawerPage('managedAppointments')}}var admin=drawer.querySelector("[onclick=\"drawerPage('admin')\"]");drawer.insertBefore(button,admin||drawer.querySelector('#drawerLogout')||null)}
  }
  async function sourceIds(ids){
    var session=await window.salonDb.auth.getSession();if(session.error)throw session.error;var token=session.data?.session?.access_token;if(!token)throw new Error('Personel oturumu gerekli.');
    var found=new Set();
    for(var offset=0;offset<ids.length;offset+=200){var response=await fetch(API+'?action=admin-list&sourceIds='+encodeURIComponent(ids.slice(offset,offset+200).join(',')),{headers:{Authorization:'Bearer '+token}}),data=await response.json();if(!response.ok)throw new Error(data.error||'Randevu kaynakları yüklenemedi.');(data.sourceAppointmentIds||[]).forEach(function(id){found.add(String(id))})}
    return found;
  }
  async function load(){
    var actor=user(),seq=++requestNumber;if(!actor)return;ensure();var holder=document.getElementById('managedList');holder.innerHTML='<div class="empty">Randevular yükleniyor…</div>';
    try{
      var range=dates(),selectedSource=filter.source,loaded=[];
      for(var offset=0;;offset+=500){var query=window.salonDb.from('appointments').select('id,client_id,client_name,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,status,created_by').gte('scheduled_at',range.start+'T00:00:00+03:00').lt('scheduled_at',shift(range.end,1)+'T00:00:00+03:00').neq('status','cancelled').order('scheduled_at').order('id');if(actor.role!=='yonetici')query=query.eq('employee_id',actor.id);var result=await query.range(offset,offset+499);if(result.error)throw result.error;if(seq!==requestNumber||user()?.id!==actor.id)return;loaded=loaded.concat(result.data||[]);if((result.data||[]).length<500)break}
      // Defence in depth: do not trust a client response to broaden employee access.
      if(actor.role!=='yonetici')loaded=loaded.filter(function(row){return String(row.employee_id)===String(actor.id)});
      var online=loaded.length?await sourceIds(loaded.map(function(row){return row.id})):new Set();
      if(seq!==requestNumber||user()?.id!==actor.id)return;
      rows=loaded.map(function(raw){var item=window.remoteAppointment(raw);item.duration=raw.duration_minutes;item.creatorId=raw.created_by;item.source=online.has(String(raw.id))?'online':'staff';return item});
      render(selectedSource);
    }catch(error){if(seq===requestNumber&&user()?.id===actor.id){rows=[];holder.innerHTML='<div class="empty">'+esc(error.message||'Randevular yüklenemedi.')+'</div>'}}
  }
  function render(source){
    var holder=document.getElementById('managedList');if(!holder)return;var shown=rows.filter(function(item){return source==='all'||item.source===source});
holder.innerHTML='<p class="muted">'+shown.length+' randevu</p>'+(shown.map(function(item,index){return '<div class="appointment" style="flex-wrap:wrap"><div class="item-main"><strong>'+esc(item.customer)+'</strong><small>'+esc(item.date)+' · '+esc(item.time)+' · '+esc(item.staff)+'</small><small>'+esc(item.operation)+' · ₺ '+esc(item.amount)+' · '+(item.source==='online'?'Online':'Ekleyen: '+esc((window.remoteProfiles||[]).find(function(profile){return item.creatorId&&String(profile.id)===String(item.creatorId)})?.full_name||'Belirtilmemiş'))+' · '+(item.status==='completed'?'Tamamlandı':'Aktif')+'</small>'+'</div>'+(item.status==='confirmed'?'<button type="button" class="link" data-complete="'+index+'">Tamamla</button>':'')+'<button type="button" class="link" data-edit="'+index+'">Düzenle</button><button type="button" class="remove" data-delete="'+index+'">İptal et</button></div>'}).join('')||'<div class="empty">Bu filtrede randevu yok.</div>');
    holder.querySelectorAll('[data-complete]').forEach(function(button){button.onclick=function(){complete(shown[Number(button.dataset.complete)])}});
    holder.querySelectorAll('[data-edit]').forEach(function(button){button.onclick=function(){edit(shown[Number(button.dataset.edit)])}});
    holder.querySelectorAll('[data-delete]').forEach(function(button){button.onclick=function(){remove(shown[Number(button.dataset.delete)])}});
  }
  function permitted(item){return !!user()&&!!item&&(isManager()||String(item.employeeId)===String(user().id))&&window.canManageOwnAppointment(item)}
  function release(){if(temporary&&typeof appts!=='undefined'){appts=appts.filter(function(item){return item!==temporary})}temporary=null}
  function stage(item){release();if(!appts.some(function(row){return String(row.id)===String(item.id)})){temporary=item;appts.push(item)}}
  function edit(item){if(!permitted(item))return;stage(item);window.openAppointmentModal(item.time,item.id,item.staff)}
  function remove(item){if(!permitted(item))return;stage(item);window.requestAppointmentDeletion(item.id)}
  async function complete(item){if(!permitted(item)||item.status!=='confirmed')return;if(!confirm(item.customer+' randevusu tamamlandı olarak işaretlensin mi?'))return;var result=await window.salonDb.rpc('complete_appointment',{p_appointment_id:item.id});if(result.error){window.showAppToast?.('Randevu tamamlanamadı',result.error.message);return}window.showAppToast?.('Randevu tamamlandı','Uygun ve izinli müşteriler için teşekkür zamanlaması başlatıldı.');await load();await window.reloadRemoteData?.()}
  function reset(){requestNumber++;rows=[];release();Object.assign(filter,{period:'today',source:'all',start:'',end:''});document.getElementById('managedAppointments')?.remove();document.getElementById('drawerManagedAppointments')?.remove()}
  window.SalonAppointmentList={load:load,dates:dates,filter:filter,permitted:permitted};
  var priorEnter=window.enterApp;window.enterApp=function(){var result=priorEnter.apply(this,arguments);ensure();return result};
  var priorShow=window.showPage;window.showPage=function(id){if(id==='managedAppointments'&&!user())return;ensure();var result=priorShow.apply(this,arguments);if(id==='managedAppointments')load();return result};
  var priorDrawer=window.toggleDrawer;window.toggleDrawer=function(){ensure();return priorDrawer.apply(this,arguments)};
  var priorReload=window.reloadRemoteData;window.reloadRemoteData=async function(){var result=await priorReload.apply(this,arguments);ensure();if(active())load();return result};
  var priorClose=window.closeAppointmentModal;window.closeAppointmentModal=function(){var result=priorClose.apply(this,arguments);release();return result};
  var priorDeleteClose=window.closeAppointmentDeleteModal;window.closeAppointmentDeleteModal=function(){var result=priorDeleteClose.apply(this,arguments);if(!document.getElementById('appointmentDeleteModal')?.classList.contains('show'))release();return result};
  var priorLogout=window.logout;window.logout=function(){reset();return priorLogout.apply(this,arguments)};
  ensure();
})();
