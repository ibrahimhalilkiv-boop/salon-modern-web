(function(){
'use strict';
window.SALON_APP_VERSION='2.3.19';
document.querySelectorAll('#appVersion,[data-app-version]').forEach(function(node){node.textContent='v2.3.19'});
document.querySelectorAll('.auth small').forEach(function(node){if(/^v\d+\.\d+\.\d+$/.test(node.textContent.trim()))node.textContent='v2.3.19'});
})();

// Takvim açılışında güncel randevuları yeniden al; eski seçili çalışan filtresi
// yeni eklenen ve ileri tarihli kayıtların görünmesini engellemesin.
(function(){
  var previousShowPage=showPage, previousReload=reloadRemoteData;
  var fastLoadInFlight=null, fastLoadDate=null, backgroundLoadInFlight=null;
  var calendarRequestSequence=0;
  var appointmentColumns='id,client_id,client_name,client_phone,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,status,note,created_by,recurrence_group_id,tariff_price_snapshot';
  if(typeof previousShowPage!=='function') return;

  function calendarDebug(event,detail){
    if(window.SALON_CALENDAR_DEBUG!==true&&localStorage.getItem('salonCalendarDebug')!=='1')return;
    console.info('[SalonCalendar '+new Date().toISOString()+'] '+event,Object.assign({
      userId:currentUser&&currentUser.id,
      role:currentUser&&currentUser.role,
      selectedEmployee:teamCalendarMember||null,
      appointmentCount:Array.isArray(appts)?appts.length:0,
      realtimeState:salonChannel&&salonChannel.state||null
    },detail||{}));
  }

  function nextLocalDate(date){
    var parts=String(date||'').split('-').map(Number);
    var value=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]+1));
    return value.getUTCFullYear()+'-'+String(value.getUTCMonth()+1).padStart(2,'0')+'-'+String(value.getUTCDate()).padStart(2,'0');
  }

  async function loadCalendarDayFast(date){
    if(!currentUser||!salonDb||!date)return;
    var requestId=++calendarRequestSequence;
    var start=date+'T00:00:00+03:00',end=nextLocalDate(date)+'T00:00:00+03:00';
    calendarDebug('day-query-start',{requestId:requestId,rangeStart:start,rangeEnd:end});
    var results=await Promise.all([
      salonDb.from('profiles').select('id,username,full_name,role,commission_pct,active').order('full_name'),
      salonDb.from('services').select('id,name,price,duration_minutes,active').order('name'),
      salonDb.from('appointments').select(appointmentColumns).gte('scheduled_at',start).lt('scheduled_at',end).order('scheduled_at',{ascending:true}),
      salonDb.from('closed_time_slots').select('id,employee_id,starts_at,ends_at,note').lt('starts_at',end).gt('ends_at',start).order('starts_at',{ascending:true})
    ]);
    var failed=results.find(function(result){return result&&result.error});
    if(failed)throw failed.error;
    if(requestId!==calendarRequestSequence){
      calendarDebug('day-query-stale-ignored',{requestId:requestId,latestRequestId:calendarRequestSequence});
      return;
    }
    remoteProfiles=results[0].data||[];
    remoteServices=results[1].data||[];
    remoteClosedSlots=results[3].data||[];
    staff=remoteProfiles.filter(function(profile){return profile.active}).map(function(profile){return [profile.full_name,profile.role==='manager'?'Yönetici':'Çalışan',Number(profile.commission_pct),avatarFor(profile.full_name)]});
    appts=(results[2].data||[]).map(remoteAppointment);
    calendarDebug('day-query-complete',{requestId:requestId,returnedRows:appts.length,calendarEvents:appts.length,rangeStart:start,rangeEnd:end});
    if(typeof renderHomeSummary==='function')renderHomeSummary();
    if(typeof renderCalendar==='function')renderCalendar();
    if(typeof render==='function')render();
  }

  async function loadAllAppointmentsPaged(){
    var appointmentRows=[],pageSize=1000,offset=0;
    calendarDebug('background-appointments-start');
    while(offset<10000){
      var page=await salonDb.from('appointments').select(appointmentColumns).order('scheduled_at',{ascending:true}).range(offset,offset+pageSize-1);
      if(page.error)throw page.error;
      var rows=page.data||[];
      appointmentRows=appointmentRows.concat(rows);
      if(rows.length<pageSize)break;
      offset+=pageSize;
    }
    calendarDebug('background-appointments-complete',{returnedRows:appointmentRows.length});
    return appointmentRows.map(remoteAppointment);
  }

  function startBackgroundLoad(){
    if(backgroundLoadInFlight||!currentUser)return backgroundLoadInFlight;
    backgroundLoadInFlight=(async function(){
      var validCalendarRows=Array.isArray(appts)?appts.slice():[];
      var activeRenderCalendar=renderCalendar;
      calendarDebug('background-suppressed-reload-start',{preservedRows:validCalendarRows.length});
      try{
        // Eski yükleme zinciri ilk 1000 kaydı ara sonuç olarak appts üzerine
        // yazıyor. Bu ara sonucu takvime çizdirmeyerek görünür veriyi koru.
        renderCalendar=function(){};
        await previousReload();
      }finally{
        renderCalendar=activeRenderCalendar;
        appts=validCalendarRows;
      }
      var completeAppointments=await loadAllAppointmentsPaged();
      appts=completeAppointments;
      calendarDebug('background-state-committed',{appointmentCount:appts.length,calendarEvents:appts.filter(function(item){return appointmentDate(item)===selectedTeamDate()}).length});
      if(typeof renderHomeSummary==='function')renderHomeSummary();
      if(typeof renderCalendar==='function')renderCalendar();
      if(typeof render==='function')render();
      if(typeof renderStatistics==='function')renderStatistics();
    })().catch(function(error){
      if(typeof showAppToast==='function')showAppToast('Arka plan güncellemesi tamamlanamadı',error&&error.message||'Veriler alınamadı.');
    }).finally(function(){backgroundLoadInFlight=null});
    return backgroundLoadInFlight;
  }

  function refreshCalendarFast(){
    var date=teamCalendarDate||(typeof localDate==='function'?localDate(0):'');
    if(fastLoadInFlight&&fastLoadDate===date)return fastLoadInFlight;
    fastLoadDate=date;
    fastLoadInFlight=loadCalendarDayFast(date).catch(function(error){
      if(typeof showAppToast==='function')showAppToast('Takvim güncellenemedi',error&&error.message||'Randevular alınamadı.');
    }).finally(function(){if(fastLoadDate===date){fastLoadInFlight=null;fastLoadDate=null}});
    return fastLoadInFlight;
  }

  showPage=function(id){
    var target=id==='appointments'?'calendar':id;
    if(target==='calendar'&&currentUser){
      teamCalendarMember=undefined;
      if(!teamCalendarDate&&typeof localDate==='function') teamCalendarDate=localDate(0);
    }
    var result=previousShowPage.apply(this,arguments);
    if(target==='calendar'&&currentUser){
      refreshCalendarFast();
      setTimeout(startBackgroundLoad,0);
    }
    return result;
  };
  if(typeof previousReload==='function'){
    reloadRemoteData=async function(){
      if(!currentUser||!salonDb)return;
      await refreshCalendarFast();
      setTimeout(startBackgroundLoad,0);
    };
  }
})();
