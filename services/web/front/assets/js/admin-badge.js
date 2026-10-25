/* ============================================================================
   admin-badge.js — case rouge « Admin » du bandeau, pour les administrateurs.

   Le bandeau partagé (partials/site-nav.html) contient déjà la case en trois
   exemplaires masqués : ce script les révèle si /api/auth/me.php répond
   isAdmin, et les marque actifs sur les pages d'administration.

   Pages sans bandeau partagé (jeux en plein écran, qui ont leur propre <nav>),
   ou partial resté en cache dans une ancienne version : la case est créée et
   insérée dans la zone droite (.nav-right), comme l'était l'ancienne pastille.

   Raccourci d'affichage uniquement : les droits sont vérifiés côté serveur par
   chaque page d'administration.
   ============================================================================ */
(function () {
  // Espaces d'administration : /admin (hub, panel, cours), /jeux-admin, /evenements-admin.
  var PREFIXES = ['/admin', '/jeux-admin', '/evenements-admin'];
  var isAdminCached = false;

  function surPageAdmin() {
    var p = window.location.pathname.replace(/\/+$/, '');
    return PREFIXES.some(function (x) { return p === x || p.indexOf(x + '/') === 0; });
  }

  function creerCase() {
    var a = document.createElement('a');
    a.id = 'adminBadge';
    a.href = '/admin';
    a.className = 'nav-admin-mini';
    a.textContent = 'Admin';
    // Styles en ligne : ces pages ne chargent pas forcément desktop.css.
    a.style.cssText = [
      'display:inline-flex', 'align-items:center', 'background:#e53935', 'color:#fff',
      'font-family:Nunito,Arial,sans-serif', 'font-size:0.78rem', 'font-weight:900',
      'letter-spacing:0.5px', 'padding:5px 12px', 'border-radius:20px',
      'text-decoration:none', 'flex-shrink:0', 'white-space:nowrap',
      'box-shadow:0 1px 4px rgba(229,57,53,0.4)'
    ].join(';');
    return a;
  }

  // Insensible à l'ordre : appelé au retour du fetch ET après l'injection du nav.
  function tryInject() {
    if (!isAdminCached) return;

    var cases = document.querySelectorAll('.nav-admin, .nav-admin-mini');
    if (!cases.length) {
      var navRight = document.querySelector('.nav-right');
      if (!navRight || document.getElementById('adminBadge')) return;
      var profil = navRight.querySelector('.nav-profil');
      navRight.insertBefore(creerCase(), profil || navRight.firstChild);
      cases = document.querySelectorAll('.nav-admin-mini');
    }

    var actif = surPageAdmin();
    cases.forEach(function (el) {
      el.hidden = false;
      var lien = el.tagName === 'A' ? el : el.querySelector('a');
      if (lien && actif) lien.classList.add('active');
    });
  }

  // Pas de cache serveur — appel direct pour toujours avoir l'état réel
  fetch('/api/auth/me.php')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.logged_in && d.isAdmin) { isAdminCached = true; tryInject(); }
    })
    .catch(function () {});

  // Rappelé par site-nav.js une fois le bandeau injecté.
  window.refreshAdminBadge = tryInject;
})();
