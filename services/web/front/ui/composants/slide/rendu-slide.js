/* ============================================================================
   rendu-slide.js — la carte d'une slide d'atelier.

   Un seul générateur pour les deux écrans (téléphone du participant et
   projection de l'animateur) : c'est ce qui garantit que la salle et les
   téléphones montrent la même chose. Le câblage des clics reste propre à
   chaque page, puisque le participant répond alors que l'animateur observe.

   Reprend assets/js/slide-render.js. Les deux doivent produire le même HTML
   tant qu'une page ancienne et une page nouvelle coexistent : un test les
   compare, slide par slide et état par état (tests/front/slide.test.mjs). La
   seule différence voulue est l'échappement, qui protège aussi les
   guillemets (invisible à l'écran, et sûr dans un attribut).

   rendreSlide(slide, opts) → Html de la carte
     slide : { id, type, titre, points, contenu }
     opts  : {
       fixe       : true  → carte au format 4:5 (projection)
       interactif : true  → boutons cliquables (écran participant)
       maReponse  : { reponse, points, correct } | null
       correction : true  → montrer les bonnes réponses (écran animateur)
       position   : { index, total } | null
       classement : { joueurs:[], equipes:[], moi?, mon_equipe?, nb_joueurs?,
                      nb_equipes? } | null — entrées { nom, points, rang?, moi? }
       moiPoints  : score du participant (slide d'encouragement)
       papier     : true  → thème « papier » (la page le sait par
                            l'attribut data-theme-slide de son <body>)
     }

   Fonctions pures, sauf rejouer() qui relance une animation déjà affichée.
   ============================================================================ */
import { Html, brut, echapper as e } from '../../socle/outils.js';
import { mediaHtml } from './media-slide.js';

/**
 * @typedef {object} OptionsSlide
 * @property {boolean} [fixe]
 * @property {boolean} [interactif]
 * @property {{ reponse: any, points?: number, correct?: boolean | null } | null} [maReponse]
 * @property {boolean} [correction]
 * @property {{ index: number, total: number } | null} [position]
 * @property {any} [classement]
 * @property {number} [moiPoints]
 * @property {boolean} [papier]
 */

const LETTRES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Bouton d'action (Valider, Envoyer). Il n'est PAS posé dans le corps de la
 * carte : celui-ci défile, et un bouton rangé tout au fond disparaissait hors
 * champ dès qu'une slide débordait. La carte le place dans son pied fixe
 * .sl__actions, où la page participant ajoute aussi « Suivant ».
 * @param {string} libelle
 */
function boutonAction(libelle) {
  return '<button type="button" class="sl__action" id="slValider">' + e(libelle) + '</button>';
}

/** Kicker + filet, la ligne d'en-tête récurrente des gabarits. @param {string} kicker @param {string} [droite] */
function ligne(kicker, droite) {
  return '<div class="sl__ligne"><span class="sl__kicker">' + e(kicker) + '</span>'
    + '<span class="sl__filet"></span>'
    + (droite ? droite : '') + '</div>';
}

/** @param {string} gauche @param {OptionsSlide} o */
function pied(gauche, o) {
  const num = o.position ? (o.position.index + 1) + ' / ' + o.position.total : '';
  if (!gauche && !num) return '';
  return '<div class="sl__pied"><span>' + e(gauche || '') + '</span>'
    + '<span class="sl__num">' + e(num) + '</span></div>';
}

/* ── Classement ──────────────────────────────────────────────────────────────
   Une carte ne montre que la tête du classement : au-delà, la liste sortait du
   cadre, et personne ne lit trente lignes sur un téléphone. Le participant
   classé plus loin voit sa propre ligne, séparée par « … ». Il est repéré par
   le drapeau `moi` posé par le serveur, jamais par son pseudo : deux homonymes
   étaient auparavant surlignés ensemble. */
const TETE_JOUEURS = 5;
const TETE_EQUIPES = 3;

/**
 * Rang « sportif » (1, 2, 2, 4) quand le serveur ne l'a pas fourni — c'est le
 * cas sur l'écran de l'animateur, qui reçoit la liste entière.
 * @param {any[]} liste
 */
export function avecRangs(liste) {
  /** @type {any} */
  let prec = null;
  let rang = 0;
  return liste.map((x, i) => {
    if (x.points !== prec) { rang = i + 1; prec = x.points; }
    return Object.assign({ rang }, x);
  });
}

