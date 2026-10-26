/* ============================================================================
   confirmer.js — boîte de confirmation intégrée à la page.

   Remplace confirm() natif, qui a trois défauts en atelier : il est laid et
   dépareillé, il bloque tout le fil d'exécution (le sondage de la console se
   fige derrière), et certains navigateurs mobiles le suppriment purement et
   simplement — l'action passait alors sans confirmation.

   Usage :
     const ok = await confirmer({
       titre: 'Annuler cet événement ?',
       texte: 'Les participants seront déconnectés.',
       valider: 'Annuler l’événement',
       danger: true,
     });
     if (!ok) return;

   Renvoie une promesse résolue à true/false. Échap et le clic hors de la boîte
   valent « non ».

   Pour un simple message (remplace alert()) :
     await informer({ titre: 'Action impossible', texte: d.error });
   Un seul bouton « OK » ; la promesse se résout à la fermeture.
   ============================================================================ */
(function () {
  var CSS = [
    '.cfm-fond{position:fixed;inset:0;background:rgba(15,24,17,.55);z-index:900;display:flex;align-items:center;justify-content:center;padding:18px;opacity:0;transition:opacity .18s}',
    '.cfm-fond.ouvert{opacity:1}',
    '.cfm-boite{background:#fff;border-radius:18px;max-width:420px;width:100%;padding:24px;box-shadow:0 18px 50px rgba(0,0,0,.28);transform:translateY(8px) scale(.98);transition:transform .18s}',
    '.cfm-fond.ouvert .cfm-boite{transform:none}',
    '.cfm-titre{font-family:"Baloo 2",cursive;font-weight:900;font-size:1.12rem;color:#1a3a25;margin-bottom:8px}',
    '.cfm-texte{font-size:.92rem;line-height:1.55;color:#4a7a5a;font-weight:600}',
    '.cfm-actions{display:flex;gap:9px;margin-top:20px}',
    '.cfm-actions button{flex:1;border:none;border-radius:50px;padding:11px 16px;font-family:"Baloo 2",cursive;font-weight:800;font-size:.88rem;cursor:pointer}',
    '.cfm-non{background:#eceff1;color:#607d8b}',
    '.cfm-oui{background:#1e6e3e;color:#fff}',
    '.cfm-oui.danger{background:#c0392b}',
    '.cfm-actions button:focus-visible{outline:3px solid #a8e6bf;outline-offset:2px}',
    'html.dark .cfm-boite{background:#1a2b1e}',
    'html.dark .cfm-titre{color:#e8f5ee}',
    'html.dark .cfm-texte{color:#9fb8a8}',
    'html.dark .cfm-non{background:#243328;color:#9fb0a5}',
  ].join('');

  var styleFait = false;
  function poserStyle() {
    if (styleFait) return;
    styleFait = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function echapper(t) {
    var d = document.createElement('div');
    d.textContent = (t == null ? '' : String(t));
    return d.innerHTML;
  }

  window.confirmer = function (opts) {
    opts = opts || {};
    poserStyle();

    return new Promise(function (resoudre) {
      var fond = document.createElement('div');
      fond.className = 'cfm-fond';
      fond.innerHTML =
        '<div class="cfm-boite" role="dialog" aria-modal="true">'
        + '<div class="cfm-titre">' + echapper(opts.titre || 'Confirmer ?') + '</div>'
        + (opts.texte ? '<div class="cfm-texte">' + echapper(opts.texte) + '</div>' : '')
        + '<div class="cfm-actions">'
        + (opts.seul ? '' : '<button type="button" class="cfm-non">' + echapper(opts.annuler || 'Annuler') + '</button>')
        + '<button type="button" class="cfm-oui' + (opts.danger ? ' danger' : '') + '">'
        + echapper(opts.valider || 'Confirmer') + '</button>'
        + '</div></div>';
      document.body.appendChild(fond);
      requestAnimationFrame(function () { fond.classList.add('ouvert'); });

      var fini = false;
      function fermer(reponse) {
        if (fini) return;
        fini = true;
        document.removeEventListener('keydown', auClavier);
        fond.classList.remove('ouvert');
        // On attend la fin de la transition avant de retirer du DOM, sinon la
        // boîte disparaît d'un coup au lieu de se fondre.
        setTimeout(function () { if (fond.parentNode) fond.parentNode.removeChild(fond); }, 200);
        resoudre(reponse);
      }
      function auClavier(ev) {
        if (ev.key === 'Escape') fermer(false);
        if (ev.key === 'Enter') fermer(true);
      }

      if (!opts.seul) fond.querySelector('.cfm-non').onclick = function () { fermer(false); };
      fond.querySelector('.cfm-oui').onclick = function () { fermer(true); };
      fond.onclick = function (ev) { if (ev.target === fond) fermer(false); };
      document.addEventListener('keydown', auClavier);

      // Le focus part sur « Confirmer » : Entrée valide, Échap annule.
      fond.querySelector('.cfm-oui').focus();
    });
  };

  window.informer = function (opts) {
    opts = opts || {};
    return window.confirmer({
      titre: opts.titre || 'Information',
      texte: opts.texte,
      valider: opts.valider || 'OK',
      seul: true,
    });
  };
})();
