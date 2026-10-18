type Db = any;
type Actor = { id: string; role: string; full_name: string; commission_pct: number };
type Step = { tool: string; args?: Record<string, unknown> };
type CallModel = (messages: { role: 'user' | 'assistant'; content: string }[], instruction: string, json?: boolean) => Promise<string>;
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const day = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
const clean = (v: unknown, max = 100) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const money = (v: number) => `${v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL`;
const stamp = (v: string) => new Date(v).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' });
const next = (d: string, n = 1) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const range = (start: string, end: string) => ({ from: `${start}T00:00:00+03:00`, to: `${next(end)}T00:00:00+03:00` });
const fail = (text: string): never => { throw new Error(text); };
const writeKinds = new Set(['appointment_create','appointment_move','undo_move','appointment_cancel','client_create','client_update','expense_create','debt_payment','commission_update','service_price_update']);
const readKinds = new Set(['daily_summary','alerts','proactive_alerts','daily_digest','availability','calendar','client_search','client_history','finance','debts','debt_search','staff_metrics','services','navigate','report']);
const allowedPages = new Set(['home','calendar','appointments','customers','finance','debts','team','admin','statistics','employeePerformance','recoveryCenter']);

async function unique(db: Db, table: string, name: unknown, columns = 'id,name') {
  const label = clean(name);
  if (!label) fail('Ad belirtin.');
  const column = table === 'clients' || table === 'profiles' ? (table === 'clients' ? 'full_name' : 'full_name') : 'name';
  let q = db.from(table).select(columns).ilike(column, `%${label.replace(/[%_]/g, '')}%`).limit(10);
  if (table !== 'services') q = q.eq('active', true);
  const { data, error } = await q;
  if (error) fail('Kayıt aranamadı.');
  const exact = (data || []).filter((x: any) => String(x[column]).toLocaleLowerCase('tr') === label.toLocaleLowerCase('tr'));
  const matches = exact.length ? exact : data || [];
  if (!matches.length) fail(`${label} bulunamadı.`);
  if (matches.length > 1) fail(`${label} için birden fazla kayıt var; tam adı belirtin.`);
  return matches[0];
}
async function employee(db: Db, who: unknown, actor: Actor) {
  if (!who || clean(who).toLocaleLowerCase('tr') === 'ben') {
    const { data } = await db.from('profiles').select('id,full_name,role,commission_pct,active').eq('id', actor.id).single();
    if (!data?.active) fail('Çalışan hesabı etkin değil.');
    return data;
  }
  return unique(db, 'profiles', who, 'id,full_name,role,commission_pct,active');
}
async function service(db: Db, who: unknown) {
  const label=clean(who).toLocaleLowerCase('tr').replace(/[+,]/g,' ').replace(/\s+/g,' ').trim();
  const s = await unique(db, 'services', label==='saç sakal'?'Saç sakal kesim':who, 'id,name,price,duration_minutes,active');
  if (!s.active) fail('Hizmet pasif.');
  return s;
}
async function appointment(db: Db, args: Record<string, unknown>, actor: Actor) {
  if (uuid(args.appointment_id)) {
    const { data } = await db.from('appointments').select('id,client_name,employee_id,scheduled_at,duration_minutes,service_name,status,source').eq('id', args.appointment_id).maybeSingle();
    if (!data || data.status === 'cancelled' || actor.role !== 'manager' && data.employee_id !== actor.id) fail('Randevu bulunamadı veya erişim yok.');
    return data;
  }
  const name = clean(args.client_name);
  const d = date(args.date);
  if (!name || !d) fail('Randevuyu belirlemek için müşteri adı ve tarihi belirtin.');
  const r = range(d!, d!);
  let q = db.from('appointments').select('id,client_name,employee_id,scheduled_at,duration_minutes,service_name,status,source').gte('scheduled_at',r.from).lt('scheduled_at',r.to).neq('status','cancelled').ilike('client_name',`%${name.replace(/[%_]/g,'')}%`).limit(10);
  if (actor.role !== 'manager') q = q.eq('employee_id',actor.id);
  const { data, error } = await q;
  if (error || !data?.length) fail('Randevu bulunamadı.');
  if (data.length > 1) fail('Bu müşteri için birden fazla randevu var; saati belirtin.');
  return data[0];
}
function period(args: Record<string, unknown>) {
  const now = day();
  let from = date(args.start_date), to = date(args.end_date);
  const kind = clean(args.period).toLowerCase();
  if (kind === 'week' || kind === 'hafta') {
    const dow = (new Date(`${now}T12:00:00Z`).getUTCDay() + 6) % 7;
    from = next(now, -dow); to = next(from, 6);
  } else if (kind === 'month' || kind === 'ay') {
    from = now.slice(0, 7) + '-01'; to = next(next(from, 32).slice(0, 7) + '-01', -1);
  } else if (kind === 'day' || kind === 'today' || kind === 'bugün') {
    from = now; to = now;
  } else if (!from || !to) { from = now; to = now; }
  if (from > to || Date.parse(to) - Date.parse(from) > 93 * 86400000) fail('Tarih aralığı en çok 93 gün olabilir.');
  return { start:from, end:to, ...range(from, to) };
}
async function availability(db: Db, args: Record<string, unknown>, actor: Actor, duration = 30) {
  const d = date(args.date) || day();
  const staff = await employee(db,args.employee,actor);
  if (actor.role !== 'manager' && staff.id !== actor.id) fail('Yalnız kendi uygunluğunuzu görebilirsiniz.');
  const r = range(d,d);
  const [booked, closed] = await Promise.all([
    db.from('appointments').select('scheduled_at,scheduled_end,duration_minutes').eq('employee_id',staff.id).neq('status','cancelled').lt('scheduled_at',r.to).gte('scheduled_at',`${next(d,-1)}T00:00:00+03:00`).limit(300),
    db.from('closed_time_slots').select('starts_at,ends_at').eq('employee_id',staff.id).lt('starts_at',r.to).gte('ends_at',r.from).limit(100)
  ]);
  if (booked.error || closed.error) fail('Uygun saatler alınamadı.');
  const slots: string[] = [];
  for (let mins=8*60; mins<=23*60+30; mins+=30) {
    const time = `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
    const start = Date.parse(`${d}T${time}:00+03:00`), end = start+duration*60000;
    if (start < Date.now()) continue;
    if ((booked.data||[]).some((a:any)=>Date.parse(a.scheduled_at)<end && Date.parse(a.scheduled_end || new Date(Date.parse(a.scheduled_at)+a.duration_minutes*60000).toISOString())>start)) continue;
    if ((closed.data||[]).some((c:any)=>Date.parse(c.starts_at)<end && Date.parse(c.ends_at)>start)) continue;
    slots.push(time);
  }
  return { date:d, employee:staff.full_name, employee_id:staff.id, slots };
}

async function read(db: Db, actor: Actor, step: Step) {
  const args = step.args || {};
  const p = period(args);
  if (step.tool === 'proactive_alerts') {
    const {data,error}=await db.from('mori_events')
      .select('severity,title,detail,route,context').eq('recipient_id',actor.id)
      .eq('state','active').order('last_seen_at',{ascending:false}).limit(20);
    if(error) fail('MORİ uyarıları alınamadı.');
    const order:Record<string,number>={critical:0,important:1,info:2};
    const rows=(data||[]).sort((a:any,b:any)=>(order[a.severity]??3)-(order[b.severity]??3));
    return {text:rows.length?rows.map((e:any)=>`${e.severity==='critical'?'Kritik':e.severity==='important'?'Önemli':'Bilgi'}: ${e.title}. ${e.detail} ${e.route} ekranından inceleyebilirsiniz.`).join('\n'):'Şu anda açık MORİ işletme uyarısı yok.',
      navigation:rows.length?rows[0].route:null};
  }
  if (step.tool === 'daily_digest') {
    const {data,error}=await db.from('mori_daily_summaries').select('facts,business_date')
      .eq('recipient_id',actor.id).order('business_date',{ascending:false}).limit(1).maybeSingle();
    if(error) fail('Günlük özet alınamadı.');
    if(!data) return {text:'Günlük MORİ özeti henüz hazırlanmadı. Yönetici ayarlarındaki özet saatinde hazırlanır.'};
    const f=data.facts||{};
    return {text:`${data.business_date} özeti: ${f.appointments} randevu; bekleyen talepler ${f.pending_requests}; açık uyarılar ${f.active_alerts}. Dünkü gerçekleşen ciro: ${f.yesterday_turnover==null?'kapanış kaydı yok':money(Number(f.yesterday_turnover))}. Cengiz ve Talip programı: ${(f.staff||[]).map((s:any)=>`${s.name}: ${(s.appointments||[]).join(', ')||'randevu yok'}`).join('; ')}. Çalışan performansı: ${(f.performance||[]).map((s:any)=>`${s.name}: ${s.completed} tamamlanan, mevcut orana göre ${money(Number(s.calculated_commission||0))} prim`).join('; ')}.`};
  }
  if (step.tool==='daily_summary'||step.tool==='alerts') {
    let q=db.from('appointments').select('id,status').gte('scheduled_at',p.from).lt('scheduled_at',p.to).neq('status','cancelled').limit(3000);
    if(actor.role!=='manager') q=q.eq('employee_id',actor.id);
    const {data,error}=await q;
    if(error) fail('Günlük özet alınamadı.');
    let alertText='';
    if(actor.role==='manager') {
      const {data:visits,error:visitsError}=await db.from('client_visit_intelligence').select('last_visit_date,average_visit_days,distinct_visit_days').limit(5000);
      if(visitsError) fail('Uyarılar alınamadı.');
      const counts={due:0,overdue:0,risk:0},now=Date.parse(`${day()}T12:00:00Z`);
      for(const row of visits||[]) {
        if(!row.last_visit_date||Number(row.distinct_visit_days)<3||!Number(row.average_visit_days))continue;
        const ratio=Math.max(0,Math.round((now-Date.parse(`${row.last_visit_date}T12:00:00Z`))/86400000))/Number(row.average_visit_days);
        if(ratio>=1.75)counts.risk++; else if(ratio>=1.25)counts.overdue++; else if(ratio>=1)counts.due++;
      }
      alertText=`Geliş zamanı gelen ${counts.due}, geciken ${counts.overdue}, kayıp riski ${counts.risk}.`;
    }
    return {text:step.tool==='alerts'?(alertText||'Uyarılar yalnız yöneticiye açıktır.'):`${p.start} için ${(data||[]).length} randevu, ${(data||[]).filter((x:any)=>x.status==='completed').length} tamamlanan. ${alertText}`};
  }
  if (step.tool === 'availability') {
    const found = await availability(db,args,actor);
    return { text: `${found.employee} için ${found.date} müsait saatler: ${found.slots.slice(0,16).join(', ') || 'yok'}.`, data: found };
  }
  if (step.tool === 'calendar') {
    let q = db.from('appointments').select('id,client_name,service_name,scheduled_at,employee_id,status,amount').gte('scheduled_at',p.from).lt('scheduled_at',p.to).neq('status','cancelled').order('scheduled_at').limit(200);
    if (actor.role !== 'manager') q=q.eq('employee_id',actor.id);
    if (args.employee) { const e=await employee(db,args.employee,actor); if (actor.role!=='manager' && e.id!==actor.id) fail('Erişim yok.'); q=q.eq('employee_id',e.id); }
    const { data,error }=await q;
    if(error) fail('Takvim alınamadı.');
    const rows=data||[];
    return { text:`${p.start}–${p.end}: ${rows.length} randevu. ${rows.slice(0,12).map((a:any)=>`${stamp(a.scheduled_at)} ${a.client_name}, ${a.service_name}`).join('; ')}`, cards:rows.slice(0,12).map((a:any)=>({kind:'appointment',id:a.id,title:a.client_name,detail:`${stamp(a.scheduled_at)} · ${a.service_name}`})), data:{count:rows.length} };
  }
  if (step.tool === 'client_search' || step.tool === 'client_history') {
    const c=await unique(db,'clients',args.name,'id,full_name,phone,note,active,deleted_at');
    if(c.deleted_at) fail('Müşteri aktif değil.');
    if(step.tool==='client_search') return {text:`${c.full_name} kayıtlı müşteri.`,cards:[{kind:'client',id:c.id,title:c.full_name,detail:'Müşteri kaydını aç'}],data:{client_id:c.id}};
    const {data,error}=await db.from('appointments').select('id,service_name,scheduled_at,status,amount').eq('client_id',c.id).order('scheduled_at',{ascending:false}).limit(20);
    if(error) fail('Müşteri geçmişi alınamadı.');
    return {text:`${c.full_name}: ${(data||[]).length} son işlem. ${(data||[]).slice(0,8).map((a:any)=>`${stamp(a.scheduled_at)} ${a.service_name} (${a.status})`).join('; ')}`,cards:[{kind:'client',id:c.id,title:c.full_name,detail:'Müşteri kaydını aç'}],data:{count:(data||[]).length}};
  }
  if (step.tool === 'finance' || step.tool === 'debts' || step.tool === 'debt_search') {
    if(actor.role!=='manager') fail('Kasa bilgisi yalnız yöneticiye açıktır.');
    if(step.tool==='debt_search') {
      const name=clean(args.client_name||args.name);
      if(!name) fail('Müşteri adını belirtin.');
      const {data,error}=await db.from('customer_debts').select('id,client_name,amount,debt_date').eq('status','open').ilike('client_name',`%${name.replace(/[%_]/g,'')}%`).order('debt_date').limit(20);
      if(error) fail('Müşteri borçları alınamadı.');
      return {text:(data||[]).length?`${name} için açık borçlar: ${(data||[]).map((d:any)=>`${d.debt_date}: ${money(Number(d.amount))}`).join('; ')}.`:`${name} için açık borç bulunamadı.`,data:{count:(data||[]).length}};
    }
    if(step.tool==='debts') {
      const {data,error}=await db.from('customer_debts').select('amount,status').eq('status','open').limit(3000);
      if(error) fail('Borçlar alınamadı.');
      return {text:`Açık borç: ${(data||[]).length} kayıt, toplam ${money((data||[]).reduce((s:number,x:any)=>s+Number(x.amount||0),0))}.`,data:{count:(data||[]).length}};
    }
    const [ap,ex,adj]=await Promise.all([
      db.from('appointments').select('amount,status').gte('scheduled_at',p.from).lt('scheduled_at',p.to).limit(3000),
      db.from('business_expenses').select('amount').gte('expense_date',p.start).lte('expense_date',p.end).limit(3000),
      db.from('cash_adjustments').select('amount,entry_kind').gte('entry_date',p.start).lte('entry_date',p.end).limit(3000)
    ]);
    if(ap.error||ex.error||adj.error) fail('Kasa özeti alınamadı.');
    const income=(ap.data||[]).filter((x:any)=>x.status!=='cancelled').reduce((s:number,x:any)=>s+Number(x.amount||0),0);
    const expenses=(ex.data||[]).reduce((s:number,x:any)=>s+Number(x.amount||0),0);
    const adjustments=(adj.data||[]).reduce((s:number,x:any)=>s+(x.entry_kind==='income'?1:-1)*Number(x.amount||0),0);
    return {text:`${p.start}–${p.end}: kayıtlı randevu tutarı ${money(income)}, gider ${money(expenses)}, kasa düzeltmeleri ${money(adjustments)}, fark ${money(income-expenses+adjustments)}. Bu tutar tahsilat teyidi değildir.`,data:{income,expenses,adjustments}};
  }
  if (step.tool === 'staff_metrics') {
    const e=await employee(db,args.employee,actor);
    if(actor.role!=='manager'&&e.id!==actor.id) fail('Başka çalışanın tutarları görüntülenemez.');
    const {data,error}=await db.from('appointments').select('amount,status').eq('employee_id',e.id).gte('scheduled_at',p.from).lt('scheduled_at',p.to).limit(3000);
    if(error) fail('Çalışan tutarı alınamadı.');
    const rows=(data||[]).filter((x:any)=>x.status!=='cancelled');
    const total=rows.reduce((s:number,x:any)=>s+Number(x.amount||0),0);
    const pct=e.role==='employee'?Number(e.commission_pct||0):0;
    const commission=rows.reduce((s:number,x:any)=>s+Math.round((Number(x.amount||0)*pct/100+Number.EPSILON)*100)/100,0);
    return {text:`${e.full_name}, ${p.start}–${p.end}: ${rows.length} randevu, kayıtlı işlem tutarı ${money(total)}${e.role==='employee'?`, mevcut %${pct} kuralla hesaplanan prim ${money(commission)}`:''}.`,data:{total,commission}};
  }
  if (step.tool === 'services') {
    const {data,error}=await db.from('services').select('name,price,duration_minutes').eq('active',true).order('name').limit(50);
    if(error) fail('Hizmetler alınamadı.');
    return {text:(data||[]).map((x:any)=>`${x.name}: ${money(Number(x.price))}, ${x.duration_minutes} dk`).join('; '),data:{count:(data||[]).length}};
  }
  if (step.tool === 'navigate' || step.tool === 'report') {
    const page=step.tool==='report'?'statistics':clean(args.page);
    if(!allowedPages.has(page)) fail('Bu ekran mevcut değil.');
    if(actor.role!=='manager'&&['finance','debts','team','admin','employeePerformance','recoveryCenter'].includes(page)) fail('Bu ekran için yönetici yetkisi gerekli.');
    return {text:`${page} ekranını açabilirsiniz.`,navigation:page};
  }
  fail('Araç desteklenmiyor.');
}

async function prepare(db: Db, actor: Actor, sessionId: string, step: Step, question: string) {
  const x=step.args||{};
  if(['appointment_create','appointment_move','undo_move','appointment_cancel','client_update','expense_create','debt_payment','commission_update','service_price_update'].includes(step.tool)&&actor.role!=='manager') fail('Bu işlem için yönetici gerekli.');
  let payload: Record<string,unknown>={}, description='',storedKind=step.tool;
  if(step.tool==='appointment_create') {
    const e=await employee(db,x.employee,actor), s=await service(db,x.service);
    if(actor.role!=='manager'&&e.id!==actor.id) fail('Yalnız kendi takviminize randevu ekleyebilirsiniz.');
    const name=clean(x.client_name), d=date(x.date);
    if(name.length<2||!d) fail('Müşteri adı ve tarih gerekli.');
    let time=clean(x.time,5);
    if(time==='first'||time==='ilk') time=(await availability(db,{employee:e.full_name,date:d},actor,/saç[ ,]+sakal/i.test(s.name)?Math.max(Number(s.duration_minutes),60):Number(s.duration_minutes))).slots[0]||'';
    if(!/^([01]\d|2[0-3]):[03]0$/.test(time)) fail('Uygun saat belirtin.');
    payload={client_name:name,service_id:s.id,employee_id:e.id,scheduled_at:`${d}T${time}:00+03:00`};
    description=`${name} · ${s.name} · ${e.full_name} · ${d} ${time}`;
  } else if(step.tool==='undo_move') {
    const {data:prior}=await db.from('salon_ai_actions').select('result').eq('user_id',actor.id).eq('session_id',sessionId).eq('kind','appointment_move').eq('state','applied').order('applied_at',{ascending:false}).limit(1).maybeSingle();
    if(!prior?.result?.appointment_id) fail('Bu sohbette geri alınabilecek taşıma bulunamadı.');
    const ap=await appointment(db,{appointment_id:prior.result.appointment_id},actor);
    if(ap.status!=='confirmed') fail('Randevu artık geri alınamaz.');
    const {data:audits,error}=await db.from('salon_audit_log').select('before_data,after_data').eq('entity_type','appointment').eq('entity_id',ap.id).eq('action','update').order('created_at',{ascending:false}).limit(12);
    if(error) fail('Önceki randevu zamanı alınamadı.');
    const moved=(audits||[]).find((entry:any)=>entry.before_data?.scheduled_at&&entry.after_data?.scheduled_at&&(entry.before_data.scheduled_at!==entry.after_data.scheduled_at||entry.before_data.employee_id!==entry.after_data.employee_id));
    if(!moved||Date.parse(moved.after_data.scheduled_at)!==Date.parse(ap.scheduled_at)||moved.after_data.employee_id!==ap.employee_id) fail('Randevu daha sonra değişmiş; geri alma güvenli değil.');
    const {data:previousEmployee}=await db.from('profiles').select('full_name,active').eq('id',moved.before_data.employee_id).maybeSingle();
    if(!previousEmployee?.active) fail('Önceki çalışan artık etkin değil.');
    payload={appointment_id:ap.id,employee_id:moved.before_data.employee_id,scheduled_at:moved.before_data.scheduled_at};
    description=`${ap.client_name} randevusunu ${previousEmployee.full_name} için ${stamp(moved.before_data.scheduled_at)} zamanına geri al`;
    storedKind='appointment_move';
  } else if(step.tool==='appointment_move'||step.tool==='appointment_cancel') {
    const ap=await appointment(db,x,actor);
    if(step.tool==='appointment_move') {
      const e=await employee(db,x.employee||'ben',actor),d=date(x.date)||new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul'}).format(new Date(ap.scheduled_at));
      const time=clean(x.time,5)||new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit'}).format(new Date(ap.scheduled_at));
      if(!d||!/^([01]\d|2[0-3]):[03]0$/.test(time)) fail('Yeni tarih ve saati belirtin.');
      payload={appointment_id:ap.id,employee_id:e.id,scheduled_at:`${d}T${time}:00+03:00`};
      description=`${ap.client_name} randevusunu ${e.full_name} için ${d} ${time} saatine taşı`;
    } else {payload={appointment_id:ap.id};description=`${ap.client_name} randevusunu iptal et`;}
  } else if(step.tool==='client_create') {
    const name=clean(x.full_name||x.name),phone=clean(x.phone,30)==='[telefon]' ? (question.match(/(?:\+?90\s?)?(?:\(?0?5\d{2}\)?[\s.-]?)\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/)||[])[0]||'' : clean(x.phone,30),note=clean(x.note,500);
    if(name.length<2) fail('Müşteri adını belirtin.');
    if(phone&&!/^\+?[0-9\s()-]{10,20}$/.test(phone)) fail('Telefon biçimi geçersiz.');
    payload={full_name:name,phone,note};description=`${name} müşteri kaydını ekle`;
  } else if(step.tool==='client_update') {
    const c=await unique(db,'clients',x.name,'id,full_name,active,deleted_at');
    const phone=x.phone===undefined?undefined:clean(x.phone,30)==='[telefon]' ? (question.match(/(?:\+?90\s?)?(?:\(?0?5\d{2}\)?[\s.-]?)\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/)||[])[0]||'' : clean(x.phone,30),full_name=x.full_name===undefined?undefined:clean(x.full_name),note=x.note===undefined?undefined:clean(x.note,500);
    if(phone!==undefined&&phone&&!/^\+?[0-9\s()-]{10,20}$/.test(phone)) fail('Telefon biçimi geçersiz.');
    if(full_name===undefined&&phone===undefined&&note===undefined) fail('Değiştirilecek alanı belirtin.');
    payload={client_id:c.id,...(full_name!==undefined?{full_name}:{}),...(phone!==undefined?{phone}:{}),...(note!==undefined?{note}:{})};
    description=`${c.full_name} müşteri bilgisini güncelle`;
  } else if(step.tool==='expense_create') {
    const amount=Number(x.amount),category=clean(x.category,80),d=date(x.date)||day(),descriptionText=clean(x.description,500);
    if(!(amount>0&&amount<=1000000)||category.length<2) fail('Gider tutarı ve kategorisini belirtin.');
    payload={amount,category,date:d,description:descriptionText};description=`${d} · ${category} · ${money(amount)} gider ekle`;
  } else if(step.tool==='debt_payment') {
    const name=clean(x.client_name||x.name),amount=Number(x.amount);
    if(name.length<2||!(amount>0&&amount<=1000000)) fail('Müşteri adı ve ödeme tutarını belirtin.');
    const {data,error}=await db.from('customer_debts').select('id,client_name,amount').eq('status','open').ilike('client_name',`%${name.replace(/[%_]/g,'')}%`).limit(10);
    if(error||!data?.length) fail('Açık borç bulunamadı.');
    if(data.length>1) fail('Birden fazla açık borç var; ödeme için borç ekranında doğru kaydı seçin.');
    if(amount>Number(data[0].amount)) fail('Ödeme tutarı kalan borcu aşamaz.');
    payload={debt_id:data[0].id,amount};description=`${data[0].client_name} borcuna ${money(amount)} ödeme kaydet`;
  } else if(step.tool==='commission_update') {
    const e=await employee(db,x.employee,actor),pct=Number(x.percent);
    if(e.role!=='employee'||!(pct>=0&&pct<=100)) fail('Çalışan veya prim yüzdesi geçersiz.');
    payload={employee_id:e.id,percent:pct};description=`${e.full_name} primini %${pct} yap`;
  } else if(step.tool==='service_price_update') {
    const s=await service(db,x.service),price=Number(x.price);
    if(!(price>=0&&price<=1000000)) fail('Fiyat geçersiz.');
    payload={service_id:s.id,price};description=`${s.name} fiyatını ${money(price)} yap`;
  } else fail('İşlem desteklenmiyor.');
  const {data,error}=await db.from('salon_ai_actions').insert({user_id:actor.id,session_id:sessionId,kind:storedKind,payload}).select('id,kind').single();
  if(error) fail('İşlem onayı hazırlanamadı.');
  return {id:data.id,kind:storedKind,description};
}

export async function handlePhase2(body: Record<string,unknown>, admin: Db, caller: Db, actor: Actor, model: CallModel) {
  if(body.action==='confirm') {
    if(!uuid(body.action_id)||!uuid(body.session_id)) fail('İşlem kimliği geçersiz.');
    const {data:proposal}=await admin.from('salon_ai_actions').select('session_id,user_id,kind,state,result').eq('id',body.action_id).maybeSingle();
    if(!proposal||proposal.user_id!==actor.id||proposal.session_id!==body.session_id) fail('İşlem onayı bulunamadı.');
    if(proposal.state==='applied') return {answer:'İşlem daha önce uygulandı.',result:proposal.result,session_id:body.session_id};
    const {data,error}=await caller.rpc(proposal.kind==='debt_payment'?'salon_ai_commit_debt_payment':'salon_ai_commit_action',{p_id:body.action_id});
    if(error) fail(error.message||'İşlem uygulanamadı.');
    const answer=data.kind==='appointment_create'?'Randevu oluşturuldu.':data.kind==='appointment_move'?'Randevu taşındı.':data.kind==='appointment_cancel'?'Randevu iptal edildi.':data.kind==='debt_payment'?`Ödeme kaydedildi. Kalan borç ${money(Number(data.remaining_amount))}.`:'İşlem kaydedildi.';
    await admin.from('salon_ai_messages').insert({user_id:actor.id,session_id:body.session_id,role:'assistant',content:answer});
    return {answer,result:data,session_id:body.session_id};
  }
  if(body.action!=='send'||!uuid(body.session_id)||typeof body.message!=='string'||!body.message.trim()||body.message.length>1200) fail('Mesajı kontrol edin.');
  const sessionId=body.session_id as string,question=(body.message as string).trim();
  const {data:previous,error:historyError}=await admin.from('salon_ai_messages').select('role,content').eq('user_id',actor.id).eq('session_id',sessionId).gte('created_at',new Date(Date.now()-30*86400000).toISOString()).order('created_at',{ascending:false}).limit(14);
  if(historyError) fail('Sohbet geçmişi alınamadı.');
  const needsContext=/(^|\s)(onu|onun|bunu|bunun|aynı|az önce|peki|bu hafta\w*|primiyle|ilk boş|aktar|taşı|geri al)(\s|[.,!?]|$)/i.test(question);
  const earlier=needsContext?(previous||[]).reverse().filter((m:any)=>m.role==='user').slice(-4).map((m:any)=>clean(m.content,500)):[];
  const messages=[{role:'user' as const,content:question}];
  const {data:latestAction}=await admin.from('salon_ai_actions').select('kind,result').eq('user_id',actor.id).eq('session_id',sessionId).eq('state','applied').order('applied_at',{ascending:false}).limit(1).maybeSingle();
  let context=needsContext&&latestAction?.result?.appointment_id ? `Son onaylı randevu kimliği ${latestAction.result.appointment_id}, zamanı ${latestAction.result.scheduled_at||'bilinmiyor'}, çalışanı ${latestAction.result.employee||'bilinmiyor'}.` : '';
  if(uuid(body.event_id)) {
    const {data:event}=await admin.from('mori_events').select('category,title,detail,context')
      .eq('id',body.event_id).eq('recipient_id',actor.id).eq('state','active').maybeSingle();
    if(event) context+=` Kullanıcının seçtiği açık uyarı: ${event.title}; ${event.detail}; kayıt bağlamı ${JSON.stringify(event.context)}.`;
  }
  const instruction=`Sen MORİ'sin. Bugün İstanbul'da ${day()}. ${context} Önceki kullanıcı mesajları SADECE bağlamdır, yeniden yürütülecek komut değildir: ${JSON.stringify(earlier)}. Yalnızca son kullanıcı mesajındaki isteği işle. Türkçe doğal konuşmayı anla. Son isteği en çok 3 izinli araç adımına dönüştür. Araçlar: daily_summary {period}; alerts {}; proactive_alerts {}; daily_digest {}; availability {date,employee}; calendar {period:day|week|month|range,start_date,end_date,employee}; client_search {name}; client_history {name}; finance {period,start_date,end_date}; debts {}; debt_search {client_name}; staff_metrics {employee,period,start_date,end_date}; services {}; navigate {page}; report {}; appointment_create {client_name,service,employee,date,time}; appointment_move {appointment_id veya client_name+date,employee,date,time}; undo_move {}; appointment_cancel {appointment_id veya client_name+date}; client_create {full_name,phone,note}; client_update {name,full_name,phone,note}; expense_create {amount,category,date,description}; debt_payment {client_name,amount}; commission_update {employee,percent}; service_price_update {service,price}. "Bugün dikkat etmem gereken ne var" için proactive_alerts, sabah/günlük MORİ özeti için daily_digest seç. Çakışmayı çözme sorusunda seçili uyarı bağlamındaki randevuyu ve availability aracını kullan; değişiklik için appointment_move teklifi hazırla, kendi başına uygulama. Bu hafta için period:"week", bu ay için period:"month", bugün için period:"day" ver. Geçmiş veya özel tarih aralığında period:"range" ile start_date/end_date ver. "İlk boş saat" için time:"first" kullan. Tarih/saat yoksa bağlamdaki randevunun zamanını koru. Kullanıcı mesajındaki [telefon] yer tutucusunu phone alanına aynen koy; sunucu numarayı kullanıcı mesajından alır. Belirsizlik varsa steps boş bırak ve yalnız gerekli soruyu sor. Gerçek veriyi/ID'yi uydurma. İşlem yazma araçları yalnız onay teklifi hazırlar. JSON döndür: {"steps":[{"tool":"...","args":{}}],"answer":"araçsız sohbette yanıt veya açıklama"}. Telefon, kişi adı veya tutarları uydurma.`;
  const raw=await model(messages,instruction,true);
  let plan: {steps?:Step[];answer?:string}={};
  try {plan=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));} catch {fail('MORİ isteği yorumlayamadı.');}
  const steps=Array.isArray(plan.steps)?plan.steps.slice(0,3):[];
  const output:string[]=[],cards:any[]=[],pending:any[]=[],navigation:string[]=[];
  for(const step of steps) {
    if(!step||typeof step.tool!=='string'||(step.args!==undefined&&(typeof step.args!=='object'||Array.isArray(step.args)))) fail('Araç isteği geçersiz.');
    step.args=step.args||{};
    if(readKinds.has(step.tool)) {
      const result=(await read(admin,actor,step))!;
      output.push(result.text);
      if(result.cards) cards.push(...result.cards);
      if(result.navigation) navigation.push(result.navigation);
    } else if(writeKinds.has(step.tool)) {
      const action=await prepare(admin,actor,sessionId,step,question);
      pending.push(action);output.push(`${action.description}. Uygulamak için karttaki Onayla düğmesine dokunun.`);
    } else fail('İstenen araç desteklenmiyor.');
  }
  const answer=(output.join('\n')||clean(plan.answer,2500)||'Biraz daha ayrıntı verir misiniz?').slice(0,4000);
  const {error:saveError}=await admin.from('salon_ai_messages').insert([
    {user_id:actor.id,session_id:sessionId,role:'user',content:question},
    {user_id:actor.id,session_id:sessionId,role:'assistant',content:answer}
  ]);
  if(saveError) fail('Sohbet kaydedilemedi.');
  return {answer,cards,pending,navigation,session_id:sessionId};
}