/** @param {any} x */
function ligneClst(x) {
  return '<li' + (x.moi ? ' class="moi"' : '') + '><span class="rang">' + e(x.rang) + '</span>'
    + '<span class="nom">' + e(x.nom) + (x.moi ? ' <span class="sl__clst-toi">· toi</span>' : '') + '</span>'
    + '<span class="pts">' + e(x.points) + '</span></li>';
}

/**
 * Tête de liste + ligne personnelle + nombre de lignes non montrées.
 * @param {any[] | undefined} liste
 * @param {number} tete
 * @param {any} moi
 * @param {number | undefined} total
 * @param {[string, string]} autre
 */
function listeClst(liste, tete, moi, total, autre) {
  const vus = avecRangs(liste || []).slice(0, tete);
  const dedans = vus.some((x) => x.moi);
  let h = vus.map(ligneClst).join('');
  let montres = vus.length;
  if (moi && !dedans) {
    h += '<li class="sl__clst-ecart" aria-hidden="true">…</li>' + ligneClst(Object.assign({}, moi, { moi: true }));
    montres++;
  }
  const reste = (total || (liste || []).length) - montres;
  return '<ul class="sl__clst">' + h + '</ul>'
    + (reste > 0 ? '<p class="sl__clst-reste">+ ' + reste + ' ' + autre[reste > 1 ? 1 : 0] + '</p>' : '');
}

/** @param {OptionsSlide} o @param {string} portee */
function classement(o, portee) {
  const c = o.classement;
  if (!c) return '';
  const avecJoueurs = portee !== 'equipe' && (c.joueurs || []).length;
  const avecEquipes = portee !== 'individuel' && (c.equipes || []).length;
  // Les deux listes à la fois : chacune son intitulé, sinon rien ne dit que
  // la seconde liste est celle des équipes.
  const titres = avecJoueurs && avecEquipes;
  let h = '';
  if (avecJoueurs) {
    h += '<div class="sl__clst-bloc">' + (titres ? '<p class="sl__kicker">Participants</p>' : '')
      + listeClst(c.joueurs, TETE_JOUEURS, c.moi, c.nb_joueurs, ['autre participant', 'autres participants']) + '</div>';
  }
  if (avecEquipes) {
    h += '<div class="sl__clst-bloc">' + (titres ? '<p class="sl__kicker">Équipes</p>' : '')
      + listeClst(c.equipes, TETE_EQUIPES, c.mon_equipe, c.nb_equipes, ['autre équipe', 'autres équipes']) + '</div>';
  }
  // Conteneur commun : en paysage, les deux listes se placent côte à côte.
  return h ? '<div class="sl__clst-blocs">' + h + '</div>'
    : '<p class="sl__texte">Le classement s\'affichera dès les premières réponses.</p>';
}

/**
 * Bloc de réponses pour quiz / vrai-faux / sondage. Un quiz à plusieurs bonnes
 * réponses a `correct` (et la réponse envoyée) en tableaux d'index : un clic
 * coche ou décoche, « Valider » envoie.
 * @param {any} s @param {any} c @param {OptionsSlide} o
 */
function reponses(s, c, o) {
  const sondage = s.type === 'sondage';
  const multi = s.type === 'quiz' && !!c.multiple;
  /** @type {string[]} */
  const opts = s.type === 'vrai_faux' ? ['Vrai', 'Faux'] : (c.options || []);
  const rep = o.maReponse;
  const repChoix = (multi && rep && Array.isArray(rep.reponse)) ? rep.reponse : [];

  const boutons = opts.map((lib, i) => {
    // Vrai/Faux : l'index 0 vaut « Vrai », donc la valeur envoyée est booléenne.
    const valeur = s.type === 'vrai_faux' ? (i === 0 ? 1 : 0) : i;
    let cls = 'sl__rep';
    /** @type {string | number} */
    let marque = LETTRES[i] || (i + 1);

    if (rep) {
      const choisi = multi ? repChoix.indexOf(i) !== -1
        : s.type === 'vrai_faux' ? Boolean(rep.reponse) === (i === 0)
          : rep.reponse === i;
      if (sondage) {
        if (choisi) cls += ' sl__rep--choisie';
      } else {
        const bonne = multi ? (Array.isArray(c.correct) && c.correct.indexOf(i) !== -1)
          : s.type === 'vrai_faux' ? Boolean(c.correct) === (i === 0)
            : c.correct === i;
        if (bonne) { cls += ' sl__rep--juste'; marque = '✓'; } else if (choisi) { cls += ' sl__rep--fausse'; marque = '✕'; }
      }
    } else if (o.correction && !sondage) {
      const juste = multi ? (Array.isArray(c.correct) && c.correct.indexOf(i) !== -1)
        : s.type === 'vrai_faux' ? Boolean(c.correct) === (i === 0)
          : c.correct === i;
      if (juste) { cls += ' sl__rep--juste'; marque = '✓'; }
    }

    return '<button type="button" class="' + cls + '" data-rep="' + valeur + '"'
      + (o.interactif && !rep ? '' : ' disabled') + '>'
      + '<span class="sl__rep-marque">' + e(marque) + '</span>'
      + '<span>' + e(lib) + '</span></button>';
  }).join('');

  return '<div class="sl__reps">' + boutons + '</div>';
}

