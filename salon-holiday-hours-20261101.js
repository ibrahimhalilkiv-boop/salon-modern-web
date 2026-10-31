(function(){
'use strict';

// One-time holiday/peak-season schedule overrides. These never change
// the normal opening hours or create appointment/financial transactions.
var saving=false;
function isManager(){return typeof currentUser!=='undefined'&&currentUser&&currentUser.role==='yonetici'}
function dayInIstanbul(){
  var parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date()),values={};
  parts.forEach(function(part){values[part.type]=part.value});
  return values.year+'-'+values.month+'-'+values.day;
}
function datesBetween(start,end){
  if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(start||'')||
     !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(end||'')){
    throw new Error('Başlangıç ve bitiş tarihlerini seçin.');
  }
  var a=new Date(start+'T12:00:00Z'),b=new Date(end+'T12:00:00Z');
  if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||
     a.toISOString().slice(0,10)!==start||b.toISOString().slice(0,10)!==end){
    throw new Error('Geçerli tarih seçin.');
  }
  var count=Math.round((b.getTime()-a.getTime())/86400000)+1;
  if(count<1)throw new Error('Bitiş tarihi başlangıçtan önce olamaz.');
  if(count>31)throw new Error('Bir işlemde en fazla 31 gün ayarlanabilir.');
  var dates=[];
  for(var i=0;i<count;i++){
    var day=new Date(a.getTime()+i*86400000);
    dates.push(day.toISOString().slice(0,10));
  }
  return dates;
}
function validHour(value){
  return /^([01]\d|2[0-3]):(00|30)$/.test(String(value||''));
}
function showResult(message,isError){
  var target=document.getElementById('holidayRangeResult');
  if(target){target.textContent=message;target.style.color=isError?'var(--red, #9e3c36)':'var(--green, #246c55)'}
  if(typeof window.showAppToast==='function')
    window.showAppToast(isError?'Özel çalışma saatleri kaydedilemedi':'Özel çalışma saatleri',message);
}
function render(){
  if(!isManager()||!window.salonDb)return;
  var host=document.getElementById('adminControls');
  if(!host||document.getElementById('holidayHoursRangeCard'))return;
  var card=document.createElement('section');
  card.id='holidayHoursRangeCard';
  card.className='holiday-hours-range-card';
  card.innerHTML=
    '<div class="section"><h2>Bayram Öncesi / Özel Çalışma Saatleri</h2><span class="role">YÖNETİM</span></div>'+
    '<p class="hint">Seçtiğiniz 4–5 günün çalışma saatlerini birlikte uzatabilirsiniz. Diğer günler normal saatlerinde kalır. Süre bitince özel ayar otomatik sona erer.</p>'+
    '<form id="holidayHoursRangeForm">'+
      '<div class="holiday-range-grid">'+
        '<label class="field">Başlangıç tarihi<input id="holidayRangeStart" type="date" required></label>'+
        '<label class="field">Bitiş tarihi<input id="holidayRangeEnd" type="date" required></label>'+
        '<label class="field">Açılış<input id="holidayRangeOpen" type="time" step="1800" required value="09:00"></label>'+
        '<label class="field">Kapanış<input id="holidayRangeClose" type="time" step="1800" required value="22:00"></label>'+
      '</div>'+
      '<small class="hint">Saatler seçilen günlerde online randevu uygunluğunu ve performans doluluk hesabını değiştirir. Takvimdeki mevcut randevular korunur. Aralıkta pazar varsa o gün de açılır.</small>'+
      '<button type="submit" class="save" id="holidayRangeSave">Seçilen günlere uygula</button>'+
      '<button type="button" class="back" id="holidayRangeReset">Bu günlerde özel saatleri kaldır</button>'+
      '<p id="holidayRangeResult" role="status" aria-live="polite"></p>'+
    '</form>';
  host.insertBefore(card,host.firstChild);
  var today=dayInIstanbul();
  document.getElementById('holidayRangeStart').value=today;
  document.getElementById('holidayRangeEnd').value=today;
  document.getElementById('holidayHoursRangeForm').onsubmit=save;
  document.getElementById('holidayRangeReset').onclick=removeRange;
  // Use current configured opening time; default close 2h later is a suggestion,
  // not a saved change. The manager can always choose a different half-hour.
  salonDb.from('booking_settings')
    .select('default_open_time,default_close_time').eq('id',true).maybeSingle()
    .then(function(res){
      if(res.error||!res.data||!document.getElementById('holidayRangeOpen'))return;
      var start=String(res.data.default_open_time||'09:00').slice(0,5);
      var end=String(res.data.default_close_time||'20:00').slice(0,5);
      var startEl=document.getElementById('holidayRangeOpen');
      var endEl=document.getElementById('holidayRangeClose');
      if(startEl&&!startEl.dataset.edited)startEl.value=start;
      if(endEl&&!endEl.dataset.edited){
        var parts=end.split(':').map(Number),minutes=parts[0]*60+parts[1]+120;
        endEl.value=minutes<=1410?String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'):end;
      }
    }).catch(function(){});
  ['holidayRangeOpen','holidayRangeClose'].forEach(function(id){
    document.getElementById(id).addEventListener('input',function(){this.dataset.edited='1'});
  });
}
function formValues(){
  var dates=datesBetween(
    document.getElementById('holidayRangeStart').value,
    document.getElementById('holidayRangeEnd').value
  );
  var open=document.getElementById('holidayRangeOpen').value;
  var close=document.getElementById('holidayRangeClose').value;
  if(!validHour(open)||!validHour(close)||close<=open)
    throw new Error('Açılış ve kapanışı tam veya yarım saat olarak seçin; kapanış daha geç olmalı.');
  return {dates:dates,open:open,close:close};
}
async function save(event){
  event.preventDefault();
  if(!isManager()||saving)return;
  var button=document.getElementById('holidayRangeSave');
  try{
    var value=formValues();
    saving=true;
    button.disabled=true;
    button.textContent='Kaydediliyor…';
    var old=await salonDb.from('booking_schedule_overrides')
      .select('schedule_date,open_time,close_time,is_closed').in('schedule_date',value.dates);
    if(old.error)throw old.error;
    var conflicts=(old.data||[]).filter(function(row){
      return row.is_closed || String(row.open_time||'').slice(0,5)!==value.open ||
        String(row.close_time||'').slice(0,5)!==value.close;
    });
    if(conflicts.length && !window.confirm(
      conflicts.length+' gün için önceden özel saat girilmiş. Seçilen saatlerle değiştirilsin mi?'))return;
    var rows=value.dates.map(function(date){
      return {schedule_date:date,open_time:value.open,close_time:value.close,
        is_closed:false,updated_by:currentUser.id,updated_at:new Date().toISOString()};
    });
    var result=await salonDb.from('booking_schedule_overrides')
      .upsert(rows,{onConflict:'schedule_date'})
      .select('schedule_date,open_time,close_time,is_closed');
    if(result.error)throw result.error;
    if(!result.data||result.data.length!==rows.length)
      throw new Error('Özel saatlerin tamamı doğrulanamadı. Kayıtları kontrol edin.');
    showResult(value.dates.length+' gün kaydedildi: '+value.open+'–'+value.close+
      '. Diğer günlerin normal saatleri değişmedi.',false);
    if(typeof window.renderCalendar==='function')window.renderCalendar();
  }catch(error){showResult(error.message||'Saatler kaydedilemedi.',true)}
  finally{saving=false;if(button){button.disabled=false;button.textContent='Seçilen günlere uygula'}}
}
async function removeRange(){
  if(!isManager()||saving)return;
  var button=document.getElementById('holidayRangeReset');
  try{
    var dates=datesBetween(document.getElementById('holidayRangeStart').value,
      document.getElementById('holidayRangeEnd').value);
    if(!window.confirm(dates.length+' günün özel çalışma saati kaldırılsın mı? Bu günler normal çalışma düzenine döner.'))return;
    saving=true;
    button.disabled=true;
    button.textContent='Kaldırılıyor…';
    var result=await salonDb.from('booking_schedule_overrides')
      .delete().in('schedule_date',dates);
    if(result.error)throw result.error;
    showResult(dates.length+' günün özel saat ayarı kaldırıldı; normal saatler geçerli.',false);
    if(typeof window.renderCalendar==='function')window.renderCalendar();
  }catch(error){showResult(error.message||'Saatler kaldırılamadı.',true)}
  finally{saving=false;if(button){button.disabled=false;button.textContent='Bu günlerde özel saatleri kaldır'}}
}
var prevShow=window.showPage;
if(typeof prevShow==='function')window.showPage=function(id){
  var result=prevShow.apply(this,arguments);
  if(id==='admin')render();
  return result;
};
var prevEnter=window.enterApp;
if(typeof prevEnter==='function')window.enterApp=function(){
  var result=prevEnter.apply(this,arguments);
  if(isManager())render();
  return result;
};
var style=document.createElement('style');
style.textContent='.holiday-hours-range-card{padding:15px;border:1px solid var(--line);background:var(--paper,#fff);border-radius:16px;margin:0 0 20px}.holiday-hours-range-card .section{margin-bottom:5px}.holiday-hours-range-card .hint{display:block;color:var(--muted);line-height:1.45;margin:7px 0 12px}.holiday-range-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.holiday-hours-range-card .field{min-width:0}.holiday-hours-range-card .field input{width:100%;min-width:0}.holiday-hours-range-card .save,.holiday-hours-range-card .back{width:100%;margin-top:10px}';
document.head.appendChild(style);
if(isManager())render();
})();
