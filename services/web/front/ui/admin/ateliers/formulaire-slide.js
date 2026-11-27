/* ============================================================================
   formulaire-slide.js — le formulaire d'une slide, type par type : ce qu'on
   y saisit (CHAMPS), son gabarit pré-rempli, et sa relecture en `contenu`.

   Un type = une liste de champs : ajouter un type de slide ne demande qu'une
   entrée dans CHAMPS (et la validation correspondante côté serveur,
   valider_contenu() de evenements-api/evenements/_slides.php).

   La relecture reprend celle de l'ancien éditeur, ligne pour ligne :
   tests/front/admin-parcours.test.mjs vérifie qu'une slide ouverte puis
   enregistrée sans changement donne le même `contenu` qu'avant
   (tests/front/reference/ancien-editeur-parcours.js).

   Chaque champ porte `data-cle` : c'est par là qu'on le retrouve, jamais par
   sa place dans le formulaire.
   ============================================================================ */
import { ChoixEmoji } from '../../composants/choix-emoji/choix-emoji.js';
import { Html, html } from '../../socle/outils.js';

/**
 * @typedef {'text' | 'textarea' | 'number' | 'check' | 'select' | 'select_vf' | 'emoji'
 *   | 'select_anecdote' | 'select_theme' | 'options' | 'options_simple' | 'items_jeu'} TypeChamp
 * @typedef {[cle: string, libelle: string, type: TypeChamp, extra?: string[] | string]} Champ
 * @typedef {Record<string, any>} Contenu
 * @typedef {{ emoji?: string, nom?: string, info?: string, cat?: string, jours?: number | null, mot?: string }} ItemJeu
 */

/** Les jeux dont une slide peut reprendre un extrait (slides_jeux_valides()). */
export const JEUX_SLIDE = ['compost-ou-pas', 'temps-decompo', 'mot-mystere'];

/** @type {Record<string, Champ[]>} */
export const CHAMPS = {
  titre: [['sous_titre', 'Sous-titre', 'text']],
  texte: [['corps', 'Texte', 'textarea']],
  anecdote: [
    ['source', 'Provenance', 'select', ['libre', 'banque', 'aleatoire']],
    ['emoji', 'Emoji', 'emoji'],
    ['corps', 'Anecdote', 'textarea'],
    ['anecdote_id', 'Anecdote de la banque', 'select_anecdote'],
    ['theme', 'Limiter au thème (facultatif)', 'select_theme'],
  ],
  // Le sommaire n'a rien à saisir : il liste les slides « Titre de partie »
  // du parcours et surligne celle en cours.
  sommaire: [],
  media: [
    ['media_type', 'Type', 'select', ['image', 'video', 'audio']],
    ['url', 'Adresse du média', 'text'],
    ['legende', 'Légende', 'text'],
  ],
  classement: [['portee', 'Afficher', 'select', ['les_deux', 'individuel', 'equipe']]],
  encouragement: [
    ['animation', 'Animation', 'select', ['pousse', 'confettis']],
    ['message', 'Message', 'textarea'],
    ['sous_titre', 'Précision (facultatif)', 'text'],
    ['montrer_score', 'Afficher le score du participant', 'check'],
  ],
  fin: [
    ['message', 'Message de fin', 'textarea'],
    ['afficher_classement', 'Afficher le classement final', 'check'],
  ],
  quiz: [
    ['question', 'Question', 'textarea'],
    ['multiple', 'Plusieurs bonnes réponses possibles', 'check',
      'Chaque bonne réponse cochée par le joueur rapporte 1/n du point de la question, '
      + 'chaque mauvaise en retire 1/n (n = nombre de bonnes réponses) — jamais moins que 0, '
      + 'jamais plus que le point plein.'],
    ['options', 'Réponses possibles', 'options'],
    ['explication', 'Explication (après réponse)', 'textarea'],
  ],
  vrai_faux: [
    ['question', 'Affirmation', 'textarea'],
    ['correct', 'La bonne réponse est', 'select_vf'],
    ['explication', 'Explication (après réponse)', 'textarea'],
  ],
  estimation: [
    ['question', 'Question', 'textarea'],
    ['valeur', 'Valeur exacte', 'number'],
    ['unite', 'Unité', 'text'],
    ['tolerance', 'Tolérance (points pleins en deçà)', 'number'],
    ['explication', 'Explication (après réponse)', 'textarea'],
  ],
  sondage: [
    ['question', 'Question', 'textarea'],
    ['options', 'Choix proposés', 'options_simple'],
  ],
  jeu: [
    ['jeu', 'Jeu', 'select', JEUX_SLIDE],
    ['items', 'Éléments', 'items_jeu'],
  ],
  question_ouverte: [
    ['question', 'Question', 'textarea'],
    ['max_car', 'Longueur max de la réponse', 'number'],
  ],
  defi: [['consigne', 'Consigne du défi', 'textarea']],
};

