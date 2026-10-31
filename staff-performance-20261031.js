(function(){
'use strict';
// Authenticated report: RLS and staff_performance_report also enforce user scope.
var report=null,requestSerial=0,selectedWorker='all';

function user(){return typeof currentUser!=='undefined'&&currentUser||null}
function manager(){return !!(user()&&user().role==='yonetici')}
function fmt(value){return new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(value||0))}
function escapeText(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})}
function currentDate(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul'}).format(new Date())}
function summary(rows){return rows.reduce(function(t,r){t.completed_count+=Number(r.completed_count||0);t.revenue+=Number(r.revenue||0);t.commission+=Number(r.commission||0);return t},{completed_count:0,revenue:0,commission:0})}

// The report is always a calendar month in the salon's local timezone.
// Current month ends today; past months include all their days.
function monthBounds(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Geçerli bir ay seçin.');
  var today=currentDate(),currentMonth=today.slice(0,7);
  if(month>currentMonth)throw new Error('İleri tarihli ayın performansı henüz oluşmadı.');
  var endDay=new Date(month+'-01T12:00:00Z');
  endDay.setUTCMonth(endDay.getUTCMonth()+1);
  endDay.setUTCDate(0);
  var last=endDay.toISOString().slice(0,10);
  return {start:month+'-01',end:month===currentMonth?today:last};
}
function shiftMonthValue(month,offset){
  var day=new Date(month+'-01T12:00:00Z');
  if(!Number.isFinite(day.getTime()))throw new Error('Ay seçimi geçersiz.');
  day.setUTCMonth(day.getUTCMonth()+offset);
  return day.toISOString().slice(0,7);
}
function monthLabel(month){
  var label=new Intl.DateTimeFormat('tr-TR',{month:'long',year:'numeric',timeZone:'UTC'})
    .format(new Date(month+'-01T12:00:00Z'));
  return label.charAt(0).toLocaleUpperCase('tr-TR')+label.slice(1);
}
function refreshMonthNavigation(){
  var monthInput=document.getElementById('performanceMonth');
  if(!monthInput)return;
  var thisMonth=currentDate().slice(0,7);
  monthInput.max=thisMonth;
  if(monthInput.value>thisMonth)monthInput.value=thisMonth;
  var next=document.getElementById('performanceNextMonth');
  if(next)next.disabled=!monthInput.value||monthInput.value>=thisMonth;
}
function changeMonth(offset){
  var input=document.getElementById('performanceMonth');
  if(!input)return;
  var candidate=shiftMonthValue(input.value||currentDate().slice(0,7),offset);
  if(candidate>currentDate().slice(0,7))return;
  input.value=candidate;
  refreshMonthNavigation();
  load();
}

function install(){
  var drawer=document.querySelector('#drawerLayer .drawer');
  if(drawer){
    var button=document.getElementById('drawerEmployeePerformance');
    if(!button){
      button=document.createElement('button');
      button.id='drawerEmployeePerformance';
      button.className='menu-item';
      button.type='button';
      button.textContent='▥  Çalışan Performansı';
      var stats=drawer.querySelector('[onclick*="statistics"]');
      if(stats)stats.insertAdjacentElement('afterend',button);
      else drawer.appendChild(button);
    }
    // Employees see only their own secure monthly report.
    // Managers keep the full-team overview and its monthly-details link.
    button.classList.remove('manager-menu','hidden');
    button.onclick=function(){
      if(manager() && typeof window.showPage==='function'){
        if(typeof window.closeDrawer==='function')window.closeDrawer();
        window.showPage('employeePerformance');
      }else open();
    };
  }
  if(document.getElementById('staffPerformance'))return;
  var page=document.createElement('section');
  page.id='staffPerformance';
  page.className='page';
  page.innerHTML='<div class="content"><button type="button" class="back" id="staffPerformanceBack">‹ Ana sayfa</button>'+
    '<h1 class="page-title">Çalışan Performansı</h1>'+
    '<p class="hint">Yalnızca tamamlanmış randevular hesaplanır. İptal edilen, gelmeyen ve henüz gerçekleşmemiş randevular dahil edilmez.</p>'+
    '<div class="finance230-card"><label class="field">Performans ayı<input id="performanceMonth" type="month" aria-label="Performans ayını seçin"></label>'+
    '<div class="row"><button type="button" class="back" id="performancePrevMonth">‹ Önceki ay</button>'+
    '<button type="button" class="back" id="performanceNextMonth">Sonraki ay ›</button></div>'+
    '<button type="button" class="save" id="performanceRefresh">Seçilen ayı göster</button></div>'+
    '<div id="performanceResult" role="status" aria-live="polite"></div></div>';
  var app=document.getElementById('app'),nav=app&&app.querySelector(':scope > .nav');
  if(!app)return;
  if(nav)app.insertBefore(page,nav);else app.appendChild(page);
  document.getElementById('staffPerformanceBack').onclick=function(){window.showPage('home')};
  document.getElementById('performanceRefresh').onclick=load;
  document.getElementById('performancePrevMonth').onclick=function(){changeMonth(-1)};
  document.getElementById('performanceNextMonth').onclick=function(){changeMonth(1)};
  document.getElementById('performanceMonth').onchange=function(){refreshMonthNavigation();load()};
  document.getElementById('performanceMonth').value=currentDate().slice(0,7);
  refreshMonthNavigation();
}

function reset(){
  report=null;selectedWorker='all';requestSerial++;
  var holder=document.getElementById('performanceResult');
  if(holder)holder.textContent='';
}

async function open(){
  if(!user())return;
  install();
  if(typeof window.closeDrawer==='function')window.closeDrawer();
  // This report reads its own secure RPC, not the paginated calendar history.
  document.querySelectorAll('#app .page').forEach(function(p){p.classList.remove('active')});
  document.getElementById('staffPerformance').classList.add('active');
  document.getElementById('performanceMonth').value=currentDate().slice(0,7);
  refreshMonthNavigation();
  window.scrollTo(0,0);
  reset();
  await load();
}

async function load(){
  if(!user())return;
  var holder=document.getElementById('performanceResult');
  var button=document.getElementById('performanceRefresh');
  var serial=++requestSerial,actor=user().id,month=document.getElementById('performanceMonth').value;
  refreshMonthNavigation();
  var period;
  try{period=monthBounds(month)}
  catch(error){
    report=null;
    holder.textContent=error.message||'Performans ayını kontrol edin.';
    button.disabled=false;
    return;
  }
  var start=period.start,end=period.end;
  report=null;holder.innerHTML='<div class="security">Performans hesaplanıyor…</div>';
  button.disabled=true;
  try{
    var response=await salonDb.rpc('staff_performance_report',{
      p_start:start,p_end:end,p_employee_id:null
    });
    if(response.error)throw response.error;
    if(serial!==requestSerial||user()?.id!==actor)return;
    if(!response.data||!Array.isArray(response.data.employees))
      throw new Error('Performans yanıtı geçersiz.');
    // The server is authoritative: non-managers are always limited to their id.
    if(!manager()&&(response.data.is_manager!==false||
      response.data.employees.some(function(row){return row.id!==actor})))
      throw new Error('Performans erişim denetimi başarısız.');
    report=response.data;
    render();
  }catch(err){
    if(serial===requestSerial&&user()?.id===actor)
      holder.innerHTML='<div class="security">'+escapeText(err.message||'Performans alınamadı.')+'</div>';
  }finally{
    if(serial===requestSerial)button.disabled=false;
  }
}

function render(){
  var holder=document.getElementById('performanceResult');
  if(!holder||!report||!user())return;
  var canSeeAll=manager()&&report.is_manager===true;
  var people=report.employees||[];
  var available=people.some(function(r){return String(r.id)===String(selectedWorker)});
  if(!available)selectedWorker='all';
  var shown=canSeeAll&&selectedWorker!=='all'?
    people.filter(function(r){return String(r.id)===String(selectedWorker)}):people;
  var sum=summary(shown);
  var average=sum.completed_count?sum.revenue/sum.completed_count:0;
  var label=monthLabel(String(report.start_date).slice(0,7));
  var periodHeading='<div class="section"><h2>'+escapeText(label)+' performansı</h2><small>'+escapeText(report.start_date)+' – '+escapeText(report.end_date)+'</small></div>';
  var controls=canSeeAll?'<div class="finance230-card"><label class="field">Çalışan seçimi<select id="performanceWorker">'+
      '<option value="all">Tüm çalışanlar</option>'+
      people.map(function(r){return '<option value="'+escapeText(r.id)+'"'+(r.id===selectedWorker?' selected':'')+'>'+escapeText(r.name)+'</option>'}).join('')+
      '</select></label></div>':'<div class="security">Yalnızca kendi performansınız gösteriliyor.</div>';
  var cards='<div class="stats-grid">'+
    '<div class="stat-box"><small>'+escapeText(label)+' tamamlanan</small><strong>'+sum.completed_count+'</strong></div>'+
    '<div class="stat-box"><small>Gerçekleşen ciro</small><strong>'+fmt(sum.revenue)+'</strong></div>'+
    '<div class="stat-box"><small>Hesaplanan prim</small><strong>'+fmt(sum.commission)+'</strong></div>'+
    '<div class="stat-box"><small>İşlem başına ortalama</small><strong>'+fmt(average)+'</strong></div></div>';
  var detail='<div class="finance230-card"><div class="section"><h2>'+(
    canSeeAll?'Çalışan bazında performans':'Kendi performansım')+'</h2></div>'+
    (shown.map(function(r){return '<div class="finance230-ledger">'+
      '<div><span>Çalışan</span><strong>'+escapeText(r.name)+'</strong></div>'+
      '<div><span>Tamamlanan randevu</span><strong>'+Number(r.completed_count||0)+'</strong></div>'+
      '<div><span>Gerçekleşen ciro</span><strong>'+fmt(r.revenue)+'</strong></div>'+
      '<div><span>Prim oranı</span><strong>% '+Number(r.commission_pct||0).toLocaleString('tr-TR')+'</strong></div>'+
      '<div><span>Hesaplanan prim</span><strong>'+fmt(r.commission)+'</strong></div>'+
      '</div>'}).join('<hr>')||'<div class="empty">Bu tarih aralığında çalışan kaydı yok.</div>')+
    '</div>';
  holder.innerHTML=periodHeading+controls+cards+detail;
  var selector=document.getElementById('performanceWorker');
  if(selector)selector.onchange=function(){selectedWorker=this.value;render()};
}

install();
var priorEnter=window.enterApp;
if(typeof priorEnter==='function')window.enterApp=function(){reset();return priorEnter.apply(this,arguments)};
var priorLogout=window.logout;
if(typeof priorLogout==='function')window.logout=function(){reset();return priorLogout.apply(this,arguments)};
window.openSalonStaffPerformance=open;
window.SalonStaffPerformance={open:open,reset:reset};
})();
