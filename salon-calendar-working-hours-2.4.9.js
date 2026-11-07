(function(){
'use strict';
// Keep manager and employee calendars on the same date-specific working-hour range.
// This changes only the visible grid, not appointment validation or permissions.
var normal={default_open_time:'09:00',default_close_time:'19:00'};
var dayOverride=null,overrideDate='',lastFetch=0,requestId=0,inFlight=false;
var FIRST=8*60,LAST=24*60;

function actor(){return typeof currentUser==='undefined'?null:currentUser}
function selectedDate(){return typeof selectedTeamDate==='function'?selectedTeamDate():''}
function minute(value){
  var match=String(value||'').match(/^(\d{1,2}):(\d{2})/);
  if(!match)return NaN;
  var result=Number(match[1])*60+Number(match[2]);
  return Number(match[2])<60&&result>=0&&result<=LAST?result:NaN;
}
function formatMinute(value){return String(Math.floor(value/60)).padStart(2,'0')+'.'+String(value%60).padStart(2,'0')}
function relevantAppointments(date){
  var user=actor(),isManager=user&&user.role==='yonetici';
  return (typeof appts!=='undefined'&&Array.isArray(appts)?appts:[]).filter(function(item){
    if(!user||item.status==='cancelled'||typeof appointmentDate!=='function'||appointmentDate(item)!==date)return false;
    if(isManager)return !teamCalendarMember||item.staff===teamCalendarMember;
    return String(item.employeeId)===String(user.id)||item.staff===user.name;
  });
}
function rangeFor(date){
  var override=overrideDate===date?dayOverride:null;
  var start=minute(override&&!override.is_closed?override.open_time:normal.default_open_time);
  var end=minute(override&&!override.is_closed?override.close_time:normal.default_close_time);
  if(!Number.isFinite(start))start=9*60;
  if(!Number.isFinite(end))end=19*60;
  if(override&&override.is_closed)end=start+60;
  if(end<=start)end=start+60;
  relevantAppointments(date).forEach(function(item){
    var at=minute(item.time);
    if(!Number.isFinite(at))return;
    var duration=Math.max(15,Math.min(240,Number(item.duration||item.duration_minutes||30)));
    start=Math.min(start,at);
    end=Math.max(end,at+duration);
  });
  // Closed blocks are visible for both roles, including exceptional days.
  if(typeof remoteClosedSlots!=='undefined'&&Array.isArray(remoteClosedSlots)&&typeof toIstanbul==='function'){
    remoteClosedSlots.forEach(function(slot){
      var startPart=toIstanbul(slot.starts_at),endPart=toIstanbul(slot.ends_at);
      if(startPart.date!==date)return;
      var user=actor();
      if(user&&user.role!=='yonetici'&&String(slot.employee_id)!==String(user.id))return;
      if(user&&user.role==='yonetici'&&teamCalendarMember&&typeof profileForEmployeeName==='function'){
        var profile=profileForEmployeeName(teamCalendarMember);
        if(profile&&String(slot.employee_id)!==String(profile.id))return;
      }
      var blockStart=minute(startPart.time);
      var blockEnd=endPart.date===date?minute(endPart.time):LAST;
      if(Number.isFinite(blockStart))start=Math.min(start,blockStart);
      if(Number.isFinite(blockEnd))end=Math.max(end,blockEnd);
    });
  }
  start=Math.max(FIRST,Math.min(LAST-60,Math.floor(start/15)*15));
  end=Math.min(LAST,Math.max(start+60,Math.ceil(end/15)*15));
  return {start:start,end:end};
}
function apply(){
  if(!actor()||typeof teamCalendarMode!=='undefined'&&teamCalendarMode!=='day'&&teamCalendarMode!=null)return;
  var grid=document.querySelector('#calendarContent .duration-hour-grid');
  if(!grid)return;
  var range=rangeFor(selectedDate()),from=(range.start-FIRST)/15,to=(range.end-FIRST)/15;
  var slots=Math.max(1,to-from),before=Math.max(0,from),after=Math.max(0,64-to);
  var height=window.visualViewport&&window.visualViewport.height||window.innerHeight||750;
  var rowHeight=Math.max(11,Math.min(19,Math.floor((height-165)/slots)));
  var rows=['auto'];
  if(before)rows.push('repeat('+before+',0px)');
  rows.push('repeat('+slots+','+rowHeight+'px)');
  if(after)rows.push('repeat('+after+',0px)');
  rows.push('20px');
  grid.dataset.workingHours='1';
  grid.style.setProperty('grid-template-rows',rows.join(' '),'important');
  grid.style.setProperty('height','auto','important');
  grid.querySelectorAll('.duration-time:not(.duration-end)').forEach(function(node){
    var value=minute(node.textContent.replace('.',':'));
    node.style.display=Number.isFinite(value)&&value>=range.start&&value<range.end?'':'none';
  });
  grid.querySelectorAll('[data-calendar-time]').forEach(function(node){
    var value=minute(node.dataset.calendarTime);
    node.style.display=value>=range.start&&value<range.end?'':'none';
  });
  var end=grid.querySelector('.duration-end');
  if(end){end.textContent=formatMinute(range.end);end.setAttribute('aria-label','Çalışma aralığı sonu '+formatMinute(range.end))}
  grid.querySelectorAll('.current-time-line').forEach(function(node){node.remove()});
  var nowParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),parts={};
  nowParts.forEach(function(part){parts[part.type]=part.value});
  var today=parts.year+'-'+parts.month+'-'+parts.day,now=Number(parts.hour)*60+Number(parts.minute);
  if(selectedDate()===today&&now>=range.start&&now<range.end){
    var step=Math.floor((now-FIRST)/15),offset=((now-FIRST)%15)/15*rowHeight,line=document.createElement('div');
    line.className='current-time-line';
    line.setAttribute('aria-label','Şu an '+parts.hour+':'+parts.minute);
    line.style.cssText='grid-column:2 / -1;grid-row:'+(step+2)+';align-self:start;transform:translateY('+offset+'px);border-top:2px solid #d1594f;z-index:30;pointer-events:none';
    grid.appendChild(line);
  }
}
function refresh(){
  if(!actor()||!window.salonDb)return;
  var date=selectedDate(),now=Date.now();
  if(!date||inFlight||now-lastFetch<6000)return;
  lastFetch=now;inFlight=true;
  var id=++requestId,userId=String(actor().id);
  Promise.all([
    salonDb.from('booking_settings').select('default_open_time,default_close_time').eq('id',true).maybeSingle(),
    salonDb.from('booking_schedule_overrides').select('schedule_date,open_time,close_time,is_closed').eq('schedule_date',date).maybeSingle()
  ]).then(function(results){
    if(id!==requestId||!actor()||String(actor().id)!==userId)return;
    if(!results[0].error&&results[0].data)normal=results[0].data;
    if(!results[1].error){overrideDate=date;dayOverride=results[1].data||null}
    if(selectedDate()===date&&typeof window.renderCalendar==='function')window.renderCalendar();
  }).catch(function(error){console.warn('Takvim çalışma saatleri yüklenemedi:',error.message||error)})
    .finally(function(){inFlight=false});
}
var style=document.createElement('style');
style.textContent='#calendar .team-calendar.duration-hour-grid.single[data-working-hours="1"]{min-width:0!important;width:100%!important}'+
  '#calendar .team-calendar.duration-hour-grid[data-working-hours="1"]>.duration-end,'+
  '#calendar .team-calendar.duration-hour-grid[data-working-hours="1"]>.duration-end-cell{min-height:20px!important;height:20px!important}';
document.head.appendChild(style);
var previousRender=window.renderCalendar;
if(typeof previousRender==='function')window.renderCalendar=function(){
  var result=previousRender.apply(this,arguments);
  apply();refresh();
  return result;
};
window.addEventListener('resize',apply);
window.visualViewport&&window.visualViewport.addEventListener('resize',apply);
document.addEventListener('visibilitychange',function(){if(!document.hidden){lastFetch=0;refresh();apply()}});
})();
