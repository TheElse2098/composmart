/* ============================================================================
   site-nav.js — passerelle : pose le bandeau dans les pages pas encore migrées.

   Ces pages contiennent <div id="site-nav"></div> et chargent ce script. Il
   remplace le conteneur par le composant <cs-bandeau> et charge son module.
   Le bandeau lui-même — menu, tiroir, case « Admin », bouton de thème — vit
   dans /ui/composants/bandeau/ : c'est là qu'il se modifie.

   Une page migrée écrit directement <cs-bandeau> et n'a plus besoin de ce
   fichier, qui disparaîtra avec la dernière page historique
   (docs/front.md, « Transition »).

   Usage dans une page historique :
     <div id="site-nav"></div>
     <script src="/assets/js/site-nav.js"></script>
   ============================================================================ */
(function () {
  var mount = document.getElementById('site-nav');
  if (!mount) { console.warn('[site-nav] pas de <div id="site-nav"> sur cette page'); return; }
  if (mount.localName === 'cs-bandeau') return; // déjà posé

  // La feuille d'abord : la bande verte est réservée avant l'arrivée du composant.
  var feuille = document.createElement('link');
  feuille.rel = 'stylesheet';
  feuille.href = '/ui/composants/bandeau/bandeau.css';
  document.head.appendChild(feuille);

  // Même identifiant que le conteneur : des pages le visent encore (mode
  // projection du suivi d'atelier).
  var bandeau = document.createElement('cs-bandeau');
  bandeau.id = 'site-nav';
  mount.replaceWith(bandeau);

  var module = document.createElement('script');
  module.type = 'module';
  module.src = '/ui/composants/bandeau/bandeau.js';
  module.onerror = function () { console.error('[site-nav] bandeau indisponible'); };
  document.head.appendChild(module);
})();
