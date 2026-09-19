(function(){
'use strict';

var PHASE2_VERSION='1.8.0';
var phase2Intelligence=[];
var phase2LoadedAt=0;
var phase2Unmatched=[];
var phase2SelectedUnmatchedId=null;
var phase2HistoryCache={};
var phase2PreviousShowPage=showPage;
var phase2PreviousSimplifyNavigation=simplifyNavigation;
var phase2PreviousReloadRemoteData=reloadRemoteData;
var phase2PreviousRenderCalendar=renderCalendar;
var phase2PreviousRenderCustomerDetail=renderCustomerDetail;
var phase2PreviousApplyCustomerHistory=applyCustomerHistory;

function phase2IsManager(){return currentUser&&currentUser.role==='yonetici'}
function phase2Today(){return localDate(0)}
function phase2DayDiff(later,earlier){
  if(!later||!earlier)return null;
  return Math.max(0,Math.round((Date.parse(String(later).slice(0,10)+'T12:00:00')-Date.parse(String(earlier).slice(0,10)+'T12:00:00'))/86400000));
}
function phase2DateAdd(date,days){
  if(!date||days==null)return null;
  var value=new Date(String(date).slice(0,10)+'T12:00:00');value.setDate(value.getDate()+Number(days));
  return value.getFullYear()+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0');
}
function phase2Status(row){
  if(!row||Number(row.distinct_visit_days||0)<3||!Number(row.average_visit_days))return {key:'insufficient',label:'Yeterli veri yok',rank:0};
  var elapsed=phase2DayDiff(phase2Today(),row.last_visit_date),average=Number(row.average_visit_days),ratio=elapsed/average;
  if(ratio>=1.75)return {key:'risk',label:'Kaybedilme Riski',rank:4};
  if(ratio>=1.25)return {key:'overdue',label:'Gecikti',rank:3};
  if(ratio>=1)return {key:'due',label:'Zamanı Geldi',rank:2};
  if(ratio>=0.75)return {key:'approaching',label:'Yaklaşıyor',rank:1};
  return {key:'regular',label:'Zamanı Var',rank:0};
}
function phase2Rows(){
  return phase2Intelligence.map(function(row){
    var status=phase2Status(row);return Object.assign({},row,{status:status.key,status_label:status.label,status_rank:status.rank,elapsed_days:phase2DayDiff(phase2Today(),row.last_visit_date)});
  }).filter(function(row){return Number(row.visit_count||0)>0}).sort(function(a,b){return b.status_rank-a.status_rank||(b.elapsed_days||0)-(a.elapsed_days||0)});
}
function phase2Client(id){return remoteClients.find(function(client){return String(client.id)===String(id)})}
function phase2Profile(id){return remoteProfiles.find(function(profile){return String(profile.id)===String(id)})}
function phase2Service(id){return remoteServices.find(function(service){return String(service.id)===String(id)})}
function phase2Money(value){return formatTry(Number(value||0))}
function phase2StatusBadge(row){return '<span class="phase2-status phase2-'+safe(row.status)+'">'+safe(row.status_label)+'</span>'}
function phase2CanUseNote(clientId){
  return phase2IsManager()||appts.some(function(item){return String(item.clientId)===String(clientId)&&String(item.employeeId)===String(currentUser&&currentUser.id)});
}

async function phase2LoadIntelligence(force){
  if(!currentUser||(!force&&phase2LoadedAt&&Date.now()-phase2LoadedAt<60000))return phase2Rows();
  var result=await salonDb.from('client_visit_intelligence').select('client_id,full_name,phone,note,visit_count,distinct_visit_days,last_visit_date,average_visit_days,expected_next_visit_date,preferred_employee_id,preferred_service_id,preferred_service_name,recorded_spend,spend_reliable');
  if(result.error){
    console.warn('Salon intelligence could not be loaded',result.error.message||result.error);
    phase2Intelligence=(window.SalonSmartTest&&SalonSmartTest.analyses?SalonSmartTest.analyses().map(function(item){return {client_id:item.client.id,full_name:item.client.full_name,phone:item.client.phone,note:item.client.note,visit_count:item.count,distinct_visit_days:item.count,last_visit_date:item.last,average_visit_days:item.average,expected_next_visit_date:phase2DateAdd(item.last,item.average),preferred_employee_id:item.preferredEmployeeId,preferred_service_id:null,preferred_service_name:null,recorded_spend:null,spend_reliable:false}}):[]);
  }else phase2Intelligence=result.data||[];
  phase2LoadedAt=Date.now();return phase2Rows();
}

function phase2TodayAppointments(){return appts.filter(function(item){return appointmentDate(item)===phase2Today()&&item.status!=='cancelled'})}
function phase2FreeSlots(date){return window.SalonSmartTest&&SalonSmartTest.freeSlots?SalonSmartTest.freeSlots(date):[]}
function phase2Actionable(includeApproaching){
  var allowed=includeApproaching?['approaching','due','overdue','risk']:['due','overdue','risk'];
  return phase2Rows().filter(function(row){return allowed.includes(row.status)});
}
function phase2GapSuggestions(limit){
  var candidates=phase2Actionable(true),used={},servicesById={};
  remoteServices.forEach(function(service){servicesById[String(service.id)]=service});
  return phase2FreeSlots(phase2Today()).map(function(slot){
    var capacity=Number(slot.end)-Number(slot.start);
    var matching=candidates.filter(function(row){
      var service=servicesById[String(row.preferred_service_id||'')],duration=Number(service&&service.duration_minutes||30);
      return !used[row.client_id]&&duration<=capacity&&(!row.preferred_employee_id||String(row.preferred_employee_id)===String(slot.employeeId));
    }).slice(0,5);
    matching.forEach(function(row){used[row.client_id]=true});
    var reliable=matching.filter(function(row){return servicesById[String(row.preferred_service_id||'')]});
    var revenue=reliable.length===matching.length&&matching.length?reliable.reduce(function(sum,row){return sum+Number(servicesById[String(row.preferred_service_id)].price||0)},0):null;
    return {slot:slot,candidates:matching,revenue:revenue};
  }).filter(function(group){return group.candidates.length}).slice(0,limit||6);
}

function phase2SummaryMetrics(){
  var today=phase2TodayAppointments(),gaps=phase2FreeSlots(phase2Today()),rows=phase2Rows(),suggestions=phase2GapSuggestions(8);
  return {
    appointments:today.length,
    gaps:gaps,
    approaching:rows.filter(function(row){return row.status==='approaching'}).length,
    due:rows.filter(function(row){return row.status==='due'}).length,
    overdue:rows.filter(function(row){return row.status==='overdue'}).length,
    risk:rows.filter(function(row){return row.status==='risk'}).length,
    candidates:suggestions.reduce(function(sum,group){return sum+group.candidates.length},0),
    suggestions:suggestions
  };
}
function phase2OccupancyCards(){
  var appointments=phase2TodayAppointments();
  return remoteProfiles.filter(function(profile){return profile.active&&(phase2IsManager()||String(profile.id)===String(currentUser.id))}).map(function(profile){
    var count=appointments.filter(function(item){return String(item.employeeId)===String(profile.id)}).length;
    return '<div class="phase2-occupancy"><strong>'+safe(profile.full_name.split(' ')[0])+'</strong><span>'+count+' randevu</span></div>';
  }).join('');
}
function phase2SummaryHtml(){
  var m=phase2SummaryMetrics(),firstGap=m.gaps[0],name=currentUser&&currentUser.name?currentUser.name.split(' ')[0]:'';
  var title=(new Date().getHours()<12?'Günaydın':'İyi günler')+(phase2IsManager()?'':' '+name);
  var gapText=firstGap?safe(firstGap.employeeName)+' · '+safe(String(Math.floor(firstGap.start/60)).padStart(2,'0')+':'+String(firstGap.start%60).padStart(2,'0'))+'–'+safe(String(Math.floor(firstGap.end/60)).padStart(2,'0')+':'+String(firstGap.end%60).padStart(2,'0')):'Uygun boşluk yok';
  return '<section class="phase2-card phase2-summary"><small>GÜNLÜK SALON ÖZETİ</small><h2>'+safe(title)+'</h2><div class="phase2-metrics"><div><strong>'+m.appointments+'</strong><span>Randevu</span></div><div><strong>'+m.due+'</strong><span>Zamanı gelen</span></div><div><strong>'+m.overdue+'</strong><span>Geciken</span></div><div><strong>'+m.risk+'</strong><span>Riskli</span></div></div><div class="phase2-gapline"><b>İlk boşluk</b><span>'+gapText+'</span></div><div class="phase2-occupancies">'+phase2OccupancyCards()+'</div></section>';
}
function phase2AssistantHtml(){
  return '<section class="phase2-card phase2-assistant"><small>SALON ASİSTANI</small><h2>İstediğiniz soruyu yazın veya söyleyin</h2><p class="phase2-assistant-hint">Aşağıdaki örneklerle sınırlı değildir; müşteri, randevu, takvim ve analiz hakkında kendi cümlenizi kullanabilirsiniz.</p><form onsubmit="runPhase2HomeAssistant(event)"><div class="phase2-query"><input id="phase2AssistantInput" autocomplete="off" enterkeyhint="send" placeholder="Örn. Ahmet en son ne zaman geldi?"><button type="submit">Çalıştır</button></div></form><div class="phase2-chips"><button onclick="phase2QuickCommand(\'Yarın boş saatler ne?\')">Boş Saatler</button><button onclick="phase2QuickCommand(\'Geciken müşterileri göster\')">Geciken Müşteriler</button><button onclick="phase2QuickCommand(\'Kaybedilme riski olan müşterileri göster.\')">Riskli Müşteriler</button><button onclick="phase2QuickCommand(\'Bugünkü randevuları göster.\')">Bugünkü Randevular</button><button onclick="phase2QuickCommand(\'Ne sorabilirim?\')">Yardım</button></div><div id="phase2AssistantResult" class="assistant-result"></div></section>';
}
function phase2AttentionCards(rows,limit,withWhatsapp){
  return rows.slice(0,limit||20).map(function(row){
    var client=phase2Client(row.client_id)||row;
    return '<div class="phase2-customer" onclick="openCustomerDetail('+jsAttr(row.client_id)+')"><div class="item-main"><strong>'+safe(row.full_name||client.full_name)+'</strong><small>Son geliş: '+safe(row.last_visit_date?friendlyDate(row.last_visit_date):'Yeterli veri yok')+(row.average_visit_days?' · Ortalama '+Number(row.average_visit_days)+' gün':'')+(row.elapsed_days!=null?' · '+row.elapsed_days+' gündür gelmedi':'')+'</small></div>'+phase2StatusBadge(row)+(withWhatsapp?'<button type="button" class="phase2-wa" onclick="event.stopPropagation();openSmartCustomerWhatsApp('+jsAttr(row.client_id)+')">WhatsApp</button>':'')+'</div>';
  }).join('')||'<div class="empty">Bu grupta müşteri yok.</div>';
}
function phase2MoneyCard(){
  if(!phase2IsManager())return '';
  var groups=phase2GapSuggestions(1),group=groups[0],count=groups.reduce(function(sum,item){return sum+item.candidates.length},0);
  return '<section class="phase2-card phase2-money"><small>AKILLI BOŞLUK ÖNERİSİ</small><h2>Bugün Sana Para Kazandırabilecek Müşteriler</h2><p>'+(group?'Bugün '+safe(group.slot.employeeName)+' için '+safe(String(Math.floor(group.slot.start/60)).padStart(2,'0')+':'+String(group.slot.start%60).padStart(2,'0'))+'–'+safe(String(Math.floor(group.slot.end/60)).padStart(2,'0')+':'+String(group.slot.end%60).padStart(2,'0'))+' arasında boşluk var. ':'Bugün uygun boşluk görünmüyor. ')+count+' uygun müşteri bulundu.'+(group&&group.revenue!=null?' Güvenilir tarife karşılığı: '+phase2Money(group.revenue)+'.':'')+'</p><button onclick="showPage(\'recoveryCenter\')">Müşterileri Göster</button></section>';
}

function phase2RenderHome(){
  var home=document.getElementById('home');if(!home||!currentUser)return;
  var metrics=phase2SummaryMetrics(),attention=phase2Actionable(false);
  var roleShortcut=phase2IsManager()?'<button onclick="showPage(\'customers\')"><b>♙</b>Müşteriler</button>':'<button onclick="showPage(\'salonAssistant\')"><b>✦</b>Asistan</button>';
  home.innerHTML='<div class="phase2-home"><div class="phase2-home-top"><button class="menu-button" onclick="toggleDrawer()" aria-label="Menüyü aç">☰</button><div><small>SALON MODERN</small><h1>Ana Sayfa</h1></div></div>'+phase2SummaryHtml()+phase2AssistantHtml()+'<section class="phase2-card"><div class="phase2-section-title"><div><small>HIZLI İŞLEMLER</small><h2>Tek dokunuşla erişim</h2></div></div><div class="phase2-actions"><button onclick="openAppointmentModal(\'\',null,\'\')"><b>＋</b>Yeni Randevu</button><button class="phase2-calendar-shortcut" onclick="showPage(\'calendar\')"><b>📅</b>Takvim</button>'+roleShortcut+'<button onclick="showPage(\'statistics\')"><b>▥</b>İstatistikler</button></div></section>'+phase2MoneyCard()+'<section class="phase2-card"><div class="phase2-section-title"><div><small>AKILLI MÜŞTERİ UYARILARI</small><h2>Bugün ilgilenilecek müşteriler</h2></div>'+(phase2IsManager()?'<button onclick="showPage(\'recoveryCenter\')">Tümü ›</button>':'')+'</div><div class="phase2-countline">'+metrics.due+' zamanı gelen · '+metrics.overdue+' geciken · '+metrics.risk+' riskli</div>'+phase2AttentionCards(attention,6,false)+'</section></div>';
}
window.phase2QuickCommand=function(command){var input=document.getElementById('phase2AssistantInput');if(input)input.value=command;runPhase2HomeAssistant({preventDefault:function(){}})};
window.runPhase2HomeAssistant=function(event){
  event.preventDefault();var homeInput=document.getElementById('phase2AssistantInput'),fullInput=document.getElementById('salonAssistantInput'),fullResult=document.getElementById('salonAssistantResult'),homeResult=document.getElementById('phase2AssistantResult');
  if(!homeInput||!fullInput||!fullResult||!homeResult||!homeInput.value.trim())return;
  fullInput.value=homeInput.value.trim();runSalonAssistant({preventDefault:function(){}});homeResult.innerHTML=fullResult.innerHTML;
  if(homeResult.querySelector('.assistant-confirm'))homeResult.insertAdjacentHTML('beforeend','<button class="save" onclick="showPage(\'salonAssistant\')">Onay ekranını aç</button>');
};

function phase2InstallPage(id,title,managerOnly){
  var page=document.getElementById(id);if(page)return page;
  page=document.createElement('section');page.id=id;page.className='page';page.dataset.managerOnly=managerOnly?'1':'0';page.innerHTML='<div class="content"><button class="back" onclick="showPage(\'home\')">‹ Ana Sayfa</button><h1 class="page-title">'+safe(title)+'</h1><div id="'+id+'Content"></div></div>';
  document.querySelector('main').appendChild(page);return page;
}
function phase2AddDrawerButton(id,label,target,afterId,managerOnly){
  if(document.getElementById(id))return;
  var drawer=document.querySelector('#drawerLayer .drawer'),after=document.getElementById(afterId)||document.getElementById('drawerSmartAnalysis');if(!drawer)return;
  var button=document.createElement('button');button.id=id;button.type='button';button.className='menu-item'+(managerOnly?' manager-menu':'');button.textContent=label;button.onclick=function(){drawerPage(target)};
  if(after)after.insertAdjacentElement('afterend',button);else drawer.appendChild(button);
}
function phase2InstallShell(){
  phase2InstallPage('recoveryCenter','Kayıp / Geciken Müşteri Merkezi',true);
  phase2InstallPage('employeePerformance','Çalışan Performansı',true);
  phase2AddDrawerButton('drawerRecoveryCenter','↻   Müşteri Geri Kazanım','recoveryCenter','drawerSmartAnalysis',true);
  phase2AddDrawerButton('drawerEmployeePerformance','▥   Çalışan Performansı','employeePerformance','drawerRecoveryCenter',true);
  document.getElementById('drawerAuditHistory')?.remove();
}

function phase2RenderRecovery(){
  var holder=document.getElementById('recoveryCenterContent');if(!holder)return;if(!phase2IsManager()){holder.innerHTML='<div class="empty">Bu bölüm yalnızca yöneticilere açıktır.</div>';return}
  var rows=phase2Rows(),groups=[
    {title:'Zamanı Gelenler',items:rows.filter(function(r){return r.status==='due'})},
    {title:'Gecikenler',items:rows.filter(function(r){return r.status==='overdue'})},
    {title:'20+ gündür gelmeyenler',items:rows.filter(function(r){return r.elapsed_days>=20})},
    {title:'30+ gündür gelmeyenler',items:rows.filter(function(r){return r.elapsed_days>=30})},
    {title:'45+ gündür gelmeyenler',items:rows.filter(function(r){return r.elapsed_days>=45})},
    {title:'Kaybedilme Riski',items:rows.filter(function(r){return r.status==='risk'})}
  ];
  holder.innerHTML='<div class="notice">20/30/45 gün grupları yalnızca ek görünüm sağlar. Asıl risk durumu her müşterinin kendi ortalama geliş aralığına göre hesaplanır. WhatsApp yalnızca düğmeye dokunduğunuzda açılır.</div>'+groups.map(function(group){return '<section class="phase2-recovery-group"><div class="phase2-section-title"><h2>'+safe(group.title)+'</h2><span class="role">'+group.items.length+'</span></div>'+phase2AttentionCards(group.items,100,true)+'</section>'}).join('');
}

function phase2Periods(){
  var today=new Date(phase2Today()+'T12:00:00'),weekStart=new Date(today);weekStart.setDate(today.getDate()-((today.getDay()+6)%7));
  return {today:phase2Today(),week:weekStart.getFullYear()+'-'+String(weekStart.getMonth()+1).padStart(2,'0')+'-'+String(weekStart.getDate()).padStart(2,'0'),month:phase2Today().slice(0,7)};
}
function phase2RenderEmployeePerformance(){
  var holder=document.getElementById('employeePerformanceContent');if(!holder)return;if(!phase2IsManager()){holder.innerHTML='<div class="empty">Bu bölüm yalnızca yöneticilere açıktır.</div>';return}
  var p=phase2Periods(),now=Date.now();
  holder.innerHTML=remoteProfiles.filter(function(profile){return profile.active}).map(function(profile){
    var own=appts.filter(function(item){return String(item.employeeId)===String(profile.id)&&item.status!=='cancelled'}),past=own.filter(function(item){return Date.parse(remoteSchedule(appointmentDate(item),item.time))<=now&&item.status!=='no_show'}),customerCounts={};past.forEach(function(item){if(item.clientId)customerCounts[item.clientId]=(customerCounts[item.clientId]||0)+1});
    var unique=Object.keys(customerCounts),repeat=unique.filter(function(id){return customerCounts[id]>1}).length,monthItems=own.filter(function(item){return appointmentDate(item).startsWith(p.month)}),bookedMinutes=monthItems.reduce(function(sum,item){return sum+Number(item.duration||30)},0),elapsedDays=Math.max(1,new Date().getDate()),occupancy=Math.min(100,Math.round(bookedMinutes/(elapsedDays*16*60)*100));
    var busy={};own.forEach(function(item){var key=appointmentDate(item)+' '+item.time.slice(0,2)+':00';busy[key]=(busy[key]||0)+1});var busiest=Object.keys(busy).sort(function(a,b){return busy[b]-busy[a]})[0]||'Yeterli veri yok';
    var reliable=monthItems.every(function(item){return Number.isFinite(Number(item.amount))}),revenue=reliable?monthItems.reduce(function(sum,item){return sum+Number(item.amount||0)},0):null;
    return '<section class="phase2-card"><div class="phase2-section-title"><h2>'+safe(profile.full_name)+'</h2><span class="role">'+(profile.role==='manager'?'Yönetici':'Çalışan')+'</span></div><div class="phase2-metrics phase2-performance"><div><strong>'+own.filter(function(i){return appointmentDate(i)===p.today}).length+'</strong><span>Bugün</span></div><div><strong>'+own.filter(function(i){return appointmentDate(i)>=p.week}).length+'</strong><span>Bu hafta</span></div><div><strong>'+monthItems.length+'</strong><span>Bu ay</span></div><div><strong>'+past.length+'</strong><span>Tamamlanan</span></div><div><strong>'+unique.length+'</strong><span>Müşteri</span></div><div><strong>'+(unique.length?Math.round(repeat/unique.length*100):0)+'%</strong><span>Tekrar oranı</span></div><div><strong>'+occupancy+'%</strong><span>Doluluk</span></div><div><strong>'+(revenue==null?'Yeterli veri yok':phase2Money(revenue))+'</strong><span>Kayıtlı ciro</span></div></div><div class="notice">En yoğun zaman: '+safe(busiest)+'</div></section>';
  }).join('')||'<div class="empty">Aktif çalışan yok.</div>';
}

function phase2AuditText(row){
  var before=row.before_data||{},after=row.after_data||{},actor=phase2Profile(row.actor_id),who=actor?actor.full_name:'Sistem';
  if(row.entity_type==='appointment'&&row.action==='update'&&before.scheduled_at!==after.scheduled_at)return who+' → '+safe(after.client_name||before.client_name||'Müşteri')+' randevusunu '+safe(toIstanbul(before.scheduled_at).time)+' saatinden '+safe(toIstanbul(after.scheduled_at).time)+' saatine değiştirdi.';
  if(row.entity_type==='client'&&row.action==='update'&&before.note!==after.note)return who+' → '+safe(after.full_name||before.full_name||'Müşteri')+' müşteri notunu güncelledi.';
  var actions={insert:'oluşturdu',update:'güncelledi',delete:'sildi'};return who+' → '+(row.entity_type==='appointment'?'randevu':'müşteri')+' kaydını '+(actions[row.action]||row.action)+'.';
}
async function phase2RenderAudit(){
  var holder=document.getElementById('auditHistoryContent');if(!holder)return;if(!phase2IsManager()){holder.innerHTML='<div class="empty">Bu bölüm yalnızca yöneticilere açıktır.</div>';return}
  holder.innerHTML='<div class="empty">Yükleniyor…</div>';var result=await salonDb.from('salon_audit_log').select('id,actor_id,action,entity_type,entity_id,before_data,after_data,created_at').order('created_at',{ascending:false}).limit(150);
  if(result.error){holder.innerHTML='<div class="notice">'+safe(result.error.message||'İşlem geçmişi yüklenemedi.')+'</div>';return}
  holder.innerHTML=(result.data||[]).map(function(row){return '<div class="history-row"><strong>'+safe(phase2AuditText(row))+'</strong><small style="display:block;color:var(--muted)">'+safe(new Date(row.created_at).toLocaleString('tr-TR'))+' · '+safe(row.action)+'</small></div>'}).join('')||'<div class="empty">Henüz işlem kaydı yok.</div>';
}

function phase2EnsureUnmatchedModal(){
  if(document.getElementById('phase2UnmatchedModal'))return;var modal=document.createElement('div');modal.id='phase2UnmatchedModal';modal.className='modal';modal.innerHTML='<div class="sheet"><h2>Eski kaydı müşteriye bağla</h2><div id="phase2UnmatchedSummary" class="notice"></div><label class="field">Doğru müşteri<select id="phase2UnmatchedClient"></select></label><button class="save" onclick="phase2ConfirmUnmatchedLink()">Kontrol et ve bağla</button><button class="back" style="display:block;margin:14px auto 0" onclick="phase2CloseUnmatchedModal()">Vazgeç</button></div>';document.body.appendChild(modal);
}
async function phase2RenderUnmatched(){
  var holder=document.getElementById('unmatchedHistoryContent');if(!holder)return;if(!phase2IsManager()){holder.innerHTML='<div class="empty">Bu bölüm yalnızca yöneticilere açıktır.</div>';return}
  holder.innerHTML='<div class="empty">Yükleniyor…</div>';var result=await salonDb.from('appointments').select('id,client_name,client_phone,service_name,employee_id,scheduled_at,amount').is('client_id',null).order('scheduled_at',{ascending:false}).limit(200);
  if(result.error){holder.innerHTML='<div class="notice">'+safe(result.error.message||'Kayıtlar yüklenemedi.')+'</div>';return}phase2Unmatched=result.data||[];
  holder.innerHTML='<div class="notice">Bu '+phase2Unmatched.length+' kayıt otomatik eşleştirilmez. Doğru müşteriyi siz seçip onaylamadan hiçbir değişiklik yapılmaz.</div>'+phase2Unmatched.map(function(item){var slot=toIstanbul(item.scheduled_at);return '<div class="staff"><div class="item-main"><strong>'+safe(item.client_name)+'</strong><small>'+safe(friendlyDate(slot.date))+' · '+safe(slot.time)+' · '+safe(item.service_name)+'</small></div><button class="link" onclick="phase2OpenUnmatchedModal('+jsAttr(item.id)+')">Eşleştir</button></div>'}).join('');
}
window.phase2OpenUnmatchedModal=function(id){
  if(!phase2IsManager())return;var item=phase2Unmatched.find(function(row){return String(row.id)===String(id)});if(!item)return;phase2SelectedUnmatchedId=item.id;
  var slot=toIstanbul(item.scheduled_at);document.getElementById('phase2UnmatchedSummary').textContent=item.client_name+' · '+friendlyDate(slot.date)+' · '+slot.time+' · '+item.service_name;
  document.getElementById('phase2UnmatchedClient').innerHTML=remoteClients.filter(function(c){return c.active!==false}).map(function(c){return '<option value="'+safe(c.id)+'">'+safe(c.full_name)+' · '+safe(c.phone||'Telefon yok')+'</option>'}).join('');document.getElementById('phase2UnmatchedModal').classList.add('show');
};
window.phase2CloseUnmatchedModal=function(){phase2SelectedUnmatchedId=null;document.getElementById('phase2UnmatchedModal')?.classList.remove('show')};
window.phase2ConfirmUnmatchedLink=async function(){
  if(!phase2IsManager()||!phase2SelectedUnmatchedId)return;var item=phase2Unmatched.find(function(row){return String(row.id)===String(phase2SelectedUnmatchedId)}),client=phase2Client(document.getElementById('phase2UnmatchedClient').value);if(!item||!client)return;
  if(!confirm(item.client_name+' eski kaydı '+client.full_name+' müşterisine bağlansın mı?\n\nBu işlem ziyaret, analiz ve harcama geçmişini etkiler ve işlem geçmişine kaydedilir.'))return;
  var result=await salonDb.from('appointments').update({client_id:client.id,client_name:client.full_name,client_phone:client.phone||null,updated_by:currentUser.id}).eq('id',item.id).is('client_id',null).select('id,client_id');
  if(result.error||!result.data?.length){showAppToast('Eşleştirme yapılamadı',result.error?.message||'Kayıt daha önce eşleştirilmiş olabilir.');return}
  phase2CloseUnmatchedModal();phase2LoadedAt=0;await reloadRemoteData();await phase2LoadIntelligence(true);await phase2RenderUnmatched();showAppToast('Eski kayıt eşleştirildi',client.full_name);
};

async function phase2LoadClientHistory(clientId){
  var key=String(clientId);if(phase2HistoryCache[key])return phase2HistoryCache[key];
  phase2HistoryCache[key]=(async function(){var result=await salonDb.from('appointments').select('id,client_id,client_name,service_id,service_name,amount,employee_id,scheduled_at,duration_minutes,status').eq('client_id',clientId).order('scheduled_at',{ascending:false}).limit(5);return result.error?[]:(result.data||[])})();
  return phase2HistoryCache[key];
}
async function phase2LoadClientProducts(clientId){
  if(!phase2IsManager())return[];var key='products:'+String(clientId);if(phase2HistoryCache[key])return phase2HistoryCache[key];
  phase2HistoryCache[key]=(async function(){var result=await salonDb.from('product_sales').select('id,client_id,sold_at,total_amount,status,payment_status,product_sale_items(product_name,quantity,unit_price)').eq('client_id',clientId).eq('status','completed').order('sold_at',{ascending:false}).limit(20);return result.error?[]:(result.data||[])})();
  return phase2HistoryCache[key];
}
function phase2ProductHistoryHtml(sales){if(!phase2IsManager())return'';var rows=(sales||[]).map(function(sale){var slot=toIstanbul(sale.sold_at),items=(sale.product_sale_items||[]).map(function(item){return Number(item.quantity||1)+'× '+safe(item.product_name||'Ürün')+' · '+phase2Money(item.unit_price)}).join(', ');return '<div class="history-row"><strong>'+safe(items||'Ürün satışı')+'</strong><small style="display:block;color:var(--muted)">'+safe(friendlyDate(slot.date))+' · '+phase2Money(sale.total_amount)+(sale.payment_status==='debt'?' · Borca yazıldı':' · Ödendi')+'</small></div>'}).join('');return '<div class="section"><h2>Aldığı ürünler</h2><span class="role">'+Number((sales||[]).length)+' satış</span></div>'+(rows||'<div class="empty">Henüz ürün satın alımı yok.</div>')}
async function phase2RenderCustomerDetail(){
  var holder=document.getElementById('customerDetailContent'),client=phase2Client(selectedCustomerId);if(!holder||!client)return;
  holder.innerHTML='<div class="empty">Müşteri bilgileri yükleniyor…</div>';var row=phase2Rows().find(function(item){return String(item.client_id)===String(client.id)}),history=await phase2LoadClientHistory(client.id),productHistory=await phase2LoadClientProducts(client.id),openDebt=phase2IsManager()?remoteDebts.filter(function(debt){return String(debt.client_id)===String(client.id)&&debt.status==='open'}).reduce(function(sum,debt){return sum+Number(debt.amount||0)},0):null;
  row=row||{client_id:client.id,full_name:client.full_name,phone:client.phone,note:client.note,visit_count:0,status:'insufficient',status_label:'Yeterli veri yok'};
  var employee=phase2Profile(row.preferred_employee_id),canNote=phase2CanUseNote(client.id);
  holder.innerHTML='<div class="phase2-section-title"><div><small>MÜŞTERİ KARTI</small><h1 class="page-title">'+safe(client.full_name)+'</h1></div>'+phase2StatusBadge(row)+'</div><button class="fab" onclick="newAppointmentForCustomer('+jsAttr(client.id)+')">＋ Yeni Randevu</button><div class="customer-metrics phase2-detail-grid"><div class="stat-box"><small>Telefon</small><strong>'+safe(client.phone||'—')+'</strong></div><div class="stat-box"><small>Toplam ziyaret</small><strong>'+Number(row.visit_count||0)+'</strong></div><div class="stat-box"><small>Son geliş</small><strong>'+safe(row.last_visit_date?friendlyDate(row.last_visit_date):'Yeterli veri yok')+'</strong></div><div class="stat-box"><small>Geçen gün</small><strong>'+(row.elapsed_days==null?'Yeterli veri yok':row.elapsed_days+' gün')+'</strong></div><div class="stat-box"><small>Ortalama periyot</small><strong>'+(row.average_visit_days?row.average_visit_days+' gün':'Yeterli veri yok')+'</strong></div><div class="stat-box"><small>Tahmini sonraki geliş</small><strong>'+safe(row.expected_next_visit_date?friendlyDate(row.expected_next_visit_date):'Yeterli veri yok')+'</strong></div><div class="stat-box"><small>Tercih ettiği çalışan</small><strong>'+safe(employee?employee.full_name:'Yeterli veri yok')+'</strong></div><div class="stat-box"><small>En sık hizmet</small><strong>'+safe(row.preferred_service_name||'Yeterli veri yok')+'</strong></div><div class="stat-box"><small>Toplam harcama</small><strong>'+(row.spend_reliable?phase2Money(row.recorded_spend):'Yeterli veri yok')+'</strong></div>'+(phase2IsManager()?'<div class="stat-box"><small>Açık borç</small><strong>'+phase2Money(openDebt)+'</strong></div><div class="stat-box"><small>Ürün alışverişi</small><strong>'+Number(productHistory.length)+' satış</strong></div>':'')+'</div>'+(canNote?'<section class="phase2-card"><div class="phase2-section-title"><h2>Müşteri Notları</h2><small>customer_id ile saklanır</small></div><textarea id="phase2CustomerNote" maxlength="1000" placeholder="Örn. Sakalı kısa seviyor.">'+safe(client.note||row.note||'')+'</textarea><button class="save" onclick="phase2SaveCustomerNote('+jsAttr(client.id)+')">Notu Kaydet</button></section>':'')+'<div class="section"><h2>Son 5 ziyaret</h2></div>'+(history.map(function(item){var slot=toIstanbul(item.scheduled_at),profile=phase2Profile(item.employee_id);return '<div class="history-row"><strong>'+safe(item.service_name)+'</strong><small style="display:block;color:var(--muted)">'+safe(friendlyDate(slot.date))+' · '+safe(slot.time)+' · '+safe(profile?profile.full_name:'Çalışan')+' · '+phase2Money(item.amount)+'</small></div>'}).join('')||'<div class="empty">Henüz ziyaret kaydı yok.</div>')+phase2ProductHistoryHtml(productHistory)+(phase2IsManager()?'<section class="phase2-card"><h2>Bilgileri düzenle</h2><label class="field">Müşteri adı<input id="customerNameEdit" value="'+safe(client.full_name)+'"></label><label class="field">Telefon<input id="customerPhoneEdit" value="'+safe(client.phone||'')+'"></label><div class="customer-phone-actions"><button class="back" onclick="pickCustomerContact()">Rehberden seç</button><button class="save" onclick="saveCustomerPhone()">Bilgileri kaydet</button><button class="back" style="color:#a9514d" onclick="openDeleteCustomerModal('+jsAttr(client.id)+')">Müşteriyi pasifleştir</button></div></section>':'');
}
window.phase2SaveCustomerNote=async function(clientId){
  var input=document.getElementById('phase2CustomerNote');if(!input)return;var button=input.parentElement.querySelector('.save');button.disabled=true;button.textContent='Kaydediliyor…';
  var result=await salonDb.rpc('save_client_note',{p_client_id:clientId,p_note:input.value});button.disabled=false;button.textContent='Notu Kaydet';
  if(result.error||!result.data?.length){showAppToast('Not kaydedilemedi',result.error?.message||'Yetkiniz olmayabilir.');return}
  var client=phase2Client(clientId);if(client)client.note=result.data[0].note;var intel=phase2Intelligence.find(function(row){return String(row.client_id)===String(clientId)});if(intel)intel.note=result.data[0].note;showAppToast('Müşteri notu kaydedildi',client?client.full_name:'Müşteri');
};

function phase2ShowAppointmentNote(){
  var modal=document.querySelector('#appointmentModal .sheet');if(!modal)return;var panel=document.getElementById('phase2AppointmentNote'),selected=window.SalonSmartTest&&SalonSmartTest.selectedClient?SalonSmartTest.selectedClient():null,client=selected?phase2Client(selected):null;
  if(!panel){panel=document.createElement('div');panel.id='phase2AppointmentNote';panel.className='phase2-appointment-note';var customerField=document.getElementById('appointmentCustomer')?.closest('.field');if(customerField)customerField.insertAdjacentElement('afterend',panel)}
  panel.innerHTML=client&&client.note?'<strong>📝 Müşteri notu</strong><span>'+safe(client.note)+'</span>':'';panel.classList.toggle('hidden',!(client&&client.note));
}
applyCustomerHistory=function(client){var result=phase2PreviousApplyCustomerHistory(client);setTimeout(phase2ShowAppointmentNote,0);return result};

function phase2ActivateHome(){
  document.querySelectorAll('.page').forEach(function(page){page.classList.remove('active')});document.getElementById('home').classList.add('active');phase2RenderHome();window.scrollTo(0,0);
}
showPage=function(id){
  phase2InstallShell();
  if(id==='home'){phase2ActivateHome();return}
  if(currentUser&&!phase2IsManager()&&['recoveryCenter','employeePerformance','auditHistory'].includes(id)){phase2ActivateHome();return}
  phase2PreviousShowPage(id);
  if(id==='calendar')document.querySelectorAll('#calendarContent .smart-daily-block').forEach(function(node){node.remove()});
  if(id==='recoveryCenter')phase2RenderRecovery();
  if(id==='employeePerformance')phase2RenderEmployeePerformance();
  if(id==='auditHistory')phase2RenderAudit();
};
renderCalendar=function(){phase2PreviousRenderCalendar();document.querySelectorAll('#calendarContent .smart-daily-block').forEach(function(node){node.remove()})};
renderCustomerDetail=function(){phase2RenderCustomerDetail()};
simplifyNavigation=function(){
  phase2PreviousSimplifyNavigation();phase2InstallShell();
  document.querySelector("[onclick=\"drawerPage('home')\"]")?.classList.remove('hidden');
  document.querySelector("[onclick=\"drawerPage('calendar')\"]")?.classList.remove('hidden');
  ['drawerRecoveryCenter','drawerEmployeePerformance'].forEach(function(id){document.getElementById(id)?.classList.toggle('hidden',!phase2IsManager())});
};
reloadRemoteData=async function(){
  phase2HistoryCache={};var result=await phase2PreviousReloadRemoteData();phase2LoadedAt=0;await phase2LoadIntelligence(true);
  if(document.getElementById('home')?.classList.contains('active'))phase2RenderHome();
  if(document.getElementById('customerDetail')?.classList.contains('active'))phase2RenderCustomerDetail();return result;
};

var phase2Style=document.createElement('style');phase2Style.textContent='\
.phase2-home{padding:16px 14px 92px;max-width:760px;margin:0 auto}.phase2-home-top{display:flex;align-items:center;gap:12px;margin-bottom:14px}.phase2-home-top small,.phase2-card>small,.phase2-section-title small{font-size:10px;font-weight:850;letter-spacing:.09em;color:var(--gold)}.phase2-home-top h1{font-size:24px;margin:2px 0 0}.phase2-card{margin:0 0 12px;padding:14px;border:1px solid var(--line);border-radius:17px;background:#fff}.phase2-card h2{font-size:17px;margin:4px 0 10px}.phase2-summary{color:#fff;border:0;background:linear-gradient(135deg,#123b34,#082a26)}.phase2-summary>small,.phase2-money>small{color:#e8bd76}.phase2-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.phase2-metrics>div{padding:9px 6px;border-radius:12px;background:rgba(255,255,255,.1);text-align:center}.phase2-metrics strong,.phase2-metrics span{display:block}.phase2-metrics strong{font-size:18px}.phase2-metrics span{font-size:10px;margin-top:3px;opacity:.85}.phase2-gapline{display:flex;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.16);font-size:12px}.phase2-occupancies{display:flex;gap:6px;overflow:auto;margin-top:9px}.phase2-occupancy{min-width:84px;border-radius:9px;background:rgba(255,255,255,.1);padding:7px}.phase2-occupancy strong,.phase2-occupancy span{display:block;font-size:10px}.phase2-query{display:flex;gap:7px}.phase2-query input{width:100%;min-width:0;border:1px solid var(--line);border-radius:12px;padding:12px}.phase2-query button,.phase2-money button{border:0;border-radius:12px;background:var(--dark);color:#fff;padding:0 16px;font-weight:800}.phase2-chips{display:flex;gap:7px;overflow:auto;padding-top:9px}.phase2-chips button{white-space:nowrap;border:1px solid var(--line);border-radius:999px;background:#f8f5ef;padding:8px 10px}.phase2-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.phase2-actions button{border:1px solid var(--line);border-radius:13px;background:#faf8f3;padding:10px 4px;font-size:11px;font-weight:750}.phase2-actions b{display:block;font-size:19px;margin-bottom:4px}.phase2-calendar-shortcut{background:#183c35!important;color:#fff}.phase2-money{background:#fff7e7;border-color:#e8c98e}.phase2-money p{font-size:13px;line-height:1.5}.phase2-money button{min-height:42px}.phase2-section-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.phase2-section-title h1,.phase2-section-title h2{margin:2px 0 8px}.phase2-section-title>button{border:0;background:transparent;color:var(--gold);font-weight:800}.phase2-countline{font-size:12px;color:var(--muted);margin-bottom:5px}.phase2-customer{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}.phase2-customer:last-child{border-bottom:0}.phase2-customer .item-main{min-width:0}.phase2-customer small{display:block;color:var(--muted);margin-top:3px;line-height:1.35}.phase2-status{font-size:9px;font-weight:850;padding:5px 7px;border-radius:999px;white-space:nowrap}.phase2-approaching{background:#e6f1ed;color:#286b58}.phase2-due{background:#fff0c7;color:#896000}.phase2-overdue{background:#fde0c8;color:#9f4d20}.phase2-risk{background:#f5d3d1;color:#963630}.phase2-insufficient,.phase2-regular{background:#eee;color:#666}.phase2-wa{border:0;border-radius:9px;background:#1d7b58;color:#fff;padding:7px;font-weight:750}.phase2-recovery-group{margin:18px 0}.phase2-performance{grid-template-columns:repeat(4,1fr)}.phase2-performance>div{background:#f5f2eb;color:var(--ink)}.phase2-detail-grid{grid-template-columns:1fr 1fr}.phase2-card textarea{display:block;width:100%;min-height:88px;resize:vertical;border:1px solid var(--line);border-radius:12px;padding:11px;margin:10px 0}.phase2-appointment-note{margin:0 0 12px;padding:10px;border-radius:12px;background:#fff3c9;color:#6f5316}.phase2-appointment-note strong,.phase2-appointment-note span{display:block}.phase2-appointment-note span{margin-top:4px;font-size:13px}.phase2-appointment-note.hidden{display:none}.smart-daily-block{display:none!important}@media(max-width:520px){.phase2-home{padding:12px 10px 84px}.phase2-metrics{grid-template-columns:repeat(2,1fr)}.phase2-actions{grid-template-columns:repeat(2,1fr)}.phase2-performance{grid-template-columns:repeat(2,1fr)}.phase2-customer{align-items:flex-start;flex-wrap:wrap}.phase2-customer .item-main{flex:1 1 58%}.phase2-wa{margin-left:auto}}';document.head.appendChild(phase2Style);

phase2InstallShell();
document.querySelectorAll('#appVersion').forEach(function(node){node.textContent='v'+PHASE2_VERSION});
document.querySelectorAll('.auth small').forEach(function(node){if(/^v1\./.test(node.textContent))node.textContent='v'+PHASE2_VERSION});
setTimeout(async function(){if(currentUser){await phase2LoadIntelligence(true);simplifyNavigation();phase2ActivateHome()}},0);

window.SalonPhase2Test={status:phase2Status,rows:phase2Rows,gapSuggestions:phase2GapSuggestions,summaryMetrics:phase2SummaryMetrics};
})();
