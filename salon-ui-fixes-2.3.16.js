(function(){
'use strict';
window.SALON_APP_VERSION='2.3.20';
document.querySelectorAll('#appVersion,[data-app-version]').forEach(function(node){node.textContent='v2.3.20'});
document.querySelectorAll('.auth small').forEach(function(node){if(/^v\d+\.\d+\.\d+$/.test(node.textContent.trim()))node.textContent='v2.3.20'});
})();

// Takvim yüklemesi salon-appointment-data.js üzerinden tek kaynakta yönetilir.
