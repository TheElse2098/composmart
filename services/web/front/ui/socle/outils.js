/* ============================================================================
   outils.js — fonctions pures partagées par tous les composants.

   Rien ici ne touche au DOM ni au réseau : tout se teste sous Node
   (tests/front/outils.test.mjs). Une fonction n'entre dans ce fichier que si
   au moins deux composants s'en servent.
   ============================================================================ */

/** @type {Record<string, string>} */
const ENTITES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Échappe un texte pour l'insérer dans du HTML, y compris dans un attribut.
 * `null` et `undefined` donnent une chaîne vide.
 * @param {unknown} texte
 * @returns {string}
 */
export function echapper(texte) {
  return (texte == null ? '' : String(texte)).replace(/[&<>"']/g, (c) => ENTITES[c]);
}

/**
 * Fragment de HTML déjà sûr. On n'en fabrique pas à la main : il sort de
 * `html` ou de `brut()`. C'est le seul type que Composant.rendre() accepte,
 * ce qui rend impossible d'afficher par mégarde une chaîne non échappée.
 */
export class Html {
  #texte;

  /** @param {string} texte */
  constructor(texte) {
    this.#texte = texte;
  }

  toString() {
    return this.#texte;
  }
}

/**
 * Gabarit HTML. Tout ce qui est interpolé est échappé, sauf un autre gabarit
 * (ou une liste de gabarits), inséré tel quel :
 *
 *   html`<b>${nom}</b>`                                   nom est échappé
 *   html`<ul>${noms.map((n) => html`<li>${n}</li>`)}</ul>`
 *   html`${connecte && html`<a href="/compte">…</a>`}`     false n'affiche rien
 *
 * `null`, `undefined` et `false` n'affichent rien ; `0` s'affiche.
 * L'échappement protège le texte et les attributs entre guillemets. Il ne
 * valide pas une adresse : un `href` construit depuis une donnée doit partir
 * d'un préfixe fixe (`/cours/${slug}`).
 *
 * @param {TemplateStringsArray} morceaux
 * @param {...unknown} valeurs
 * @returns {Html}
 */
export function html(morceaux, ...valeurs) {
  let sortie = morceaux[0];
  for (let i = 0; i < valeurs.length; i++) {
    sortie += inserer(valeurs[i]) + morceaux[i + 1];
  }
  return new Html(sortie);
}

/**
 * @param {unknown} valeur
 * @returns {string}
 */
function inserer(valeur) {
  if (valeur == null || valeur === false) return '';
  if (valeur instanceof Html) return valeur.toString();
  if (Array.isArray(valeur)) return valeur.map(inserer).join('');
  return echapper(valeur);
}

/**
 * Déclare sûr un HTML produit ailleurs (bibliothèque de rendu, SVG construit
 * par le code). Jamais sur un texte saisi par quelqu'un : c'est la seule
 * porte de sortie de l'échappement, chaque appel doit pouvoir se justifier.
 * @param {string} texte
 * @returns {Html}
 */
export function brut(texte) {
  return new Html(String(texte));
}

/**
 * Une date du serveur (« 2026-11-14 09:15:00 », datetime MySQL sans fuseau),
 * lue à l'heure locale. Le « T » rend la lecture fiable d'un navigateur à
 * l'autre.
 * @param {string} texte
 * @returns {Date}
 */
export function dateSql(texte) {
  return new Date(String(texte).replace(' ', 'T'));
}

/**
 * « 14 nov. »
 * @param {Date | string} date  une date, ou une date du serveur
 * @returns {string}
 */
export function jourCourt(date) {
  return (date instanceof Date ? date : dateSql(date)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * « novembre 2026 »
 * @param {Date | string} date  une date, ou une date du serveur
 * @returns {string}
 */
export function moisAnnee(date) {
  return (date instanceof Date ? date : dateSql(date)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/**
 * « 1 message », « 3 messages » : le nombre suivi du mot accordé.
 * @param {number} n
 * @param {string} un
 * @param {string} plusieurs
 * @returns {string}
 */
export function pluriel(n, un, plusieurs) {
  return n + ' ' + (n > 1 ? plusieurs : un);
}

/**
 * Échange l'élément `i` avec son voisin (`sens` −1 : celui d'avant, +1 : celui
 * d'après). Sans effet au bord de la liste.
 * @template T
 * @param {T[]} liste
 * @param {number} i
 * @param {-1 | 1} sens
 * @returns {T[]}
 */
export function echanger(liste, i, sens) {
  const j = i + sens;
  if (j < 0 || j >= liste.length || i < 0 || i >= liste.length) return liste.slice();
  const copie = liste.slice();
  [copie[i], copie[j]] = [copie[j], copie[i]];
  return copie;
}
