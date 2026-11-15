/* ============================================================================
   site-footer.js — injecte le footer partagé (partials/site-footer.html).

   Usage dans une page :
     <div id="site-footer"></div>
     <script src="/assets/js/site-footer.js"></script>
   (Le CSS du footer reste dans le <style> de la page, cf. index.html — à
   copier dans les pages qui ne l'ont pas encore.)
   ============================================================================ */
(function () {
  var mount = document.getElementById('site-footer');
  if (!mount) return;

  /* ── Passerelle vers le nouveau pied de page (docs/front.md, « Transition ») ──
     Avec ?ui=2 dans l'adresse, le composant <cs-pied> remplace ce script le
     temps de l'onglet ; ?ui=1 revient à l'ancien. Sans ce paramètre, rien ne
     change. Fonction recopiée de site-nav.js, où elle est expliquée. */
  function nouvelleInterface() {
    try {
      var choix = new URLSearchParams(window.location.search).get('ui');
      if (choix === '2') sessionStorage.setItem('ui', '2');
      else if (choix === '1') sessionStorage.removeItem('ui');
      return sessionStorage.getItem('ui') === '2';
    } catch (e) {
      return false; // stockage inaccessible : ancienne interface
    }
  }

  if (nouvelleInterface()) {
    // Même identifiant que l'ancien conteneur : la page des ateliers le vise
    // pour masquer le pied pendant un parcours.
    var pied = document.createElement('cs-pied');
    pied.id = 'site-footer';
    mount.replaceWith(pied);

    var module = document.createElement('script');
    module.type = 'module';
    module.src = '/ui/composants/pied/pied.js';
    module.onerror = function () { console.error('[site-footer] nouveau pied de page indisponible'); };
    document.head.appendChild(module);
    return;
  }

  // Sans .html : la 301 du .htaccess (strip d'extension) génère un Location en
  // http:// derrière le proxy TLS → mixed content bloqué en HTTPS.
  fetch('/partials/site-footer')
    .then(function (r) {
      if (!r.ok) throw new Error('partial HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) { mount.innerHTML = html; })
    .catch(function () { /* échec silencieux : la page reste utilisable sans footer injecté */ });
})();
