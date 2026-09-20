(function () {
  'use strict';

  var selectedClientId = null;
  var pendingSavedWarning = null;
  var modalWasOpen = false;

  function isManager() {
    return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'yonetici';
  }

  function openDebtTotal(clientId) {
    if (!clientId || typeof remoteDebts === 'undefined' || !Array.isArray(remoteDebts)) return 0;
    return remoteDebts
      .filter(function (debt) {
        return String(debt.client_id || '') === String(clientId) && debt.status === 'open' && Number(debt.amount || 0) > 0;
      })
      .reduce(function (sum, debt) { return sum + Number(debt.amount || 0); }, 0);
  }

  function money(value) {
    return typeof window.formatTry === 'function'
      ? window.formatTry(value)
      : Number(value || 0).toLocaleString('tr-TR') + ' TL';
  }

  function ensureStyle() {
    if (document.getElementById('appointmentDebtWarningStyle')) return;
    var style = document.createElement('style');
    style.id = 'appointmentDebtWarningStyle';
    style.textContent = '\
      .appointment-debt-warning{display:none;margin:12px 0 0;padding:13px 15px;border:2px solid #b94e48;border-radius:14px;background:#fff0ed;color:#8f2f2a;font-weight:800;text-align:center}\
      .appointment-debt-warning.show{display:block;animation:salonDebtPulse .8s ease-in-out 6}\
      .appointment-debt-toast{position:fixed;z-index:10050;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:min(calc(100% - 28px),620px);padding:16px 18px;border-radius:16px;background:#a33f3a;color:#fff;box-shadow:0 12px 35px rgba(79,24,20,.32);font-weight:850;text-align:center;animation:salonDebtPulse .8s ease-in-out 7}\
      @keyframes salonDebtPulse{0%,100%{opacity:1}50%{opacity:.35}}\
      @media(prefers-reduced-motion:reduce){.appointment-debt-warning.show,.appointment-debt-toast{animation:none}}';
    document.head.appendChild(style);
  }

  function ensureInlineWarning() {
    var sheet = document.querySelector('#appointmentModal .sheet');
    if (!sheet) return null;
    var warning = document.getElementById('appointmentDebtWarning');
    if (!warning) {
      warning = document.createElement('div');
      warning.id = 'appointmentDebtWarning';
      warning.className = 'appointment-debt-warning';
      warning.setAttribute('role', 'status');
      warning.setAttribute('aria-live', 'assertive');
      var debtField = document.getElementById('appointmentDebtField');
      var save = sheet.querySelector('button.save');
      sheet.insertBefore(warning, debtField || save);
    }
    return warning;
  }

  function flashInline(client) {
    selectedClientId = client && client.id ? String(client.id) : null;
    var warning = ensureInlineWarning();
    if (!warning) return;
    var total = isManager() ? openDebtTotal(selectedClientId) : 0;
    warning.classList.remove('show');
    if (!total) {
      warning.style.display = 'none';
      warning.textContent = '';
      return;
    }
    warning.textContent = 'Dikkat: Müşterinin toplam açık borcu ' + money(total);
    warning.style.display = 'block';
    void warning.offsetWidth;
    warning.classList.add('show');
  }

  function flashSaved(name, total) {
    if (!isManager() || !total) return;
    document.getElementById('appointmentDebtSavedToast')?.remove();
    var toast = document.createElement('div');
    toast.id = 'appointmentDebtSavedToast';
    toast.className = 'appointment-debt-toast';
    toast.setAttribute('role', 'alert');
    toast.textContent = (name || 'Müşteri') + ' · Toplam açık borç: ' + money(total);
    document.body.appendChild(toast);
    window.setTimeout(function () { toast.remove(); }, 6000);
  }

  function bindForm() {
    var form = document.querySelector('#appointmentModal form');
    if (!form || form.dataset.debtWarningBound) return;
    form.dataset.debtWarningBound = '1';
    form.addEventListener('submit', function () {
      if (!isManager() || (typeof editingAppointmentId !== 'undefined' && editingAppointmentId)) {
        pendingSavedWarning = null;
        return;
      }
      var client = selectedClientId && typeof remoteClients !== 'undefined'
        ? remoteClients.find(function (item) { return String(item.id) === String(selectedClientId); })
        : null;
      var total = openDebtTotal(selectedClientId);
      if (document.getElementById('appointmentOnDebt')?.checked) total += Number(document.getElementById('appointmentAmount')?.value || 0);
      pendingSavedWarning = total ? { name: client?.full_name || document.getElementById('appointmentCustomer')?.value || '', total: total } : null;
    }, true);
  }

  var previousApplyCustomerHistory = typeof applyCustomerHistory === 'function' ? applyCustomerHistory : null;
  if (previousApplyCustomerHistory) {
    applyCustomerHistory = function (client) {
      var result = previousApplyCustomerHistory.apply(this, arguments);
      flashInline(client);
      return result;
    };
  }

  ensureStyle();
  ensureInlineWarning();
  bindForm();
  var modal = document.getElementById('appointmentModal');
  if (modal) {
    modalWasOpen = modal.classList.contains('show');
    new MutationObserver(function () {
      bindForm();
      var isOpen = modal.classList.contains('show');
      if (modalWasOpen && !isOpen && pendingSavedWarning) {
        flashSaved(pendingSavedWarning.name, pendingSavedWarning.total);
        pendingSavedWarning = null;
      }
      if (!isOpen) {
        selectedClientId = null;
        var warning = document.getElementById('appointmentDebtWarning');
        if (warning) { warning.classList.remove('show'); warning.style.display = 'none'; }
      }
      modalWasOpen = isOpen;
    }).observe(modal, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  }
})();
