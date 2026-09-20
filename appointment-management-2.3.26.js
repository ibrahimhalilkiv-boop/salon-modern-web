(function(){
  'use strict';

  var period='today',statusFilter='all',rows=[];

  function esc(value){return typeof window.safe==='function'?window.safe(String(value==null?'':value)):String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]})}
  function dateText(value){try{return new Date(value).toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul',day:'numeric',month:'long',weekday:'long'})}catch(_){return String(value||'')}}
  function timeText(value){try{return new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))}catch(_){return ''}}
  function isoDate(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')}
  function addDays(text,days){var parts=text.split('-').map(Number),date=new Date(parts[0],parts[1]-1,parts[2]+days,12);return isoDate(date)}
  function today(){return typeof window.localDate==='function'?window.localDate(0):isoDate(new Date())}
  function rangeFor(value){
    var base=today(),parts=base.split('-').map(Number),date=new Date(parts[0],parts[1]-1,parts[2],12),start,end;
    if(value==='week'){
      var offset=(date.getDay()+6)%7;start=addDays(base,-offset);end=addDays(start,7);
    }else if(value==='month'){
      start=parts[0]+'-'+String(parts[1]).padStart(2,'0')+'-01';
      var next=new Date(parts[0],parts[1],1,12);end=isoDate(next);
    }else{start=base;end=addDays(base,1)}
    return {start:start,end:end};
  }
  function inIstanbul(date){return date+'T00:00:00+03:00'}
  function statusLabel(value){return value==='cancelled'?'İptal edildi':'Aktif'}
  function serviceName(item){return item.service_name||'İşlem bilgisi yok'}
  function employeeName(item){var profile=(window.remoteProfiles||[]).find(function(person){return String(person.id)===String(item.employee_id)});return profile?profile.full_name:'Çalışan'}
  function amountText(value){return typeof window.formatTry==='function'?window.formatTry(Number(value||0)):(Number(value||0).toLocaleString('tr-TR')+' TL')}
  function currentAppointments(){
    if(typeof appts!=='undefined'&&Array.isArray(appts))return appts;
    return Array.isArray(window.appts)?window.appts:[];
  }
  function currentUserId(){
    if(typeof currentUser!=='undefined'&&currentUser&&currentUser.id)return currentUser.id;
    return window.currentUser&&window.currentUser.id?window.currentUser.id:null;
  }
  function cancellationWhatsAppUrl(item){
    if(!item||typeof window.renderSavedTemplate!=='function'||typeof window.appointmentTemplateValues!=='function'||typeof window.whatsappPhone!=='function')return '';
    var clients=typeof remoteClients!=='undefined'&&Array.isArray(remoteClients)?remoteClients:(window.remoteClients||[]);
    var client=clients.find(function(row){return String(row.id)===String(item.clientId||item.client_id)||String(row.full_name||'').toLocaleLowerCase('tr-TR')===String(item.customer||item.client_name||'').toLocaleLowerCase('tr-TR')});
    var phone=item.clientPhone||item.client_phone||item.phone||(client&&client.phone)||'',normalized=window.whatsappPhone(phone);
    if(!normalized)return '';
    var customer=item.customer||item.client_name||'',date=item.scheduled_at?String(item.scheduled_at).slice(0,10):(typeof window.appointmentDate==='function'?window.appointmentDate(item):item.date),time=item.time||(item.scheduled_at?timeText(item.scheduled_at):''),staff=item.staff||employeeName(item);
    var message=window.renderSavedTemplate('appointment_cancelled',window.appointmentTemplateValues(customer,date,time,staff,item.amount||0,item.service_name||item.operation||''));
    return message?'https://wa.me/'+normalized+'?text='+encodeURIComponent(message):'';
  }

  function ensureUi(){
    if(document.getElementById('appointmentManagement'))return;
    var page=document.createElement('section');page.id='appointmentManagement';page.className='page';
    page.innerHTML='<div class="content appointment-management-content"><button class="back" type="button" onclick="showPage(\'calendar\')">‹ Takvim</button><div class="section"><h1 class="page-title">Randevu Yönetimi</h1><button class="link" type="button" onclick="openAppointmentModal()">+ Yeni</button></div><div class="appointment-management-tabs"><button type="button" data-period="today">Bugün</button><button type="button" data-period="week">Bu hafta</button><button type="button" data-period="month">Bu ay</button></div><div class="appointment-management-tools"><input id="appointmentManagementSearch" type="search" placeholder="Müşteri ara" autocomplete="off"><select id="appointmentManagementStatus"><option value="all">Tüm durumlar</option><option value="active">Aktif</option><option value="cancelled">İptal edilen</option></select></div><div id="appointmentManagementSummary"></div><div id="appointmentManagementList"><div class="empty">Randevular yükleniyor…</div></div></div>';
    var main=document.querySelector('main');(main||document.body).appendChild(page);
    var calendarMenu=document.querySelector('[onclick="drawerPage(\'calendar\')"]');
    if(calendarMenu){var button=document.createElement('button');button.type='button';button.className='menu-item';button.id='drawerAppointmentManagement';button.innerHTML='✓ &nbsp; Randevu Yönetimi';button.onclick=function(){window.drawerPage('appointmentManagement')};calendarMenu.insertAdjacentElement('afterend',button)}
    page.querySelectorAll('[data-period]').forEach(function(button){button.onclick=function(){period=button.dataset.period;load()}});
    document.getElementById('appointmentManagementSearch').addEventListener('input',render);
    document.getElementById('appointmentManagementStatus').addEventListener('change',function(event){statusFilter=event.target.value;render()});
    ensureStyle();ensureConfirmModal();
  }
  function ensureStyle(){
    if(document.getElementById('appointmentManagementStyle'))return;
    var style=document.createElement('style');style.id='appointmentManagementStyle';style.textContent='\
      .appointment-management-content{max-width:960px;margin:0 auto}.appointment-management-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.appointment-management-tabs button{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px 8px;font-weight:700;color:var(--ink)}.appointment-management-tabs button.active{background:var(--dark);color:#fff;border-color:var(--dark)}.appointment-management-tools{display:grid;grid-template-columns:1fr minmax(135px,.42fr);gap:8px;margin-bottom:12px}.appointment-management-tools input,.appointment-management-tools select{width:100%;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px;color:var(--ink)}.appointment-management-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}.appointment-management-summary div{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px}.appointment-management-summary small{display:block;color:var(--muted)}.appointment-management-summary strong{font-size:1.25rem}.managed-appointment{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;margin-bottom:10px}.managed-appointment.cancelled{opacity:.72;border-color:#d6a5a2}.managed-appointment-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.managed-appointment-head strong{font-size:1.06rem}.managed-appointment-meta{color:var(--muted);margin-top:5px;line-height:1.45}.managed-appointment-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.managed-appointment-actions button{border:0;border-radius:12px;padding:9px 12px;font-weight:700}.managed-appointment-actions .edit{background:#efe0c9;color:#714b1b}.managed-appointment-actions .cancel{background:#f6dddb;color:#963d38}.managed-appointment-actions .restore{background:#dceee7;color:#155f48}.status-pill{display:inline-block;border-radius:999px;padding:5px 9px;font-size:.78rem;font-weight:800;background:#dceee7;color:#155f48}.status-pill.cancelled{background:#f6dddb;color:#963d38}@media(max-width:560px){.appointment-management-tools{grid-template-columns:1fr}.appointment-management-summary{grid-template-columns:repeat(3,1fr)}.managed-appointment-head{align-items:center}}';document.head.appendChild(style);
  }
  function ensureConfirmModal(){
    if(document.getElementById('appointmentStatusModal'))return;
    var modal=document.createElement('div');modal.id='appointmentStatusModal';modal.className='modal';modal.innerHTML='<div class="sheet"><h2 id="appointmentStatusTitle">Randevu işlemi</h2><div id="appointmentStatusBody" class="security"></div><button type="button" class="save" id="appointmentStatusConfirm">Onayla</button><button type="button" class="back" id="appointmentStatusCancel" style="display:block;margin:14px auto 0">Vazgeç</button></div>';document.body.appendChild(modal);document.getElementById('appointmentStatusCancel').onclick=function(){modal.classList.remove('show')};
  }

  async function load(){
    ensureUi();var range=rangeFor(period),list=document.getElementById('appointmentManagementList');if(list)list.innerHTML='<div class="empty">Randevular yükleniyor…</div>';
    var result=await window.salonDb.from('appointments').select('id,client_id,client_name,client_phone,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,status,created_by,updated_by').gte('scheduled_at',inIstanbul(range.start)).lt('scheduled_at',inIstanbul(range.end)).order('scheduled_at',{ascending:true});
    if(result.error){if(list)list.innerHTML='<div class="empty">Randevular alınamadı: '+esc(result.error.message)+'</div>';return}
    rows=result.data||[];render();
  }
  function render(){
    if(!document.getElementById('appointmentManagement'))return;
    document.querySelectorAll('#appointmentManagement [data-period]').forEach(function(button){button.classList.toggle('active',button.dataset.period===period)});
    var term=String(document.getElementById('appointmentManagementSearch')?.value||'').trim().toLocaleLowerCase('tr-TR');
    var filtered=rows.filter(function(item){var cancelled=item.status==='cancelled';if(statusFilter==='active'&&cancelled)return false;if(statusFilter==='cancelled'&&!cancelled)return false;return !term||String(item.client_name||'').toLocaleLowerCase('tr-TR').includes(term)});
    var active=rows.filter(function(item){return item.status!=='cancelled'}).length,cancelled=rows.length-active;
    document.getElementById('appointmentManagementSummary').innerHTML='<div class="appointment-management-summary"><div><small>Toplam</small><strong>'+rows.length+'</strong></div><div><small>Aktif</small><strong>'+active+'</strong></div><div><small>İptal</small><strong>'+cancelled+'</strong></div></div>';
    document.getElementById('appointmentManagementList').innerHTML=filtered.map(function(item){var cancelled=item.status==='cancelled';return '<article class="managed-appointment '+(cancelled?'cancelled':'')+'"><div class="managed-appointment-head"><div><strong>'+esc(item.client_name||'İsimsiz müşteri')+'</strong><div class="managed-appointment-meta">'+esc(dateText(item.scheduled_at))+' · '+esc(timeText(item.scheduled_at))+'<br>'+esc(employeeName(item))+' · '+esc(serviceName(item))+' · '+esc(amountText(item.amount))+'</div></div><span class="status-pill '+(cancelled?'cancelled':'')+'">'+statusLabel(item.status)+'</span></div><div class="managed-appointment-actions">'+(cancelled?'<button type="button" class="restore" onclick="SalonAppointmentManagement.askRestore(\''+esc(item.id)+'\')">İptali geri al</button>':'<button type="button" class="edit" onclick="SalonAppointmentManagement.edit(\''+esc(item.id)+'\')">Düzenle</button><button type="button" class="cancel" onclick="SalonAppointmentManagement.askCancel(\''+esc(item.id)+'\')">Randevuyu iptal et</button>')+'</div></article>'}).join('')||'<div class="empty">Bu aralıkta randevu bulunamadı.</div>';
  }
  function showConfirmation(id,nextStatus){
    var item=rows.find(function(row){return String(row.id)===String(id)})||currentAppointments().find(function(row){return String(row.id)===String(id)});if(!item){if(typeof window.showAppToast==='function')window.showAppToast('Randevu bulunamadı','Takvimi yenileyip tekrar deneyin.');return}
    var cancelling=nextStatus==='cancelled',modal=document.getElementById('appointmentStatusModal');document.getElementById('appointmentStatusTitle').textContent=cancelling?'Randevu iptal edilsin mi?':'İptal geri alınsın mı?';document.getElementById('appointmentStatusBody').innerHTML='<strong>'+esc(item.client_name||item.customer||'Müşteri')+'</strong><br>'+esc(item.scheduled_at?dateText(item.scheduled_at):(typeof window.friendlyDate==='function'?window.friendlyDate(window.appointmentDate(item)):window.appointmentDate(item)))+' · '+esc(item.scheduled_at?timeText(item.scheduled_at):item.time)+'<br><br>'+(cancelling?'Kayıt silinmeyecek. Takvim ve cirodan çıkarılacak; iptal mesajı için WhatsApp açılacak.':'Randevu yeniden aktif olacak. Saat doluysa işlem engellenecek.');var confirm=document.getElementById('appointmentStatusConfirm');confirm.textContent=cancelling?'İptali onayla':'Yeniden etkinleştir';confirm.onclick=function(){var whatsappUrl=cancelling?cancellationWhatsAppUrl(item):'',whatsappWindow=whatsappUrl?window.open('about:blank','_blank'):null;if(whatsappWindow)whatsappWindow.opener=null;applyStatus(id,nextStatus,whatsappUrl,whatsappWindow)};modal.classList.add('show');
  }
  async function applyStatus(id,nextStatus,whatsappUrl,whatsappWindow){
    var button=document.getElementById('appointmentStatusConfirm');button.disabled=true;button.textContent='Kaydediliyor…';
    try{var values={status:nextStatus},actorId=currentUserId();if(actorId)values.updated_by=actorId;var result=await window.salonDb.from('appointments').update(values).eq('id',id).select('id,status,updated_by').single();if(result.error)throw result.error;document.getElementById('appointmentStatusModal').classList.remove('show');if(whatsappWindow&&whatsappUrl)whatsappWindow.location.href=whatsappUrl;else if(nextStatus==='cancelled'&&!whatsappUrl&&typeof window.showAppToast==='function')window.showAppToast('Telefon numarası yok','Randevu iptal edildi; WhatsApp açılamadı.');await window.reloadRemoteData();await load();if(typeof window.showAppToast==='function')window.showAppToast(nextStatus==='cancelled'?'Randevu iptal edildi':'Randevu yeniden aktif',nextStatus==='cancelled'?'Kayıt korundu; iptal mesajı WhatsApp’ta hazırlandı.':'Randevu takvime geri alındı.');}
    catch(error){if(whatsappWindow)whatsappWindow.close();if(typeof window.showAppToast==='function')window.showAppToast('İşlem tamamlanamadı',error.message||'Tekrar deneyin.');}
    finally{button.disabled=false}
  }
  function edit(id){var item=currentAppointments().find(function(row){return String(row.id)===String(id)});if(!item){if(typeof window.showAppToast==='function')window.showAppToast('Randevu açılamadı','İptal edilen randevuyu önce yeniden etkinleştirin.');return}window.openAppointmentModal('',id)}

  var previousReload=window.reloadRemoteData;
  window.reloadRemoteData=async function(){var result=await previousReload.apply(this,arguments);if(Array.isArray(window.appts)){window.appts=window.appts.filter(function(item){return item.status!=='cancelled'});if(typeof window.render==='function')window.render();if(typeof window.renderCalendar==='function')window.renderCalendar();if(typeof window.renderStatistics==='function')window.renderStatistics()}if(document.getElementById('appointmentManagement')?.classList.contains('active'))await load();return result};
  var previousShowPage=window.showPage;
  window.showPage=function(id){ensureUi();var result=previousShowPage.apply(this,arguments);if(id==='appointmentManagement')load();return result};
  window.deleteAppointment=function(id){showConfirmation(id,'cancelled')};
  window.installDirectAppointmentDelete=function(){document.getElementById('directAppointmentDelete')?.remove()};
  window.SalonAppointmentManagement={load:load,edit:edit,askCancel:function(id){showConfirmation(id,'cancelled')},askRestore:function(id){showConfirmation(id,'confirmed')}};
  ensureUi();
})();
