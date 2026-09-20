(function () {
  'use strict';

  var reauthStarted = false;

  function todayLabel() {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', weekday: 'long'
    }).format(new Date());
  }

  function refreshVisibleDate() {
    document.querySelectorAll('.top-brand .date').forEach(function (node) {
      node.textContent = todayLabel();
    });
  }

  function hasVerifiedRemoteProfile() {
    return Boolean(typeof currentUser !== 'undefined' && currentUser && currentUser.id && currentUser.name && currentUser.remote);
  }

  function preventLegacySessionScreen() {
    if (hasVerifiedRemoteProfile() || reauthStarted) return;
    var app = document.getElementById('app');
    if (!app || app.classList.contains('hidden')) return;
    reauthStarted = true;
    app.classList.add('hidden');
    document.getElementById('auth')?.classList.add('hidden');
    Promise.resolve(window.startRemoteApp && window.startRemoteApp()).finally(function () {
      reauthStarted = false;
    });
  }

  var previousEnterApp = window.enterApp;
  if (typeof previousEnterApp === 'function') {
    window.enterApp = function () {
      var result = previousEnterApp.apply(this, arguments);
      refreshVisibleDate();
      return result;
    };
  }

  var previousRenderHomeSummary = window.renderHomeSummary;
  if (typeof previousRenderHomeSummary === 'function') {
    window.renderHomeSummary = function () {
      var result = previousRenderHomeSummary.apply(this, arguments);
      refreshVisibleDate();
      return result;
    };
  }

  refreshVisibleDate();
  preventLegacySessionScreen();
  setTimeout(preventLegacySessionScreen, 0);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (!event.data || event.data.type !== 'SALON_SHELL_UPDATED') return;
      if (sessionStorage.getItem('salonShellReloadedV16') === '1') return;
      sessionStorage.setItem('salonShellReloadedV16', '1');
      location.reload();
    });
  }
})();
