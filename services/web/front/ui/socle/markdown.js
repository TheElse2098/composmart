/* ============================================================================
   markdown.js — rendu du markdown des cours, assaini.

   Reprend assets/js/markdown-sur.js pour les pages migrées. Les deux doivent
   produire exactement le même HTML : l'aperçu de l'éditeur d'admin (pas
   encore migré, il utilise l'ancien fichier) montre ce que verront les
   lecteurs, et deux moteurs différents mentiraient sur le résultat, en
   particulier pour le LaTeX et les schémas. Un test compare les deux
   configurations tant qu'elles coexistent (tests/front/lecteur-cours.test.mjs).

   POURQUOI ASSAINIR
   Le markdown des cours contient volontairement du HTML : les schémas dessinés
   à la main (cf. les-solutions-de-compostage) sont des <div>/<figure> avec
   classes et styles. Interdire le HTML les casserait. Mais depuis que les cours
   s'écrivent depuis le site et non plus par commit relu, un compte admin
   compromis pourrait y glisser un <script> exécuté chez tous les lecteurs.
   DOMPurify tranche : la mise en forme passe, le code non.

   Usage, dans un composant :
     await chargerMoteur();
     this.rendre(html`<div class="corps">${markdownEnHtml(texte)}</div>`);
     finaliser(this.trouver('.corps'));   // formules et tableaux, une fois dans la page
   ============================================================================ */
import { chargerScript, chargerStyle } from './composant.js';
import { Html, brut, echapper } from './outils.js';

const MARKED = new URL('../../assets/vendor/marked-15.0.12/marked.min.js', import.meta.url);
const DOMPURIFY = new URL('../../assets/vendor/dompurify-3.1.6/purify.min.js', import.meta.url);
const KATEX = new URL('../../assets/vendor/katex-0.18.1/katex.min.js', import.meta.url);
const KATEX_STYLE = new URL('../../assets/vendor/katex-0.18.1/katex.min.css', import.meta.url);
const KATEX_AUTO = new URL('../../assets/vendor/katex-0.18.1/contrib/auto-render.min.js', import.meta.url);

/**
 * Ce que DOMPurify laisse passer, en plus de sa liste par défaut. Les schémas
 * sont essentiellement des div/figure/span, déjà autorisés ; on complète avec
 * les éléments de tableau et de figure utilisés dans les cours existants.
 */
export const NETTOYAGE = {
  ADD_TAGS: ['figure', 'figcaption'],
  // `style` et `class` portent toute la mise en forme des schémas. Les
  // gestionnaires « on… » et les URL « javascript: » sont refusés d'office
  // par DOMPurify, c'est précisément ce qu'on veut garder.
  ADD_ATTR: ['class', 'style', 'colspan', 'rowspan', 'target', 'rel'],
  // Les objets embarqués n'ont rien à faire dans un cours : ils ouvriraient
  // une fenêtre vers un contenu tiers non contrôlé.
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
  FORBID_ATTR: ['srcdoc', 'formaction', 'ping'],
};

/** Les délimiteurs des formules. auto-render ne reconnaît PAS « $…$ » par
 *  défaut, pour éviter de confondre avec des montants en dollars : on le dit. */
const DELIMITEURS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
];

/** @type {Promise<void> | null} */
let moteur = null;

/**
 * Charge les bibliothèques du rendu, une seule fois par page.
 *
 * L'ordre compte pour KaTeX : auto-render se branche sur KaTeX au moment où
 * il s'exécute. Chargés en parallèle, rien ne garantit lequel s'exécute en
 * premier, et les formules resteraient en clair sans la moindre erreur.
 *
 * Ne lève jamais : une bibliothèque absente est signalée dans la console, et
 * le rendu se dégrade sans danger (texte brut sans DOMPurify, formules en
 * clair sans KaTeX) — c'était déjà le comportement de markdown-sur.js.
 * @returns {Promise<void>}
 */
export function chargerMoteur() {
  if (!moteur) {
    /** @param {unknown} erreur */
    const signaler = (erreur) => console.error('[markdown]', erreur);
    moteur = Promise.all([
      chargerScript(MARKED).catch(signaler),
      chargerScript(DOMPURIFY).catch(signaler),
      chargerStyle(KATEX_STYLE),
      chargerScript(KATEX).then(() => chargerScript(KATEX_AUTO)).catch(signaler),
    ]).then(() => {});
  }
  return moteur;
}

/**
 * Markdown → HTML assaini, prêt à être inséré dans un gabarit.
 * @param {string | null | undefined} markdown
 * @returns {Html}
 */
export function markdownEnHtml(markdown) {
  const g = /** @type {any} */ (globalThis);
  const texte = markdown || '';
  // Sans DOMPurify, on refuse de rendre du HTML plutôt que de l'insérer tel
  // quel : dégradé mais jamais dangereux.
  if (!g.DOMPurify) return brut(echapper(texte));
  const source = g.marked && typeof g.marked.parse === 'function' ? g.marked.parse(texte) : texte;
  // brut() : c'est la sortie de DOMPurify, pas le texte saisi.
  return brut(String(g.DOMPurify.sanitize(source, NETTOYAGE)));
}

/**
 * Termine un fragment DÉJÀ inséré dans la page : formules, puis tableaux.
 * @param {Element} zone
 */
export function finaliser(zone) {
  rendreMaths(zone);
  envelopperTableaux(zone);
}

/**
 * Rend les formules d'un fragment inséré dans la page.
 *
 * auto-render de KaTeX plutôt qu'une extension de marked : une extension finit
 * par ne plus s'accrocher à l'API interne de marked — elle s'enregistre alors
 * sans erreur mais ne convertit plus rien, ce qui laissait « $O_2$ » en clair.
 * Ici le traitement porte sur le HTML produit, donc indépendamment de marked.
 * @param {Element} zone
 */
export function rendreMaths(zone) {
  const rendu = /** @type {any} */ (globalThis).renderMathInElement;
  if (typeof rendu !== 'function') return;
  rendu(zone, { delimiters: DELIMITEURS, throwOnError: false });
}

/**
 * Place chaque tableau dans une boîte qui défile horizontalement. Un tableau
 * à 4-5 colonnes tient sur un écran d'ordinateur, mais sur un mobile de 360 px
 * il pousse la carte, et donc toute la page, au-delà de l'écran. La boîte
 * dédiée règle le problème sans compresser les colonnes ; `display: block` sur
 * le tableau lui-même casse `width: 100%` et les bordures sur certains
 * navigateurs mobiles.
 * @param {Element} zone
 */
export function envelopperTableaux(zone) {
  for (const tableau of zone.querySelectorAll('table')) {
    const parent = tableau.parentElement;
    if (!parent || parent.classList.contains('table-scroll')) continue;
    const boite = document.createElement('div');
    boite.className = 'table-scroll';
    parent.insertBefore(boite, tableau);
    boite.appendChild(tableau);
  }
}