/** Quels champs montrer pour chaque provenance d'une anecdote : les trois
 *  formulaires cohabitent dans le même bloc, un seul sert à la fois. */
export const CHAMPS_PAR_SOURCE = {
  libre: ['corps', 'emoji'],
  banque: ['anecdote_id'],
  aleatoire: ['theme'],
};

/** @param {string} cle */
const idDe = (cle) => 'slide-ch-' + cle;

/**
 * Valeur d'un champ simple, comme l'ancien éditeur la posait : rien si elle
 * est absente.
 * @param {Contenu} contenu
 * @param {string} cle
 * @returns {string}
 */
function valeurDe(contenu, cle) {
  const v = contenu[cle];
  return v === undefined || v === null ? '' : String(v);
}

/**
 * Le formulaire d'un type, pré-rempli avec le contenu d'une slide.
 * @param {string} type
 * @param {Contenu | null | undefined} [contenu]
 * @returns {Html}
 */
export function gabaritChamps(type, contenu) {
  const c = contenu || {};
  if (type === 'sommaire') {
    return html`<div class="hint">Rien à saisir : le sommaire reprend automatiquement toutes les slides « Titre de partie » du parcours, et met en valeur celle qui commence. Place-le juste avant chaque partie.</div>`;
  }
  // Le jeu choisi décide de la forme des éléments ; il vient avant eux.
  const jeu = typeof c.jeu === 'string' && JEUX_SLIDE.includes(c.jeu) ? c.jeu : JEUX_SLIDE[0];
  return html`${(CHAMPS[type] || []).map((champ) => gabaritChamp(champ, c, jeu))}`;
}

/**
 * @param {Champ} champ
 * @param {Contenu} c
 * @param {string} jeu
 * @returns {Html}
 */
function gabaritChamp([cle, libelle, type, extra], c, jeu) {
  const id = idDe(cle);
  const titre = html`<label for="${id}">${libelle}</label>`;
  const bloc = (/** @type {Html} */ corps) => html`<div class="field" data-champ="${cle}">${corps}</div>`;
  switch (type) {
    case 'emoji':
      return bloc(html`<span class="field-titre">${libelle}</span><cs-choix-emoji data-cle="${cle}" libelle="${libelle}" valeur="${valeurDe(c, cle)}"></cs-choix-emoji>`);
    case 'select_anecdote':
    case 'select_theme':
      // Rempli à l'arrivée de la banque d'anecdotes ; la valeur attendue
      // attend dans data-valeur.
      return bloc(html`${titre}<select id="${id}" data-cle="${cle}" data-valeur="${valeurDe(c, cle)}"><option value="">Chargement…</option></select>`);
    case 'textarea':
      return bloc(html`${titre}<textarea id="${id}" data-cle="${cle}">${valeurDe(c, cle)}</textarea>`);
    case 'number':
      return bloc(html`${titre}<input type="number" step="any" id="${id}" data-cle="${cle}" value="${valeurDe(c, cle)}">`);
    case 'check':
      return bloc(html`<label class="check"><input type="checkbox" id="${id}" data-cle="${cle}"${!!c[cle] && html` checked`}> ${libelle}</label>${typeof extra === 'string' && html`<div class="hint">${extra}</div>`}`);
    case 'select': {
      const choix = Array.isArray(extra) ? extra : [];
      // La provenance d'une anecdote vaut « libre » par défaut.
      const valeur = cle === 'source' && !c.source ? 'libre' : valeurDe(c, cle);
      return bloc(html`${titre}<select id="${id}" data-cle="${cle}">${choix.map((o) => html`<option value="${o}"${o === valeur && html` selected`}>${o}</option>`)}</select>`);
    }
    case 'select_vf':
      return bloc(html`${titre}<select id="${id}" data-cle="${cle}"><option value="1"${!!c[cle] && html` selected`}>Vrai</option><option value="0"${!c[cle] && html` selected`}>Faux</option></select>`);
    case 'options':
    case 'options_simple': {
      const avecCorrect = type === 'options';
      const multi = avecCorrect && !!c.multiple;
      const justes = multi && Array.isArray(c.correct) ? c.correct : [];
      const options = Array.isArray(c.options) ? c.options : ['', ''];
      return bloc(html`
        <div class="field-titre">${libelle}</div>
        <div class="rep-liste" data-cle="${cle}" data-sorte="${type}">${options.map((o, i) =>
          gabaritLigneOption(o, avecCorrect && (multi ? justes.includes(i) : c.correct === i), avecCorrect, multi))}</div>
        <button type="button" class="rep-add" data-ajouter="${cle}">+ Ajouter</button>
        ${avecCorrect && html`<div class="hint">Coche la bonne réponse (ou les bonnes réponses si « Plusieurs bonnes réponses » est activé).</div>`}`);
    }
    case 'items_jeu': {
      const items = Array.isArray(c.items) ? c.items : [{}];
      return bloc(html`
        <div class="field-titre">${libelle}</div>
        <div class="rep-liste" data-cle="${cle}" data-sorte="items_jeu">${items.map((it) => gabaritLigneItem(it, jeu))}</div>
        <button type="button" class="rep-add" data-ajouter="${cle}">+ Ajouter</button>
        <button type="button" class="rep-add" data-action="importer">📥 Importer depuis le jeu</button>
        <div class="hint">L'import recopie les éléments du jeu dans la slide : retire ensuite ceux dont tu ne veux pas. Modifier le jeu du site ne changera plus ce parcours.</div>`);
    }
    default:
      return bloc(html`${titre}<input type="text" id="${id}" data-cle="${cle}" value="${valeurDe(c, cle)}">`);
  }
}

