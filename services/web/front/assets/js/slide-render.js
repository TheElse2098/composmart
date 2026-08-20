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
    if (s.type === 'vrai_faux') opts = ['Vrai', 'Faux'];
    else opts = c.options || [];

    var rep = o.maReponse;
    return '<div class="sl__reps">' + opts.map(function (lib, i) {
      // Vrai/Faux : l'index 0 vaut « Vrai », donc la valeur envoyée est booléenne.
      var valeur = (s.type === 'vrai_faux') ? (i === 0 ? 1 : 0) : i;
      var cls = 'sl__rep', marque = LETTRES[i] || (i + 1);

      if (rep) {
        var choisi = (s.type === 'vrai_faux')
          ? (Boolean(rep.reponse) === (i === 0))
          : (rep.reponse === i);
        if (sondage) { if (choisi) cls += ' sl__rep--choisie'; }
        else {
          var bonne = (s.type === 'vrai_faux') ? (Boolean(c.correct) === (i === 0)) : (c.correct === i);
          if (bonne) { cls += ' sl__rep--juste'; marque = '✓'; }
          else if (choisi) { cls += ' sl__rep--fausse'; marque = '✕'; }
        }
      } else if (o.correction && !sondage) {
        var juste = (s.type === 'vrai_faux') ? (Boolean(c.correct) === (i === 0)) : (c.correct === i);
        if (juste) { cls += ' sl__rep--juste'; marque = '✓'; }
      }

      return '<button type="button" class="' + cls + '" data-rep="' + valeur + '"'
        + (o.interactif && !rep ? '' : ' disabled') + '>'
        + '<span class="sl__rep-marque">' + e(marque) + '</span>'
        + '<span>' + e(lib) + '</span></button>';
    }).join('') + '</div>';
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
        // La pousse reflète l'avancement réel : c'est ce qui distingue cette
        // slide d'une simple image décorative. Sans position connue (aperçu
        // hors contexte), on retombe sur une plante à mi-croissance.
        var av = o.position && o.position.total > 1
          ? (o.position.index + 1) / o.position.total
          : 0.5;
        var feuilles = '<span class="sl__pousse-feuille sl__pousse-feuille--g"></span>'
          + '<span class="sl__pousse-feuille sl__pousse-feuille--d"></span>';
        if (av >= 0.5) feuilles += '<span class="sl__pousse-feuille sl__pousse-feuille--g2"></span>';
        if (av >= 0.7) feuilles += '<span class="sl__pousse-feuille sl__pousse-feuille--d2"></span>';
        if (av >= 0.9) feuilles += '<span class="sl__pousse-fleur"></span>';

        var pct = Math.round(av * 100);
        corps = '<div class="sl__bandeau"></div>'
          + '<div class="sl__corps" style="--pousse:' + av.toFixed(3) + '; justify-content:center; text-align:center">'
          + '<div class="sl__pousse">' + feuilles
          + '<span class="sl__pousse-tige"></span><span class="sl__pousse-sol"></span></div>'
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

    return '<div class="' + cls + '" data-type="' + e(s.type) + '">'
      + (entete ? '<div class="sl__entete"><div class="sl__deco sl__deco--bas"></div>'
                  + '<div style="position:relative">' + entete + '</div></div>' : '')
      + (plein ? deco : '')
      + corps + '</div>';
  };
})();
