(function(){
'use strict';

window.SALON_APP_VERSION='2.3.14';

var performanceStyle=document.createElement('style');
performanceStyle.textContent=
  '.calendar-price{font-weight:750;white-space:nowrap}'+
  '.stats-customer-row.stats-price-editable{cursor:pointer;border-radius:12px;padding-left:7px;padding-right:7px}'+
  '.stats-customer-row.stats-price-editable:active{background:#f4ecdf}'+
  '#appointmentPriceModal .price-summary{margin:0 0 13px;padding:11px 13px;border-radius:12px;background:#f6f2ea}'+
  '#appointmentPriceModal .price-summary strong,#appointmentPriceModal .price-summary small{display:block}'+
  '#appointmentPriceModal .price-summary small{margin-top:4px;color:var(--muted)}';
document.head.appendChild(performanceStyle);

function priceText(item){
  return Number(appointmentRevenue(item)||0).toLocaleString('tr-TR')+' TL';
}

var appointmentRevenueBeforeStoredZero=appointmentRevenue;
appointmentRevenue=function(item){
  var stored=item&&item.amount;
  return stored!==null&&stored!==''&&Number.isFinite(Number(stored))?Number(stored):appointmentRevenueBeforeStoredZero(item);
};
window.appointmentRevenue=appointmentRevenue;

/* Add the saved appointment price next to the customer without changing the
   compact service/closed-slot calendar layout. */
var renderCalendarBeforePrice=renderCalendar;
renderCalendar=function(){
  var result=renderCalendarBeforePrice.apply(this,arguments);
  document.querySelectorAll('#calendarContent .team-event.duration-event:not(.duration-closed-event)').forEach(function(card){
    var handler=card.getAttribute('onclick')||'';
    var match=handler.match(/appointmentClick\((?:'|&quot;)?([^'"&)]+)(?:'|&quot;)?\)/);
    var item=match&&appts.find(function(row){return String(row.id)===String(match[1])});
    var label=card.querySelector('strong');
    if(item&&label)label.innerHTML=safe(item.customer)+' <span class="calendar-price">· '+safe(priceText(item))+'</span>';
  });
  return result;
};
window.renderCalendar=renderCalendar;

function ensureAppointmentPriceModal(){
  var modal=document.getElementById('appointmentPriceModal');
  if(modal)return modal;
  modal=document.createElement('div');
  modal.id='appointmentPriceModal';
  modal.className='modal';
  modal.innerHTML='<form class="sheet" onsubmit="saveStatisticsAppointmentPrice(event)">'+
    '<h2>İşlem ücretini güncelle</h2>'+
    '<div id="appointmentPriceSummary" class="price-summary"></div>'+
    '<label class="field">Yeni ücret (TL)<input id="statisticsAppointmentPrice" type="number" min="0" step="0.01" inputmode="decimal" required></label>'+
    '<button class="save" id="statisticsAppointmentPriceSave">Ücreti güncelle</button>'+
    '<button type="button" class="back" style="display:block;margin:14px auto 0" onclick="closeStatisticsAppointmentPrice()">Vazgeç</button>'+
    '</form>';
  document.body.appendChild(modal);
  return modal;
}

var selectedStatisticsAppointmentId=null;
window.openStatisticsAppointmentPrice=function(id){
  if(!currentUser||currentUser.role!=='yonetici')return;
  var item=appts.find(function(row){return String(row.id)===String(id)});
  if(!item){showAppToast('Kayıt bulunamadı','İstatistikleri yenileyip tekrar deneyin.');return;}
  selectedStatisticsAppointmentId=item.id;
  var modal=ensureAppointmentPriceModal();
  document.getElementById('appointmentPriceSummary').innerHTML='<strong>'+safe(item.customer||'Müşteri')+'</strong><small>'+safe(friendlyDate(appointmentDate(item)))+' · '+safe(item.time||'—')+' · '+safe(item.operation||'İşlem')+'</small>';
  document.getElementById('statisticsAppointmentPrice').value=String(Number(appointmentRevenue(item)||0));
  var button=document.getElementById('statisticsAppointmentPriceSave');button.disabled=false;button.textContent='Ücreti güncelle';
  modal.classList.add('show');
  setTimeout(function(){document.getElementById('statisticsAppointmentPrice')?.select()},30);
};
window.closeStatisticsAppointmentPrice=function(){
  document.getElementById('appointmentPriceModal')?.classList.remove('show');
  selectedStatisticsAppointmentId=null;
};

function updateLocalDebtFromPrice(result,id,amount){
  var debt=result&&result.debt;
  if(debt){
    var index=remoteDebts.findIndex(function(row){return String(row.id)===String(debt.id)});
    if(index>=0)remoteDebts[index]=Object.assign({},remoteDebts[index],debt);
    else remoteDebts.unshift(debt);
  }else{
    var existing=remoteDebts.find(function(row){return String(row.appointment_id)===String(id)&&row.status==='open'});
    if(existing){existing.original_amount=amount;existing.amount=Math.max(0,amount-Number(existing.paid_amount||0));}
  }
}

window.saveStatisticsAppointmentPrice=async function(event){
  event.preventDefault();
  if(!currentUser||currentUser.role!=='yonetici'||!selectedStatisticsAppointmentId)return;
  var id=selectedStatisticsAppointmentId,item=appts.find(function(row){return String(row.id)===String(id)}),amount=Number(document.getElementById('statisticsAppointmentPrice').value),button=document.getElementById('statisticsAppointmentPriceSave');
  if(!item||!Number.isFinite(amount)||amount<0){showAppToast('Ücret güncellenemedi','Geçerli bir ücret girin.');return;}
  button.disabled=true;button.textContent='Güncelleniyor…';
  try{
    var response=await salonDb.rpc('update_appointment_price',{p_appointment_id:id,p_amount:amount});
    if(response.error)throw response.error;
    var saved=response.data||{};
    item.amount=Number(saved.amount==null?amount:saved.amount);
    if(saved.debt_original_amount!=null)item.debtOriginalAmount=Number(saved.debt_original_amount);
    updateLocalDebtFromPrice(saved,id,item.amount);
    closeStatisticsAppointmentPrice();
    renderCalendar();renderStatistics();
    if(typeof renderCustomerDetail==='function')renderCustomerDetail();
    if(typeof renderDebts==='function')renderDebts();
    if(typeof renderDebtDetail==='function')renderDebtDetail();
    if(typeof syncNativeAppointmentReminders==='function')syncNativeAppointmentReminders();
    if(document.getElementById('finance')?.classList.contains('active')&&typeof loadCashTracking==='function')setTimeout(loadCashTracking,0);
    showAppToast('Ücret güncellendi',safe(item.customer)+' için yeni ücret '+priceText(item)+'.');
  }catch(error){
    button.disabled=false;button.textContent='Ücreti güncelle';
    showAppToast('Ücret güncellenemedi',error&&error.message||'Sunucu isteği tamamlanamadı.');
  }
};

/* Make each manager statistics row an edit target while employee statistics
   stay strictly read-only. */
var renderStatisticsBeforePrice=renderStatistics;
renderStatistics=function(){
  var result=renderStatisticsBeforePrice.apply(this,arguments);
  if(!currentUser||currentUser.role!=='yonetici')return result;
  var start=document.getElementById('statsStart')?.value||localDate(0),end=document.getElementById('statsEnd')?.value||start,worker=document.getElementById('statsWorker')?.value||'Tümü';
  if(end<start){var swap=start;start=end;end=swap;}
  var sorted=visibleAppointments().filter(function(item){var day=appointmentDate(item);return day>=start&&day<=end&&(worker==='Tümü'||item.staff===worker)}).sort(function(a,b){return (appointmentDate(a)+' '+String(a.time||'')).localeCompare(appointmentDate(b)+' '+String(b.time||''))});
  document.querySelectorAll('#statsAppointmentDetails .stats-customer-row').forEach(function(row,index){
    var item=sorted[index];if(!item)return;
    row.classList.add('stats-price-editable');row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',(item.customer||'Müşteri')+' ücretini güncelle');
    row.onclick=function(){openStatisticsAppointmentPrice(item.id)};
    row.onkeydown=function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();openStatisticsAppointmentPrice(item.id)}};
  });
  return result;
};
window.renderStatistics=renderStatistics;

/* The legacy build grew several nested full-reload wrappers. Coalesce duplicate
   refreshes and use an appointment-only refresh after appointment mutations. */
var legacyFullReload=reloadRemoteData;
var reloadPromise=null;
var preferAppointmentOnlyReload=false;

async function refreshAppointmentsOnly(){
  if(!currentUser)return;
  var response=await salonDb.from('appointments').select('id,client_id,client_name,client_phone,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,status,note,created_by,updated_by,recurrence_group_id,recurrence_interval_weeks,tariff_price_snapshot,debt_original_amount').order('scheduled_at');
  if(response.error)throw response.error;
  appts=(response.data||[]).map(function(row){var mapped=remoteAppointment(row);mapped.status=row.status;mapped.note=row.note||'';mapped.updatedBy=row.updated_by||null;mapped.debtOriginalAmount=Number(row.debt_original_amount||0);return mapped});
  renderHomeSummary();render();renderCalendar();renderStatistics();
  if(typeof syncNativeAppointmentReminders==='function')syncNativeAppointmentReminders();
}

reloadRemoteData=async function(){
  if(preferAppointmentOnlyReload)return refreshAppointmentsOnly();
  if(reloadPromise)return reloadPromise;
  reloadPromise=Promise.resolve().then(function(){return legacyFullReload.apply(this,arguments)}).finally(function(){reloadPromise=null});
  return reloadPromise;
};
window.reloadRemoteData=reloadRemoteData;

function withFastAppointmentReload(fn){
  return async function(){
    preferAppointmentOnlyReload=true;
    try{return await fn.apply(this,arguments)}finally{preferAppointmentOnlyReload=false;}
  };
}
saveAppointment=withFastAppointmentReload(saveAppointment);window.saveAppointment=saveAppointment;
deleteAppointment=withFastAppointmentReload(deleteAppointment);window.deleteAppointment=deleteAppointment;

var realtimeTimers={};
function scheduleTargeted(name,fn,delay){
  clearTimeout(realtimeTimers[name]);
  realtimeTimers[name]=setTimeout(function(){delete realtimeTimers[name];Promise.resolve(fn()).catch(function(error){console.error(name+' yenilemesi:',error)})},delay||90);
}
function applyRealtimeAppointment(payload,renderNow){
  var row=payload&&payload.new&&payload.new.id?payload.new:payload&&payload.old;
  if(!row||!row.id)return;
  var index=appts.findIndex(function(item){return String(item.id)===String(row.id)});
  if(payload.eventType==='DELETE'){if(index>=0)appts.splice(index,1);}else{
    var mapped=remoteAppointment(row);mapped.status=row.status;mapped.note=row.note||'';mapped.updatedBy=row.updated_by||null;mapped.debtOriginalAmount=Number(row.debt_original_amount||0);
    if(index>=0)appts[index]=mapped;else appts.push(mapped);
    appts.sort(function(a,b){return (appointmentDate(a)+' '+a.time).localeCompare(appointmentDate(b)+' '+b.time)});
  }
  if(renderNow!==false){
    renderCalendar();renderStatistics();renderHomeSummary();render();
    if(typeof syncNativeAppointmentReminders==='function')syncNativeAppointmentReminders();
  }
}

var pendingAppointmentPayloads=[];
function queueRealtimeAppointment(payload){
  pendingAppointmentPayloads.push(payload);
  scheduleTargeted('appointments',function(){
    var events=pendingAppointmentPayloads.splice(0);
    events.forEach(function(item){applyRealtimeAppointment(item,false)});
    renderCalendar();renderStatistics();renderHomeSummary();render();
    if(typeof syncNativeAppointmentReminders==='function')syncNativeAppointmentReminders();
  },35);
}

var subscribeBeforeTargetedRefresh=subscribeSalon;
subscribeSalon=function(){
  subscribeBeforeTargetedRefresh.apply(this,arguments);
  if(salonChannel)salonDb.removeChannel(salonChannel);
  salonChannel=salonDb.channel('salon-modern-live-v2314')
    .on('postgres_changes',{event:'*',schema:'public',table:'appointments'},queueRealtimeAppointment)
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},function(){scheduleTargeted('profiles',legacyFullReload,180)})
    .on('postgres_changes',{event:'*',schema:'public',table:'services'},function(){scheduleTargeted('services',legacyFullReload,180)})
    .on('postgres_changes',{event:'*',schema:'public',table:'clients'},function(){scheduleTargeted('clients',function(){return typeof smartLoadActiveClients==='function'?smartLoadActiveClients(true):legacyFullReload()},120)})
    .on('postgres_changes',{event:'*',schema:'public',table:'closed_time_slots'},function(){scheduleTargeted('closed',legacyFullReload,150)})
    .on('postgres_changes',{event:'*',schema:'public',table:'customer_debts'},function(){scheduleTargeted('debts',loadV151Supplement,100)})
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications'},function(payload){deliverAssignmentNotification(payload.new)})
    .subscribe();
  deliverUnreadAssignmentNotifications();
};
window.subscribeSalon=subscribeSalon;

var handleBackBeforePrice=handleAndroidBack;
handleAndroidBack=function(){if(document.getElementById('appointmentPriceModal')?.classList.contains('show')){closeStatisticsAppointmentPrice();return true}return handleBackBeforePrice.apply(this,arguments)};
window.handleAndroidBack=handleAndroidBack;

document.querySelectorAll('#appVersion,[data-app-version]').forEach(function(node){node.textContent='v2.3.14'});
})();
