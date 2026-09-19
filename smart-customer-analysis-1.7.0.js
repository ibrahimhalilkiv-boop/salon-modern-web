(function(){
'use strict';

var smartSelectedClientId=null;
var smartPendingAction=null;
var SMART_STATUS={
  approaching:{label:'Yaklaşıyor',rank:1,className:'smart-approaching'},
  due:{label:'Zamanı Geldi',rank:2,className:'smart-due'},
  overdue:{label:'Gecikti',rank:3,className:'smart-overdue'},
  risk:{label:'Kaybedilme Riski',rank:4,className:'smart-risk'},
  insufficient:{label:'Henüz yeterli veri yok',rank:0,className:'smart-insufficient'},
  regular:{label:'Zamanı var',rank:0,className:'smart-regular'}
};

function smartClientById(id){
  return remoteClients.find(function(client){return String(client.id)===String(id)&&client.active!==false});
}
function smartClientAppointments(clientId){
  return appts.filter(function(item){return item.clientId&&String(item.clientId)===String(clientId)}).sort(function(a,b){return (appointmentDate(b)+'T'+b.time).localeCompare(appointmentDate(a)+'T'+a.time)});
}
function smartDateDiff(later,earlier){
  var one=Date.parse(String(later).slice(0,10)+'T12:00:00'),two=Date.parse(String(earlier).slice(0,10)+'T12:00:00');
  return Math.max(0,Math.round((one-two)/86400000));
}
function smartPastVisits(client){
  var today=localDate(0),seen={};
  return smartClientAppointments(client.id).filter(function(item){
    var day=appointmentDate(item),status=String(item.status||'confirmed');
    if(day>today||status==='cancelled'||status==='no_show'||seen[day])return false;
    seen[day]=true;return true;
  }).sort(function(a,b){return appointmentDate(a).localeCompare(appointmentDate(b))});
}
function smartPreferredEmployee(items){
  var counts={};
  items.forEach(function(item){if(item.employeeId)counts[item.employeeId]=(counts[item.employeeId]||0)+1});
  return Object.keys(counts).sort(function(left,right){return counts[right]-counts[left]})[0]||null;
}
function smartAnalysisForClient(client){
  var visits=smartPastVisits(client),dates=visits.map(appointmentDate),last=dates.length?dates[dates.length-1]:null;
  if(dates.length<3){return {client:client,enough:false,status:'insufficient',label:SMART_STATUS.insufficient.label,count:dates.length,last:last,average:null,elapsed:last?smartDateDiff(localDate(0),last):null,preferredEmployeeId:smartPreferredEmployee(visits),visits:visits}}
  var intervals=[];
  for(var index=1;index<dates.length;index++)intervals.push(smartDateDiff(dates[index],dates[index-1]));
  intervals=intervals.filter(function(value){return value>0});
  if(intervals.length<2){return {client:client,enough:false,status:'insufficient',label:SMART_STATUS.insufficient.label,count:dates.length,last:last,average:null,elapsed:smartDateDiff(localDate(0),last),preferredEmployeeId:smartPreferredEmployee(visits),visits:visits}}
  var average=Math.max(1,Math.round(intervals.reduce(function(sum,value){return sum+value},0)/intervals.length));
  var elapsed=smartDateDiff(localDate(0),last),ratio=elapsed/average,status='regular';
  if(ratio>=1.75)status='risk';
  else if(ratio>=1.25)status='overdue';
  else if(ratio>=1)status='due';
  else if(ratio>=0.75)status='approaching';
  return {client:client,enough:true,status:status,label:SMART_STATUS[status].label,count:dates.length,last:last,average:average,elapsed:elapsed,preferredEmployeeId:smartPreferredEmployee(visits),visits:visits};
}
function smartAnalyses(){
  return uniqueRemoteClients().map(smartAnalysisForClient).filter(function(item){return item.count>0}).sort(function(left,right){
    var rank=(SMART_STATUS[right.status].rank-SMART_STATUS[left.status].rank);return rank||(right.elapsed||0)-(left.elapsed||0);
  });
}
function smartActionableAnalyses(includeApproaching){
  var allowed=includeApproaching?['approaching','due','overdue','risk']:['due','overdue','risk'];
  return smartAnalyses().filter(function(item){return allowed.includes(item.status)});
}

var previousRemoteAppointment=remoteAppointment;
remoteAppointment=function(item){
  var mapped=previousRemoteAppointment(item);
  mapped.status=item.status||'confirmed';mapped.updatedBy=item.updated_by||null;mapped.createdBy=item.created_by||mapped.createdBy||null;
  return mapped;
};

uniqueRemoteClients=function(){
  var seen={};
  return remoteClients.filter(function(client){var id=String(client.id||'');if(!id||client.active===false||seen[id])return false;seen[id]=true;return true});
};
clientForName=function(name){
  var key=customerNameKey(name),matches=uniqueRemoteClients().filter(function(client){return customerNameKey(client.full_name)===key});
  return matches.length===1?matches[0]:null;
};
appointmentsForClient=function(client){return client?smartClientAppointments(client.id):[]};
visitAnalysisForClient=function(client){return smartAnalysisForClient(client)};

ensureRemoteClient=async function(name,phone){
  var normalizedPhone=normalizeCustomerPhone(phone),selected=smartClientById(smartSelectedClientId);
  if(selected&&customerNameKey(selected.full_name)===customerNameKey(name))return selected.id;
  var exact=uniqueRemoteClients().filter(function(client){return customerNameKey(client.full_name)===customerNameKey(name)});
  if(exact.length===1){smartSelectedClientId=exact[0].id;return exact[0].id}
  if(exact.length>1)throw new Error('Aynı isimde birden fazla müşteri var. Öneri listesinden doğru müşteriyi seçin.');
  var payload={full_name:name,phone:normalizedPhone||null,created_by:currentUser&&currentUser.id};
  var result=await salonDb.from('clients').insert(payload).select('id,full_name,phone,last_service_id,last_employee_id,last_appointment_at,active,created_by,updated_by').single();
  if(result.error)throw result.error;
  remoteClients.push(result.data);clients=remoteClients.map(function(client){return client.full_name});smartSelectedClientId=result.data.id;return result.data.id;
};

filterCustomers=function(){
  var input=document.getElementById('appointmentCustomer');if(!input)return;
  ensureTypedCustomerSuggestions();
  var selected=smartClientById(smartSelectedClientId);
  if(selected&&customerNameKey(selected.full_name)!==customerNameKey(input.value))smartSelectedClientId=null;
  var panel=document.getElementById('typedCustomerSuggestions'),term=customerNameKey(input.value);
  if(!term){panel.classList.remove('show');panel.innerHTML='';return}
  var matches=uniqueRemoteClients().filter(function(client){return customerNameKey(client.full_name).includes(term)}).slice(0,8);
  panel.innerHTML=matches.map(function(client){return '<button type="button" data-id="'+safe(client.id)+'"><strong>'+safe(client.full_name)+'</strong><small>'+safe(client.phone||'Telefon yok')+'</small></button>'}).join('');
  Array.from(panel.querySelectorAll('button')).forEach(function(button){button.onclick=function(){
    var client=smartClientById(button.dataset.id);if(!client)return;smartSelectedClientId=client.id;input.value=client.full_name;panel.classList.remove('show');applyCustomerHistory(client);
  }});
  panel.classList.toggle('show',Boolean(matches.length));
};

var previousOpenAppointment=openAppointmentModal;
openAppointmentModal=function(time,id,staffName){
  smartSelectedClientId=null;
  var result=previousOpenAppointment(time,id,staffName),existing=id?appts.find(function(item){return String(item.id)===String(id)}):null;
  if(existing&&existing.clientId){smartSelectedClientId=existing.clientId;var client=smartClientById(existing.clientId);if(client)applyCustomerHistory(client)}
  var input=document.getElementById('appointmentCustomer');
  if(input&&!input.dataset.smartIdentityBound){input.dataset.smartIdentityBound='1';input.addEventListener('input',function(){var client=smartClientById(smartSelectedClientId);if(client&&customerNameKey(client.full_name)!==customerNameKey(input.value))smartSelectedClientId=null})}
  return result;
};
newAppointmentForCustomer=function(id){
  var client=smartClientById(id);if(!client)return;openAppointmentModal('',null,'');smartSelectedClientId=client.id;
  document.getElementById('appointmentCustomer').value=client.full_name;applyCustomerHistory(client);
};

confirmDeleteCustomer=async function(){
  var id=pendingCustomerDeleteId;if(!id||currentUser?.role!=='yonetici')return;
  var result=await salonDb.from('clients').update({active:false,deleted_at:new Date().toISOString(),deleted_by:currentUser.id}).eq('id',id).eq('active',true).select('id');
  if(result.error){showAppToast('Müşteri silinemedi',result.error.message||'Tekrar deneyin.');return}
  if(!result.data||result.data.length!==1){showAppToast('Müşteri silinemedi','Kayıt bulunamadı veya silme yetkiniz yok.');return}
  closeDeleteCustomerModal();selectedCustomerId=null;await reloadRemoteData();await loadV151Supplement();showPage('customers');showAppToast('Müşteri kaldırıldı','Randevu, borç ve analiz geçmişi client_id ile korundu.');
};

window.onSalonContactsSelected=function(payload){
  var contacts;try{contacts=JSON.parse(payload||'[]')}catch(error){window.onSalonContactsImportError('Rehber verisi okunamadı.');return}
  var existingNames=new Set(uniqueRemoteClients().map(function(client){return customerNameKey(client.full_name)})),seenNames=new Set();pendingContactChoices=[];selectedContactIndexes=new Set();contactImportSkipped=0;
  contacts.forEach(function(contact){
    var name=String(contact.name||'').trim(),phone=normalizeCustomerPhone(contact.phone),nameKey=customerNameKey(name);
    if(!nameKey||name.length<2||(phone&&phone.length!==11)||existingNames.has(nameKey)||seenNames.has(nameKey)){contactImportSkipped++;return}
    seenNames.add(nameKey);pendingContactChoices.push({full_name:name,phone:phone||null,created_by:currentUser&&currentUser.id});
  });
  if(!pendingContactChoices.length){showAppToast('Aktarılacak yeni kişi yok',contactImportSkipped+' kayıt zaten mevcut veya uygun değil.');return}
  document.getElementById('contactImportSearch').value='';document.getElementById('contactImportModal').classList.add('show');renderContactImportChoices();
};

var smartClientLoadPromise=null;
function smartLoadActiveClients(){
  if(smartClientLoadPromise)return smartClientLoadPromise;
  smartClientLoadPromise=salonDb.from('clients').select('id,full_name,phone,note,last_service_id,last_employee_id,last_appointment_at,active,created_by,updated_by,deleted_at,deleted_by').eq('active',true).order('full_name').then(function(result){
    if(result.error)throw result.error;
    remoteClients=result.data||[];clients=remoteClients.map(function(client){return client.full_name});
    return remoteClients;
  }).finally(function(){smartClientLoadPromise=null});
  return smartClientLoadPromise;
}
var previousLoadV151Smart=loadV151Supplement;
loadV151Supplement=async function(){
  await previousLoadV151Smart();if(!currentUser)return;
  await smartLoadActiveClients();
};

var previousReloadSmart=reloadRemoteData;
reloadRemoteData=async function(){
  await previousReloadSmart();if(!currentUser)return;
  await smartLoadActiveClients();
  renderCustomers();renderCustomerDetail();renderSmartAnalysisPage();renderSmartDailyPanels();
};

// Some older boot loaders initially selected only the client identity fields.
// Hydrate the full customer rows before a customer screen is rendered so a
// transient partial result can never make saved phone numbers look deleted.
var previousShowPageSmartClients=showPage;
showPage=function(id){
  previousShowPageSmartClients(id);
  if(!currentUser||!['customers','customerDetail'].includes(id))return;
  var needsHydration=remoteClients.length&&!remoteClients.some(function(client){return Object.prototype.hasOwnProperty.call(client,'phone')});
  if(!needsHydration)return;
  var holder=document.getElementById(id==='customers'?'customerList':'customerDetailContent');
  if(holder)holder.innerHTML='<div class="empty">Müşteri telefonları yükleniyor…</div>';
  smartLoadActiveClients().then(function(){renderCustomers();renderCustomerDetail()}).catch(function(error){showAppToast('Müşteri telefonları yüklenemedi',error.message||'Bağlantıyı kontrol edin.')});
};

function smartMinutes(value){var parts=String(value||'00:00').split(':').map(Number);return (parts[0]||0)*60+(parts[1]||0)}
function smartClock(minutes){if(minutes>=1440)return '24:00';return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')}
function smartVisibleProfiles(){
  if(!currentUser)return [];
  if(currentUser.role!=='yonetici')return remoteProfiles.filter(function(profile){return profile.active&&String(profile.id)===String(currentUser.id)});
  return remoteProfiles.filter(function(profile){return profile.active});
}
function smartFreeSlots(date){
  var now=new Date(),today=localDate(0),minimum=date===today?Math.max(480,Math.ceil((now.getHours()*60+now.getMinutes())/30)*30):480;
  return smartVisibleProfiles().flatMap(function(profile){
    var free=[];
    for(var minute=480;minute<1440;minute+=30){
      var start=minute,end=minute+30,time=smartClock(start),blocked=closedSlotFor(date,time,30,profile.id);
      var busy=appts.some(function(item){if(String(item.employeeId)!==String(profile.id)||appointmentDate(item)!==date||item.status==='cancelled')return false;var itemStart=smartMinutes(item.time),itemEnd=itemStart+Number(item.duration||30);return start<itemEnd&&end>itemStart});
      if(!blocked&&!busy&&start>=minimum)free.push(start);
    }
    var groups=[];
    free.forEach(function(value){var last=groups[groups.length-1];if(last&&last.end===value)last.end=value+30;else groups.push({employeeId:profile.id,employeeName:profile.full_name,start:value,end:value+30})});
    return groups;
  }).sort(function(left,right){return left.start-right.start});
}
function smartGapSuggestions(date){
  var candidates=smartActionableAnalyses(true),used={};
  return smartFreeSlots(date).map(function(slot){
    var matching=candidates.filter(function(item){return !used[item.client.id]&&(!item.preferredEmployeeId||String(item.preferredEmployeeId)===String(slot.employeeId))}).slice(0,3);
    matching.forEach(function(item){used[item.client.id]=true});
    return {slot:slot,candidates:matching};
  }).filter(function(item){return item.candidates.length}).slice(0,6);
}
function smartStatusBadge(item){var status=SMART_STATUS[item.status];return '<span class="smart-status '+status.className+'">'+safe(status.label)+'</span>'}
function smartWhatsappButton(clientId,label){return '<button type="button" class="smart-whatsapp" onclick="event.stopPropagation();openSmartCustomerWhatsApp('+jsAttr(clientId)+')">'+safe(label||'WhatsApp')+'</button>'}
window.openSmartCustomerWhatsApp=function(clientId){openReturnWhatsApp(clientId)};

function smartAttentionCards(items,limit){
  return items.slice(0,limit||20).map(function(item){return '<div class="smart-customer-card"><div class="item-main"><strong>'+safe(item.client.full_name)+'</strong><small>'+safe(item.client.phone||'Telefon yok')+' · Son geliş: '+safe(item.last?friendlyDate(item.last):'—')+'<br>'+(item.enough?'Ortalama '+item.average+' gün · '+item.elapsed+' gündür gelmedi':'Henüz yeterli veri yok')+'</small></div>'+smartStatusBadge(item)+smartWhatsappButton(item.client.id,'WhatsApp')+'</div>'}).join('');
}
function smartGreeting(){var hour=new Date().getHours();return hour<12?'Günaydın':hour<18?'İyi günler':'İyi akşamlar'}
function smartSummaryText(){
  var today=localDate(0),todayAppointments=appts.filter(function(item){return appointmentDate(item)===today&&item.status!=='cancelled'}),gaps=smartFreeSlots(today),analyses=smartActionableAnalyses(false),risk=analyses.filter(function(item){return item.status==='risk'}).length,suggestions=smartGapSuggestions(today);
  var prefix=smartGreeting()+((currentUser&&currentUser.role!=='yonetici')?' '+currentUser.name.split(' ')[0]:'')+'. ';
  var count=prefix+'Bugün '+todayAppointments.length+' randevu'+(currentUser&&currentUser.role!=='yonetici'?'n var':' var')+'. ';
  var gap=gaps.length?gaps[0].employeeName+' için '+smartClock(gaps[0].start)+'–'+smartClock(gaps[0].end)+' arasında boşluk bulunuyor. ':'Bugün uygun boşluk görünmüyor. ';
  return count+gap+analyses.length+' müşterinin gelme zamanı geldi veya geçti. '+risk+' müşteri kaybedilme riski taşıyor. Boşluğu doldurabilecek '+suggestions.reduce(function(sum,item){return sum+item.candidates.length},0)+' müşteri bulundu.';
}
function renderSmartDailyPanels(){
  var target=document.getElementById('calendarContent');if(!target||!currentUser||teamCalendarMode==='month'||selectedTeamDate()!==localDate(0))return;
  target.querySelectorAll('.smart-daily-block').forEach(function(node){node.remove()});
  var attention=smartActionableAnalyses(false),suggestions=smartGapSuggestions(localDate(0));
  var summary=document.createElement('section');summary.className='smart-daily-block smart-summary';summary.innerHTML='<div class="smart-title"><div><small>GÜNLÜK SALON ÖZETİ</small><h2>'+safe(smartGreeting())+'</h2></div><button type="button" onclick="showPage(\'salonAssistant\')">Salon Asistanı ›</button></div><p>'+safe(smartSummaryText())+'</p>';
  var attentionBlock=document.createElement('section');attentionBlock.className='smart-daily-block';attentionBlock.innerHTML='<div class="smart-title"><div><small>AKILLI MÜŞTERİ ANALİZİ</small><h2>Bugün ilgilenilecek müşteriler</h2></div><button type="button" onclick="showPage(\'smartAnalysis\')">Tümünü gör ›</button></div><div class="smart-scroll">'+(smartAttentionCards(attention,8)||'<div class="empty">Bugün için öncelikli müşteri yok.</div>')+'</div>';
  var gapBlock=document.createElement('section');gapBlock.className='smart-daily-block';gapBlock.innerHTML='<div class="smart-title"><div><small>BOŞ SAAT ANALİZİ</small><h2>Boşluğu doldurabilecek müşteriler</h2></div></div>'+(suggestions.map(function(group){return '<div class="smart-gap"><strong>'+safe(group.slot.employeeName)+' · '+smartClock(group.slot.start)+'–'+smartClock(group.slot.end)+'</strong>'+group.candidates.map(function(item){return '<span>'+safe(item.client.full_name)+' · '+safe(item.label)+smartWhatsappButton(item.client.id,'Mesaj')+'</span>'}).join('')+'</div>'}).join('')||'<div class="empty">Uygun boşluk veya müşteri önerisi yok.</div>');
  var anchor=target.querySelector('.calendar-date-nav')||target.firstChild;target.insertBefore(gapBlock,anchor);target.insertBefore(attentionBlock,gapBlock);target.insertBefore(summary,attentionBlock);
}

var previousRenderCalendarSmart=renderCalendar;
renderCalendar=function(){previousRenderCalendarSmart();renderSmartDailyPanels()};

function installSmartPages(){
  var app=document.getElementById('app'),nav=app&&app.querySelector('.nav'),analysis=document.getElementById('smartAnalysis'),assistant=document.getElementById('salonAssistant');
  if(!analysis){analysis=document.createElement('section');analysis.id='smartAnalysis';analysis.className='page';analysis.innerHTML='<div class="content"><button class="back" onclick="showPage(\'calendar\')">‹ Takvim</button><h1 class="page-title">Akıllı Müşteri Analizi</h1><div id="smartAnalysisContent"></div></div>';if(nav)app.insertBefore(analysis,nav);else app.appendChild(analysis)}
  if(!assistant){assistant=document.createElement('section');assistant.id='salonAssistant';assistant.className='page';assistant.innerHTML='<div class="content"><button class="back" onclick="showPage(\'calendar\')">‹ Takvim</button><h1 class="page-title">Salon Asistanı</h1><div class="security">İstediğiniz desteklenen soruyu kendi cümlenizle yazabilir veya söyleyebilirsiniz. Aşağıdaki düğmeler yalnızca örnektir.</div><form class="assistant-form" onsubmit="runSalonAssistant(event)"><label class="field">Ne öğrenmek veya yapmak istiyorsunuz?<input id="salonAssistantInput" autocomplete="off" enterkeyhint="send" placeholder="Örn. Ahmet en son ne zaman geldi?"></label><button class="save">Komutu çalıştır</button></form><div class="assistant-examples"><button onclick="useAssistantExample(this)">Bugünkü randevuları göster.</button><button onclick="useAssistantExample(this)">Yarın boş saatler ne?</button><button onclick="useAssistantExample(this)">30 gündür gelmeyenleri göster.</button><button onclick="useAssistantExample(this)">Kaybedilme riski olan müşterileri göster.</button><button onclick="useAssistantExample(this)">Ne sorabilirim?</button></div><div id="salonAssistantResult" class="assistant-result"></div></div>';if(nav)app.insertBefore(assistant,nav);else app.appendChild(assistant)}
  var drawer=document.querySelector('#drawerLayer .drawer'),stats=document.querySelector("[onclick=\"drawerPage('statistics')\"]");
  if(drawer&&stats&&!document.getElementById('drawerSmartAnalysis')){var button=document.createElement('button');button.type='button';button.id='drawerSmartAnalysis';button.className='menu-item';button.textContent='◉   Akıllı Müşteri Analizi';button.onclick=function(){drawerPage('smartAnalysis')};stats.insertAdjacentElement('afterend',button)}document.getElementById('drawerSalonAssistant')?.remove();
}
function renderSmartAnalysisPage(){
  var holder=document.getElementById('smartAnalysisContent');if(!holder||!currentUser)return;
  var analyses=smartAnalyses(),groups=['risk','overdue','due','approaching','insufficient'];
  holder.innerHTML='<div class="smart-analysis-intro"><strong>'+analyses.length+' müşteri analiz edildi</strong><small>Geçmişler yalnızca benzersiz customer_id üzerinden hesaplanır. En az 3 farklı ziyaret olmadan tahmin yapılmaz.</small></div>'+groups.map(function(status){var items=analyses.filter(function(item){return item.status===status});return '<section class="smart-analysis-group"><div class="section"><h2>'+safe(SMART_STATUS[status].label)+'</h2><span class="role">'+items.length+'</span></div>'+(smartAttentionCards(items,100)||'<div class="empty">Bu durumda müşteri yok.</div>')+'</section>'}).join('');
}

renderCustomerReturnAlerts=function(){
  var area=document.getElementById('customerReturnAlerts');if(!area||currentUser?.role!=='yonetici')return;
  var due=smartActionableAnalyses(false);
  area.innerHTML='<div class="section"><h2>Akıllı Müşteri Analizi</h2><span class="role">'+due.length+' müşteri</span></div><div class="notice">Analiz kendi başına WhatsApp açmaz ve mesaj göndermez. Mesaj yalnızca aşağıdaki düğmeye basıldığında hazırlanır.</div>'+(smartAttentionCards(due,50)||'<div class="empty">Şu anda ilgilenilecek müşteri yok.</div>');
};

function assistantNormalize(value){return customerNameKey(String(value||'').replace(/[’']/g,'').replace(/[?.!,]/g,' '))}
function assistantOwnerName(value){return String(value||'').trim().replace(/[’']?(?:nin|nın|nun|nün|in|ın|un|ün)$/i,'').trim()}
function assistantClients(term){var key=customerNameKey(term);return uniqueRemoteClients().filter(function(client){return customerNameKey(client.full_name).includes(key)}).slice(0,10)}
function assistantAppointmentRows(items){return items.map(function(item){return '<div class="assistant-row"><strong>'+safe(item.customer)+'</strong><small>'+safe(friendlyDate(appointmentDate(item)))+' · '+safe(item.time)+' · '+safe(item.staff)+' · '+safe(item.operation)+'</small></div>'}).join('')||'<div class="empty">Kayıt bulunamadı.</div>'}
function assistantClientHistory(term,limit,latestOnly){
  var matches=assistantClients(term);if(!matches.length)return '<div class="empty">Bu isimle müşteri bulunamadı.</div>';
  return matches.map(function(client){var items=smartClientAppointments(client.id).filter(function(item){return appointmentDate(item)<=localDate(0)}).slice(0,limit);return '<div class="assistant-client"><h3>'+safe(client.full_name)+'</h3>'+(latestOnly?(items[0]?'<p>Son geliş: <strong>'+safe(friendlyDate(appointmentDate(items[0])))+' · '+safe(items[0].time)+'</strong></p>':'<div class="empty">Ziyaret kaydı yok.</div>'):assistantAppointmentRows(items))+'</div>'}).join('');
}
function assistantReadResult(command){
  var normalized=assistantNormalize(command),today=localDate(0),tomorrow=localDate(1),match;
  match=command.match(/^(.+?)\s+en\s+son\s+ne\s+zaman\s+geldi/i);if(match)return assistantClientHistory(match[1],1,true);
  match=command.match(/^(.+?)\s+son\s+(\d+)\s+ziyaretini\s+göster/i);if(match)return assistantClientHistory(assistantOwnerName(match[1]),Math.min(20,Number(match[2])||5),false);
  match=command.match(/(\d+)\s+gündür\s+gelmeyenleri/i);if(match){var days=Number(match[1]);return smartAttentionCards(smartAnalyses().filter(function(item){return item.elapsed!==null&&item.elapsed>=days}),100)||'<div class="empty">Bu ölçüte uyan müşteri yok.</div>'}
  if(normalized.includes('gecikenmusteriler'))return smartAttentionCards(smartAnalyses().filter(function(item){return item.status==='overdue'}),100)||'<div class="empty">Geciken müşteri yok.</div>';
  if(normalized.includes('gelmezamanigelenler'))return smartAttentionCards(smartAnalyses().filter(function(item){return item.status==='due'}),100)||'<div class="empty">Gelme zamanı gelen müşteri yok.</div>';
  if(normalized.includes('kaybedilmeriski'))return smartAttentionCards(smartAnalyses().filter(function(item){return item.status==='risk'}),100)||'<div class="empty">Riskte müşteri yok.</div>';
  if(normalized.includes('bugunkurandevularim'))return assistantAppointmentRows(appts.filter(function(item){return appointmentDate(item)===today&&item.status!=='cancelled'}));
  if(normalized.includes('yarinkirandevularim'))return assistantAppointmentRows(appts.filter(function(item){return appointmentDate(item)===tomorrow&&item.status!=='cancelled'}));
  if(normalized.includes('yarinbossaatlerim')||normalized==='bossaatler'){var gapDate=normalized.includes('yarin')?tomorrow:today,gaps=smartFreeSlots(gapDate);return gaps.map(function(gap){return '<div class="assistant-row"><strong>'+safe(gap.employeeName)+'</strong><small>'+smartClock(gap.start)+'–'+smartClock(gap.end)+'</small></div>'}).join('')||'<div class="empty">Boş saat yok.</div>'}
  if(normalized.includes('buayencokgelenmusteriler')){var month=today.slice(0,7),counts={};appts.filter(function(item){return appointmentDate(item).startsWith(month)&&item.clientId&&item.status!=='cancelled'}).forEach(function(item){counts[item.clientId]=(counts[item.clientId]||0)+1});return Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]}).slice(0,10).map(function(id){var client=smartClientById(id);return '<div class="assistant-row"><strong>'+safe(client?.full_name||'Müşteri')+'</strong><small>'+counts[id]+' ziyaret</small></div>'}).join('')||'<div class="empty">Bu ay ziyaret kaydı yok.</div>'}
  if(normalized.includes('bugunmesajatmamgerekenmusteriler'))return smartAttentionCards(smartActionableAnalyses(false),100)||'<div class="empty">Bugün mesaj önerilen müşteri yok.</div>';
  return null;
}
function assistantMutation(command){
  var match=command.match(/^(.+?)\s+randevusunu\s+(\d{1,2}):(\d{2})(?:[’']?[ae])?\s+al/i);if(!match)return null;
  var term=customerNameKey(assistantOwnerName(match[1])),time=String(Number(match[2])).padStart(2,'0')+':'+match[3];if(smartMinutes(time)<480||smartMinutes(time)>=1440)return {error:'Saat 08:00–24:00 arasında olmalıdır.'};
  var future=appts.filter(function(item){return customerNameKey(item.customer).includes(term)&&Date.parse(remoteSchedule(appointmentDate(item),item.time))>Date.now()&&canManageOwnAppointment(item)}).sort(function(a,b){return (appointmentDate(a)+a.time).localeCompare(appointmentDate(b)+b.time)});
  if(!future.length)return {error:'Değiştirilebilecek gelecek randevu bulunamadı.'};
  return {type:'moveAppointment',appointment:future[0],newTime:time};
}
window.runSalonAssistant=function(event){
  event.preventDefault();var input=document.getElementById('salonAssistantInput'),result=document.getElementById('salonAssistantResult'),command=input.value.trim();if(!command)return;
  var read=assistantReadResult(command);if(read!==null){smartPendingAction=null;result.innerHTML='<div class="assistant-answer">'+read+'</div>';return}
  var action=assistantMutation(command);if(action){if(action.error){result.innerHTML='<div class="notice">'+safe(action.error)+'</div>';return}smartPendingAction=action;var item=action.appointment;result.innerHTML='<div class="assistant-confirm"><h3>Onay gerekli</h3><p><strong>'+safe(item.customer)+'</strong> müşterisinin '+safe(friendlyDate(appointmentDate(item)))+' tarihindeki randevusu <strong>'+safe(item.time)+'</strong> saatinden <strong>'+safe(action.newTime)+'</strong> saatine taşınacak.</p><small>Çalışan: '+safe(item.staff)+' · İşlem: '+safe(item.operation)+'</small><div class="row"><button class="save" onclick="confirmSalonAssistantAction()">Onayla ve uygula</button><button class="back" onclick="cancelSalonAssistantAction()">Vazgeç</button></div></div>';return}
  result.innerHTML='<div class="notice">Bu komutu anlayamadım. Örneklerden birini kullanın veya müşteri adını daha açık yazın.</div>';
};
window.useAssistantExample=function(button){document.getElementById('salonAssistantInput').value=button.textContent;document.getElementById('salonAssistantInput').focus()};
window.cancelSalonAssistantAction=function(){smartPendingAction=null;document.getElementById('salonAssistantResult').innerHTML='<div class="empty">İşlem iptal edildi.</div>'};
window.confirmSalonAssistantAction=async function(){
  var action=smartPendingAction;if(!action||action.type!=='moveAppointment')return;var item=action.appointment,date=appointmentDate(item),time=action.newTime;
  if(appointmentConflictFor(date,time,Number(item.duration||30),item.employeeId,item.id)){showAppToast('Saat dolu','Bu çalışanın seçilen saatinde başka bir randevu var.');return}
  var result=await salonDb.from('appointments').update({scheduled_at:remoteSchedule(date,time),updated_by:currentUser.id}).eq('id',item.id).select('id,scheduled_at');
  if(result.error||!result.data?.length){showAppToast('Randevu güncellenemedi',result.error?.message||'Yetkiniz olmayabilir.');return}
  smartPendingAction=null;await reloadRemoteData();renderCalendar();document.getElementById('salonAssistantResult').innerHTML='<div class="security">Randevu '+safe(time)+' saatine güncellendi. İşlemi yapan kullanıcı denetim kaydına yazıldı.</div>';
  var client=smartClientById(item.clientId),phone=item.phone||client?.phone||'';if(phone){var url=whatsappAppointmentUpdateUrl(item.customer,phone,date,time,item.staff,appointmentRevenue(item),item.operation);setTimeout(function(){window.open(url,'_blank','noopener')},20)}
};

var previousShowPageSmart=showPage;
showPage=function(id){
  installSmartPages();previousShowPageSmart(id);
  if(id==='smartAnalysis')renderSmartAnalysisPage();
  if(id==='salonAssistant'){var input=document.getElementById('salonAssistantInput');if(input)setTimeout(function(){input.focus()},50)}
};
var previousSimplifySmart=simplifyNavigation;
simplifyNavigation=function(){previousSimplifySmart();installSmartPages();document.getElementById('drawerSmartAnalysis')?.classList.remove('hidden');document.getElementById('drawerSalonAssistant')?.remove()};

var smartStyle=document.createElement('style');
smartStyle.textContent='\
.smart-daily-block{margin:10px 0 14px;padding:14px;border:1px solid var(--line);border-radius:16px;background:#fff}.smart-summary{background:linear-gradient(135deg,#163b34,#0b2d28);color:#fff;border:0}.smart-summary p{margin:10px 0 0;line-height:1.5}.smart-title{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.smart-title small{display:block;font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--gold)}.smart-title h2{font-size:17px;margin:3px 0 0}.smart-title button{border:0;background:transparent;color:var(--gold);font-weight:800}.smart-customer-card{display:flex;align-items:center;gap:9px;padding:11px 0;border-bottom:1px solid var(--line)}.smart-customer-card:last-child{border-bottom:0}.smart-customer-card .item-main{min-width:0}.smart-customer-card small{display:block;color:var(--muted);line-height:1.4;margin-top:3px}.smart-status{font-size:10px;font-weight:800;padding:5px 7px;border-radius:999px;white-space:nowrap}.smart-approaching{background:#e8f2ef;color:#276c58}.smart-due{background:#fff1ca;color:#8a6500}.smart-overdue{background:#fde0c9;color:#a45022}.smart-risk{background:#f7d5d3;color:#9d3733}.smart-insufficient,.smart-regular{background:#eee;color:#666}.smart-whatsapp{border:0;border-radius:10px;padding:8px;background:#1f7a5b;color:#fff;font-weight:750}.smart-gap{padding:10px 0;border-bottom:1px solid var(--line)}.smart-gap>strong,.smart-gap>span{display:flex;align-items:center;justify-content:space-between;gap:8px}.smart-gap>span{padding:7px 0 0;color:var(--muted)}.smart-analysis-intro{padding:14px;background:#eef5f1;border-radius:14px}.smart-analysis-intro strong,.smart-analysis-intro small{display:block}.smart-analysis-intro small{margin-top:5px;color:var(--muted)}.smart-analysis-group{margin-top:18px}.assistant-form{margin-top:16px}.assistant-examples{display:flex;gap:7px;overflow:auto;padding:11px 0}.assistant-examples button{border:1px solid var(--line);border-radius:999px;background:#fff;padding:8px 11px;white-space:nowrap}.assistant-result{margin-top:12px}.assistant-row,.assistant-client{padding:11px 0;border-bottom:1px solid var(--line)}.assistant-row strong,.assistant-row small{display:block}.assistant-row small{margin-top:4px;color:var(--muted)}.assistant-confirm{padding:15px;border:1px solid #d5b16c;background:#fff9ed;border-radius:14px}.assistant-confirm .row{margin-top:12px}.assistant-confirm .back{border:1px solid var(--line);border-radius:12px;background:#fff}.typed-customer-suggestions button small{display:block;color:var(--muted);margin-top:3px}@media(max-width:520px){.smart-customer-card{align-items:flex-start;flex-wrap:wrap}.smart-customer-card .item-main{flex:1 1 55%}.smart-status{order:2}.smart-whatsapp{order:3;margin-left:auto}.smart-title h2{font-size:15px}}';
document.head.appendChild(smartStyle);

installSmartPages();
document.querySelectorAll('#appVersion').forEach(function(node){node.textContent='v1.7.0'});
document.querySelectorAll('.auth small').forEach(function(node){if(/^v1\./.test(node.textContent))node.textContent='v1.7.0'});
window.SalonSmartTest={
  analysisForClient:smartAnalysisForClient,
  analyses:smartAnalyses,
  freeSlots:smartFreeSlots,
  gapSuggestions:smartGapSuggestions,
  summaryText:smartSummaryText,
  assistantReadResult:assistantReadResult,
  assistantMutation:assistantMutation,
  selectClient:function(id){smartSelectedClientId=id},
  selectedClient:function(){return smartSelectedClientId}
};
})();
