(function () {
  'use strict';
  var previousRender = window.renderCalendar;
  window.renderCalendar = function () {
    var target = document.getElementById('calendarContent');
    var state = window.salonCalendarLoadState;
    if (!target) return previousRender.apply(this, arguments);
    var result;
    if (window.salonFastCalendarBoot && state && state.status !== 'ready') {
      // No stale/placeholder appointments: render only the authenticated
      // calendar's structure while the first selected day is being fetched.
      var hours = ['08.00','09.00','10.00','11.00','12.00','13.00','14.00','15.00','16.00','17.00','18.00','19.00','20.00'];
      target.innerHTML = '<div class="calendar-date-nav"><strong>Bugünün takvimi hazırlanıyor</strong></div>' +
        '<div class="team-calendar-wrap"><div class="team-calendar" aria-hidden="true" style="grid-template-columns:44px repeat(4,minmax(0,1fr))">' +
        '<div class="team-head">Saat</div>' +
        '<div class="team-head">···</div>'.repeat(4) +
        hours.map(function (hour) {
          return '<div class="team-time">' + hour + '</div>' +
            '<div class="team-cell" style="min-height:27px;opacity:.65"></div>'.repeat(4);
        }).join('') + '</div></div>';
    } else {
      if (state && state.status === 'ready') window.salonFastCalendarBoot = false;
      result = previousRender.apply(this, arguments);
    }
    target.querySelector('#salonCalendarLoadNotice')?.remove();
    target.style.pointerEvents = state && state.status !== 'ready' ? 'none' : '';
    target.setAttribute('aria-busy', state?.status === 'loading' ? 'true' : 'false');
    if (state && state.status !== 'ready') {
      var notice = document.createElement('div');
      notice.id = 'salonCalendarLoadNotice';
      notice.className = 'security';
      notice.setAttribute('role', 'status');
      notice.textContent = state.status === 'loading'
        ? 'Randevular yükleniyor… Bu gün henüz boş olarak doğrulanmadı.'
        : 'Randevular yüklenemedi. Bu gün boş olarak doğrulanmadı. Bağlantıyı kontrol edip takvimi yeniden açın.';
      target.prepend(notice);
    }
    return result;
  };
})();
