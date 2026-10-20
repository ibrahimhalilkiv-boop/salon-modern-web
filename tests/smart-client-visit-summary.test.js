const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('smart-customer-analysis-1.7.0.js', 'utf8');
const core = source.slice(source.indexOf('var smartSelectedClientId='), source.indexOf('var previousRemoteAppointment='));
const migration = fs.readFileSync('supabase/migrations/20261020202100_client_visit_summary_future_guard.sql', 'utf8');
const legacy = fs.readFileSync('salon-ui-fixes-2.3.16.js', 'utf8');
const clients = [
  { id: 'kenan', full_name: 'Kenan Şahin' },
  { id: 'same-1', full_name: 'Aynı Ad' },
  { id: 'same-2', full_name: 'Aynı Ad' },
  { id: 'late', full_name: 'Geciken Müşteri' }
];
const ctx = {
  Map, Date, currentUser: { id: 'owner' }, appts: [],
  appointmentDate: item => item.date, localDate: () => '2026-10-20',
  uniqueRemoteClients: () => clients,
  renderSmartAnalysisPage() {}, renderSmartDailyPanels() {}, renderCustomerReturnAlerts() {}, renderCustomerDetail() {}
};
vm.createContext(ctx);
vm.runInContext(core, ctx);
vm.runInContext("smartToday=function(){return '2026-10-20'}", ctx);

const visit = (id, count, last, average) => ({
  client_id: id, visit_count: count, last_visit: last,
  average_days: average, preferred_employee_id: null
});

(async () => {
  ctx.salonDb = { rpc: async () => ({ data: [
    visit('kenan', 4, '2026-10-20', 19),
    visit('same-1', 4, '2026-10-20', 20),
    visit('same-2', 4, '2026-09-01', 10),
    visit('late', 4, '2026-09-01', 10)
  ], error: null }) };
  await ctx.smartRefreshSummaries();
  assert.equal(ctx.smartAnalysisForClient(clients[0]).status, 'regular', 'Kenan’s completed visit today clears overdue');
  assert.equal(ctx.smartAnalysisForClient(clients[0]).elapsed, 0);
  assert.equal(ctx.smartAnalysisForClient(clients[1]).status, 'regular');
  assert.equal(ctx.smartAnalysisForClient(clients[2]).status, 'risk', 'Same names remain separate by client ID');
  assert.equal(ctx.smartAnalysisForClient(clients[3]).status, 'risk', 'Truly overdue client stays flagged');
  assert.equal(ctx.smartActionableAnalyses(false).some(item => item.client.id === 'kenan'), false);

  const large = Array.from({ length: 1201 }, (_, n) => visit(String(n).padStart(4, '0'), 1, '2026-10-20', null));
  let calls = 0;
  ctx.salonDb.rpc = async (name, args) => {
    assert.equal(name, 'salon_client_visit_summary');
    assert.equal(args.p_limit, 500);
    calls++;
    const start = args.p_after == null ? 0 : Number(args.p_after) + 1;
    return { data: large.slice(start, start + args.p_limit), error: null };
  };
  await ctx.smartRefreshSummaries();
  assert.equal(calls, 3);
  assert.equal(ctx.smartVisitSummaries.size, 1201, 'Summary clients beyond Supabase’s 1000-row default are retained');

  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  ctx.salonDb.rpc = () => old;
  const stale = ctx.smartRefreshSummaries();
  assert.equal(ctx.smartSummaryState, 'loading');
  ctx.salonDb.rpc = async () => ({ data: [visit('kenan', 4, '2026-10-20', 19)], error: null });
  await ctx.smartRefreshSummaries();
  resolveOld({ data: [visit('kenan', 4, '2026-09-01', 10)], error: null });
  await stale;
  assert.equal(ctx.smartAnalysisForClient(clients[0]).status, 'regular', 'Old request cannot overwrite newer result');

  ctx.salonDb.rpc = async () => ({ data: null, error: new Error('offline') });
  await assert.rejects(ctx.smartRefreshSummaries(), /offline/);
  assert.equal(ctx.smartSummaryState, 'error', 'Partial or failed reads cannot appear complete');
  assert.equal(ctx.smartAnalyses().length, 0);

  assert.match(migration, /a\.status in \('completed','confirmed'\) and a\.scheduled_at < now\(\)/,
    'Neither future reservations nor future-dated completed rows count as visits');
  assert.match(migration, /select distinct e\.client_id, e\.visit_day/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function .* from public, anon/);
  assert.doesNotMatch(legacy, /offset<10000|loadAllAppointmentsPaged|loadCalendarDayFast/);
  console.log('PASS independent visit summaries, Kenan today, identity, stale requests, error state and legacy loader removal');
})().catch(error => { console.error(error); process.exitCode = 1; });
