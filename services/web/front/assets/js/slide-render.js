/* ============================================================================
   slide-render.js — fabrique le HTML d'une slide d'événement.

   Un seul générateur pour les deux écrans (téléphone du participant et
   projection de l'animateur) : c'est ce qui garantit que la salle et les
   téléphones montrent la même chose. Le câblage des clics reste propre à
   chaque page, puisque le participant répond alors que l'animateur observe.

   rendreSlideHtml(slide, opts) → chaîne HTML de la carte
     slide : { type, titre, points, contenu }
     opts  : {
       fixe       : true  → carte au format 4:5 (projection)
       interactif : true  → boutons cliquables (écran participant)
       maReponse  : { reponse, points, correct } | null
       correction : true  → montrer les bonnes réponses (écran animateur)
       position   : { index, total } | null
       classement : { joueurs:[], equipes:[] } | null
       moi        : nom du participant, pour se repérer dans le classement
     }
   ============================================================================ */
(function () {
  function e(t) {
    var d = document.createElement('div');
    d.textContent = (t == null ? '' : String(t));
    return d.innerHTML;
  }

  var LETTRES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  /** Kicker + filet, la ligne d'en-tête récurrente des gabarits. */
  function ligne(kicker, droite) {
    return '<div class="sl__ligne"><span class="sl__kicker">' + e(kicker) + '</span>'
      + '<span class="sl__filet"></span>'
      + (droite ? droite : '') + '</div>';
  }

  function pied(gauche, o) {
    var num = o.position ? (o.position.index + 1) + ' / ' + o.position.total : '';
    if (!gauche && !num) return '';
    return '<div class="sl__pied"><span>' + e(gauche || '') + '</span>'
      + '<span class="sl__num">' + e(num) + '</span></div>';
  }

  function classement(o, portee) {
    var c = o.classement;
    if (!c) return '';
    var h = '';
    if (portee !== 'equipe' && (c.joueurs || []).length) {
      h += '<ul class="sl__clst">' + c.joueurs.slice(0, 8).map(function (j, i) {
        var moi = o.moi && j.nom === o.moi ? ' class="moi"' : '';
        return '<li' + moi + '><span class="rang">' + (i + 1) + '</span>'
          + '<span class="nom">' + e(j.nom) + '</span><span class="pts">' + e(j.points) + '</span></li>';
      }).join('') + '</ul>';
    }
    if (portee !== 'individuel' && (c.equipes || []).length) {
      h += '<ul class="sl__clst" style="margin-top:2cqw">' + c.equipes.map(function (q, i) {
        return '<li><span class="rang">' + (i + 1) + '</span>'
          + '<span class="nom">' + e(q.nom) + '</span><span class="pts">' + e(q.points) + '</span></li>';
      }).join('') + '</ul>';
    }
    return h || '<p class="sl__texte">Le classement s\'affichera dès les premières réponses.</p>';
  }

  /** Bloc de réponses pour quiz / vrai-faux / sondage. */
  function reponses(s, c, o) {
    var opts, sondage = (s.type === 'sondage');
    // Quiz à plusieurs bonnes réponses : `correct` (et la réponse envoyée) sont
    // des tableaux d'index au lieu d'un entier — même discriminant de type que
    // le quiz des cours. Un clic coche/décoche au lieu de répondre tout de
    // suite, d'où le bouton « Valider » ajouté sous les options.
    var multi = (s.type === 'quiz' && !!c.multiple);
    if (s.type === 'vrai_faux') opts = ['Vrai', 'Faux'];
    else opts = c.options || [];

    var rep = o.maReponse;
    var repChoix = (multi && rep && Array.isArray(rep.reponse)) ? rep.reponse : [];
    var boutons = opts.map(function (lib, i) {
      // Vrai/Faux : l'index 0 vaut « Vrai », donc la valeur envoyée est booléenne.
      var valeur = (s.type === 'vrai_faux') ? (i === 0 ? 1 : 0) : i;
      var cls = 'sl__rep', marque = LETTRES[i] || (i + 1);

      if (rep) {
        var choisi = multi ? (repChoix.indexOf(i) !== -1)
          : (s.type === 'vrai_faux') ? (Boolean(rep.reponse) === (i === 0))
          : (rep.reponse === i);
        if (sondage) { if (choisi) cls += ' sl__rep--choisie'; }
        else {
          var bonne = multi ? (Array.isArray(c.correct) && c.correct.indexOf(i) !== -1)
            : (s.type === 'vrai_faux') ? (Boolean(c.correct) === (i === 0))
            : (c.correct === i);
          if (bonne) { cls += ' sl__rep--juste'; marque = '✓'; }
          else if (choisi) { cls += ' sl__rep--fausse'; marque = '✕'; }
        }
      } else if (o.correction && !sondage) {
        var juste = multi ? (Array.isArray(c.correct) && c.correct.indexOf(i) !== -1)
          : (s.type === 'vrai_faux') ? (Boolean(c.correct) === (i === 0))
          : (c.correct === i);
        if (juste) { cls += ' sl__rep--juste'; marque = '✓'; }
      }

      return '<button type="button" class="' + cls + '" data-rep="' + valeur + '"'
        + (o.interactif && !rep ? '' : ' disabled') + '>'
        + '<span class="sl__rep-marque">' + e(marque) + '</span>'
        + '<span>' + e(lib) + '</span></button>';
    }).join('');

    var validerMulti = (multi && o.interactif && !rep)
      ? '<button type="button" class="sl__rep" id="slValider" style="justify-content:center;font-family:\'Baloo 2\',cursive;font-weight:900">Valider</button>'
      : '';

    return '<div class="sl__reps">' + boutons + '</div>' + validerMulti;
  }

  function verdict(s, c, o) {
    var rep = o.maReponse;
    if (!rep) return '';
    var cls = 'sl__verdict--neutre', titre = 'Réponse enregistrée';
    if (s.type === 'sondage')       { titre = 'Merci pour ta réponse'; }
    else if (rep.correct === true)  { cls = 'sl__verdict--bon';  titre = '✅ Bonne réponse !'; }
    else if (rep.correct === false) { cls = 'sl__verdict--rate'; titre = '❌ Raté'; }

    var txt = c.explication || '';
    if (s.type === 'estimation' && c.valeur !== undefined) {
      txt = 'La réponse exacte était ' + c.valeur + (c.unite ? ' ' + c.unite : '') + '. ' + txt;
    }
    return '<div class="sl__verdict ' + cls + '">'
      + '<div class="sl__verdict-tete"><span class="sl__verdict-titre">' + e(titre) + '</span>'
      + (rep.points > 0 ? '<span class="sl__verdict-pts">+' + e(rep.points) + ' points</span>' : '') + '</div>'
      + (txt ? '<p class="sl__verdict-txt">' + e(txt) + '</p>' : '') + '</div>';
  }

  // Relance d'animation. Écouteur unique et délégué : le câblage des clics est
  // propre à chaque page, mais celui-ci ne dépend d'aucun état de page — le
  // poser ici évite de le dupliquer dans evenement.html et suivi.html.
  // Remplacer la scène par un clone est ce qui redémarre VRAIMENT les
  // animations CSS : retirer puis remettre une classe ne suffit pas sans forcer
  // un reflow, et le clone repart d'un nœud neuf, donc d'un temps zéro.
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-rejouer]') : null;
    if (!b) return;
    var carte = b.closest('.sl');
    var scene = carte ? carte.querySelector('[data-scene]') : null;
    if (!scene || !scene.parentNode) return;
    // Demande explicite de mouvement : restaure l'oscillation de la plante, seul
    // effet que prefers-reduced-motion retire encore (cf. slides.css).
    carte.setAttribute('data-anime', '');
    scene.parentNode.replaceChild(scene.cloneNode(true), scene);
  });

  window.rendreSlideHtml = function (s, o) {
    o = o || {};
    var c = s.contenu || {};
    var cls = 'sl' + (o.fixe ? ' sl--fixe' : '');
    var corps = '', entete = '', plein = false;
    var badgePts = s.points ? '<span class="sl__badge-pts">' + e(s.points) + ' pts</span>' : '';

    switch (s.type) {
      case 'titre':
        plein = true;
        corps = ligne(o.position ? 'Étape ' + String(o.position.index + 1).padStart(2, '0') : 'Partie')
          + '<div class="sl__corps" style="gap:4cqw"><div class="sl__barre"></div>'
          + '<h2 class="sl__titre sl__titre--geant">' + e(s.titre) + '</h2>'
          + (c.sous_titre ? '<p class="sl__sous">' + e(c.sous_titre) + '</p>' : '') + '</div>'
          + pied('', o);
        break;

      case 'fin':
        plein = true;
        corps = ligne('Merci')
          + '<div class="sl__corps" style="gap:4cqw"><div class="sl__barre"></div>'
          + '<h2 class="sl__titre sl__titre--geant">' + e(s.titre || 'Merci !') + '</h2>'
          + '<p class="sl__sous">' + e(c.message) + '</p></div>'
          + (c.afficher_classement ? '<div style="position:relative">' + classement(o, 'les_deux') + '</div>' : pied('', o));
        break;

      case 'texte':
        corps = '<div class="sl__bandeau"></div><div class="sl__corps">'
          + ligne(s.titre || 'À retenir')
          + (s.titre ? '<h2 class="sl__titre">' + e(s.titre) + '</h2>' : '')
          + '<p class="sl__texte">' + e(c.corps) + '</p>' + pied('', o) + '</div>';
        break;

      case 'anecdote':
        corps = '<div class="sl__bandeau"></div><div class="sl__corps">'
          + '<div class="sl__ligne"><span class="sl__pastille">Le saviez-vous ?</span><span class="sl__filet"></span></div>'
          + '<div style="font-size:clamp(34px,9cqw,58px);line-height:1">' + e(c.emoji || '💡') + '</div>'
          + (s.titre ? '<h2 class="sl__titre">' + e(s.titre) + '</h2>' : '')
          + '<p class="sl__texte">' + e(c.corps) + '</p>' + pied('', o) + '</div>';
        break;

      case 'sommaire':
        corps = '<div class="sl__bandeau"></div><div class="sl__corps">'
          + '<div class="sl__ligne"><span class="sl__pastille">Sommaire</span><span class="sl__filet"></span></div>'
          + '<ul class="sl__somm">' + (c.sections || []).map(function (x) {
              var p = x.etat === 'passee' ? '✓' : (x.etat === 'courante' ? '▶' : '•');
              return '<li class="' + e(x.etat || 'avenir') + '"><span class="sl__somm-puce">' + p + '</span>' + e(x.nom) + '</li>';
            }).join('') + '</ul>' + pied('', o) + '</div>';
        break;

      case 'classement':
        corps = '<div class="sl__bandeau"></div><div class="sl__corps">'
          + '<div class="sl__ligne"><span class="sl__pastille">Classement</span><span class="sl__filet"></span></div>'
          + '<h2 class="sl__titre">' + e(s.titre || 'Où en est-on ?') + '</h2>'
          + classement(o, c.portee || 'les_deux') + '</div>';
        break;

      case 'encouragement': {
        var av = o.position && o.position.total > 1
          ? (o.position.index + 1) / o.position.total
          : 0.5;
        var pct = Math.round(av * 100);
        var papier = document.body.getAttribute('data-theme-slide') === 'papier';
        var anim;

        if (c.animation === 'confettis') {
          // Carte inversée : la gerbe claire a besoin d'un fond sombre, sinon
          // les pièces blanches disparaissent. En forêt, .sl--plein donne déjà
          // le dégradé vert ; en papier il rend une carte CRÈME, d'où la classe
          // sl--fete qui repasse le fond en olive plein.
          plein = true;
          cls += ' sl--fete';

          // Tirage pseudo-aléatoire mais DÉTERMINISTE (mulberry32 amorcé par
          // l'identifiant de la slide) : la même gerbe sur le téléphone de
          // chacun et sur le vidéoprojecteur. Un Math.random() donnerait une
          // gerbe différente par écran, ce qui casse l'effet de salle.
          var graine = ((s.id || 0) * 2654435761 + 11) >>> 0;
          var alea = function () {
            graine |= 0; graine = (graine + 0x6D2B79F5) | 0;
            var t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };

          var burst = 3.4;
          var ox = +(26 + alea() * 48).toFixed(1);        // origine de la gerbe, en %
          var oy = +(30 + alea() * 34).toFixed(1);
          // --sl-conf1 laisse chaque thème choisir sa dominante : l'accent
          // convient en forêt et en papier, pas en simpliste où il est trop
          // sourd sur le vert foncé de la carte.
          var blanc = papier ? '#fdfaf1' : '#ffffff';
          var teintes = ['var(--sl-conf1)', blanc, 'var(--sl-tendre)', '#e0c05f', blanc, 'var(--sl-conf1)'];

          var NB = 38, pieces = '';
          for (var k = 0; k < NB; k++) {
            var gros = alea() > 0.72;
            var band = alea() > 0.6;
            var rond = !band && alea() > 0.5;
            var px = +(ox + alea() * 5 - 2.5).toFixed(1);
            var py = +(oy + alea() * 5 - 2.5).toFixed(1);
            var ang = +((k / NB) * 360 + alea() * 26 - 13).toFixed(1);
            var dist = Math.round(120 + alea() * 160);
            var dur = +(burst * (0.62 + alea() * 0.3)).toFixed(2);
            var del = +(alea() * 0.22).toFixed(2);
            pieces += '<i class="sl__rayon" style="--x:' + px + '%;--y:' + py + '%;--a:' + ang + 'deg">'
              + '<i class="sl__vol" style="--dist:' + dist + 'px;--dur:' + dur + 's;--del:' + del + 's">'
              + '<i class="sl__piece" style="--dist:' + dist + 'px;--dur:' + dur + 's;--del:' + del
              + 's;--w:' + (band ? 6 : gros ? 16 : 11) + 'px;--h:' + (band ? 20 : gros ? 16 : 11)
              + 'px;--r:' + (rond ? '50%' : '3px') + ';--c:' + teintes[Math.floor(alea() * teintes.length)]
              + '"></i></i></i>';
          }

          anim = '<div class="sl__fete" data-scene style="--sl-burst:' + burst + 's" role="img" aria-label="Confettis">'
            + '<i class="sl__anneau" style="--x:' + ox + '%;--y:' + oy + '%"></i>'
            + '<i class="sl__anneau sl__anneau--accent" style="--x:' + ox + '%;--y:' + oy + '%"></i>'
            + pieces
            + '<div class="sl__bravo">Bravo !</div></div>';

        } else {
          // Plante en boucle : tige qui se dessine (pathLength=100), puis trois
          // feuilles ancrées sur le tracé, puis la fleur. Les transform-origin
          // sont posés en CSS, sur le bord de la feuille collé à la tige.
          var FEUILLES = [
            ['a', 'M100 214 C72 202 50 210 42 230 C62 248 90 240 100 214 Z'],
            ['b', 'M100 166 C128 154 150 162 158 182 C138 200 110 192 100 166 Z'],
            ['c', 'M100 112 C78 104 62 112 56 128 C74 142 94 134 100 112 Z']
          ].map(function (f) {
            return '<path class="sl__feuille sl__feuille--' + f[0] + '" d="' + f[1] + '"></path>';
          }).join('');

          // 6 pétales en papier (la variante géométrique), 5 en forêt.
          var nbPet = papier ? 6 : 5, pas = 360 / nbPet, opac = [1, .9, .82, .82, .9, .9], petales = '';
          for (var p = 0; p < nbPet; p++) {
            petales += '<ellipse class="sl__petale" cx="0" cy="' + (papier ? -19 : -20)
              + '" rx="' + (papier ? 10 : 11) + '" ry="' + (papier ? 17 : 18)
              + '" transform="rotate(' + Math.round(p * pas) + ')" opacity="' + opac[p] + '"></ellipse>';
          }

          anim = '<div class="sl__pousse" data-scene style="--sl-dur:6.4s">'
            + '<i class="sl__halo"></i>'
            + '<svg class="sl__plante" viewBox="0 0 200 320" role="img" aria-label="Une plante qui pousse">'
            + '<path class="sl__tige" pathLength="100" stroke-dasharray="100"'
            + ' d="M100 312 C100 258 88 226 100 188 C112 148 92 122 100 78"></path>'
            + FEUILLES
            + '<g transform="translate(100 70)"><g class="sl__fleur"><g class="sl__petales">'
            + petales + '</g>'
            + '<circle class="sl__coeur" cx="0" cy="0" r="' + (papier ? 10 : 11) + '"></circle>'
            + '<circle class="sl__pistil" cx="0" cy="0" r="5"></circle>'
            + '</g></g></svg>'
            + '<div class="sl__mot"><span>Ça pousse !</span></div>'
            + '</div>';
        }

        // En-tête repris des gabarits : pastille de section à gauche, bouton de
        // relance à droite. L'animation tourne en boucle, mais l'animateur veut
        // pouvoir la relancer au moment où il en parle plutôt que d'attendre le
        // prochain tour de boucle.
        var teteEnc = '<div class="sl__ligne">'
          + '<span class="sl__pastille">' + (c.animation === 'confettis' ? 'Bravo' : 'Encouragement') + '</span>'
          + '<span class="sl__filet"></span>'
          + '<button type="button" class="sl__rejouer" data-rejouer>&#8635; Rejouer</button></div>';

        corps = (plein ? '' : '<div class="sl__bandeau"></div>')
          + '<div class="sl__corps" style="--pousse:' + av.toFixed(3) + '; text-align:center">'
          + teteEnc
          + anim
          + '<h2 class="sl__titre">' + e(c.message) + '</h2>'
          + (c.sous_titre ? '<p class="sl__texte" style="text-align:center">' + e(c.sous_titre) + '</p>' : '')
          + (c.montrer_score && o.moiPoints !== undefined
             ? '<p class="sl__verdict-pts" style="text-align:center">' + e(o.moiPoints) + " points pour l'instant</p>" : '')
          + '<div class="sl__jauge"><span></span></div>'
          + '<div class="sl__jauge-txt">' + pct + ' % du parcours'
          + (o.position ? ' · étape ' + (o.position.index + 1) + ' sur ' + o.position.total : '') + '</div>'
          + '</div>';
        break;
      }

      case 'media':
        if (c.media_type === 'audio') {
          // Un son n'a pas de surface : le cadre plein écran laisserait un
          // grand vide. On reprend le gabarit « carte son » (bloc lecteur).
          corps = '<div class="sl__bandeau"></div><div class="sl__corps">'
            + '<div class="sl__ligne"><span class="sl__pastille">Extrait sonore</span><span class="sl__filet"></span></div>'
            + (s.titre ? '<h2 class="sl__titre">' + e(s.titre) + '</h2>' : '')
            + '<div class="sl__lecteur">' + (window.rendreMediaHtml ? window.rendreMediaHtml(c) : '') + '</div>'
            + (c.legende ? '<p class="sl__texte">' + e(c.legende) + '</p>' : '')
            + pied('', o) + '</div>';
        } else {
          // Le cadre est dimensionné après coup par ajusterMedias() d'après
          // les proportions réelles du média, pour que le texte garde sa place.
          corps = '<div class="sl__media">' + (window.rendreMediaHtml ? window.rendreMediaHtml(c) : '')
            + '<span class="sl__media-etiq">Média</span></div>'
            + '<div class="sl__corps" style="flex:none">'
            + (s.titre ? '<h2 class="sl__titre">' + e(s.titre) + '</h2>' : '')
            + (c.legende ? '<p class="sl__texte">' + e(c.legende) + '</p>' : '')
            + pied('', o) + '</div>';
        }
        break;

      case 'defi':
        entete = ligne('Défi', badgePts) + '<h2 class="sl__titre">' + e(s.titre || 'À vous de jouer') + '</h2>';
        corps = '<div class="sl__corps">'
          + '<div style="font-size:clamp(34px,9cqw,58px);line-height:1;text-align:center">🎯</div>'
          + '<p class="sl__texte">' + e(c.consigne) + '</p>'
          + '<p class="sl__texte" style="margin-top:auto;opacity:.7">L\'animateur attribuera les points.</p>' + '</div>';
        break;

      case 'quiz':
      case 'vrai_faux':
      case 'sondage':
        entete = ligne(s.type === 'sondage' ? 'Sondage' : (s.type === 'vrai_faux' ? 'Vrai ou faux' : 'Question'), badgePts)
          + '<h2 class="sl__titre">' + e(c.question) + '</h2>';
        corps = '<div class="sl__corps">' + reponses(s, c, o) + verdict(s, c, o) + '</div>';
        break;

      case 'estimation':
        entete = ligne('Estimation', badgePts) + '<h2 class="sl__titre">' + e(c.question) + '</h2>';
        corps = '<div class="sl__corps">'
          + (o.maReponse ? '<p class="sl__texte">Ta réponse : <b>' + e(o.maReponse.reponse) + (c.unite ? ' ' + e(c.unite) : '') + '</b></p>'
             : (o.interactif
                ? '<input type="number" step="any" id="slEstim" class="sl__rep" style="cursor:text" placeholder="Ta réponse'
                  + (c.unite ? ' (' + e(c.unite) + ')' : '') + '">'
                  + '<button type="button" class="sl__rep" id="slValider" style="justify-content:center;font-family:\'Baloo 2\',cursive;font-weight:900">Valider</button>'
                : '<p class="sl__texte">' + (o.correction && c.valeur !== undefined
                    ? 'Réponse attendue : <b>' + e(c.valeur) + ' ' + e(c.unite || '') + '</b> (tolérance ± ' + e(c.tolerance) + ')'
                    : 'Les participants saisissent une valeur.') + '</p>'))
          + verdict(s, c, o) + '</div>';
        break;

      case 'question_ouverte':
        entete = ligne('Question ouverte', badgePts) + '<h2 class="sl__titre">' + e(c.question) + '</h2>';
        corps = '<div class="sl__corps">'
          + (o.maReponse ? '<p class="sl__texte">Ta réponse : <b>' + e(o.maReponse.reponse) + '</b></p>'
             : (o.interactif
                ? '<textarea id="slOuverte" class="sl__rep" style="cursor:text;min-height:22cqw" maxlength="' + (c.max_car || 300) + '"></textarea>'
                  + '<button type="button" class="sl__rep" id="slValider" style="justify-content:center;font-family:\'Baloo 2\',cursive;font-weight:900">Envoyer</button>'
                : '<p class="sl__texte">Les participants répondent librement.</p>'))
          + verdict(s, c, o) + '</div>';
        break;

      case 'jeu':
        entete = ligne('Extrait de jeu', badgePts) + '<h2 class="sl__titre">' + e(s.titre || 'À toi de jouer !') + '</h2>';
        corps = '<div class="sl__corps">' + (c.items || []).map(function (it, i) {
            var champ = '';
            if (o.interactif && !o.maReponse) {
              if (c.jeu === 'compost-ou-pas') {
                champ = '<select data-jeu="' + i + '"><option value="">?</option>'
                  + '<option value="oui">✅ Oui</option><option value="attention">⚠️ Prudence</option><option value="non">❌ Non</option></select>';
              } else if (c.jeu === 'temps-decompo') {
                champ = '<input type="number" min="0" data-jeu="' + i + '" placeholder="jours" style="max-width:32%">';
              } else {
                champ = '<input type="text" data-jeu="' + i + '" placeholder="le mot" style="max-width:42%">';
              }
            } else if (o.correction) {
              var k = it.cat !== undefined ? it.cat : (it.jours !== undefined ? it.jours + ' j' : it.mot);
              champ = '<span class="sl__verdict-pts">' + e(k) + '</span>';
            }
            return '<div class="sl__rep" style="cursor:default"><span class="sl__rep-marque">' + e(it.emoji || '•') + '</span>'
              + '<span style="flex:1">' + e(it.nom) + '</span>' + champ + '</div>';
          }).join('')
          + (o.interactif && !o.maReponse
             ? '<button type="button" class="sl__rep" id="slValider" style="justify-content:center;font-family:\'Baloo 2\',cursive;font-weight:900">Valider</button>' : '')
          + verdict(s, c, o) + '</div>';
        break;

      default:
        corps = '<div class="sl__corps"><h2 class="sl__titre">' + e(s.titre || '') + '</h2></div>';
    }

    if (plein) cls += ' sl--plein';
    var deco = plein || entete
      ? '<div class="sl__grain"></div><div class="sl__deco sl__deco--haut"></div>' : '';

    /* Illustration de la banque d'images. L'URL est posée par le serveur dans
       le contenu de la slide (resoudre_illustration), et seulement pour le
       thème simpliste : le renderer n'a donc rien à décider, il affiche ce
       qu'on lui donne. La classe .sl--illu remonte l'information à la carte,
       pour que le CSS puisse dégager la place en bas du corps.

       loading="lazy" est délibérément ABSENT : la carte est déjà à l'écran au
       moment où elle est construite, et un chargement différé ferait apparaître
       l'image après coup, en pleine projection. */
    var illu = c.illustration
      ? '<img class="sl__illu" src="' + e(c.illustration) + '" alt="" decoding="async">' : '';
    if (illu) cls += ' sl--illu';

    return '<div class="' + cls + '" data-type="' + e(s.type) + '">'
      + (entete ? '<div class="sl__entete"><div class="sl__deco sl__deco--bas"></div>'
                  + '<div style="position:relative">' + entete + '</div></div>' : '')
      + (plein ? deco : '')
      + corps + illu + '</div>';
  };
})();