/**
 * Une réponse d'un quiz ou d'un sondage. `multi` remplace le bouton radio
 * (une seule bonne réponse) par une case à cocher (plusieurs).
 * @param {unknown} valeur
 * @param {boolean} coche
 * @param {boolean} avecCorrect
 * @param {boolean} multi
 * @returns {Html}
 */
export function gabaritLigneOption(valeur, coche, avecCorrect, multi) {
  return html`
    <div class="rep-row">
      <input type="text" maxlength="300" value="${valeur == null ? '' : String(valeur)}" placeholder="Réponse">
      ${avecCorrect && html`<label class="rep-correct"><input type="${multi ? 'checkbox' : 'radio'}"${!multi && html` name="slide-opt-correct"`}${coche && html` checked`}> juste</label>`}
      <button type="button" class="rep-del" aria-label="Retirer">✕</button>
    </div>`;
}

/**
 * Un élément d'un extrait de jeu. Le libellé principal change de rôle selon
 * le jeu : pour mot-mystère c'est l'indice qui s'affiche, et le mot à deviner
 * est un champ à part (sans quoi la réponse serait visible du participant).
 * L'anecdote du jeu d'origine n'a pas de champ : elle voyage avec la ligne
 * (data-info) pour être réaffichée au participant après sa réponse.
 * @param {ItemJeu | null | undefined} item
 * @param {string} jeu
 * @returns {Html}
 */
export function gabaritLigneItem(item, jeu) {
  const it = item || {};
  let cle;
  let indication = 'Élément';
  if (jeu === 'compost-ou-pas') {
    cle = html`<select class="rep-cat">${['oui', 'attention', 'non'].map((c) => html`<option value="${c}"${it.cat === c && html` selected`}>${c}</option>`)}</select>`;
  } else if (jeu === 'temps-decompo') {
    cle = html`<input type="number" min="0" class="rep-jours" value="${it.jours != null ? String(it.jours) : ''}" placeholder="jours">`;
  } else {
    indication = 'Indice affiché';
    cle = html`<input type="text" maxlength="60" class="rep-mot" value="${it.mot || ''}" placeholder="mot à deviner">`;
  }
  return html`
    <div class="rep-row" data-info="${it.info || ''}">
      <input type="text" maxlength="60" class="rep-emoji" value="${it.emoji || ''}" placeholder="emoji">
      <input type="text" maxlength="200" value="${it.nom || ''}" placeholder="${indication}">
      ${cle}
      <button type="button" class="rep-del" aria-label="Retirer">✕</button>
    </div>`;
}

/**
 * Le champ d'une clé, dans le formulaire.
 * @param {ParentNode} racine
 * @param {string} cle
 * @returns {Element | null}
 */
export function champDe(racine, cle) {
  return racine.querySelector('[data-cle="' + cle + '"]');
}

/**
 * Le jeu choisi dans le formulaire (le premier, s'il n'y en a pas).
 * @param {ParentNode} racine
 * @returns {string}
 */
export function jeuChoisi(racine) {
  const choix = champDe(racine, 'jeu');
  return choix instanceof HTMLSelectElement ? choix.value : JEUX_SLIDE[0];
}

/**
 * @param {Element} ligne
 * @param {string} selecteur
 * @returns {string}
 */
function valeurDans(ligne, selecteur) {
  const champ = ligne.querySelector(selecteur);
  return champ instanceof HTMLInputElement || champ instanceof HTMLSelectElement ? champ.value : '';
}

/**
 * Relit le formulaire et reconstruit le `contenu` de la slide. Même ordre et
 * mêmes règles que l'ancien éditeur : `multiple` est lu avant `options`, une
 * réponse vide est écartée, un élément sans nom aussi.
 * @param {ParentNode} racine
 * @param {string} type
 * @returns {Contenu}
 */