/** @param {any} s @param {any} c @param {OptionsSlide} o */
function verdict(s, c, o) {
  const rep = o.maReponse;
  if (!rep) return '';
  let cls = 'sl__verdict--neutre';
  let titre = 'Réponse enregistrée';
  if (s.type === 'sondage') { titre = 'Merci pour ta réponse'; } else if (rep.correct === true) { cls = 'sl__verdict--bon'; titre = '✅ Bonne réponse !'; } else if (rep.correct === false) { cls = 'sl__verdict--rate'; titre = '❌ Raté'; }

  let txt = c.explication || '';
  if (s.type === 'estimation' && c.valeur !== undefined) {
    txt = 'La réponse exacte était ' + c.valeur + (c.unite ? ' ' + c.unite : '') + '. ' + txt;
  }
  return '<div class="sl__verdict ' + cls + '">'
    + '<div class="sl__verdict-tete"><span class="sl__verdict-titre">' + e(titre) + '</span>'
    + ((rep.points || 0) > 0 ? '<span class="sl__verdict-pts">+' + e(rep.points) + ' points</span>' : '') + '</div>'
    + (txt ? '<p class="sl__verdict-txt">' + e(txt) + '</p>' : '') + '</div>';
}

/**
 * Gerbe de confettis : tirage pseudo-aléatoire mais DÉTERMINISTE (mulberry32
 * amorcé par l'identifiant de la slide), donc la même gerbe sur le téléphone
 * de chacun et sur le vidéoprojecteur. Un Math.random() donnerait une gerbe
 * différente par écran, ce qui casse l'effet de salle.
 * @param {any} s @param {boolean} papier
 */
