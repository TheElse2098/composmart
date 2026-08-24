/* ============================================================================
   tag-picker.js — sélecteur de tags à pastilles.

   Remplace la saisie « nature, hiver, chiffre-choc » séparée par des virgules,
   qui a trois défauts : rien ne montre quels tags existent déjà, une faute de
   frappe crée silencieusement un tag jumeau qui ne retrouvera jamais ses
   images, et il faut connaître la convention de séparateur.

   Ici on clique ce qui existe, et le (+) ne sert qu'à créer ce qui manque.

   Usage :
     var sel = creerSelecteurTags(document.getElementById('zone'), {
       disponibles: [{ tag: 'nature', n: 4 }, …],   // vocabulaire existant
       choisis:     ['nature'],                     // sélection de départ
       creation:    true,                           // afficher le (+)
       tout:        true,                           // afficher « Tous »/« Aucun »
       onChange:    function (tags) { … }           // à chaque modification
     });
     sel.valeur()          → ['nature', …]
     sel.definir([…])      → remplace la sélection
     sel.disponibles([…])  → remplace le vocabulaire

   Les tags sont normalisés exactement comme côté serveur (minuscules, espaces
   resserrés, 40 caractères) : ce qui est affiché est ce qui sera enregistré.
   ============================================================================ */
