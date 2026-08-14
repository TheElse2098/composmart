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

  // Sans .html : la 301 du .htaccess (strip d'extension) génère un Location en
  // http:// derrière le proxy TLS → mixed content bloqué en HTTPS.
  fetch('/partials/site-nav')
    .then(function (r) {
      if (!r.ok) throw new Error('partial HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) {
      mount.innerHTML = html;
      wire();
    })
    .catch(function () { /* échec silencieux : la page reste utilisable sans nav injectée */ });

  function wire() {
    var burger  = document.getElementById('burgerBtn');
    var drawer  = document.getElementById('drawer');
    var overlay = document.getElementById('overlay');
    var closeBtn = document.getElementById('closeBtn');

    // #site-nav est `position: sticky` (cf. desktop.css) pour coller le bandeau
    // en haut de page. Un ancêtre en position non-static — sticky y compris —
    // crée un nouveau contexte de positionnement : les descendants en
    // `position: fixed` (le drawer et son overlay) se calent alors sur CET
    // ancêtre plutôt que sur la fenêtre. #site-nav ne fait dans son flux normal
    // que la hauteur du <nav> (~52px), donc le drawer — top:0, height:100vh —
    // se retrouvait comprimé dans cette bande au lieu de couvrir tout l'écran.
    // On les sort du sous-arbre AVANT tout affichage : plus aucun ancêtre
    // positionné entre eux et <body>.
    if (drawer)  document.body.appendChild(drawer);
    if (overlay) document.body.appendChild(overlay);

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

    // Marque le lien actif d'après l'URL courante (data-match = liste de chemins).
    // Cible à la fois la barre desktop (.nav-links, restée dans #site-nav) et la
    // sidebar mobile (.drawer-menu, déplacée sous <body> juste au-dessus) : le
    // drawer n'étant plus un descendant de #site-nav, le sélecteur doit couvrir
    // les deux emplacements plutôt que de se limiter à #site-nav.
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    document.querySelectorAll('#site-nav a[data-match], #drawer a[data-match]').forEach(function (a) {
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
