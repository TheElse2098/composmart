(function () {
  var CACHE_KEY = 'cs_me';
  var CACHE_TTL = 5 * 60 * 1000;

  function injectBadge() {
    if (document.getElementById('adminBadge')) return;
    var badge = document.createElement('span');
    badge.id = 'adminBadge';
    badge.textContent = 'ADMIN';
    badge.style.cssText = [
      'background:#e53935',
      'color:#fff',
      'font-size:0.58rem',
      'font-weight:900',
      'padding:3px 8px',
      'border-radius:10px',
      'letter-spacing:1.2px',
      'font-family:sans-serif',
      'text-transform:uppercase',
      'vertical-align:middle',
      'flex-shrink:0',
      'box-shadow:0 1px 4px rgba(229,57,53,0.4)',
    ].join(';');

    // Insérer avant l'icône profil, ou au début de nav-right
    var profil = document.querySelector('.nav-profil');
    var navRight = document.querySelector('.nav-right');
    if (profil && profil.parentNode) {
      profil.parentNode.insertBefore(badge, profil);
    } else if (navRight) {
      navRight.insertBefore(badge, navRight.firstChild);
    }
  }

  function check(data) {
    if (data && data.logged_in && data.isAdmin) injectBadge();
  }

  // Cache sessionStorage
  try {
    var raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      var cached = JSON.parse(raw);
      if (Date.now() - cached.ts < CACHE_TTL) { check(cached.data); return; }
    }
  } catch (e) {}

  fetch('/api/auth/me.php')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: d, ts: Date.now() })); } catch (e) {}
      check(d);
    })
    .catch(function () {});
})();
