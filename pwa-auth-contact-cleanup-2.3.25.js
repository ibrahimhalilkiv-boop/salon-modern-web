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
