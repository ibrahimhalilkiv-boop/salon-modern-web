(function () {
  'use strict';

  var CONTACT_SELECTORS = [
    'button[onclick*="pickCustomerContact"]',
    'button[onclick*="importCustomersFromContacts"]'
  ].join(',');

  function removeContactImportUi(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(CONTACT_SELECTORS).forEach(function (button) { button.remove(); });
    document.getElementById('contactImportModal')?.remove();
  }

  // Keep legacy native bridge callbacks harmless, but remove every user-facing entry point.
  window.pickCustomerContact = function () {};
  window.importCustomersFromContacts = function () {};
  window.closeContactImportModal = function () {};

  var style = document.createElement('style');
  style.textContent = CONTACT_SELECTORS + '{display:none!important}';
  document.head.appendChild(style);

  removeContactImportUi(document);
  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) removeContactImportUi(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();

(function () {
  'use strict';
  var previousSetRemoteAuth = window.setRemoteAuth;
  window.setRemoteAuth = function () {
    document.documentElement.dataset.authState = 'UNAUTHENTICATED';
    return previousSetRemoteAuth.apply(this, arguments);
  };
  function isActiveAppointment(item) { return item && String(item.status || 'confirmed').toLowerCase() !== 'cancelled'; }
  function activeAppointments() { return Array.isArray(window.appts) ? window.appts.filter(isActiveAppointment) : []; }
  window.visibleAppointments = function () {
    var rows = activeAppointments();
    return window.currentUser && window.currentUser.role === 'yonetici' ? rows : rows.filter(function (item) { return item.staff === (window.currentUser && window.currentUser.name); });
  };
  window.calendarAppointmentsForMember = function () {
    var rows = activeAppointments();
    return window.teamCalendarMember ? rows.filter(function (item) { return item.staff === window.teamCalendarMember; }) : rows;
  };
  if (typeof window.remoteAppointment === 'function') {
    var previousRemoteAppointment = window.remoteAppointment;
    window.remoteAppointment = function (row) {
      var mapped = previousRemoteAppointment(row);
      mapped.status = row && row.status ? row.status : 'confirmed';
      return mapped;
    };
  }
  function removeDateShortcuts() { document.querySelectorAll('#appointmentModal .date-quick').forEach(function (node) { node.remove(); }); }
  var previousOpenAppointmentModal = window.openAppointmentModal;
  window.openAppointmentModal = function () {
    var result = previousOpenAppointmentModal.apply(this, arguments);
    removeDateShortcuts();
    var id = arguments.length > 1 ? arguments[1] : null;
    if (typeof window.installDirectAppointmentDelete === 'function') {
      window.installDirectAppointmentDelete(id);
      var button = document.getElementById('directAppointmentDelete');
      if (button) button.textContent = 'Randevuyu iptal et';
    }
    return result;
  };
  window.appointmentClick = function (id) {
    var item = activeAppointments().find(function (row) { return String(row.id) === String(id); });
    if (!item) return;
    if (typeof window.canManageOwnAppointment === 'function' && !window.canManageOwnAppointment(item)) {
      window.showAppToast && window.showAppToast('Yetki yok', 'Yalnızca kendi randevularınızı yönetebilirsiniz.');
      return;
    }
    window.openAppointmentModal('', id);
  };
  var previousReloadRemoteData = window.reloadRemoteData;
  window.reloadRemoteData = async function () {
    var result = await previousReloadRemoteData.apply(this, arguments);
    if (Array.isArray(window.appts)) window.appts = window.appts.filter(isActiveAppointment);
    if (typeof window.render === 'function') window.render();
    if (typeof window.renderCalendar === 'function') window.renderCalendar();
    if (typeof window.renderStatistics === 'function') window.renderStatistics();
    return result;
  };
  removeDateShortcuts();
})();