(function () {
  var CSS = [
    '.tgp{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.tgp-chip{border:1.5px solid #d4e6d8;background:#fff;color:#4a7a5a;border-radius:20px;padding:5px 13px;font-size:0.79rem;font-weight:700;cursor:pointer;font-family:inherit;line-height:1.3}',
    '.tgp-chip:hover{border-color:#1e6e3e;color:#1e6e3e}',
    '.tgp-chip.on{background:#1e6e3e;border-color:#1e6e3e;color:#fff}',
    '.tgp-chip .n{opacity:.6;font-weight:800}',
    '.tgp-plus{border:1.5px dashed #b7d3bd;background:transparent;color:#1e6e3e;border-radius:20px;padding:5px 13px;font-size:0.82rem;font-weight:900;cursor:pointer;font-family:inherit;line-height:1.3}',
    '.tgp-plus:hover{border-style:solid}',
    '.tgp-tout{background:none;border:none;color:#1e6e3e;font-size:0.76rem;font-weight:800;cursor:pointer;font-family:inherit;text-decoration:underline;padding:4px 6px}',
    '.tgp-sep{width:1px;align-self:stretch;background:#d4e6d8;margin:2px 2px}',
    '.tgp-neuf{display:flex;gap:6px;align-items:center;width:100%;margin-top:2px}',
    '.tgp-neuf input{flex:1;min-width:0;padding:7px 11px;border:1.5px solid #1e6e3e;border-radius:10px;font-size:0.85rem;font-family:inherit;background:#fff;color:#1a3a25;outline:none}',
    '.tgp-vide{font-size:0.78rem;color:#888}',
    'html.dark .tgp-chip{background:#16211a;border-color:#2d4030;color:#7ab88e}',
    'html.dark .tgp-chip.on{background:#2d9959;border-color:#2d9959;color:#fff}',
    'html.dark .tgp-plus{border-color:#2d4030;color:#7fc99a}',
    'html.dark .tgp-tout{color:#7fc99a}',
    'html.dark .tgp-sep{background:#2d4030}',
    'html.dark .tgp-neuf input{background:#1e2d22;border-color:#2d9959;color:#e8f5ee}',
  ].join('');

  var styleFait = false;
  function poserStyle() {
    if (styleFait) return;
    styleFait = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /** Même règle que img_tags_parser() / anec_mots_parser() côté PHP. */
  function normaliser(t) {
    return String(t == null ? '' : t).trim().replace(/[ \t]+/g, ' ').toLowerCase().slice(0, 40);
  }

  window.creerSelecteurTags = function (hote, opts) {
    opts = opts || {};
    poserStyle();

    var dispo   = (opts.disponibles || []).slice();
    var choisis = (opts.choisis || []).map(normaliser).filter(Boolean);
    var onChange = opts.onChange || function () {};

    hote.classList.add('tgp');

    function prevenir() { onChange(choisis.slice()); }

    function basculer(t) {
      var i = choisis.indexOf(t);
      if (i < 0) choisis.push(t); else choisis.splice(i, 1);
      dessiner();
      prevenir();
    }

    /** Champ de création, affiché seulement quand on clique le (+). Il reste
     *  fermé le reste du temps : la création est l'exception, pas le geste
     *  courant, et un champ toujours ouvert invite à retaper un tag existant. */
    function ouvrirCreation() {
      if (hote.querySelector('.tgp-neuf')) return;
      var ligne = document.createElement('div');
      ligne.className = 'tgp-neuf';
      var champ = document.createElement('input');
      champ.type = 'text';
      champ.maxLength = 40;
      champ.placeholder = 'Nouveau tag';
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'tgp-chip on';
      ok.textContent = 'Ajouter';
      var non = document.createElement('button');
      non.type = 'button';
      non.className = 'tgp-chip';
      non.textContent = 'Annuler';

      function valider() {
        var t = normaliser(champ.value);
        if (!t) { champ.focus(); return; }
        // Un tag déjà connu n'est pas recréé : il est simplement sélectionné.
        // Sans ça, taper un tag existant en produirait un doublon visuel.
        var connu = dispo.some(function (d) { return d.tag === t; });
        if (!connu) dispo.push({ tag: t, n: 0 });
        if (choisis.indexOf(t) < 0) choisis.push(t);
        dessiner();
        prevenir();
      }
      ok.onclick = valider;
      non.onclick = function () { ligne.remove(); };
      champ.onkeydown = function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); valider(); }
        if (ev.key === 'Escape') { ev.preventDefault(); ligne.remove(); }
      };

      ligne.appendChild(champ);
      ligne.appendChild(ok);
      ligne.appendChild(non);
      hote.appendChild(ligne);
      champ.focus();
    }

    function dessiner() {
      hote.textContent = '';

      dispo.forEach(function (d) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tgp-chip' + (choisis.indexOf(d.tag) >= 0 ? ' on' : '');
        b.setAttribute('aria-pressed', choisis.indexOf(d.tag) >= 0 ? 'true' : 'false');
        b.textContent = d.tag;
        if (d.n) {
          var n = document.createElement('span');
          n.className = 'n';
          n.textContent = ' ' + d.n;
          b.appendChild(n);
        }
        b.onclick = function () { basculer(d.tag); };
        hote.appendChild(b);
      });

      // Tags sélectionnés qui ne sont pas (ou plus) dans le vocabulaire : ils
      // doivent rester visibles et décochables, sinon on ne peut plus les
      // retirer d'un événement dont la dernière image vient d'être supprimée.
      choisis.forEach(function (t) {
        if (dispo.some(function (d) { return d.tag === t; })) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tgp-chip on';
        b.title = "Ce tag n'est plus porté par aucune image";
        b.textContent = t + ' ⚠';
        b.onclick = function () { basculer(t); };
        hote.appendChild(b);
      });

      if (!dispo.length && !choisis.length) {
        var vide = document.createElement('span');
        vide.className = 'tgp-vide';
        vide.textContent = opts.messageVide || 'Aucun tag pour le moment.';
        hote.appendChild(vide);
      }

      if (opts.creation !== false) {
        var plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'tgp-plus';
        plus.title = 'Créer un tag';
        plus.textContent = '+';
        plus.onclick = ouvrirCreation;
        hote.appendChild(plus);
      }

      if (opts.tout && dispo.length) {
        var sep = document.createElement('span');
        sep.className = 'tgp-sep';
        hote.appendChild(sep);

        var tous = document.createElement('button');
        tous.type = 'button';
        tous.className = 'tgp-tout';
        var complet = dispo.every(function (d) { return choisis.indexOf(d.tag) >= 0; });
        tous.textContent = complet ? 'Aucun' : 'Tous';
        tous.onclick = function () {
          if (complet) {
            // On ne vide que ce qui vient du vocabulaire : un tag orphelin
            // sélectionné à la main n'a pas à disparaître dans l'opération.
            choisis = choisis.filter(function (t) {
              return !dispo.some(function (d) { return d.tag === t; });
            });
          } else {
            dispo.forEach(function (d) { if (choisis.indexOf(d.tag) < 0) choisis.push(d.tag); });
          }
          dessiner();
          prevenir();
        };
        hote.appendChild(tous);
      }
    }

    dessiner();

    return {
      valeur: function () { return choisis.slice(); },
      definir: function (tags) { choisis = (tags || []).map(normaliser).filter(Boolean); dessiner(); },
      disponibles: function (liste) { dispo = (liste || []).slice(); dessiner(); },
    };
  };
})();
