(function () {
  'use strict';
  var previousRender = window.renderCalendar;
  window.renderCalendar = function () {
    var result = previousRender.apply(this, arguments);
    var target = document.getElementById('calendarContent');
    if (!target) return result;
    var state = window.salonCalendarLoadState;
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
