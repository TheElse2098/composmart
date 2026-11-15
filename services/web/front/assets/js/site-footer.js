/* ============================================================================
   site-footer.js — passerelle : pose le pied de page dans les pages pas encore
   migrées.

   Ces pages contiennent <div id="site-footer"></div> et chargent ce script. Il
   remplace le conteneur par le composant <cs-pied> et charge son module. Le
   pied lui-même vit dans /ui/composants/pied/ : c'est là qu'il se modifie.

   Une page migrée écrit directement <cs-pied> et n'a plus besoin de ce
   fichier, qui disparaîtra avec la dernière page historique
   (docs/front.md, « Transition »).

   Usage dans une page historique :
     <div id="site-footer"></div>
     <script src="/assets/js/site-footer.js"></script>
   ============================================================================ */
(function () {
  var mount = document.getElementById('site-footer');
  if (!mount || mount.localName === 'cs-pied') return;

  // Même identifiant que le conteneur : la page des ateliers le vise pour
  // masquer le pied pendant un parcours.
  var pied = document.createElement('cs-pied');
  pied.id = 'site-footer';
  mount.replaceWith(pied);

  var module = document.createElement('script');
  module.type = 'module';
  module.src = '/ui/composants/pied/pied.js';
  module.onerror = function () { console.error('[site-footer] pied de page indisponible'); };
  document.head.appendChild(module);
})();
