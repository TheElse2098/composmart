/* ============================================================================
   amorce.js — pose le thème sombre avant le premier affichage.

   Seul script du site qui ne soit pas un module : il doit s'exécuter pendant
   la lecture du <head>, avant que la page ne soit peinte, sinon un visiteur en
   thème sombre voit un éclair blanc à chaque chargement. Il remplace la ligne
   de script recopiée dans le <head> de chaque page.

   Usage, avant les feuilles de style :
     <script src="/ui/socle/amorce.js"></script>
   ============================================================================ */
(function () {
  try {
    if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {
    // Stockage inaccessible : thème clair.
  }
})();
