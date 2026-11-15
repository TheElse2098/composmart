/* ============================================================================
   journal-diff.js — comparer un « avant » et un « après » et le montrer.

   Le journal conserve ce qu'une action a changé (cf. audit_changements() dans
   shared/_guard.php) :
     changements = { champ: [avant, après] }   seulement ce qui a changé
     etat        = l'élément entier, à sa création ou à sa suppression
   Ce fichier en fait des gabarits : tableau champ / avant / après, listes
   avec leurs éléments retirés et ajoutés, textes comparés ligne à ligne puis
   mot à mot, cours comparés panneau par panneau, quiz question par question.

   Que des fonctions pures (des données vers un gabarit), testées sous Node.
   ============================================================================ */
import { Html, html } from '../../socle/outils.js';
import { VALEURS, libelleChamp } from './journal-libelles.js';

/** @typedef {['=' | '-' | '+', string]} Operation */
/** @typedef {Html | string} Contenu  ce qu'un gabarit sait insérer : du HTML sûr, ou un texte à échapper */

const TIRET = html`<span class="audit-vide">—</span>`;
const VIDE = html`<span class="audit-vide">(vide)</span>`;

/** @param {string} texte */
const note = (texte) => html`<div class="audit-note">${texte}</div>`;

/** @param {number} n @param {string} mot @param {string} accord  « 3 lignes inchangées » */
const compte = (n, mot, accord) => n + ' ' + mot + (n > 1 ? 's' : '') + ' ' + accord + (n > 1 ? 's' : '');

/**
 * Une ligne « clé : valeur » du détail.
 * @param {Contenu} cle
 * @param {Contenu | number} valeur
 * @param {boolean} [absente]  valeur manquante, affichée en retrait
 */
export function ligne(cle, valeur, absente = false) {
  return html`<div class="audit-row"><span class="audit-key">${cle}</span><span class="audit-val${absente ? ' empty' : ''}">${valeur}</span></div>`;
}

/**
 * Un élément de liste (déchet d'un jeu, slide…) résumé en une ligne.
 * @param {unknown} x
 * @returns {string}
 */
export function resumeElement(x) {
  if (x === null || typeof x !== 'object') return String(x);
  const objet = /** @type {Record<string, unknown>} */ (x);
  const valeurs = Object.keys(objet)
    .filter((k) => k !== 'emoji' && k !== 'id' && objet[k] !== '' && objet[k] !== null && typeof objet[k] !== 'object')
    .map((k) => String(objet[k]));
  const texte = (objet.emoji ? objet.emoji + ' ' : '') + valeurs.join(' · ');
  return texte.length > 140 ? texte.slice(0, 140) + '…' : texte;
}

/**
 * @param {unknown} x
 * @param {string} [sorte]  `ajout`, `retrait`, `nok`
 */
const puce = (x, sorte = '') => html`<span class="audit-chip${sorte ? ' ' + sorte : ''}">${resumeElement(x)}</span>`;

/**
 * Une valeur telle qu'on la lit : oui/non, liste en puces, objet en sous-tableau,
 * statut traduit.
 * @param {unknown} v
 * @param {string | number} [cle]  le champ, qui décide de la lecture (`admin`, `statut`, `niveau`)
 * @param {number} [profondeur]
 * @returns {Contenu}
 */
export function valeur(v, cle = '', profondeur = 0) {
  if (v === null || v === undefined || v === '') return TIRET;
  const champ = String(cle).split('.').pop() || '';
  if (typeof v === 'boolean' || (champ === 'admin' && (v === 0 || v === 1))) return v ? 'oui' : 'non';
  if (Array.isArray(v)) {
    if (!v.length) return VIDE;
    return html`${v.map((x) => puce(x))}`;
  }
  if (typeof v === 'object') {
    if (profondeur >= 2) return JSON.stringify(v).slice(0, 300);
    const objet = /** @type {Record<string, unknown>} */ (v);
    const cles = Object.keys(objet);
    if (!cles.length) return VIDE;
    return html`<div class="audit-obj">${cles.map((k) => html`<span class="k">${libelleChamp(k)}</span><span>${valeur(objet[k], k, profondeur + 1)}</span>`)}</div>`;
  }
  if ((champ === 'statut' || champ === 'niveau') && typeof v === 'string' && VALEURS[v]) return VALEURS[v];
  return String(v);
}

/**
 * Plus longue sous-suite commune de deux suites. Préfixe et suffixe communs
 * sont retirés d'abord (le cas courant : une retouche au milieu d'un long
 * texte) ; au-delà de 2,5 millions de cases, on renonce à aligner plutôt que
 * de figer l'onglet.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Operation[]} ce qui est gardé (=), retiré (-), ajouté (+)
 */
