(function () {
  'use strict';
  var PAGE_SIZE = 500;
  var employeeOrder = { 'mehmet.safakoglu': 0, 'halil.kiv': 1, 'cengiz.bavkir': 2, 'talip.kose': 3 };
  var colors = { 'halil.kiv': '#2563EB', 'cengiz.bavkir': '#15803D', 'talip.kose': '#7C3AED', 'mehmet.safakoglu': '#EA580C' };
  var statusNames = { confirmed: 'Aktif', completed: 'Tamamlandı', no_show: 'Gelmedi', cancelled: 'İptal' };
  var state = { view: 'day', date: today(), monthSelectedDay: null, staff: '', service: '', status: 'all', rows: [], hours: null, key: '', loading: false, error: '', generation: 0 };

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
  function visibleRange() {
    var start = state.view === 'month' ? monday(monthStart(state.date)) : state.view === 'week' ? monday(state.date) : state.date;
    var end = state.view === 'month' ? moveDay(nextMonth(state.date, 1), 7) : moveDay(start, state.view === 'week' ? 7 : 1);
    return { start: start + 'T00:00:00+03:00', end: end + 'T00:00:00+03:00' };
  }
  function currentKey() { var range = visibleRange(); return user()?.id + ':' + range.start + ':' + range.end; }
  function employees() {
    return remoteProfiles.filter(function (person) { return person.active && person.username !== 'salon.modern' && (manager() || String(person.id) === String(user()?.id)); })
      .sort(function (a, b) { return (employeeOrder[a.username] ?? 99) - (employeeOrder[b.username] ?? 99); });
  }

  function ensurePage() {
    if (document.getElementById('practicalCalendar')) return;
    var page = document.createElement('section');
    page.id = 'practicalCalendar';
    page.className = 'page';
    page.innerHTML = '<div class="content practical-content"><div class="practical-heading"><button type="button" class="menu-button" onclick="toggleDrawer()" aria-label="Menüyü aç">☰</button><h1 class="page-title">Takvim</h1></div><div class="practical-toolbar"><div class="practical-nav"><button type="button" data-nav="previous" aria-label="Önceki gün, hafta veya ay">‹</button><label class="practical-date-title" title="Tarih seç"><strong id="practicalTitle"></strong><input id="practicalJump" type="date" aria-label="Tarihe git"></label><button type="button" data-nav="next" aria-label="Sonraki gün, hafta veya ay">›</button><button type="button" data-nav="today">Bugün</button><button type="button" id="practicalMonth" data-view="month" aria-pressed="false">Ay görünümü</button><button type="button" id="practicalDay" data-view="day" hidden aria-pressed="false">Güne dön</button><details id="practicalTools" class="practical-tools"><summary>Seçenekler</summary><div class="practical-tools-body"><label>Görünüm<select id="practicalViewSelect"><option value="day">Gün</option><option value="week">Hafta</option><option value="month">Ay</option></select></label><label>Çalışan<select id="practicalStaff"></select></label><label>İşlem<select id="practicalService"></select></label><label>Durum<select id="practicalStatus"><option value="all">Tümü</option><option value="active">Aktif</option><option value="arrived">Geldi</option><option value="completed">Tamamlandı</option><option value="no_show">Gelmedi</option></select></label></div></details></div></div><button type="button" id="practicalAll" hidden>Tüm Çalışanlar</button><div id="practicalNotice" role="status" aria-live="polite"></div><div id="practicalBody"></div></div>';
    document.getElementById('calendar').after(page);
    page.addEventListener('click', click);
    installDaySwipe(page.querySelector('#practicalBody'));
    document.getElementById('practicalJump').addEventListener('click', function (event) {
      if (typeof event.currentTarget.showPicker === 'function') {
        try { event.currentTarget.showPicker(); } catch (_error) { /* Native date input remains usable. */ }
      }
    });
    page.addEventListener('change', function (event) {
      var id = event.target.id, value = event.target.value;
      if (id === 'practicalJump') { state.view = 'day'; setDate(value); }
      else if (id === 'practicalViewSelect') { if (value === 'month' && state.view !== 'month') state.monthSelectedDay = state.date; state.view = value; load(false); }
      else if (id === 'practicalStaff') { state.staff = manager() ? value : user().id; render(); }
      else if (id === 'practicalService') { state.service = value; render(); }
      else if (id === 'practicalStatus') { state.status = value; render(); }
    });
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
      practical.textContent = '▤  Takvim';
      practical.addEventListener('click', function () { drawerPage('practicalCalendar'); });
    }
    calendar.before(practical);
  }

  function options(id, pairs, value) {
    var element = document.getElementById(id), html = pairs.map(function (pair) { return '<option value="' + esc(pair[0]) + '">' + esc(pair[1]) + '</option>'; }).join('');
    if (element.innerHTML !== html) element.innerHTML = html;
    element.value = value;
  }
  function controls() {
    if (!manager()) state.staff = user()?.id || '';
    document.getElementById('practicalCalendar').classList.toggle('practical-month-mode', state.view === 'month');
    document.querySelectorAll('#practicalCalendar [data-view]').forEach(function (button) { button.classList.toggle('active', button.dataset.view === state.view); button.setAttribute('aria-pressed', String(button.dataset.view === state.view)); });
    document.getElementById('practicalMonth').hidden = state.view === 'month';
    document.getElementById('practicalDay').hidden = state.view === 'day';
    document.getElementById('practicalAll').hidden = !manager() || !state.staff || state.view !== 'day';
    document.getElementById('practicalViewSelect').value = state.view;
    options('practicalStaff', (manager() ? [['', 'Tüm çalışanlar']] : []).concat(employees().map(function (person) { return [person.id, person.full_name]; })), state.staff);
    document.getElementById('practicalStaff').disabled = !manager();
    var services = Array.from(new Set(remoteServices.map(function (service) { return service.name; }).concat(state.rows.map(function (item) { return item.operation; })).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'tr'); });
    if (state.service && !services.includes(state.service)) services.push(state.service);
    options('practicalService', [['', 'Tüm işlemler']].concat(services.map(function (service) { return [service, service]; })), state.service);
    document.getElementById('practicalStatus').value = state.status;
  }

  function matches(item) {
    if (item.status === 'cancelled') return false;
    if (state.staff && String(item.employeeId) !== String(state.staff)) return false;
    if (!manager() && String(item.employeeId) !== String(user()?.id)) return false;
    if (state.service && item.operation !== state.service) return false;
    if (state.status === 'active') return item.status === 'confirmed' && !item.checkedInAt;
    if (state.status === 'arrived') return item.status === 'confirmed' && !!item.checkedInAt;
    return state.status === 'all' || item.status === state.status;
  }

  function rowsFor(day, items) { return items.filter(function (item) { return item.date === day; }).sort(function (a, b) { return a.time.localeCompare(b.time) || a.customer.localeCompare(b.customer, 'tr'); }); }
  function timeMinute(value) { var parts = String(value || '').split(':'); return Number(parts[0]) * 60 + Number(parts[1]); }
  function timeLabel(minute) { return String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0'); }
  async function loadHours(day) {
    var results = await Promise.all([
      salonDb.from('booking_settings').select('default_open_time,default_close_time').eq('id', true).maybeSingle(),
      salonDb.from('booking_schedule_overrides').select('open_time,close_time,is_closed').eq('schedule_date', day).maybeSingle()
    ]);
    if (results[0].error || results[1].error) throw results[0].error || results[1].error;
    var base = results[0].data || {}, override = results[1].data;
    var open = timeMinute(override?.open_time || base.default_open_time || '09:00');
    var close = timeMinute(override?.close_time || base.default_close_time || '20:00');
    if (!Number.isFinite(open) || !Number.isFinite(close)) throw Error('Çalışma saatleri geçersiz.');
    return { open: open, close: close, closed: !!override?.is_closed || close <= open };
  }
  function dayGrid(items) {
    var people = employees().filter(function (person) { return !state.staff || String(person.id) === String(state.staff); });
    if (!people.length) return '<div class="practical-empty">Gösterilecek çalışan bulunamadı.</div>';
    var dayRows = rowsFor(state.date, items), hours = state.hours || { open: 540, close: 1200 }, start = hours.closed ? 1440 : Math.floor(hours.open / 30) * 30, end = hours.closed ? 0 : Math.ceil(hours.close / 30) * 30;
    dayRows.forEach(function (item) { var minute = timeMinute(item.time); if (Number.isFinite(minute)) { start = Math.min(start, Math.floor(minute / 30) * 30); end = Math.max(end, Math.floor(minute / 30) * 30 + 30); } });
    var bySlot = new Map();
    dayRows.forEach(function (item) {
      var minute = Math.floor(timeMinute(item.time) / 30) * 30, key = minute + ':' + item.employeeId;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push(item);
    });
    var single = people.length === 1, html = '<div class="practical-schedule' + (single ? ' single' : '') + '" style="--practical-columns:' + people.length + '"><div class="practical-schedule-head"><span>Saat</span>';
    people.forEach(function (person) {
      var sample = { employeeId: person.id }, shade = esc(color(sample)), name = person.full_name.split(' ')[0];
      html += '<button type="button" data-employee="' + esc(person.id) + '" style="--staff-color:' + shade + '"' + (manager() ? '' : ' disabled') + '>' + esc(single ? person.full_name : name) + '</button>';
    });
    html += '</div>';
    if (start >= end) return html + '<div class="practical-empty">Bu gün işletme kapalı; kayıtlı randevu yok.</div></div>';
    for (var minute = start; minute < end; minute += 30) {
      var time = timeLabel(minute);
      html += '<div class="practical-schedule-row"><span class="practical-slot-time">' + esc(time) + '</span>';
      people.forEach(function (person) {
        var shade = esc(color({ employeeId: person.id })), rows = bySlot.get(minute + ':' + person.id) || [];
        html += '<div class="practical-cell" style="--staff-color:' + shade + '">';
        if (rows.length) rows.forEach(function (item) {
          var status = item.checkedInAt && item.status === 'confirmed' ? 'Geldi' : (statusNames[item.status] || 'Aktif');
          var amount = Number(item.amount), price = Number.isFinite(amount) ? '₺ ' + amount.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : 'Ücret belirtilmemiş';
          html += '<button type="button" class="practical-event" data-appointment="' + esc(item.id) + '" title="' + esc(item.customer + ' · ' + item.operation + ' · ' + price + ' · ' + status) + '" aria-label="' + esc(item.time + ' ' + item.customer + ', ' + person.full_name + ', ' + item.operation + ', ' + price + ', ' + status) + '"><strong>' + esc(item.customer) + '</strong><span class="practical-event-time">' + esc(item.time) + '</span><span class="practical-event-service">' + esc(item.operation || 'Hizmet belirtilmemiş') + '</span><span class="practical-event-price">' + esc(price) + '</span><span class="practical-event-status">' + esc(status) + '</span></button>';
        });
        else {
          var canCreate = manager() && !hours.closed && minute >= hours.open && minute < hours.close;
          html += '<button type="button" class="practical-available" data-slot-time="' + esc(time) + '" data-slot-staff="' + esc(person.id) + '" aria-label="' + esc(person.full_name + ' ' + time + (canCreate ? ' boş saat; randevu oluştur' : ' çalışma saati dışında')) + '"' + (canCreate ? '' : ' disabled') + '></button>';
        }
        html += '</div>';
      });
      html += '</div>';
    }
    return html + '</div>';
  }
  function weekGrid(items) {
    var start = monday(state.date), html = '<div class="practical-week">';
    for (var index = 0; index < 7; index++) {
      var day = moveDay(start, index), rows = rowsFor(day, items);
      html += '<section class="practical-week-day"><button type="button" class="practical-week-title" data-day="' + day + '">' + esc(title(day, { weekday: 'short', day: 'numeric', month: 'short' })) + '<small>' + rows.length + ' randevu</small></button>';
      rows.forEach(function (item) {
        var status = item.checkedInAt && item.status === 'confirmed' ? 'Geldi' : (statusNames[item.status] || 'Aktif');
        var amount = Number(item.amount), price = Number.isFinite(amount) ? '₺ ' + amount.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : 'Ücret belirtilmemiş';
        html += '<button type="button" class="practical-week-event" data-appointment="' + esc(item.id) + '" style="--staff-color:' + esc(color(item)) + '"><strong>' + esc(item.time + ' · ' + item.customer) + '</strong><span>' + esc(item.staff + ' · ' + (item.operation || 'Hizmet belirtilmemiş')) + '</span><small>' + esc(price + ' · ' + status) + '</small></button>';
      });
      html += '</section>';
    }
    return html + '</div>';
  }
  function monthGrid(items) {
    var first = monthStart(state.date), start = monday(first), next = nextMonth(first, 1), days = [], counts = new Map();
    items.forEach(function (item) { counts.set(item.date, (counts.get(item.date) || 0) + 1); });
    for (var day = start; days.length < 42; day = moveDay(day, 1)) {
      var outside = day < first || day >= next, count = outside ? 0 : counts.get(day) || 0;
      var selected = day === state.monthSelectedDay && !outside;
      days.push('<button type="button" class="practical-month-day' + (outside ? ' outside' : '') + (day === today() ? ' today' : '') + (selected ? ' selected' : '') + '" data-day="' + day + '" aria-label="' + esc(title(day, { day: 'numeric', month: 'long', year: 'numeric' }) + (count ? ', ' + count + ' randevu' : ', randevu yok')) + '"' + (outside ? ' disabled aria-hidden="true"' : selected ? ' aria-pressed="true"' : '') + '>' + (outside ? '' : '<span>' + Number(day.slice(8)) + '</span>' + (count ? '<small>' + count + ' randevu</small>' : '')) + '</button>');
      if (days.length >= 35 && day >= moveDay(next, -1) && asDate(day).getUTCDay() === 0) break;
    }
    return '<div class="practical-month" aria-label="Aylık takvim"><div class="practical-weekdays"><span>Pzt</span><span>Sal</span><span>Çar</span><span>Per</span><span>Cum</span><span>Cmt</span><span>Paz</span></div><div class="practical-month-grid">' + days.join('') + '</div></div>';
  }

  function render() {
    if (!user()) return;
    ensurePage(); controls();
    var notice = document.getElementById('practicalNotice'), body = document.getElementById('practicalBody');
    document.getElementById('practicalTitle').textContent = state.view === 'month' ? title(monthStart(state.date), { month: 'long', year: 'numeric' }) : state.view === 'week' ? title(monday(state.date), { day: 'numeric', month: 'short' }) + ' – ' + title(moveDay(monday(state.date), 6), { day: 'numeric', month: 'short', year: 'numeric' }) : title(state.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('practicalJump').value = state.date;
    if (state.loading) { notice.textContent = 'Randevular yükleniyor…'; body.replaceChildren(); return; }
    if (state.error) { notice.textContent = 'Randevular yüklenemedi: ' + state.error; body.replaceChildren(); return; }
    var items = state.rows.filter(matches);
    var firstVisible = state.view === 'month' ? monthStart(state.date) : state.view === 'week' ? monday(state.date) : state.date;
    var lastVisible = state.view === 'month' ? nextMonth(state.date, 1) : moveDay(firstVisible, state.view === 'week' ? 7 : 1);
    var visibleCount = items.filter(function (item) { return item.date >= firstVisible && item.date < lastVisible; }).length;
    notice.textContent = state.view === 'month'
      ? (state.monthSelectedDay && state.monthSelectedDay >= firstVisible && state.monthSelectedDay < lastVisible
        ? title(state.monthSelectedDay, { day: 'numeric', month: 'long' }) + ' · ' + rowsFor(state.monthSelectedDay, items).length + ' randevu'
        : title(firstVisible, { month: 'long', year: 'numeric' }) + ' · Toplam ' + visibleCount + ' randevu')
      : visibleCount + ' randevu';
    if (state.view === 'month') { body.innerHTML = monthGrid(items); return; }
    if (state.view === 'week') { body.innerHTML = weekGrid(items); return; }
    body.innerHTML = dayGrid(items);
  }

  async function fetchPages(start, end) {
    var rows = new Map();
    for (var offset = 0; ; offset += PAGE_SIZE) {
      var query = salonDb.from('appointments').select('*').gte('scheduled_at', start).lt('scheduled_at', end)
        .order('scheduled_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      var response = await query;
      if (response.error) throw response.error;
      var batch = response.data || [];
      batch.forEach(function (item) { rows.set(String(item.id), item); });
      if (batch.length < PAGE_SIZE) return Array.from(rows.values());
    }
  }

  async function load(force) {
    if (!user()) return;
    if (!window.salonDb) { state.loading = false; state.error = 'Canlı veri bağlantısı kurulamadı.'; render(); return; }
    var key = currentKey();
    if (!force && state.key === key && !state.error) { render(); return; }
    var generation = ++state.generation, actor = user().id;
    state.loading = true; state.error = ''; state.rows = []; state.key = '';
    render();
    var range = visibleRange();
    try {
      var result = await Promise.all([fetchPages(range.start, range.end), state.view === 'day' ? loadHours(state.date) : Promise.resolve(null)]);
      if (generation !== state.generation || actor !== user()?.id || key !== currentKey()) return;
      state.rows = result[0].map(remoteAppointment).filter(function (item) { return manager() || String(item.employeeId) === String(actor); });
      state.hours = result[1];
      state.key = key; state.loading = false;
      render();
    } catch (error) {
      if (generation !== state.generation || actor !== user()?.id) return;
      state.loading = false; state.error = error.message || 'Bağlantıyı kontrol edin.';
      render();
    }
  }

  function setDate(date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return; state.date = date; load(false); }
  function installDaySwipe(area) {
    var startX = 0, startY = 0, tracking = false;
    area.addEventListener('touchstart', function (event) {
      tracking = state.view === 'day' && event.touches.length === 1;
      if (tracking) { startX = event.touches[0].clientX; startY = event.touches[0].clientY; }
    }, { passive: true });
    area.addEventListener('touchend', function (event) {
      if (!tracking || state.view !== 'day' || !event.changedTouches.length) return;
      tracking = false;
      var dx = event.changedTouches[0].clientX - startX, dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      event.preventDefault();
      setDate(moveDay(state.date, dx < 0 ? 1 : -1));
    }, { passive: false });
    area.addEventListener('touchcancel', function () { tracking = false; }, { passive: true });
  }
  function click(event) {
    var button = event.target.closest('button'); if (!button) return;
    if (button.dataset.view) { if (button.dataset.view === 'month' && state.view !== 'month') state.monthSelectedDay = state.date; state.view = button.dataset.view; load(false); return; }
    if (button.dataset.nav) {
      if (button.dataset.nav === 'today') { state.view = 'day'; setDate(today()); }
      else { var amount = button.dataset.nav === 'next' ? 1 : -1; if (state.view === 'month') state.monthSelectedDay = null; setDate(state.view === 'month' ? nextMonth(state.date, amount) : moveDay(state.date, amount * (state.view === 'week' ? 7 : 1))); }
      return;
    }
    if (button.dataset.day) { state.view = 'day'; setDate(button.dataset.day); return; }
    if (button.dataset.employee && manager()) { state.staff = button.dataset.employee; render(); return; }
    if (button.id === 'practicalAll' && manager()) { state.staff = ''; render(); return; }
    if (button.dataset.slotTime && manager() && !button.disabled) { createAppointment(button.dataset.slotTime, button.dataset.slotStaff); return; }
    if (button.dataset.appointment) {
      var item = state.rows.find(function (row) { return String(row.id) === button.dataset.appointment; });
      if (item && matches(item)) {
        var globalItem = typeof appts === 'undefined' ? null : appts.find(function (row) { return String(row.id) === String(item.id); });
        if (globalItem) Object.assign(globalItem, item);
        window.SalonCalendarUI?.open(item);
        var actions = document.querySelector('#smartAppointmentPanel.show #smartPanelActions');
        if (manager() && actions) {
          var move = document.createElement('button');
          move.type = 'button'; move.dataset.action = 'move'; move.textContent = 'Taşı';
          move.addEventListener('click', function () {
            document.querySelector('#smartAppointmentPanel .smart-panel-close')?.click();
            if (typeof appts !== 'undefined' && !appts.some(function (row) { return String(row.id) === String(item.id); })) appts.push(item);
            window.openAppointmentModal('', item.id);
            document.getElementById('appointmentDate')?.focus();
          });
          actions.appendChild(move);
        }
      }
      return;
    }
  }
  function createAppointment(time, employeeId) {
    if (!manager()) return;
    window.openAppointmentModal();
    var date = document.getElementById('appointmentDate'); if (date) date.value = state.date;
    var employee = remoteProfiles.find(function (person) { return String(person.id) === String(employeeId || state.staff); });
    if (employee) document.getElementById('appointmentStaff').value = employee.full_name;
    var selectedTime = document.getElementById('appointmentTime'); if (selectedTime && typeof time === 'string') selectedTime.value = time;
    window.updateDateCaption?.(); window.refreshAppointmentTimeAvailability?.();
  }

  var previousShowPage = window.showPage;
  window.showPage = function (id) {
    if (id !== 'practicalCalendar') return previousShowPage.apply(this, arguments);
    if (!user()) return;
    ensurePage(); ensureMenu();
    state.view = 'day';
    state.staff = manager() ? '' : user().id;
    document.querySelectorAll('.page').forEach(function (page) { page.classList.remove('active'); });
    document.getElementById('practicalCalendar').classList.add('active');
    window.scrollTo(0, 0);
    render();
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
