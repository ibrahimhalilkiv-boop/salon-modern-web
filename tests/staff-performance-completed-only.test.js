// Regression checks: only appointments completed in the past count as realized business.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = path => fs.readFileSync(path, 'utf8');
const report = source('supabase/migrations/20261031173000_staff_performance_completed_only.sql');
const cash = source('supabase/migrations/20261031174000_cash_only_completed_services.sql');
const app = source('salon-modern.html');
const phase = source('salon-phase2-1.8.0.js');
const stats = source('salon-performance-2.3.14.js');
const screen = source('staff-performance-20261031.js');
const finance = source('salon-finance-2.3.0.js');
const sw = source('sw.js');

assert.match(report, /a.status = 'completed'/);
assert.match(report, /a.scheduled_at <= now\(\)/);
assert.match(report, /p_employee_id <> v_actor/);
assert.match(report, /SECURITY INVOKER|SET search_path/);
assert.doesNotMatch(report, /planned_count/);
assert.match(cash, /a.status='completed'/);
assert.match(cash, /a.scheduled_at <= now\(\)/);
assert.doesNotMatch(cash, /a.status<>'cancelled'/);

assert.match(app, /item.status==='completed'/);
assert.match(app, /staff-performance-20261031\.js\?v=4/);
assert.match(phase, /salonDb\.rpc\('staff_performance_overview'/);
assert.match(stats, /return item.status==='completed'/);
assert.match(screen, /staff_performance_report/);
assert.match(screen, /drawerEmployeePerformance/);
assert.match(screen, /response\.data\.employees\.some/);
assert.match(finance, /salonDb\.rpc\('calculate_cash_period_summary'/);
assert.match(sw, /staff-performance-20261031\.js\?v=4/);
assert.match(sw, /salon-modern-shell-pwa-v192/);
console.log('PASS completed-only finance, staff performance, global summaries, role-scope and PWA wiring');
