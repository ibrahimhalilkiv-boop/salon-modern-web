(function () {
  'use strict';
  var generation = 0;
  var PAGE_SIZE = 500;

  function nextGeneration() { return ++generation; }
  function isCurrent(value) { return value === generation; }

  function monthBounds(day) {
    var date = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    var month = date.slice(0, 7);
    var next = new Date(month + '-01T12:00:00Z');
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { start: month + '-01T00:00:00+03:00', end: next.toISOString().slice(0, 7) + '-01T00:00:00+03:00' };
  }

  function dayBounds(day) {
    var date = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    var next = new Date(date + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    return { start: date + 'T00:00:00+03:00', end: next.toISOString().slice(0, 10) + 'T00:00:00+03:00' };
  }

  function calendarBounds(day, earliestDay) {
    var bounds = monthBounds(day);
    if (earliestDay) bounds.start = bounds.start > dayBounds(earliestDay).start ? bounds.start : dayBounds(earliestDay).start;
    return bounds;
  }

  async function pages(db, columns, start, end) {
    var rows = [];
    var cursor = null;
    for (;;) {
      var query = db.from('appointments').select(columns).neq('status', 'cancelled')
        .order('scheduled_at', { ascending: false }).order('id', { ascending: false })
        .limit(PAGE_SIZE);
      if (start) query = query.gte('scheduled_at', start);
      if (end) query = query.lt('scheduled_at', end);
      if (cursor) {
        if (!/^[0-9TZ:.+\-]+$/.test(cursor.scheduled_at) || !/^[a-f0-9-]+$/i.test(cursor.id))
          throw new Error('Randevu sayfalama anahtarı geçersiz.');
        query = query.or('scheduled_at.lt.' + cursor.scheduled_at +
          ',and(scheduled_at.eq.' + cursor.scheduled_at + ',id.lt.' + cursor.id + ')');
      }
      var response = await query;
      if (response.error) throw response.error;
      var batch = response.data || [];
      rows.push.apply(rows, batch);
      if (batch.length < PAGE_SIZE) return rows;
      cursor = batch[batch.length - 1];
    }
  }

  async function loadVisible(db, columns, day, earliestDay) {
    var bounds = calendarBounds(day, earliestDay);
    if (bounds.start >= bounds.end) return [];
    return pages(db, columns, bounds.start, bounds.end);
  }

  async function load(db, columns, day, onVisible, onDay, earliestDay) {
    var bounds = calendarBounds(day, earliestDay);
    // Prioritize the selected day's query on cold startup. Month paging
    // starts only after the day is shown, so it cannot compete with first paint.
    // Both paths still use stable keyset pagination; no appointments are omitted.
    if (onDay) {
      var today = dayBounds(day);
      var dayRows = await pages(db, columns, today.start, today.end);
      await onDay(dayRows);
    }
    var monthRequest = pages(db, columns, bounds.start, bounds.end)
      .then(function (rows) { return { rows: rows }; }, function (error) { return { error: error }; });
    var monthResult = await monthRequest;
    if (monthResult.error) throw monthResult.error;
    var visible = monthResult.rows;
    if (onVisible) await onVisible(visible);
    var other = await Promise.all([
      pages(db, columns, null, bounds.start),
      pages(db, columns, bounds.end, null)
    ]);
    return visible.concat(other[0], other[1]).sort(function (a, b) {
      return a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id);
    });
  }

  window.SalonAppointmentData = { load: load, loadVisible: loadVisible, nextGeneration: nextGeneration, isCurrent: isCurrent, monthBounds: monthBounds, dayBounds: dayBounds, calendarBounds: calendarBounds };
})();