export function lireChamps(racine, type) {
  /** @type {Contenu} */
  const out = {};
  for (const [cle, , t] of CHAMPS[type] || []) {
    const el = champDe(racine, cle);
    if (!el) continue;
    if (t === 'emoji') {
      // Pas encore affiché (sa feuille de style arrive) : la valeur posée
      // par le gabarit est encore dans l'attribut.
      out[cle] = el.querySelector('.choix-emoji__champ') && el instanceof ChoixEmoji ? el.value : el.getAttribute('valeur') || '';
      continue;
    }
    if (t === 'check') { out[cle] = el instanceof HTMLInputElement && el.checked; continue; }
    if (t === 'select_vf') { out[cle] = el instanceof HTMLSelectElement && el.value === '1'; continue; }
    if (t === 'number') {
      const v = el instanceof HTMLInputElement ? el.value : '';
      out[cle] = v === '' ? null : Number(v);
      continue;
    }
    if (t === 'options' || t === 'options_simple') {
      const lignes = [...el.querySelectorAll('.rep-row')];
      out.options = lignes.map((l) => valeurDans(l, 'input[type="text"]').trim()).filter((v) => v !== '');
      if (t === 'options') {
        if (out.multiple) {
          out.correct = lignes
            .map((l, i) => {
              const marque = l.querySelector('input[type="checkbox"]');
              return marque instanceof HTMLInputElement && marque.checked ? i : -1;
            })
            .filter((i) => i !== -1);
        } else {
          out.correct = Math.max(0, lignes.findIndex((l) => {
            const marque = l.querySelector('input[type="radio"]');
            return marque instanceof HTMLInputElement && marque.checked;
          }));
        }
      }
      continue;
    }
    if (t === 'items_jeu') {
      const jeu = jeuChoisi(racine);
      out.items = [...el.querySelectorAll('.rep-row')].map((l) => {
        const textes = [...l.querySelectorAll('input[type="text"]')].map((x) => (x instanceof HTMLInputElement ? x.value : ''));
        /** @type {ItemJeu} */
        const it = { emoji: (textes[0] || '').trim(), nom: (textes[1] || '').trim(), info: l.getAttribute('data-info') || '' };
        if (jeu === 'compost-ou-pas') it.cat = valeurDans(l, 'select');
        else if (jeu === 'temps-decompo') it.jours = Number(valeurDans(l, 'input[type="number"]') || 0);
        else it.mot = textes[2] !== undefined ? textes[2].trim() : ''; // 3e champ texte = mot à deviner
        return it;
      }).filter((i) => i.nom !== '');
      continue;
    }
    out[cle] = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : '';
  }
  return out;
}

/**
 * Ce qui est saisi dans les réponses d'un quiz ou d'un sondage, ligne par
 * ligne, vides comprises : pour redessiner la liste sans rien perdre.
 * @param {Element} liste
 * @returns {{ valeur: string, coche: boolean }[]}
 */
export function etatOptions(liste) {
  return [...liste.querySelectorAll('.rep-row')].map((l) => {
    const marque = l.querySelector('input[type="radio"], input[type="checkbox"]');
    return { valeur: valeurDans(l, 'input[type="text"]'), coche: marque instanceof HTMLInputElement && marque.checked };
  });
}

/**
 * Ce qui est saisi dans les éléments d'un extrait de jeu, lignes vides
 * comprises : pour redessiner la liste sans rien perdre.
 * @param {Element} liste
 * @param {string} jeu
 * @returns {ItemJeu[]}
 */
export function etatItems(liste, jeu) {
  return [...liste.querySelectorAll('.rep-row')].map((l) => {
    const textes = [...l.querySelectorAll('input[type="text"]')].map((x) => (x instanceof HTMLInputElement ? x.value : ''));
    /** @type {ItemJeu} */
    const it = { emoji: textes[0] || '', nom: textes[1] || '', info: l.getAttribute('data-info') || '' };
    if (jeu === 'compost-ou-pas') it.cat = valeurDans(l, 'select');
    else if (jeu === 'temps-decompo') {
      const jours = valeurDans(l, 'input[type="number"]');
      it.jours = jours === '' ? null : Number(jours);
    } else it.mot = textes[2] || '';
    return it;
  });
}

/**
 * Les réponses redessinées après la bascule « Plusieurs bonnes réponses » :
 * mêmes textes ; en repassant à une seule bonne réponse, seule la première
 * coche reste.
 * @param {{ valeur: string, coche: boolean }[]} etats
 * @param {boolean} multi
 * @returns {{ valeur: string, coche: boolean }[]}
 */
export function basculerMulti(etats, multi) {
  let dejaCoche = false;
  return etats.map(({ valeur, coche }) => {
    const c = multi ? coche : coche && !dejaCoche;
    if (c && !multi) dejaCoche = true;
    return { valeur, coche: c };
  });
}
