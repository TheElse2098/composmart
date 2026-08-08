/* ============================================================================
   verif-banner.js — bandeau « confirme ton adresse email ».

   S'affiche sous le bandeau de navigation pour tout compte connecté dont
   l'adresse n'est pas encore confirmée, avec un bouton de renvoi du lien.
   Rien ne s'affiche pour un visiteur non connecté ni pour un compte vérifié.

   Usage : <script src="/assets/js/verif-banner.js"></script>
   ============================================================================ */
(function () {
  fetch('/api/auth/me.php')
    .then(function (r) { return r.json(); })
    .then(function (me) {
      if (!me || !me.logged_in || me.email_verifie) return;
      injecter(me);
    })
    .catch(function () { /* silencieux : le bandeau est un rappel, pas une fonction vitale */ });

  function injecter(me) {
    var style = document.createElement('style');
    style.textContent = [
      '.verif-bandeau{background:linear-gradient(135deg,#f9a825,#ff8f00);color:#3d2b00;',
      'display:flex;align-items:center;gap:12px;flex-wrap:wrap;',
      'padding:11px 18px;font-family:inherit;font-size:0.86rem;font-weight:700;position:relative;z-index:95}',
      '.verif-bandeau-txt{flex:1;min-width:200px;line-height:1.4}',
      '.verif-bandeau button{background:#3d2b00;color:#ffd98a;border:none;border-radius:20px;',
      'padding:7px 15px;font-family:inherit;font-size:0.8rem;font-weight:800;cursor:pointer;white-space:nowrap}',
      '.verif-bandeau button:disabled{opacity:0.55;cursor:default}',
      '.verif-bandeau a{color:#3d2b00;font-weight:800;text-decoration:underline;white-space:nowrap}'
    ].join('');
    document.head.appendChild(style);

    var barre = document.createElement('div');
    barre.className = 'verif-bandeau';
    barre.innerHTML =
      '<span>✉️</span>'
      + '<span class="verif-bandeau-txt">Confirme ton adresse <strong>'
      + (me.email || '').replace(/[<>&]/g, '') + '</strong> pour débloquer les cours.</span>'
      + '<button type="button" id="verifRenvoi">Renvoyer le lien</button>'
      + '<a href="/verifier">En savoir plus</a>';

    // Sous le bandeau de nav s'il est déjà injecté, en tête de page sinon.
    var nav = document.getElementById('site-nav');
    if (nav && nav.nextSibling) {
      nav.parentNode.insertBefore(barre, nav.nextSibling);
    } else {
      document.body.insertBefore(barre, document.body.firstChild);
    }

    document.getElementById('verifRenvoi').addEventListener('click', function () {
      var b = this;
      b.disabled = true;
      b.textContent = 'Envoi…';
      fetch('/api/auth/resend.php', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          b.textContent = d.ok ? 'Email envoyé ✓' : 'Échec';
          if (!d.ok) { b.disabled = false; }
        })
        .catch(function () { b.textContent = 'Échec'; b.disabled = false; });
    });
  }
})();
