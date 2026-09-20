(function () {
  'use strict';

  var BUTTON_ID = 'permanentAppointmentCancel';

  function editingId() {
    return typeof editingAppointmentId !== 'undefined' ? editingAppointmentId : null;
  }

  function editingItem() {
    var id = editingId();
    if (!id || typeof appts === 'undefined' || !Array.isArray(appts)) return null;
    return appts.find(function (item) { return String(item.id) === String(id); }) || null;
  }

  function canCancel(item) {
    if (!item || String(item.status || '').toLowerCase() === 'cancelled') return false;
    return typeof window.canManageOwnAppointment !== 'function' || window.canManageOwnAppointment(item);
  }

  function ensureButton() {
    var sheet = document.querySelector('#appointmentModal .sheet');
    if (!sheet) return null;
    var button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = BUTTON_ID;
      button.className = 'save';
      button.textContent = 'Randevuyu iptal et';
      button.style.cssText = 'display:none;margin-top:12px;background:#a9514d;color:#fff';
      button.addEventListener('click', function () {
        var id = editingId();
        if (!id) return;
        window.closeAppointmentModal();
        if (window.SalonAppointmentManagement && typeof window.SalonAppointmentManagement.askCancel === 'function') {
          window.SalonAppointmentManagement.askCancel(id);
        } else if (typeof window.deleteAppointment === 'function') {
          window.deleteAppointment(id);
        }
      });
      var back = sheet.querySelector('button.back');
      if (back) sheet.insertBefore(button, back);
      else sheet.appendChild(button);
    }
    return button;
  }

  function syncButton() {
    var button = ensureButton();
    if (!button) return;
    var visible = document.getElementById('appointmentModal')?.classList.contains('show') && canCancel(editingItem());
    button.style.display = visible ? 'block' : 'none';
  }

  var modal = document.getElementById('appointmentModal');
  ensureButton();
  syncButton();
  if (modal) {
    new MutationObserver(syncButton).observe(modal, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
  }

  document.addEventListener('click', function () {
    queueMicrotask(syncButton);
  }, true);

  window.syncPermanentAppointmentCancelButton = syncButton;
})();
