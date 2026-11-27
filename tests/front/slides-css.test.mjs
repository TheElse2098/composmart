/* ============================================================================
   ui/styles/slides.css rend comme assets/css/slides.css.

   La reprise a dû réécrire les règles de mode sombre en variables, ce qui
   change la précision des sélecteurs : une règle de thème peut alors
   l'emporter là où elle perdait. Ce test refait la cascade CSS (précision,
   ordre, héritage et substitution des variables) sur les éléments touchés,
   dans les trois thèmes, en clair et en sombre, et compare les valeurs
   obtenues avec l'ancienne feuille et avec la nouvelle.

   La cascade est volontairement réduite à ce dont ces éléments ont besoin :
   pas de @media ni de @container (aucune couleur n'y change), pas d'état
   :hover (on regarde une réponse corrigée, donc désactivée).
   ============================================================================ */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ANCIENNE = readFileSync(new URL('../../services/web/front/assets/css/slides.css', import.meta.url), 'utf8');
const NOUVELLE = readFileSync(new URL('../../services/web/front/ui/styles/slides.css', import.meta.url), 'utf8');

/**
 * @typedef {{ selecteur: string, nom: string, valeur: string, important: boolean, ordre: number }} Declaration
 * @typedef {{ tag: string, classes: string[], attributs: Record<string, string>, desactive?: boolean }} Element
 */

/** Les règles de premier niveau (les blocs @… sont écartés). @param {string} css @returns {Declaration[]} */
function declarations(css) {
  const texte = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {Declaration[]} */
  const sortie = [];
  let i = 0;
  let ordre = 0;
  while (i < texte.length) {
    const ouvre = texte.indexOf('{', i);
    if (ouvre < 0) break;
    const tete = texte.slice(i, ouvre).trim();
    // Fin du bloc, accolades imbriquées comprises.
    let profondeur = 1;
    let j = ouvre + 1;
    while (j < texte.length && profondeur > 0) {
      if (texte[j] === '{') profondeur++;
      else if (texte[j] === '}') profondeur--;
      j++;
    }
    const corps = texte.slice(ouvre + 1, j - 1);
    i = j;
    if (tete.startsWith('@')) continue;
    for (const morceau of corps.split(';')) {
      const deux = morceau.indexOf(':');
      if (deux < 0) continue;
      const nom = morceau.slice(0, deux).trim();
      let valeur = morceau.slice(deux + 1).trim();
      const important = /!important$/.test(valeur);
      valeur = valeur.replace(/\s*!important$/, '');
      for (const selecteur of tete.split(',')) sortie.push({ selecteur: selecteur.trim(), nom, valeur, important, ordre: ordre++ });
    }
  }
  return sortie;
}

