(function () {
  function injectBadge() {
    if (document.getElementById('adminBadge')) return;
    var badge = document.createElement('a');
    badge.id = 'adminBadge';
    badge.href = '/admin';
    badge.textContent = 'ADMIN';
    badge.title = 'Tableau de bord admin';
    badge.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'background:#e53935',
      'color:#fff',
      'font-size:0.58rem',
      'font-weight:900',
      'padding:3px 8px',
      'border-radius:10px',
      'letter-spacing:1.2px',
      'font-family:sans-serif',
      'text-transform:uppercase',
      'flex-shrink:0',
      'box-shadow:0 1px 4px rgba(229,57,53,0.4)',
      'cursor:pointer',
      'text-decoration:none',
    ].join(';');

    var profil = document.querySelector('.nav-profil');
    var navRight = document.querySelector('.nav-right');
    if (profil && profil.parentNode) {
      profil.parentNode.insertBefore(badge, profil);
    } else if (navRight) {
      navRight.insertBefore(badge, navRight.firstChild);
    }
  }

  var isAdminCached = false;

  // Pas de cache serveur — appel direct pour toujours avoir l'état réel
  fetch('/api/auth/me.php')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.logged_in && d.isAdmin) { isAdminCached = true; injectBadge(); }
    })
    .catch(function () {});

  // Le nav peut être injecté après ce fetch (nav partagé) : site-nav.js rappelle
  // cette fonction une fois le bandeau en place, pour (ré)insérer le badge si admin.
  window.refreshAdminBadge = function () { if (isAdminCached) injectBadge(); };
})();
