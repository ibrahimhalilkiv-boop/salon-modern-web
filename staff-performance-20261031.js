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

function install(){
  var drawer=document.querySelector('#drawerLayer .drawer');
  if(drawer&&!document.getElementById('drawerStaffPerformance')){
    var button=document.createElement('button');
    button.id='drawerStaffPerformance';
    button.className='menu-item';
    button.type='button';
    button.textContent='▥  Çalışan Performansı';
    button.onclick=open;
    var stats=drawer.querySelector('[onclick="drawerPage(\'statistics\')"]');
    if(stats)stats.insertAdjacentElement('afterend',button);
    else drawer.appendChild(button);
  }
  if(document.getElementById('staffPerformance'))return;
  var page=document.createElement('section');
  page.id='staffPerformance';
  page.className='page';
  page.innerHTML='<div class="content"><button type="button" class="back" id="staffPerformanceBack">‹ Ana sayfa</button>'+
    '<h1 class="page-title">Çalışan Performansı</h1>'+
    '<p class="hint">Yalnızca tamamlanmış randevular hesaplanır. İptal edilen, gelmeyen ve henüz gerçekleşmemiş randevular dahil edilmez.</p>'+
    '<div class="finance230-card"><div class="row">'+
    '<label class="field">Başlangıç<input id="performanceStart" type="date"></label>'+
    '<label class="field">Bitiş<input id="performanceEnd" type="date"></label></div>'+
    '<button type="button" class="save" id="performanceRefresh">Performansı göster</button></div>'+
    '<div id="performanceResult" role="status" aria-live="polite"></div></div>';
  var app=document.getElementById('app'),nav=app&&app.querySelector(':scope > .nav');
  if(!app)return;
  if(nav)app.insertBefore(page,nav);else app.appendChild(page);
  document.getElementById('staffPerformanceBack').onclick=function(){window.showPage('home')};
  document.getElementById('performanceRefresh').onclick=load;
  var date=currentDate();document.getElementById('performanceStart').value=date.slice(0,7)+'-01';
  document.getElementById('performanceEnd').value=date;
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
  document.getElementById('performanceEnd').value=currentDate();
  document.getElementById('performanceStart').value=currentDate().slice(0,7)+'-01';
  window.scrollTo(0,0);
  reset();
  await load();
}

async function load(){
  if(!user())return;
  var holder=document.getElementById('performanceResult');
  var start=document.getElementById('performanceStart').value,
      end=document.getElementById('performanceEnd').value,
      button=document.getElementById('performanceRefresh');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start){
    holder.textContent='Tarih aralığını kontrol edin.';return;
  }
  var days=(Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000;
  if(days>366){holder.textContent='En fazla 367 günlük tarih aralığı seçilebilir.';return}
  var serial=++requestSerial,actor=user().id;
  report=null;selectedWorker='all';holder.innerHTML='<div class="security">Performans hesaplanıyor…</div>';
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
  var controls=canSeeAll?'<div class="finance230-card"><label class="field">Çalışan seçimi<select id="performanceWorker">'+
      '<option value="all">Tüm çalışanlar</option>'+
      people.map(function(r){return '<option value="'+escapeText(r.id)+'"'+(r.id===selectedWorker?' selected':'')+'>'+escapeText(r.name)+'</option>'}).join('')+
      '</select></label></div>':'<div class="security">Yalnızca kendi performansınız gösteriliyor.</div>';
  var cards='<div class="stats-grid">'+
    '<div class="stat-box"><small>Tamamlanan işlem</small><strong>'+sum.completed_count+'</strong></div>'+
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
  holder.innerHTML=controls+cards+detail;
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
