/* ============================================================================
   site-nav.js — injecte le bandeau + la sidebar partagés (partials/site-nav.html)
   et câble les interactions (ouvrir/fermer le menu, lien actif).

   Usage dans une page :
     <div id="site-nav"></div>
     <script src="/assets/js/site-nav.js"></script>
   (Le CSS du nav/drawer reste dans le <style> de la page ou un CSS partagé.)
   ============================================================================ */
(function () {
  var mount = document.getElementById('site-nav');
  if (!mount) { console.warn('[site-nav] pas de <div id="site-nav"> sur cette page'); return; }

  fetch('/partials/site-nav.html')
    .then(function (r) {
      if (!r.ok) throw new Error('partial HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) {
      mount.innerHTML = html;
      wire();
    })
    .catch(function (e) { console.error('[site-nav] injection échouée :', e); });

  function wire() {
    var burger  = document.getElementById('burgerBtn');
    var drawer  = document.getElementById('drawer');
    var overlay = document.getElementById('overlay');
    var closeBtn = document.getElementById('closeBtn');

    function openMenu() {
      drawer.classList.add('open'); overlay.classList.add('open');
      burger.classList.add('open'); document.body.style.overflow = 'hidden';
    }
    function closeMenu() {
      drawer.classList.remove('open'); overlay.classList.remove('open');
      burger.classList.remove('open'); document.body.style.overflow = '';
    }
    if (burger)   burger.addEventListener('click', openMenu);
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    if (overlay)  overlay.addEventListener('click', closeMenu);
    // Échap ferme le menu
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

    // Marque le lien actif d'après l'URL courante (data-match = liste de chemins)
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    document.querySelectorAll('.drawer-menu a[data-match]').forEach(function (a) {
      var matches = a.getAttribute('data-match').split(',');
      for (var i = 0; i < matches.length; i++) {
        var m = matches[i].trim().replace(/\/+$/, '') || '/';
        if (m === path) { a.classList.add('active'); break; }
      }
    });

    // Recâblages des scripts qui dépendent du nav (injecté ici, donc après eux).
    if (window.initThemeToggle)   window.initThemeToggle();   // icône thème
    if (window.refreshAdminBadge) window.refreshAdminBadge(); // badge ADMIN
  }
})();