/** Un sélecteur simple (« button.a[x="y"]:not(:disabled) »). @param {string} t */
function lireSimple(t) {
  const simple = { tag: '', classes: /** @type {string[]} */ ([]), attributs: /** @type {[string, string | null][]} */ ([]), pseudos: /** @type {string[]} */ ([]) };
  const m = t.match(/^([a-z][\w-]*|\*)?/i);
  if (m && m[1] && m[1] !== '*') simple.tag = m[1].toLowerCase();
  let reste = t.slice(m ? m[0].length : 0);
  while (reste) {
    let p;
    if ((p = reste.match(/^\.([\w-]+)/))) simple.classes.push(p[1]);
    else if ((p = reste.match(/^\[([\w-]+)(?:="([^"]*)")?\]/))) simple.attributs.push([p[1], p[2] ?? null]);
    else if ((p = reste.match(/^::?[\w-]+(\((?:[^()]|\([^()]*\))*\))?/))) simple.pseudos.push(p[0]);
    else throw new Error('sélecteur non lu : ' + t);
    reste = reste.slice(p[0].length);
  }
  return simple;
}

/** @param {string} selecteur */
function precision(selecteur) {
  let b = 0;
  let c = 0;
  for (const partie of selecteur.replace(/>/g, ' ').split(/\s+/).filter(Boolean)) {
    const s = lireSimple(partie);
    b += s.classes.length + s.attributs.length;
    for (const p of s.pseudos) {
      if (p.startsWith('::')) c++;
      else if (p.startsWith(':not(')) b += precision(p.slice(5, -1))[1];
      else b++;
    }
    if (s.tag) c++;
  }
  return [0, b, c];
}

/** @param {Element} e @param {ReturnType<typeof lireSimple>} s */
function correspond(e, s) {
  if (s.tag && s.tag !== e.tag) return false;
  if (!s.classes.every((c) => e.classes.includes(c))) return false;
  if (!s.attributs.every(([n, v]) => n in e.attributs && (v === null || e.attributs[n] === v))) return false;
  for (const p of s.pseudos) {
    if (p.startsWith('::')) return false; // un pseudo-élément n'est pas l'élément
    if (p === ':root') { if (e.tag !== 'html') return false; continue; }
    if (p === ':not(:disabled)') { if (e.desactive) return false; continue; }
    if (p === ':disabled') { if (!e.desactive) return false; continue; }
    return false; // :hover, :focus… : pas dans l'état observé
  }
  return true;
}

/** Le sélecteur désigne-t-il le dernier élément de la chaîne ? @param {string} selecteur @param {Element[]} chaine */
function designe(selecteur, chaine) {
  const parties = selecteur.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
  /** @param {number} p @param {number} k  partie p du sélecteur sur l'élément k */
  const essayer = (p, k) => {
    if (k < 0 || !correspond(chaine[k], lireSimple(parties[p]))) return false;
    if (p === 0) return true;
    if (parties[p - 1] === '>') return essayer(p - 2, k - 1);
    for (let a = k - 1; a >= 0; a--) if (essayer(p - 1, a)) return true;
    return false;
  };
  return essayer(parties.length - 1, chaine.length - 1);
}

/** @param {Declaration} a @param {Declaration} b  a l'emporte-t-il sur b ? */
function lEmporte(a, b) {
  if (a.important !== b.important) return a.important;
  const pa = precision(a.selecteur);
  const pb = precision(b.selecteur);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return a.ordre > b.ordre;
}

/**
 * Valeur calculée d'une propriété sur le dernier élément de la chaîne.
 * `noms` : les déclarations qui la fixent (une propriété et ses raccourcis).
 * @param {Declaration[]} toutes @param {Element[]} chaine @param {string[]} noms
 */
function calculer(toutes, chaine, noms) {
  // Variables, de la racine vers l'élément : héritées, puis redéfinies.
  /** @type {Map<string, string>} */
  let variables = new Map();
  for (let k = 0; k < chaine.length; k++) {
    const ici = chaine.slice(0, k + 1);
    /** @type {Map<string, Declaration>} */
    const gagnantes = new Map();
    for (const d of toutes) {
      if (!d.nom.startsWith('--') || !designe(d.selecteur, ici)) continue;
      const avant = gagnantes.get(d.nom);
      if (!avant || lEmporte(d, avant)) gagnantes.set(d.nom, d);
    }
    const heritees = variables;
    /** @type {Map<string, string>} */
    const calculees = new Map(heritees);
    /** @param {string} nom @param {number} [n] @returns {string | undefined} */
    const valeurDe = (nom, n = 0) => {
      const d = gagnantes.get(nom);
      if (!d) return heritees.get(nom);
      if (n > 20) throw new Error('variables circulaires : ' + nom);
      return substituer(d.valeur, (v) => valeurDe(v, n + 1));
    };
    for (const nom of gagnantes.keys()) {
      const v = valeurDe(nom);
      if (v !== undefined) calculees.set(nom, v);
    }
    variables = calculees;
  }
  let gagnante = null;
  for (const d of toutes) {
    if (!noms.includes(d.nom) || !designe(d.selecteur, chaine)) continue;
    if (!gagnante || lEmporte(d, gagnante)) gagnante = d;
  }
  if (!gagnante) return '(rien)';
  return gagnante.nom + ': ' + substituer(gagnante.valeur, (v) => variables.get(v)).replace(/\s+/g, ' ').trim();
}

/** Remplace les var(--x[, repli]). @param {string} valeur @param {(nom: string) => string | undefined} lire */
function substituer(valeur, lire) {
  let sortie = valeur;
  for (let n = 0; n < 20 && sortie.includes('var('); n++) {
    sortie = sortie.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, nom, repli) => {
      const v = lire(nom);
      return v !== undefined ? v : (repli !== undefined ? repli : '(indéfinie ' + nom + ')');
    });
  }
  return sortie;
}

/** @param {string} tag @param {string} [classes] @param {Record<string, string>} [attributs] @returns {Element} */
const el = (tag, classes = '', attributs = {}) => ({ tag, classes: classes.split(' ').filter(Boolean), attributs });

/** La page, jusqu'à la carte d'une question, dans un thème et un mode. @param {string} theme @param {boolean} sombre */
const carte = (theme, sombre) => [el('html', sombre ? 'dark' : ''), el('body'), el('div', '', { 'data-theme-slide': theme }), el('div', 'sl sl--q sl--fixe', { 'data-type': 'quiz' })];

/** Ce qu'on compare : élément (sous la carte) et propriétés. */
const CIBLES = [
  { nom: 'carte', sous: [], props: { 'box-shadow': ['box-shadow'], bordure: ['border', 'border-color'], fond: ['background', 'background-color'] } },
  ...['juste', 'fausse', 'choisie'].flatMap((etat) => [
    { nom: 'réponse ' + etat, sous: [el('div', 'sl__corps'), el('div', 'sl__reps'), { ...el('button', 'sl__rep sl__rep--' + etat), desactive: true }], props: { bordure: ['border', 'border-color'], fond: ['background', 'background-color'], texte: ['color'] } },
    { nom: 'marque ' + etat, sous: [el('div', 'sl__corps'), el('div', 'sl__reps'), { ...el('button', 'sl__rep sl__rep--' + etat), desactive: true }, el('span', 'sl__rep-marque')], props: { fond: ['background', 'background-color'], texte: ['color'] } },
  ]),
  ...['bon', 'rate', 'neutre'].map((sorte) => ({ nom: 'verdict ' + sorte, sous: [el('div', 'sl__corps'), el('div', 'sl__verdict sl__verdict--' + sorte), el('div', 'sl__verdict-tete'), el('div', 'sl__verdict-titre')], props: { texte: ['color'] } })),
];

test('slides.css : la cascade est lisible (contrôle du test lui-même)', () => {
  const regles = declarations(ANCIENNE);
  assert.ok(regles.length > 500);
  assert.deepEqual(precision('html.dark .sl__rep--juste'), [0, 2, 1]);
  assert.deepEqual(precision('[data-theme-slide="simpliste"] .sl__rep:hover:not(:disabled)'), [0, 4, 0]);
  const ch = [...carte('papier', true), el('div', 'sl__corps')];
  assert.ok(designe('html.dark [data-theme-slide="papier"] .sl__corps', ch));
  assert.ok(!designe('html.dark [data-theme-slide="simpliste"] .sl__corps', ch));
  assert.ok(designe('.sl--q > .sl__corps', ch));
});

test('slides.css : réponses, marques, verdicts et cadre rendent pareil dans les trois thèmes, en clair et en sombre', () => {
  const avant = declarations(ANCIENNE);
  const apres = declarations(NOUVELLE);
  let comparees = 0;
  for (const theme of ['foret', 'papier', 'simpliste']) {
    for (const sombre of [false, true]) {
      for (const cible of CIBLES) {
        const chaine = [...carte(theme, sombre), ...cible.sous];
        for (const [prop, noms] of Object.entries(cible.props)) {
          const ancien = calculer(avant, chaine, noms);
          const nouveau = calculer(apres, chaine, noms);
          assert.equal(nouveau, ancien, theme + (sombre ? ' sombre' : ' clair') + ' · ' + cible.nom + ' · ' + prop);
          assert.ok(!nouveau.includes('(indéfinie'), nouveau);
          comparees++;
        }
      }
    }
  }
  assert.equal(comparees, 6 * (3 + 6 * 3 - 3 + 3), 'toutes les combinaisons');
});
