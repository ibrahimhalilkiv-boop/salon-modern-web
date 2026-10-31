const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const phase=fs.readFileSync('salon-phase2-1.8.0.js','utf8');
const scoped=fs.readFileSync('staff-performance-20261031.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261031233000_staff_performance_verified_overview.sql','utf8');
const html=fs.readFileSync('salon-modern.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');

assert.match(sql,/staff_performance_overview\(\)/);
assert.match(sql,/a\.status\s*=\s*'completed'/);
assert.match(sql,/a\.scheduled_at\s*<=\s*now\(\)/);
assert.match(sql,/SECURITY INVOKER|SET search_path/);
assert.match(sql,/p\.id=v_actor|p\.id = v_actor/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.staff_performance_overview\(\)/);
assert.match(sql,/booking_settings/);
assert.match(sql,/booking_schedule_overrides/);
assert.doesNotMatch(sql,/elapsedDays\*16\*60/);

assert.match(phase,/rpc\('staff_performance_overview'/);
assert.match(phase,/Toplam tamamlanan/);
assert.match(phase,/Tüm zamanlar/);
assert.match(phase,/Aylık gerçekleşen ciro/);
assert.match(phase,/ay içindeki açık saatleri/);
assert.match(phase,/openSalonStaffPerformance\(\)/);
assert.match(phase,/drawerEmployeePerformance'\)\?\.classList\.remove\('hidden','manager-menu'\)/);
assert.match(scoped,/button\.classList\.remove\('manager-menu','hidden'\)/);
assert.match(scoped,/showPage\('employeePerformance'\)/);
assert.match(scoped,/else open\(\)/);
assert.match(html,/salon-phase2-1\.8\.0\.js\?v=183/);
assert.match(html,/staff-performance-20261031\.js\?v=4/);
assert.match(sw,/salon-modern-shell-pwa-v192/);
assert.match(sw,/staff-performance-20261031\.js\?v=4/);
assert.match(sw,/salon-phase2-1\.8\.0\.js\?v=183/);

const start=phase.indexOf('var phase2PerformanceRequest=0;');
const end=phase.indexOf('function phase2AuditText(',start);
assert.ok(start>=0 && end>start,'The server-backed overview renderer must exist');
const node={innerHTML:''};
const mock={
  document:{getElementById:id=>id==='employeePerformanceContent'?node:null},
  phase2IsManager:()=>true,
  currentUser:{id:'manager-1',role:'yonetici'},
  remoteProfiles:[],
  phase2PerformanceOrder:()=>10,
  phase2Money:n=>'₺ '+Number(n||0).toLocaleString('tr-TR'),
  safe:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  Intl,Date,
  salonDb:{rpc(name){
    assert.equal(name,'staff_performance_overview');
    return Promise.resolve({data:{
      is_manager:true,month:'2026-10',
      employees:[{
        id:'halil-id',name:'Halil Kıv',role:'manager',
        today_count:11,week_count:48,month_count:192,lifetime_count:506,
        today_amount:6950,week_amount:31150,month_amount:126150,
        customers_lifetime:177,repeat_pct:69,occupancy_pct:28,
        busiest_hour_month:'18:00'
      }]
    }});
  }}
};
vm.runInNewContext(phase.slice(start,end),mock);
(async()=>{
  await mock.phase2RenderEmployeePerformance();
  const output=node.innerHTML;
  assert.match(output,/11<\/strong><span>Bugün tamamlanan/);
  assert.match(output,/48<\/strong><span>Bu hafta tamamlanan/);
  assert.match(output,/192<\/strong><span>Bu ay tamamlanan/);
  assert.match(output,/506<\/strong><span>Toplam tamamlanan/);
  assert.match(output,/177<\/strong><span>Müşteri/);
  assert.match(output,/69%<\/strong><span>Tekrar oranı/);
  assert.match(output,/28%<\/strong><span>Doluluk/);
  assert.match(output,/126\.150<\/strong><span>Aylık gerçekleşen ciro/);
  assert.match(output,/Ay seçerek ayrıntılı raporu aç/);
  assert.doesNotMatch(output,/Henüz tamamlanmamış/);

  mock.salonDb.rpc=()=>Promise.resolve({error:{message:'BACKEND ERROR'}});
  await mock.phase2RenderEmployeePerformance();
  assert.match(node.innerHTML,/BACKEND ERROR/);
  assert.doesNotMatch(node.innerHTML,/126\.150/,'Stale values must not survive failed fresh fetch');
  console.log('PASS live-source overview rendering, all 8 metrics, month/lifetime labels, occupancy, error state and secure menu wiring');
})().catch(error=>{console.error(error);process.exitCode=1});