function confettis(s, papier) {
  let graine = ((s.id || 0) * 2654435761 + 11) >>> 0;
  const alea = () => {
    graine |= 0; graine = (graine + 0x6D2B79F5) | 0;
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const burst = 3.4;
  const ox = +(26 + alea() * 48).toFixed(1); // origine de la gerbe, en %
  const oy = +(30 + alea() * 34).toFixed(1);
  // --sl-conf1 laisse chaque thème choisir sa dominante.
  const blanc = papier ? '#fdfaf1' : '#ffffff';
  const teintes = ['var(--sl-conf1)', blanc, 'var(--sl-tendre)', '#e0c05f', blanc, 'var(--sl-conf1)'];

  const NB = 38;
  let pieces = '';
  for (let k = 0; k < NB; k++) {
    const gros = alea() > 0.72;
    const band = alea() > 0.6;
    const rond = !band && alea() > 0.5;
    const px = +(ox + alea() * 5 - 2.5).toFixed(1);
    const py = +(oy + alea() * 5 - 2.5).toFixed(1);
    const ang = +((k / NB) * 360 + alea() * 26 - 13).toFixed(1);
    const dist = Math.round(120 + alea() * 160);
    const dur = +(burst * (0.62 + alea() * 0.3)).toFixed(2);
    const del = +(alea() * 0.22).toFixed(2);
    pieces += '<i class="sl__rayon" style="--x:' + px + '%;--y:' + py + '%;--a:' + ang + 'deg">'
      + '<i class="sl__vol" style="--dist:' + dist + 'px;--dur:' + dur + 's;--del:' + del + 's">'
      + '<i class="sl__piece" style="--dist:' + dist + 'px;--dur:' + dur + 's;--del:' + del
      + 's;--w:' + (band ? 6 : gros ? 16 : 11) + 'px;--h:' + (band ? 20 : gros ? 16 : 11)
      + 'px;--r:' + (rond ? '50%' : '3px') + ';--c:' + teintes[Math.floor(alea() * teintes.length)]
      + '"></i></i></i>';
  }

  return '<div class="sl__fete" data-scene style="--sl-burst:' + burst + 's" role="img" aria-label="Confettis">'
    + '<i class="sl__anneau" style="--x:' + ox + '%;--y:' + oy + '%"></i>'
    + '<i class="sl__anneau sl__anneau--accent" style="--x:' + ox + '%;--y:' + oy + '%"></i>'
    + pieces
    + '<div class="sl__bravo">Bravo !</div></div>';
}

/**
 * Plante en boucle : tige qui se dessine, trois feuilles ancrées sur le tracé,
 * puis la fleur. 6 pétales en papier (la variante géométrique), 5 en forêt.
 * @param {boolean} papier
 */
function plante(papier) {
  const feuilles = [
    ['a', 'M100 214 C72 202 50 210 42 230 C62 248 90 240 100 214 Z'],
    ['b', 'M100 166 C128 154 150 162 158 182 C138 200 110 192 100 166 Z'],
    ['c', 'M100 112 C78 104 62 112 56 128 C74 142 94 134 100 112 Z'],
  ].map((f) => '<path class="sl__feuille sl__feuille--' + f[0] + '" d="' + f[1] + '"></path>').join('');

  const nbPet = papier ? 6 : 5;
  const pas = 360 / nbPet;
  const opac = [1, 0.9, 0.82, 0.82, 0.9, 0.9];
  let petales = '';
  for (let p = 0; p < nbPet; p++) {
    petales += '<ellipse class="sl__petale" cx="0" cy="' + (papier ? -19 : -20)
      + '" rx="' + (papier ? 10 : 11) + '" ry="' + (papier ? 17 : 18)
      + '" transform="rotate(' + Math.round(p * pas) + ')" opacity="' + opac[p] + '"></ellipse>';
  }

  return '<div class="sl__pousse" data-scene style="--sl-dur:6.4s">'
    + '<i class="sl__halo"></i>'
    + '<svg class="sl__plante" viewBox="0 0 200 320" role="img" aria-label="Une plante qui pousse">'
    + '<path class="sl__tige" pathLength="100" stroke-dasharray="100"'
    + ' d="M100 312 C100 258 88 226 100 188 C112 148 92 122 100 78"></path>'
    + feuilles
    + '<g transform="translate(100 70)"><g class="sl__fleur"><g class="sl__petales">'
    + petales + '</g>'
    + '<circle class="sl__coeur" cx="0" cy="0" r="' + (papier ? 10 : 11) + '"></circle>'
    + '<circle class="sl__pistil" cx="0" cy="0" r="5"></circle>'
    + '</g></g></svg>'
    + '<div class="sl__mot"><span>Ça pousse !</span></div>'
    + '</div>';
}

/**
 * Les éléments d'une slide « extrait de jeu » : saisie (mot mystère à tuiles,
 * compost ou pas, durée), révélation de la réponse du participant, ou
 * correction pour l'animateur.
 * @param {any} c @param {OptionsSlide} o
 */
function itemsJeu(c, o) {
  // Réponses du participant, alignées sur l'ordre des items : présentes dès
  // que o.maReponse existe, pour révéler item par item ce qu'il a répondu et
  // la bonne réponse.
  const repItems = (o.maReponse && Array.isArray(o.maReponse.reponse)) ? o.maReponse.reponse : null;
  return (c.items || []).map((/** @type {any} */ it, /** @type {number} */ i) => {
    const interactifSansRep = o.interactif && !o.maReponse;

    // Mot mystère : mêmes cases + tuiles cliquables que le jeu de base, avec
    // les lettres déjà mélangées par le serveur (it.lettres). L'input caché
    // garde la lecture générique de [data-jeu] au clic sur « Valider ».
    if (c.jeu === 'mot-mystere' && interactifSansRep) {
      /** @type {string[]} */
      const lettres = it.lettres || [];
      const slots = lettres.map((_l, pos) => '<span class="sl__mm-slot" data-mm-slot="' + i + '-' + pos + '"></span>').join('');
      const tuiles = lettres.map((l, idx) => '<button type="button" class="sl__mm-tile" data-mm-tile="' + i + '-' + idx + '">' + e(l) + '</button>').join('');
      return '<div class="sl__mm">'
        + '<div class="sl__mm-indice"><span class="sl__rep-marque">' + e(it.emoji || '🔤') + '</span>'
        + '<span>' + e(it.nom) + '</span></div>'
        + '<div class="sl__mm-slots" data-mm-slots="' + i + '">' + slots + '</div>'
        + '<div class="sl__mm-tiles" data-mm-tiles="' + i + '">' + tuiles + '</div>'
        + '<input type="hidden" data-jeu="' + i + '" value="">'
        + '</div>';
    }

    let champ = '';
    let cls = 'sl__rep';
    if (interactifSansRep) {
      if (c.jeu === 'compost-ou-pas') {
        champ = '<select data-jeu="' + i + '"><option value="">?</option>'
          + '<option value="oui">✅ Oui</option><option value="attention">⚠️ Prudence</option><option value="non">❌ Non</option></select>';
      } else {
        champ = '<input type="number" min="0" data-jeu="' + i + '" placeholder="jours" style="max-width:32%">';
      }
    } else if (repItems) {
      const r = repItems[i];
      let bon;
      let maLabel;
      let bonneLabel;
      if (c.jeu === 'compost-ou-pas') {
        /** @type {Record<string, string>} */
        const LIB = { oui: '✅ Oui', attention: '⚠️ Prudence', non: '❌ Non' };
        bon = r === it.cat;
        maLabel = LIB[r] || '—';
        bonneLabel = LIB[it.cat] || '—';
      } else if (c.jeu === 'temps-decompo') {
        const val = Number(r);
        // Même tolérance que corriger() côté serveur (±50 %, au moins 1 jour) :
        // la couleur affichée doit coïncider avec les points.
        bon = Number.isFinite(val) && it.jours !== undefined && Math.abs(val - it.jours) <= Math.max(1, it.jours * 0.5);
        maLabel = Number.isFinite(val) ? val + ' j' : '—';
        bonneLabel = '~' + it.jours + ' j';
      } else { // mot-mystere
        const mot = (typeof r === 'string') ? r.trim().toUpperCase() : '';
        bon = mot === it.mot;
        maLabel = mot || '—';
        bonneLabel = it.mot;
      }
      cls += bon ? ' sl__rep--juste' : ' sl__rep--fausse';
      champ = bon ? '<b>' + e(bonneLabel) + '</b>'
        : '<span style="text-decoration:line-through;opacity:.7">' + e(maLabel) + '</span> <b>' + e(bonneLabel) + '</b>';
    } else if (o.correction) {
      const k = it.cat !== undefined ? it.cat : (it.jours !== undefined ? it.jours + ' j' : it.mot);
      champ = '<span class="sl__verdict-pts">' + e(k) + '</span>';
    }
    return '<div class="' + cls + '" style="cursor:default;flex-wrap:wrap"><span class="sl__rep-marque">' + e(it.emoji || '•') + '</span>'
      + '<span style="flex:1">' + e(it.nom) + '</span>' + champ + '</div>';
  }).join('');
}

/**
 * Le HTML de la carte, en texte (c'est ce que compare le test d'équivalence).
 * @param {any} s
 * @param {OptionsSlide} [options]
 * @returns {string}
 */
export function texteSlide(s, options) {
  const o = options || {};
  const c = s.contenu || {};
  let cls = 'sl' + (o.fixe ? ' sl--fixe' : '');
  let corps = '';
  let entete = '';
  let plein = false;
  let actions = '';
  const attendSaisie = o.interactif && !o.maReponse;
  const badgePts = s.points ? '<span class="sl__badge-pts">' + e(s.points) + ' pts</span>' : '';

  switch (s.type) {
    case 'titre':
      plein = true;
      corps = ligne(o.position ? 'Étape ' + String(o.position.index + 1).padStart(2, '0') : 'Partie')
        + '<div class="sl__corps" style="gap:calc(var(--u) * 4)"><div class="sl__barre"></div>'
        + '<h2 class="sl__titre sl__titre--geant">' + e(s.titre) + '</h2>'
        + (c.sous_titre ? '<p class="sl__sous">' + e(c.sous_titre) + '</p>' : '') + '</div>'
        + pied('', o);
      break;

    case 'fin':
      plein = true;
      corps = ligne('Merci')
        + '<div class="sl__corps" style="gap:calc(var(--u) * 4)"><div class="sl__barre"></div>'
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
        + '<div style="font-size:clamp(34px,calc(var(--u) * 9),58px);line-height:1">' + e(c.emoji || '💡') + '</div>'
        + (s.titre ? '<h2 class="sl__titre">' + e(s.titre) + '</h2>' : '')
        + '<p class="sl__texte">' + e(c.corps) + '</p>' + pied('', o) + '</div>';
      break;

    case 'sommaire':
      corps = '<div class="sl__bandeau"></div><div class="sl__corps">'
        + '<div class="sl__ligne"><span class="sl__pastille">Sommaire</span><span class="sl__filet"></span></div>'
        + '<ul class="sl__somm">' + (c.sections || []).map((/** @type {any} */ x) => {
          const p = x.etat === 'passee' ? '✓' : (x.etat === 'courante' ? '▶' : '•');
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
      const av = o.position && o.position.total > 1 ? (o.position.index + 1) / o.position.total : 0.5;
      const pct = Math.round(av * 100);
      const papier = !!o.papier;
      let anim;
      if (c.animation === 'confettis') {
        // Carte inversée : la gerbe claire a besoin d'un fond sombre ; en
        // papier, sl--fete repasse le fond en olive plein.
        plein = true;
        cls += ' sl--fete';
        anim = confettis(s, papier);
      } else {
        anim = plante(papier);
      }
      // L'animation tourne en boucle, mais l'animateur veut pouvoir la relancer
      // au moment où il en parle : bouton « Rejouer » (cf. rejouer()).
      const teteEnc = '<div class="sl__ligne">'
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
          ? '<p class="sl__verdict-pts" style="text-align:center">' + e(o.moiPoints) + ' points pour l\'instant</p>' : '')
        + '<div class="sl__jauge"><span></span></div>'
        + '<div class="sl__jauge-txt">' + pct + ' % du parcours'
        + (o.position ? ' · étape ' + (o.position.index + 1) + ' sur ' + o.position.total : '') + '</div>'
        + '</div>';
      break;
    }

    case 'media':
      if (c.media_type === 'audio') {
        // Un son n'a pas de surface : gabarit « carte son » (bloc lecteur).
        corps = '<div class="sl__bandeau"></div><div class="sl__corps">'
          + '<div class="sl__ligne"><span class="sl__pastille">Extrait sonore</span><span class="sl__filet"></span></div>'
          + (s.titre ? '<h2 class="sl__titre">' + e(s.titre) + '</h2>' : '')
          + '<div class="sl__lecteur">' + mediaHtml(c) + '</div>'
          + (c.legende ? '<p class="sl__texte">' + e(c.legende) + '</p>' : '')
          + pied('', o) + '</div>';
      } else {
        // Cadre dimensionné après coup par ajusterMedias() (media-slide.js).
        corps = '<div class="sl__media">' + mediaHtml(c)
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
        + '<div style="font-size:clamp(34px,calc(var(--u) * 9),58px);line-height:1;text-align:center">🎯</div>'
        + '<p class="sl__texte">' + e(c.consigne) + '</p>'
        + '<p class="sl__texte" style="margin-top:auto;opacity:.7">L\'animateur attribuera les points.</p>' + '</div>';
      break;

    case 'quiz':
    case 'vrai_faux':
    case 'sondage':
      entete = ligne(s.type === 'sondage' ? 'Sondage' : (s.type === 'vrai_faux' ? 'Vrai ou faux' : 'Question'), badgePts)
        + '<h2 class="sl__titre">' + e(c.question) + '</h2>';
      corps = '<div class="sl__corps">' + reponses(s, c, o) + verdict(s, c, o) + '</div>';
      // Quiz à plusieurs bonnes réponses : un clic coche, « Valider » envoie.
      if (s.type === 'quiz' && c.multiple && attendSaisie) actions = boutonAction('Valider');
      break;

    case 'estimation':
      entete = ligne('Estimation', badgePts) + '<h2 class="sl__titre">' + e(c.question) + '</h2>';
      corps = '<div class="sl__corps">'
        + (o.maReponse ? '<p class="sl__texte">Ta réponse : <b>' + e(o.maReponse.reponse) + (c.unite ? ' ' + e(c.unite) : '') + '</b></p>'
          : (o.interactif
            ? '<input type="number" step="any" id="slEstim" class="sl__rep" style="cursor:text" placeholder="Ta réponse'
              + (c.unite ? ' (' + e(c.unite) + ')' : '') + '">'
            : '<p class="sl__texte">' + (o.correction && c.valeur !== undefined
              ? 'Réponse attendue : <b>' + e(c.valeur) + ' ' + e(c.unite || '') + '</b> (tolérance ± ' + e(c.tolerance) + ')'
              : 'Les participants saisissent une valeur.') + '</p>'))
        + verdict(s, c, o) + '</div>';
      if (attendSaisie) actions = boutonAction('Valider');
      break;

    case 'question_ouverte':
      entete = ligne('Question ouverte', badgePts) + '<h2 class="sl__titre">' + e(c.question) + '</h2>';
      corps = '<div class="sl__corps">'
        + (o.maReponse ? '<p class="sl__texte">Ta réponse : <b>' + e(o.maReponse.reponse) + '</b></p>'
          : (o.interactif
            ? '<textarea id="slOuverte" class="sl__rep" style="cursor:text;min-height:calc(var(--u) * 22)" maxlength="' + (c.max_car || 300) + '"></textarea>'
            : '<p class="sl__texte">Les participants répondent librement.</p>'))
        + verdict(s, c, o) + '</div>';
      if (attendSaisie) actions = boutonAction('Envoyer');
      break;

    case 'jeu':
      entete = ligne('Extrait de jeu', badgePts) + '<h2 class="sl__titre">' + e(s.titre || 'À toi de jouer !') + '</h2>';
      corps = '<div class="sl__corps">' + itemsJeu(c, o) + verdict(s, c, o) + '</div>';
      if (attendSaisie) actions = boutonAction('Valider');
      break;

    default:
      corps = '<div class="sl__corps"><h2 class="sl__titre">' + e(s.titre || '') + '</h2></div>';
  }

  if (plein) cls += ' sl--plein';
  // Carte à en-tête (les questions) : en paysage, elle passe sur deux colonnes.
  if (entete) cls += ' sl--q';
  const deco = plein || entete
    ? '<div class="sl__grain"></div><div class="sl__deco sl__deco--haut"></div>' : '';

  // Illustration de la banque d'images, posée par le serveur dans le contenu
  // (thème simpliste). Pas de loading="lazy" : la carte est déjà à l'écran,
  // l'image apparaîtrait après coup en pleine projection.
  const illu = c.illustration
    ? '<img class="sl__illu" src="' + e(c.illustration) + '" alt="" decoding="async">' : '';
  if (illu) cls += ' sl--illu';

  return '<div class="' + cls + '" data-type="' + e(s.type) + '">'
    + (entete ? '<div class="sl__entete"><div class="sl__deco sl__deco--bas"></div>'
      + '<div style="position:relative">' + entete + '</div></div>' : '')
    + (plein ? deco : '')
    + corps
    + (actions ? '<div class="sl__actions">' + actions + '</div>' : '')
    + illu + '</div>';
}

/**
 * La carte, prête à être insérée dans un gabarit. brut() : tout ce qui vient
 * des données est déjà échappé par texteSlide().
 * @param {any} s
 * @param {OptionsSlide} [options]
 * @returns {Html}
 */
export function rendreSlide(s, options) {
  return brut(texteSlide(s, options));
}

/**
 * Relance l'animation d'une carte (bouton « Rejouer »). Remplacer la scène par
 * un clone est ce qui redémarre VRAIMENT les animations CSS : le clone repart
 * d'un nœud neuf, donc d'un temps zéro.
 * @param {Element} bouton
 */
export function rejouer(bouton) {
  const carte = bouton.closest('.sl');
  const scene = carte ? carte.querySelector('[data-scene]') : null;
  if (!carte || !scene || !scene.parentNode) return;
  // Demande explicite de mouvement : restaure l'oscillation de la plante, seul
  // effet que prefers-reduced-motion retire encore (cf. slides.css).
  carte.setAttribute('data-anime', '');
  scene.replaceWith(scene.cloneNode(true));
}