export function diffSuites(a, b) {
  const n = a.length;
  const m = b.length;
  let p = 0;
  while (p < n && p < m && a[p] === b[p]) p++;
  let s = 0;
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s++;
  const A = a.slice(p, n - s);
  const B = b.slice(p, m - s);

  /** @type {Operation[]} */
  const ops = [];
  for (let i = 0; i < p; i++) ops.push(['=', a[i]]);
  if (A.length * B.length > 2500000) {
    for (const x of A) ops.push(['-', x]);
    for (const x of B) ops.push(['+', x]);
  } else {
    const N = A.length;
    const M = B.length;
    /** @type {Uint32Array[]} */
    const L = [];
    for (let i = 0; i <= N; i++) L.push(new Uint32Array(M + 1));
    for (let i = N - 1; i >= 0; i--) {
      for (let j = M - 1; j >= 0; j--) {
        L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < N && j < M) {
      if (A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', A[i]]); i++; }
      else { ops.push(['+', B[j]]); j++; }
    }
    while (i < N) ops.push(['-', A[i++]]);
    while (j < M) ops.push(['+', B[j++]]);
  }
  for (let i = n - s; i < n; i++) ops.push(['=', a[i]]);
  return ops;
}

/**
 * Deux versions d'une même ligne, mots changés surlignés.
 * @param {string} a
 * @param {string} b
 * @returns {[Html, Html]} la ligne d'avant, la ligne d'après
 */
export function diffMots(a, b) {
  /** @type {Contenu[]} */
  const avant = [];
  /** @type {Contenu[]} */
  const apres = [];
  for (const [sorte, mot] of diffSuites(a.split(/(\s+)/), b.split(/(\s+)/))) {
    if (sorte === '=') { avant.push(mot); apres.push(mot); }
    else if (sorte === '-') avant.push(html`<del class="dw">${mot}</del>`);
    else apres.push(html`<ins class="dw">${mot}</ins>`);
  }
  return [html`${avant}`, html`${apres}`];
}

/** @param {unknown} texte @returns {string[]} */
const lignesDe = (texte) => (texte === null || texte === undefined || texte === '' ? [] : String(texte).split('\n'));

/**
 * Une ligne du comparatif. Une ligne vide garde sa hauteur (espace insécable).
 * @param {string} sorte  `dl-eq`, `dl-del`, `dl-add`
 * @param {Contenu} contenu
 */
const ligneDiff = (sorte, contenu) => html`<div class="dl ${sorte}">${String(contenu) === '' ? '\u00a0' : contenu}</div>`;

/**
 * Deux textes comparés ligne à ligne. Les lignes inchangées sont repliées, une
 * ligne de contexte gardée de part et d'autre de chaque changement. Une ligne
 * retirée suivie d'une ligne ajoutée est lue comme une retouche : mot à mot.
 * @param {unknown} avant
 * @param {unknown} apres
 */
export function diffTexte(avant, apres) {
  const ops = diffSuites(lignesDe(avant), lignesDe(apres));
  if (!ops.some((o) => o[0] !== '=')) return note('Texte identique.');

  /** @type {Html[]} */
  const sortie = [];
  let k = 0;
  while (k < ops.length) {
    let f = k;
    if (ops[k][0] === '=') {
      while (f < ops.length && ops[f][0] === '=') f++;
      const suite = ops.slice(k, f);
      const tete = k === 0 ? 0 : 1;
      const queue = f === ops.length ? 0 : 1;
      if (suite.length > tete + queue + 1) {
        for (const o of suite.slice(0, tete)) sortie.push(ligneDiff('dl-eq', o[1]));
        sortie.push(html`<div class="dl dl-saut">… ${compte(suite.length - tete - queue, 'ligne', 'inchangée')} …</div>`);
        for (const o of suite.slice(suite.length - queue)) sortie.push(ligneDiff('dl-eq', o[1]));
      } else {
        for (const o of suite) sortie.push(ligneDiff('dl-eq', o[1]));
      }
    } else {
      /** @type {string[]} */
      const retirees = [];
      /** @type {string[]} */
      const ajoutees = [];
      while (f < ops.length && ops[f][0] !== '=') {
        (ops[f][0] === '-' ? retirees : ajoutees).push(ops[f][1]);
        f++;
      }
      const paires = Math.min(retirees.length, ajoutees.length);
      for (let i = 0; i < paires; i++) {
        const [a, b] = diffMots(retirees[i], ajoutees[i]);
        sortie.push(ligneDiff('dl-del', a), ligneDiff('dl-add', b));
      }
      for (const x of retirees.slice(paires)) sortie.push(ligneDiff('dl-del', x));
      for (const x of ajoutees.slice(paires)) sortie.push(ligneDiff('dl-add', x));
    }
    k = f;
  }
  return html`<div class="diff-bloc">${sortie}</div>`;
}

/**
 * Deux listes : éléments retirés barrés, ajoutés en vert. Une longue liste
 * (contenu d'un jeu) ne montre que ce qui bouge.
 * @param {unknown} avant
 * @param {unknown} apres
 */
export function diffListe(avant, apres) {
  /** @type {unknown[]} */
  const av = Array.isArray(avant) ? avant : [];
  /** @type {unknown[]} */
  const ap = Array.isArray(apres) ? apres : [];
  /** @param {unknown} x */
  const cle = (x) => JSON.stringify(x);
  const dansAvant = new Set(av.map(cle));
  const dansApres = new Set(ap.map(cle));

  if (av.length + ap.length > 30) {
    const retires = av.filter((x) => !dansApres.has(cle(x)));
    const ajoutes = ap.filter((x) => !dansAvant.has(cle(x)));
    return html`<div class="audit-chg-large">
      ${retires.length > 0 && html`<div><b>Retirés (${retires.length})</b> ${retires.map((x) => puce(x, 'retrait'))}</div>`}
      ${ajoutes.length > 0 && html`<div><b>Ajoutés (${ajoutes.length})</b> ${ajoutes.map((x) => puce(x, 'ajout'))}</div>`}
      ${!retires.length && !ajoutes.length && note('Mêmes éléments, ordre changé.')}
      ${note(compte(ap.length - ajoutes.length, 'élément', 'inchangé') + '.')}
    </div>`;
  }
  return html`<div class="val-avant">${av.length ? av.map((x) => puce(x, dansApres.has(cle(x)) ? '' : 'retrait')) : VIDE}</div><div class="val-apres">${ap.length ? ap.map((x) => puce(x, dansAvant.has(cle(x)) ? '' : 'ajout')) : VIDE}</div>`;
}

/** @param {unknown} v */
const estLong = (v) => typeof v === 'string' && (v.length > 90 || v.indexOf('\n') >= 0);

/**
 * Le tableau Champ | Avant | Après.
 * @param {Record<string, [unknown, unknown]> | null | undefined} changements
 */
export function changements(changements) {
  const cles = Object.keys(changements || {});
  if (!changements || !cles.length) return note('Enregistré sans aucune différence.');
  return html`<div class="audit-chg"><span class="audit-chg-entete"></span><span class="audit-chg-entete">Avant</span><span class="audit-chg-entete">Après</span>${cles.map((k) => {
    const [av, ap] = changements[k];
    /** @type {Html} */
    let cases;
    if (Array.isArray(av) || Array.isArray(ap)) cases = diffListe(av, ap);
    else if (estLong(av) || estLong(ap)) cases = html`<div class="audit-chg-large">${diffTexte(av, ap)}</div>`;
    else cases = html`<div class="val-avant">${valeur(av, k)}</div><div class="val-apres">${valeur(ap, k)}</div>`;
    return html`<span class="audit-chg-cle">${libelleChamp(k)}</span>${cases}`;
  })}</div>`;
}

/**
 * Deux objets comparés champ par champ.
 * @param {Record<string, unknown> | null | undefined} avant
 * @param {Record<string, unknown> | null | undefined} apres
 */
export function diffObjet(avant, apres) {
  const a = avant || {};
  const b = apres || {};
  /** @type {Record<string, [unknown, unknown]>} */
  const ch = {};
  for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
    const x = a[k] === undefined ? null : a[k];
    const y = b[k] === undefined ? null : b[k];
    if (JSON.stringify(x) !== JSON.stringify(y)) ch[k] = [x, y];
  }
  return changements(ch);
}

/**
 * @param {string} etiquette  « ✏️ Panneau modifié »
 * @param {string} titre
 * @param {Contenu} corps
 */
const bloc = (etiquette, titre, corps) => html`<div class="diff-panneau"><div class="diff-panneau-titre">${etiquette} — « ${titre} »</div>${corps}</div>`;

/**
 * Les panneaux d'un cours : le texte est découpé sur les titres « ## » (même
 * règle que la page de lecture ; « ### Sources » reste dans le corps).
 * @param {unknown} markdown
 * @returns {{ titre: string, corps: string }[]}
 */
export function panneauxCours(markdown) {
  /** @type {{ titre: string, lignes: string[] }[]} */
  const panneaux = [];
  let courant = { titre: '', lignes: /** @type {string[]} */ ([]) };
  const garder = () => { if (courant.titre || courant.lignes.join('').trim()) panneaux.push(courant); };
  for (const l of String(markdown || '').split('\n')) {
    const m = /^##\s+(.*)$/.exec(l);
    if (m) {
      garder();
      courant = { titre: m[1].trim(), lignes: [] };
    } else {
      courant.lignes.push(l);
    }
  }
  garder();
  return panneaux.map((p) => ({ titre: p.titre || 'introduction', corps: p.lignes.join('\n').trim() }));
}

/**
 * Le texte d'un cours, comparé panneau par panneau.
 * @param {unknown} avant
 * @param {unknown} apres
 */
export function diffCoursTexte(avant, apres) {
  const A = panneauxCours(avant);
  const B = panneauxCours(apres);
  const pris = new Set();
  /** @type {Html[]} */
  const sortie = [];
  let inchanges = 0;
  for (const p of B) {
    const i = A.findIndex((q, k) => !pris.has(k) && q.titre === p.titre);
    if (i < 0) { sortie.push(bloc('➕ Panneau ajouté', p.titre, diffTexte('', p.corps))); continue; }
    pris.add(i);
    if (A[i].corps === p.corps) { inchanges++; continue; }
    sortie.push(bloc('✏️ Panneau modifié', p.titre, diffTexte(A[i].corps, p.corps)));
  }
  A.forEach((q, k) => { if (!pris.has(k)) sortie.push(bloc('🗑️ Panneau supprimé', q.titre, diffTexte(q.corps, ''))); });

  /** @param {{ titre: string }[]} X @param {{ titre: string }[]} Y */
  const communs = (X, Y) => X.map((p) => p.titre).filter((t) => Y.some((q) => q.titre === t));
  if (JSON.stringify(communs(A, B)) !== JSON.stringify(communs(B, A))) sortie.push(note("L'ordre des panneaux a changé."));
  if (inchanges) sortie.push(note(inchanges + ' panneau' + (inchanges > 1 ? 'x' : '') + ' inchangé' + (inchanges > 1 ? 's' : '') + '.'));
  return sortie.length ? html`${sortie}` : note('Texte identique.');
}

/** @typedef {{ question: string, options?: string[], correct?: number | number[] }} Question */

/**
 * Un quiz comparé question par question.
 * @param {unknown} avant
 * @param {unknown} apres
 */
export function diffQuiz(avant, apres) {
  /** @type {Question[]} */
  const av = Array.isArray(avant) ? avant : [];
  /** @type {Question[]} */
  const ap = Array.isArray(apres) ? apres : [];
  /** @param {Question} q  ses bonnes réponses, en toutes lettres */
  const bonnes = (q) => (Array.isArray(q.correct) ? q.correct : [q.correct])
    .map((i) => (i === undefined ? undefined : (q.options || [])[i])).filter((x) => x != null);
  /** @param {Question} q */
  const fiche = (q) => changements({ options: [null, q.options || []], 'Bonne(s) réponse(s)': [null, bonnes(q)] });

  const pris = new Set();
  /** @type {Html[]} */
  const sortie = [];
  let inchangees = 0;
  for (const q of ap) {
    const i = av.findIndex((x, k) => !pris.has(k) && x.question === q.question);
    if (i < 0) { sortie.push(bloc('➕ Question ajoutée', q.question, fiche(q))); continue; }
    pris.add(i);
    /** @type {Record<string, [unknown, unknown]>} */
    const ch = {};
    if (JSON.stringify(av[i].options) !== JSON.stringify(q.options)) ch.options = [av[i].options, q.options];
    if (JSON.stringify(bonnes(av[i])) !== JSON.stringify(bonnes(q))) ch['Bonne(s) réponse(s)'] = [bonnes(av[i]), bonnes(q)];
    if (!Object.keys(ch).length) { inchangees++; continue; }
    sortie.push(bloc('✏️ Question modifiée', q.question, changements(ch)));
  }
  av.forEach((q, k) => { if (!pris.has(k)) sortie.push(bloc('🗑️ Question supprimée', q.question, '')); });
  if (inchangees) sortie.push(note(compte(inchangees, 'question', 'inchangée') + '.'));
  return sortie.length ? html`${sortie}` : note('Quiz identique.');
}

/**
 * Un élément entier (créé, ou tel qu'il était avant sa suppression), champ par champ.
 * @param {unknown} etat
 */
export function etatElement(etat) {
  if (!etat || typeof etat !== 'object') return note('—');
  const objet = /** @type {Record<string, unknown>} */ (etat);
  return html`${Object.keys(objet).map((k) => ligne(libelleChamp(k), valeur(objet[k], k)))}`;
}
