/* ============================================================================
   verif-banner.js — passerelle : pose le rappel « confirme ton adresse email »
   dans les pages pas encore migrées.

   Le rappel lui-même vit dans /ui/composants/rappel-email/ : il ne s'affiche
   que pour un compte connecté dont l'adresse n'est pas confirmée. Ce script
   place le composant <cs-rappel-email> sous le bandeau et charge son module.

   Une page migrée écrit directement <cs-rappel-email> et n'a plus besoin de ce
   fichier, qui disparaîtra avec la dernière page historique
   (docs/front.md, « Transition »).

   Usage dans une page historique : <script src="/assets/js/verif-banner.js"></script>
   ============================================================================ */
(function () {
  if (document.querySelector('cs-rappel-email')) return; // déjà posé

  // Sous le bandeau ; en tête de page s'il n'y en a pas.
  var rappel = document.createElement('cs-rappel-email');
  var bandeau = document.getElementById('site-nav');
  if (bandeau) bandeau.after(rappel);
  else document.body.prepend(rappel);

  var module = document.createElement('script');
  module.type = 'module';
  module.src = '/ui/composants/rappel-email/rappel-email.js';
  module.onerror = function () { console.error('[verif-banner] rappel indisponible'); };
  document.head.appendChild(module);
})();
