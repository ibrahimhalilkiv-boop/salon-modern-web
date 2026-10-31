(function(){
  'use strict';
  var baseRender=window.renderCalendar,baseReload=window.reloadRemoteData;
  var filters={service:'',status:'all'},cancelled={month:'',actor:'',rows:[],loading:false},busy=false;
  // One consistent pastel palette per service category; never use employee identity for appointment colors.
  var servicePalette={
    combo:{name:'Saç + sakal',bg:'#D7F6DC',edge:'#13A35E'},
    hair:{name:'Saç kesimi',bg:'#D8EFFF',edge:'#1E83BB'},
    child:{name:'Çocuk tıraşı',bg:'#E9DCFF',edge:'#8554C9'},
    beard:{name:'Sakal kesimi',bg:'#FFF2C1',edge:'#CE9D21'},
    wash:{name:'Yıkama ve fön',bg:'#FFE2EE',edge:'#C96894'},
    dye:{name:'Saç boyama',bg:'#FFE0C9',edge:'#D67329'},
    care:{name:'Bakım / keratin',bg:'#D5F0EB',edge:'#248E82'},
    other:{name:'Diğer hizmetler',bg:'#E5E7EB',edge:'#7B8794'}
  };
  function esc(value){return window.safe(String(value==null?'':value))}
  function user(){return typeof currentUser==='undefined'?null:currentUser}
  function manager(){return user()?.role==='yonetici'}
  function owned(item){return !!item&&!!user()&&(manager()||String(item.employeeId)===String(user().id))}
  function date(item){return item.date||window.appointmentDate(item)}
  function profile(item){return remoteProfiles.find(function(p){return String(p.id)===String(item.employeeId)||p.full_name===item.staff})}
  function serviceTone(item){
    var name=String(item?.operation||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
    if(name.includes('cocuk'))return servicePalette.child;
    if(name.includes('boya'))return servicePalette.dye;
    if(name.includes('keratin')||name.includes('cilt'))return servicePalette.care;
    if(name.includes('sac')&&name.includes('sakal'))return servicePalette.combo;
    if(name.includes('sakal'))return servicePalette.beard;
    if(name.includes('sac')&&(/kesim|tiras/.test(name)))return servicePalette.hair;
    if(name.includes('yikama')||name.includes('fon'))return servicePalette.wash;
    if(name.includes('sac')||name.includes('ense')||name.includes('damat'))return servicePalette.hair;
    return servicePalette.other;
  }
  function price(item){var value=item&&item.amount;return value==null||!Number.isFinite(Number(value))?'Ücret belirtilmemiş':'₺ '+Number(value).toLocaleString('tr-TR',{maximumFractionDigits:2})}
  function cardPrice(item){var value=price(item);return value==='Ücret belirtilmemiş'?'Ücret yok':value}
  function label(item){return item.status==='completed'?'Tamamlandı':item.status==='no_show'?'Gelmedi':item.status==='cancelled'?'İptal':'Aktif'}
  function filtered(items){return items.filter(function(item){return item.status!=='cancelled'&&(!filters.service||item.operation===filters.service)&&(!manager()||!teamCalendarMember||item.staff===teamCalendarMember)&&(filters.status==='all'||(filters.status==='active'&&item.status==='confirmed')||filters.status===item.status)})}
  function cancelledFor(day){return cancelled.month===day.slice(0,7)&&cancelled.actor===user()?.id?cancelled.rows.filter(owned):[]}
  function all(){return filtered((manager()?appts:appts.filter(owned)).concat(cancelledFor(selectedTeamDate())))}
  function invalidate(){cancelled.month='';cancelled.rows=[]}
  async function loadCancelled(day){var actor=user()?.id,month=day.slice(0,7);if(!actor||cancelled.loading||(cancelled.month===month&&cancelled.actor===actor))return;cancelled.loading=true;try{var bounds=SalonAppointmentData.monthBounds(day),start=new Date(Date.parse(bounds.start)-7*86400000).toISOString(),end=new Date(Date.parse(bounds.end)+7*86400000).toISOString(),rows=[];for(var offset=0;;offset+=500){var result=await salonDb.from('appointments').select('*').eq('status','cancelled').gte('scheduled_at',start).lt('scheduled_at',end).order('scheduled_at').order('id').range(offset,offset+499);if(result.error)throw result.error;rows.push.apply(rows,result.data||[]);if((result.data||[]).length<500)break}if(user()?.id!==actor)return;cancelled={month:month,actor:actor,rows:rows.map(remoteAppointment),loading:false};window.renderCalendar()}catch(error){cancelled.loading=false;window.showAppToast?.('İptal kayıtları yüklenemedi',error.message||'Tekrar deneyin.')}}
  function options(id,pairs,value){var el=document.getElementById(id);if(!el)return;var html=pairs.map(function(pair){return '<option value="'+esc(pair[0])+'">'+esc(pair[1])+'</option>'}).join('');if(el.innerHTML!==html)el.innerHTML=html;el.value=value}
  function controls(){var content=document.querySelector('#calendar .content');if(!content||!user())return;var holder=document.getElementById('salonCalendarControls');if(!holder){holder=document.createElement('div');holder.id='salonCalendarControls';holder.innerHTML='<details id="smartFilters"><summary aria-label="Filtreler">☷</summary><div class="calendar-smart-filters"><label>Çalışan<select id="smartStaff"></select></label><label>İşlem<select id="smartService"></select></label><label>Durum<select id="smartStatus"></select></label><label>Görünüm<select id="smartPeriod"></select></label></div></details><details id="smartColors"><summary aria-label="Hizmet renkleri">🎨</summary><div id="smartColorList" aria-label="Hizmet renk açıklamaları"></div></details>';content.insertBefore(holder,document.getElementById('calendarContent'));document.getElementById('smartStaff').onchange=function(e){teamCalendarMember=e.target.value||undefined;window.renderCalendar()};document.getElementById('smartService').onchange=function(e){filters.service=e.target.value;window.renderCalendar()};document.getElementById('smartStatus').onchange=function(e){filters.status=e.target.value;window.renderCalendar()};document.getElementById('smartPeriod').onchange=function(e){teamCalendarMode=e.target.value;window.renderCalendar()};}
    options('smartStaff',[['','Tüm çalışanlar']].concat(staff.map(function(s){return [s[0],s[0]]})),manager()?teamCalendarMember||'':user().name);document.getElementById('smartStaff').disabled=!manager();options('smartService',[['','Tüm işlemler']].concat(remoteServices.map(function(s){return [s.name,s.name]})),filters.service);if(filters.status==='arrived'||filters.status==='cancelled')filters.status='all';options('smartStatus',[['all','Tümü'],['active','Aktif'],['completed','Tamamlandı'],['no_show','Gelmedi']],filters.status);options('smartPeriod',[['day','Gün'],['week','Hafta'],['month','Ay']],teamCalendarMode||'day');var colors=document.getElementById('smartColors');colors.hidden=false;if(!colors.open)document.getElementById('smartColorList').innerHTML=Object.keys(servicePalette).map(function(key){var tone=servicePalette[key];return '<div class="service-color-legend"><span class="service-color-swatch" style="--service-bg:'+tone.bg+';--service-color:'+tone.edge+'"></span><span>'+esc(tone.name)+'</span></div>'}).join('')}
  function card(item){return '<button type="button" class="smart-event" data-smart-id="'+esc(item.id)+'" style="--service-bg:'+esc(serviceTone(item).bg)+';--service-color:'+esc(serviceTone(item).edge)+'"><strong>'+esc(item.customer)+'</strong><span>'+esc(item.time)+' · '+esc(item.staff)+'</span><small>'+esc(item.operation)+' · '+esc(price(item))+' · '+label(item)+'</small></button>'}
  function simplify(target){
    var nav=target.querySelector('.calendar-date-nav');
    if(nav){
      nav.querySelectorAll('button').forEach(function(button){button.remove()});
      var title=nav.querySelector('strong');
      if(title&&teamCalendarMode==='month'){
        title.querySelector('.role')?.remove();title.classList.add('calendar-month-title');
        title.setAttribute('role','button');title.tabIndex=0;
        title.onclick=function(){window.pickTeamMonth?.()};
        title.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();window.pickTeamMonth?.()}};
      }else if(title){
        var count=title.querySelector('.role');
        if(count)count.textContent=count.textContent.replace(/\s*·\s*Ay görünümü.*/,'');
      }
    }
    if(teamCalendarMode==='month')return;
    target.querySelector(':scope > .section')?.remove();

    target.querySelectorAll('[data-appointment-id]').forEach(function(node){
      var item=appts.concat(cancelled.rows).find(function(row){return String(row.id)===node.dataset.appointmentId});
      if(!item)return;
      var strong=node.querySelector('strong'),small=node.querySelector('small');
      if(strong)strong.innerHTML='<span class="calendar-customer">'+esc(item.customer)+'</span>';
      if(small)small.textContent=item.operation;
      var amount=node.querySelector('.calendar-price');
      if(!amount){amount=document.createElement('span');amount.className='calendar-price';(small||strong)?.after(amount)}
      amount.textContent=cardPrice(item);
      var tone=serviceTone(item);node.style.setProperty('--service-bg',tone.bg);node.style.setProperty('--service-color',tone.edge);
      node.title=item.customer+' · '+item.operation+' · '+price(item);
    });
  }
  function week(target){if(teamCalendarMode!=='week')return;var current=new Date(selectedTeamDate()+'T12:00:00Z');current.setUTCDate(current.getUTCDate()-(current.getUTCDay()+6)%7);var days=[];for(var i=0;i<7;i++){var d=new Date(current);d.setUTCDate(d.getUTCDate()+i);days.push(d.toISOString().slice(0,10))}var items=all(),earliest=salonCalendarEarliestDay();target.innerHTML='<div class="calendar-date-nav"><strong>'+esc(days[0])+' – '+esc(days[6])+'</strong></div><div class="smart-week">'+days.map(function(day){var old=day<earliest,rows=old?[]:items.filter(function(item){return date(item)===day}).sort(function(a,b){return a.time.localeCompare(b.time)});return '<section><button type="button" class="smart-week-day'+(old?' muted':'')+'" data-smart-day="'+day+'"'+(old?' disabled':'')+'>'+esc(new Date(day+'T12:00:00Z').toLocaleDateString('tr-TR',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}))+'</button>'+(old?'<small>Önceki tarih</small>':rows.map(card).join('')||'<small>Randevu yok</small>')+'</section>'}).join('')+'</div>'}
  function decorate(target){target.querySelectorAll('[data-appointment-id]').forEach(function(node){var item=all().find(function(row){return String(row.id)===node.dataset.appointmentId});if(!item)return;var tone=serviceTone(item);node.style.setProperty('--service-bg',tone.bg);node.style.setProperty('--service-color',tone.edge);node.setAttribute('aria-label',item.customer+', '+item.staff+', '+item.time+', '+item.operation+', '+price(item)+', '+label(item))})}
  function bind(target){target.querySelectorAll('[data-smart-id]').forEach(function(node){node.onclick=function(){open(node.dataset.smartId)}});target.querySelectorAll('[data-smart-time]').forEach(function(node){node.onclick=function(){window.openTeamSlot(node.dataset.smartTime,manager()?teamCalendarMember||'':user().name)}});target.querySelectorAll('[data-smart-day]').forEach(function(node){node.onclick=function(){if(node.disabled||node.dataset.smartDay<salonCalendarEarliestDay())return;window.selectTeamDay(node.dataset.smartDay)}});target.querySelectorAll('[data-week-move]').forEach(function(node){node.onclick=function(){window.moveTeamCalendar(Number(node.dataset.weekMove))}})}
  function panel(){var el=document.getElementById('smartAppointmentPanel');if(el)return el;el=document.createElement('div');el.id='smartAppointmentPanel';el.className='smart-panel-backdrop';el.innerHTML='<section class="smart-panel" role="dialog" aria-modal="true" aria-labelledby="smartPanelTitle"><div class="smart-panel-handle"></div><button type="button" class="smart-panel-close" aria-label="Kapat">×</button><h2 id="smartPanelTitle"></h2><div id="smartPanelDetails"></div><div id="smartPanelActions"></div></section>';el.addEventListener('click',function(e){if(e.target===el||e.target.closest('.smart-panel-close'))close()});document.body.appendChild(el);return el}
  function close(){document.getElementById('smartAppointmentPanel')?.classList.remove('show')}
  function find(id){return appts.concat(cancelled.rows).find(function(item){return String(item.id)===String(id)})}
  function button(text,key,kind){return '<button type="button" data-action="'+key+'" class="'+(kind||'')+'">'+text+'</button>'}
  function open(id){var item=id&&typeof id==='object'?id:find(id);if(!owned(item)){showAppToast('Yetki yok','Bu randevuyu açma yetkiniz yok.');return}var el=panel();el.dataset.id=item.id;el.querySelector('#smartPanelTitle').textContent=item.customer;el.querySelector('#smartPanelDetails').innerHTML='<p><b>Tarih ve saat:</b> '+esc(date(item))+' · '+esc(item.time)+'</p><p><b>Çalışan:</b> '+esc(item.staff)+'</p><p><b>İşlem:</b> '+esc(item.operation)+'</p><p><b>Ücret:</b> '+esc(price(item))+'</p><p><b>Telefon:</b> '+esc(item.clientPhone||'Kayıtlı değil')+'</p><p><b>Durum:</b> '+label(item)+'</p>';var due=Date.parse(item.scheduledAt||remoteSchedule(date(item),item.time))<=Date.now(),buttons=[];if(item.status==='confirmed'&&due)buttons.push(button('Tamamlandı','complete'));if(item.status==='confirmed'&&due)buttons.push(button('Gelmedi','no_show'));if(item.status==='no_show'&&manager())buttons.push(button('Gelmedi işaretini geri al','undo_no_show'));if(manager()&&['completed','cancelled'].includes(item.status))buttons.push(button('Aktife geri al','undo_status'));if(item.status==='confirmed'||manager())buttons.push(button('Düzenle','edit'));if(item.status==='confirmed')buttons.push(button('İptal','cancel','danger'));el.querySelector('#smartPanelActions').innerHTML=buttons.join('');el.querySelectorAll('[data-action]').forEach(function(node){node.onclick=function(){run(node.dataset.action,item)}});el.classList.add('show')}
  async function run(key,item){if(busy||!owned(item))return;if(key==='edit'||key==='cancel'){close();if(!appts.some(function(row){return String(row.id)===String(item.id)}))appts.push(item);if(key==='edit')openAppointmentModal('',item.id);else requestAppointmentDeletion(item.id);return}if(key==='no_show'||key==='undo_no_show'){close();return key==='no_show'?window.SalonNoShow?.mark(item):window.SalonNoShow?.undo(item)}if(key==='complete'&&!confirm(item.customer+' randevusu Tamamlandı olarak işaretlensin mi?'))return;if(key==='undo_status'&&!confirm(item.customer+' randevusu Aktif durumuna geri alınsın mı?'))return;busy=true;try{var result;if(key==='complete')result=await salonDb.rpc('complete_appointment',{p_appointment_id:item.id});else if(key==='undo_status'&&manager())result=await salonDb.from('appointments').update({status:'confirmed'}).eq('id',item.id).select('id,status').single();else return;if(result.error)throw result.error;close();invalidate();await reloadRemoteData();showAppToast('Randevu güncellendi','Durum güncellendi.')}catch(error){showAppToast('İşlem tamamlanamadı',error.message||'Tekrar deneyin.')}finally{busy=false}}
  window.SalonCalendarUI={filtered:filtered,cancelledFor:cancelledFor,invalidate:invalidate,open:open,filters:filters};
  window.salonEnhanceTeamCalendar=function(){var target=document.getElementById('calendarContent');if(!target||!user())return;controls();if(window.salonCalendarLoadState?.status==='ready')week(target);simplify(target);decorate(target);bind(target)};
  window.appointmentClick=function(id){open(id)};
  window.reloadRemoteData=async function(){invalidate();return baseReload.apply(this,arguments)};
  window.renderCalendar=function(){var result=baseRender.apply(this,arguments);window.salonEnhanceTeamCalendar();return result};
})();
