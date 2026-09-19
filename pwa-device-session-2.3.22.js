(function () {
  'use strict';

  var DEVICE_ID_KEY = 'salonModernTrustedDeviceIdV1';
  var DEVICE_USER_KEY = 'salonModernTrustedUserIdV1';
  var DEVICE_SEEN_KEY = 'salonModernTrustedDeviceSeenV1';
  var EXPLICIT_LOGOUT_KEY = 'salonModernExplicitLogoutV1';

  function deviceId() {
    var value = localStorage.getItem(DEVICE_ID_KEY);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem(DEVICE_ID_KEY, value);
    }
    return value;
  }

  function trustSession(session) {
    if (!session || !session.user) return;
    deviceId();
    localStorage.setItem(DEVICE_USER_KEY, session.user.id);
    localStorage.setItem(DEVICE_SEEN_KEY, new Date().toISOString());
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
  }

  function forgetSession() {
    localStorage.removeItem(DEVICE_USER_KEY);
    localStorage.removeItem(DEVICE_SEEN_KEY);
    localStorage.setItem(EXPLICIT_LOGOUT_KEY, 'true');
  }

  var previousLogin = window.login;
  if (typeof previousLogin === 'function') {
    window.login = async function () {
      var result = await previousLogin.apply(this, arguments);
      var sessionResult = await salonDb.auth.getSession();
      if (sessionResult.data && sessionResult.data.session) trustSession(sessionResult.data.session);
      return result;
    };
  }

  var previousLogout = window.logout;
  if (typeof previousLogout === 'function') {
    window.logout = async function () {
      forgetSession();
      return previousLogout.apply(this, arguments);
    };
  }

  salonDb.auth.onAuthStateChange(function (event, session) {
    if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
      trustSession(session);
    }
    if (event === 'SIGNED_OUT') forgetSession();
  });

  salonDb.auth.getSession().then(function (result) {
    if (result.data && result.data.session) trustSession(result.data.session);
  }).catch(function () {
    // Geçici bağlantı hatasında mevcut Supabase session ve cihaz kaydı korunur.
  });
})();
