(function () {
  'use strict';
  var PAGE_SIZE = 500;
  var colors = { 'halil.kiv': '#2563EB', 'cengiz.bavkir': '#15803D', 'talip.kose': '#7C3AED', 'mehmet.safakoglu': '#EA580C' };
  var statusNames = { confirmed: 'Aktif', completed: 'Tamamlandı', no_show: 'Gelmedi', cancelled: 'İptal' };
  var statusIcons = { confirmed: '●', completed: '✓', no_show: '−', cancelled: '×' };
  var state = { view: 'day', date: today(), staff: '', service: '', status: 'all', rows: [], key: '', loading: false, error: '', generation: 0 };

  function user() { return typeof currentUser === 'undefined' ? null : currentUser; }
  function manager() { return user()?.role === 'yonetici'; }
  function esc(value) { return window.safe(String(value == null ? '' : value)); }
  function today() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); }
  function asDate(day) { return new Date(day + 'T12:00:00Z'); }
  function dayKey(date) { return date.toISOString().slice(0, 10); }
  function moveDay(day, amount) { var date = asDate(day); date.setUTCDate(date.getUTCDate() + amount); return dayKey(date); }
  function monthStart(day) { return day.slice(0, 7) + '-01'; }
  function nextMonth(day, amount) { var date = asDate(monthStart(day)); date.setUTCMonth(date.getUTCMonth() + amount); return dayKey(date); }
  function monday(day) { return moveDay(day, -(asDate(day).getUTCDay() + 6) % 7); }
  function title(day, options) { return asDate(day).toLocaleDateString('tr-TR', Object.assign({ timeZone: 'UTC' }, options)); }
  function profile(item) { return remoteProfiles.find(function (person) { return String(person.id) === String(item.employeeId); }); }
  function color(item) { var person = profile(item); return person?.calendar_color || colors[person?.username] || '#526575'; }
  function isActive() { return !!document.getElementById('practicalCalendar')?.classList.contains('active'); }
  function currentKey() { return user()?.id + ':' + state.date.slice(0, 7); }

  function ensurePage() {
    if (document.getElementById('practicalCalendar')) return;
    var page = document.createElement('section');
    page.id = 'practicalCalendar';
    page.className = 'page';
    page.innerHTML = '<div class="content practical-content"><div class="practical-heading"><button type="button" class="menu-button" onclick="toggleDrawer()" aria-label="Menüyü aç">☰</button><h1 class="page-title">Pratik Takvim</h1><button type="button" id="practicalCreate" class="practical-add">＋ Randevu oluştur</button></div><div class="practical-toolbar"><div class="practical-views" role="group" aria-label="Takvim görünümü"><button type="button" data-view="day">Gün</button><button type="button" data-view="week">Hafta</button><button type="button" data-view="month">Ay</button></div><div class="practical-nav"><button type="button" data-nav="previous" aria-label="Önceki dönem">‹</button><strong id="practicalTitle"></strong><button type="button" data-nav="next" aria-label="Sonraki dönem">›</button><button type="button" data-nav="today">Bugün</button></div></div><div class="practical-filters"><label>Çalışan<select id="practicalStaff"></select></label><label>İşlem<select id="practicalService"></select></label><label>Durum<select id="practicalStatus"><option value="all">Tümü</option><option value="active">Aktif</option><option value="arrived">Geldi</option><option value="unfinished">Tamamlanmamış</option><option value="completed">Tamamlandı</option><option value="no_show">Gelmedi</option><option value="cancelled">İptal</option></select></label><label>Tarih<input id="practicalDate" type="date"></label><button type="button" id="practicalClear">Filtreleri temizle</button></div><div id="practicalNotice" role="status" aria-live="polite"></div><div id="practicalBody"></div></div>';
    document.getElementById('calendar').after(page);
    page.addEventListener('click', click);
    page.addEventListener('change', change);
    document.getElementById('practicalCreate').addEventListener('click', createAppointment);
  }

  function ensureMenu() {
    var calendar = document.querySelector('#drawerLayer [onclick="drawerPage(\'calendar\')"]');
    if (!calendar) return;
    calendar.textContent = '▦  Ekip Takvimi';
    var practical = document.getElementById('drawerPracticalCalendar');
    if (!practical) {
      practical = document.createElement('button');
      practical.id = 'drawerPracticalCalendar';
      practical.type = 'button';
      practical.className = 'menu-item';
      practical.textContent = '▤  Pratik Takvim';
      practical.addEventListener('click', function () { drawerPage('practicalCalendar'); });
    }
    calendar.after(practical);
  }

  function options(element, pairs, value) {
    var html = pairs.map(function (pair) { return '<option value="' + esc(pair[0]) + '">' + esc(pair[1]) + '</option>'; }).join('');
    if (element.innerHTML !== html) element.innerHTML = html;
    element.value = value;
  }

  function controls() {
    var people = remoteProfiles.filter(function (person) { return person.active && (manager() || String(person.id) === String(user()?.id)); });
    if (!manager()) state.staff = user()?.id || '';
    options(document.getElementById('practicalStaff'), (manager() ? [['', 'Tüm çalışanlar']] : []).concat(people.map(function (person) { return [person.id, person.full_name]; })), state.staff);
    document.getElementById('practicalStaff').disabled = !manager();
    var names = Array.from(new Set(remoteServices.map(function (service) { return service.name; }).concat(state.rows.map(function (item) { return item.operation; })).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'tr'); });
    if (state.service && !names.includes(state.service)) names.push(state.service);
    options(document.getElementById('practicalService'), [['', 'Tüm işlemler']].concat(names.map(function (name) { return [name, name]; })), state.service);
    document.getElementById('practicalStatus').value = state.status;
    document.getElementById('practicalDate').value = state.date;
    document.querySelectorAll('#practicalCalendar [data-view]').forEach(function (button) { button.classList.toggle('active', button.dataset.view === state.view); button.setAttribute('aria-pressed', String(button.dataset.view === state.view)); });
    document.getElementById('practicalCreate').hidden = !manager();
  }

  function matches(item) {
    if (state.staff && String(item.employeeId) !== String(state.staff)) return false;
    if (!manager() && String(item.employeeId) !== String(user()?.id)) return false;
    if (state.service && item.operation !== state.service) return false;
    if (state.status === 'active') return item.status === 'confirmed' && !item.checkedInAt;
    if (state.status === 'arrived') return item.status === 'confirmed' && !!item.checkedInAt;
    if (state.status === 'unfinished') return item.status === 'confirmed';
    return state.status === 'all' || item.status === state.status;
  }

  function card(item) {
    var status = item.checkedInAt && item.status === 'confirmed' ? 'Geldi' : (statusNames[item.status] || 'Aktif');
    var icon = status === 'Geldi' ? '✓' : (statusIcons[item.status] || '●');
    return '<button type="button" class="practical-card" data-appointment="' + esc(item.id) + '" style="--practical-color:' + esc(color(item)) + '" aria-label="' + esc(item.time + ', ' + item.customer + ', ' + item.staff + ', ' + status) + '"><span class="practical-time">' + esc(item.time) + '</span><span class="practical-card-main"><strong>' + esc(item.customer) + '</strong><span>' + esc(item.operation) + '</span><small>' + esc(item.staff) + '</small></span><span class="practical-status"><span aria-hidden="true">' + icon + '</span> ' + esc(status) + '</span></button>';
  }

  function rowsFor(day, items) { return items.filter(function (item) { return item.date === day; }).sort(function (a, b) { return a.time.localeCompare(b.time) || a.customer.localeCompare(b.customer, 'tr'); }); }
  function daySection(day, items) {
    var rows = rowsFor(day, items);
    return '<section class="practical-day"><h2>' + esc(title(day, { weekday: 'long', day: 'numeric', month: 'long' })) + ' <span>' + rows.length + ' randevu</span></h2>' + (rows.length ? rows.map(card).join('') : '<p class="practical-empty">Bu gün için randevu yok.</p>') + '</section>';
  }
  function monthGrid(items) {
    var first = monthStart(state.date), start = monday(first), next = nextMonth(first, 1), days = [];
    for (var day = start; days.length < 42; day = moveDay(day, 1)) {
      var count = rowsFor(day, items).length, outside = day < first || day >= next;
      days.push('<button type="button" class="practical-month-day' + (outside ? ' outside' : '') + (day === today() ? ' today' : '') + (day === state.date ? ' selected' : '') + '" data-day="' + day + '"><span>' + Number(day.slice(8)) + '</span><small>' + (count ? count + ' randevu' : '—') + '</small></button>');
      if (days.length >= 35 && day >= moveDay(next, -1) && asDate(day).getUTCDay() === 0) break;
    }
    return '<div class="practical-month" aria-label="Aylık takvim"><div class="practical-weekdays"><span>Pzt</span><span>Sal</span><span>Çar</span><span>Per</span><span>Cum</span><span>Cmt</span><span>Paz</span></div><div class="practical-month-grid">' + days.join('') + '</div></div>';
  }

  function render() {
    if (!user()) return;
    ensurePage(); controls();
    var notice = document.getElementById('practicalNotice'), body = document.getElementById('practicalBody');
    document.getElementById('practicalTitle').textContent = state.view === 'month' ? title(monthStart(state.date), { month: 'long', year: 'numeric' }) : state.view === 'week' ? title(monday(state.date), { day: 'numeric', month: 'short' }) + ' – ' + title(moveDay(monday(state.date), 6), { day: 'numeric', month: 'short', year: 'numeric' }) : title(state.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (state.loading) { notice.textContent = 'Randevular yükleniyor…'; body.replaceChildren(); return; }
    if (state.error) { notice.textContent = 'Randevular yüklenemedi: ' + state.error; body.replaceChildren(); return; }
    var items = state.rows.filter(matches);
    var firstVisible = state.view === 'month' ? monthStart(state.date) : state.view === 'week' ? monday(state.date) : state.date;
    var lastVisible = state.view === 'month' ? nextMonth(state.date, 1) : moveDay(firstVisible, state.view === 'week' ? 7 : 1);
    var visibleCount = items.filter(function (item) { return item.date >= firstVisible && item.date < lastVisible; }).length;
    notice.textContent = visibleCount + ' randevu · ' + (state.view === 'day' ? 'Gün' : state.view === 'week' ? 'Hafta' : 'Ay') + ' görünümü';
    if (state.view === 'month') { body.innerHTML = monthGrid(items); return; }
    if (state.view === 'week') {
      var start = monday(state.date), html = '';
      for (var i = 0; i < 7; i++) html += daySection(moveDay(start, i), items);
      body.innerHTML = html; return;
    }
    body.innerHTML = daySection(state.date, items);
  }

  async function fetchPages(start, end) {
    var rows = [], cursor = null;
    for (;;) {
      var query = salonDb.from('appointments').select('*').gte('scheduled_at', start).lt('scheduled_at', end)
        .order('scheduled_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE);
      if (cursor) {
        if (!/^[0-9TZ:.+\-]+$/.test(cursor.scheduled_at) || !/^[a-f0-9-]+$/i.test(cursor.id)) throw new Error('Randevu sayfalama anahtarı geçersiz.');
        query = query.or('scheduled_at.lt.' + cursor.scheduled_at + ',and(scheduled_at.eq.' + cursor.scheduled_at + ',id.lt.' + cursor.id + ')');
      }
      var response = await query;
      if (response.error) throw response.error;
      var batch = response.data || [];
      rows.push.apply(rows, batch);
      if (batch.length < PAGE_SIZE) return rows;
      cursor = batch[batch.length - 1];
    }
  }

  async function load(force) {
    if (!user() || !window.salonRemoteMode) return;
    var key = currentKey();
    if (!force && state.key === key && !state.error) { render(); return; }
    var generation = ++state.generation, actor = user().id;
    state.loading = true; state.error = ''; state.rows = []; state.key = '';
    render();
    var bounds = SalonAppointmentData.monthBounds(state.date);
    var start = new Date(Date.parse(bounds.start) - 7 * 86400000).toISOString();
    var end = new Date(Date.parse(bounds.end) + 7 * 86400000).toISOString();
    try {
      var raw = await fetchPages(start, end);
      if (generation !== state.generation || actor !== user()?.id || key !== currentKey()) return;
      state.rows = raw.map(remoteAppointment).filter(function (item) { return manager() || String(item.employeeId) === String(actor); });
      state.key = key; state.loading = false;
      render();
    } catch (error) {
      if (generation !== state.generation || actor !== user()?.id) return;
      state.loading = false; state.error = error.message || 'Bağlantıyı kontrol edin.';
      render();
    }
  }

  function setDate(date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return; state.date = date; load(false); }
  function click(event) {
    var button = event.target.closest('button'); if (!button) return;
    if (button.dataset.view) { state.view = button.dataset.view; render(); return; }
    if (button.dataset.nav) {
      if (button.dataset.nav === 'today') setDate(today());
      else { var amount = button.dataset.nav === 'next' ? 1 : -1; setDate(state.view === 'month' ? nextMonth(state.date, amount) : moveDay(state.date, amount * (state.view === 'week' ? 7 : 1))); }
      return;
    }
    if (button.dataset.day) { state.view = 'day'; setDate(button.dataset.day); return; }
    if (button.dataset.appointment) {
      var item = state.rows.find(function (row) { return String(row.id) === button.dataset.appointment; });
      if (item && matches(item)) {
        var globalItem = typeof appts === 'undefined' ? null : appts.find(function (row) { return String(row.id) === String(item.id); });
        if (globalItem) Object.assign(globalItem, item);
        window.SalonCalendarUI?.open(item);
      }
      return;
    }
    if (button.id === 'practicalClear') { state.staff = manager() ? '' : user().id; state.service = ''; state.status = 'all'; state.date = today(); load(false); }
  }
  function change(event) {
    var id = event.target.id, value = event.target.value;
    if (id === 'practicalDate') setDate(value);
    else if (id === 'practicalStaff') { state.staff = manager() ? value : user().id; render(); }
    else if (id === 'practicalService') { state.service = value; render(); }
    else if (id === 'practicalStatus') { state.status = value; render(); }
  }
  function createAppointment() {
    if (!manager()) return;
    window.openAppointmentModal();
    var date = document.getElementById('appointmentDate'); if (date) date.value = state.date;
    var employee = remoteProfiles.find(function (person) { return String(person.id) === String(state.staff); });
    if (employee) document.getElementById('appointmentStaff').value = employee.full_name;
    window.updateDateCaption?.(); window.refreshAppointmentTimeAvailability?.();
  }

  var previousShowPage = window.showPage;
  window.showPage = function (id) {
    if (id !== 'practicalCalendar') return previousShowPage.apply(this, arguments);
    if (!user()) return;
    ensurePage(); ensureMenu();
    document.querySelectorAll('.page').forEach(function (page) { page.classList.remove('active'); });
    document.getElementById('practicalCalendar').classList.add('active');
    window.scrollTo(0, 0);
    load(true);
  };
  var previousReload = window.reloadRemoteData;
  window.reloadRemoteData = function () {
    state.key = '';
    var result = previousReload.apply(this, arguments);
    if (isActive()) load(true);
    return Promise.resolve(result).then(function (value) { if (isActive()) render(); return value; });
  };
  ['simplifyNavigation', 'enterApp', 'toggleDrawer'].forEach(function (name) {
    var previous = window[name]; if (typeof previous !== 'function') return;
    window[name] = function () { var result = previous.apply(this, arguments); ensureMenu(); return result; };
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && isActive()) load(true); });
  window.addEventListener('focus', function () { if (isActive()) load(true); });
  ensurePage(); ensureMenu();
  window.SalonPracticalCalendar = { render: render, load: load, state: state };
})();
