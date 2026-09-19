(function () {
  'use strict';

  var navigatingFromHistory = false;
  var currentPage = document.querySelector('.page.active')?.id || 'home';
  var previousShowPage = window.showPage;

  function closeOverlay() {
    var modal = document.querySelector('.modal.show, dialog[open]');
    if (modal) {
      if (modal.tagName === 'DIALOG') modal.close();
      else modal.classList.remove('show');
      return true;
    }
    var drawer = document.getElementById('drawerLayer');
    if (drawer && drawer.classList.contains('open')) {
      drawer.classList.remove('open');
      return true;
    }
    return false;
  }

  if (typeof previousShowPage === 'function') {
    window.showPage = function (id) {
      var target = id === 'appointments' ? 'calendar' : id;
      var result = previousShowPage.apply(this, arguments);
      var visible = document.querySelector('.page.active')?.id || target || 'home';
      if (!navigatingFromHistory && visible !== currentPage) {
        history.pushState({ salonPage: visible }, '', location.href);
      }
      currentPage = visible;
      return result;
    };
  }

  history.replaceState({ salonPage: currentPage, salonRoot: true }, '', location.href);
  history.pushState({ salonPage: currentPage }, '', location.href);

  window.addEventListener('popstate', function (event) {
    if (closeOverlay()) {
      history.pushState({ salonPage: currentPage }, '', location.href);
      return;
    }
    var target = event.state && event.state.salonPage;
    if (!target || (event.state && event.state.salonRoot && currentPage === 'home')) {
      history.pushState({ salonPage: 'home' }, '', location.href);
      if (currentPage !== 'home') {
        navigatingFromHistory = true;
        window.showPage('home');
        navigatingFromHistory = false;
        currentPage = 'home';
      }
      return;
    }
    navigatingFromHistory = true;
    window.showPage(target);
    navigatingFromHistory = false;
    currentPage = target;
  });
})();
