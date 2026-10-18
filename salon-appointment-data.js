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

  async function load(db, columns, day) {
    var bounds = monthBounds(day);
    // Read the visible month first. Complete the global set for history,
    // performance, commissions and modules that still use `appts`.
    var visible = await pages(db, columns, bounds.start, bounds.end);
    var other = await Promise.all([
      pages(db, columns, null, bounds.start),
      pages(db, columns, bounds.end, null)
    ]);
    return visible.concat(other[0], other[1]).sort(function (a, b) {
      return a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id);
    });
  }

  window.SalonAppointmentData = { load: load, nextGeneration: nextGeneration, isCurrent: isCurrent, monthBounds: monthBounds };
})();
