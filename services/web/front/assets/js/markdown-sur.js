/* ============================================================================
   markdown-sur.js — rendu du markdown des cours, assaini.

   Partagé par la page de lecture (cours-detail.html) et par l'aperçu de
   l'éditeur d'admin : c'est ce qui garantit qu'un administrateur voit
   exactement ce que verront les lecteurs. Deux moteurs différents mentiraient
   sur le résultat, en particulier pour le LaTeX et les schémas.

   POURQUOI ASSAINIR
   Le markdown des cours contient volontairement du HTML : les schémas dessinés
   à la main (cf. les-solutions-de-compostage) sont des <div>/<figure> avec
   classes et styles. Interdire le HTML les casserait. Mais depuis que les cours
   s'écrivent depuis le site et non plus par commit relu, un compte admin
   compromis pourrait y glisser un <script> exécuté chez tous les lecteurs.
   DOMPurify tranche : la mise en forme passe, le code non.

   Dépendances à charger avant : marked, DOMPurify, et (optionnel) KaTeX
   auto-render pour les formules.
   ============================================================================ */
(function () {
  'use strict';

  /* Balises ajoutées à la liste par défaut de DOMPurify. Les schémas sont
     essentiellement des div/figure/span, déjà autorisés ; on complète avec les
     éléments de tableau et de figure utilisés dans les cours existants. */
  var CONFIG = {
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

  /** Markdown → HTML assaini, prêt à être injecté. */
  function rendre(markdown) {
    var brut = (typeof marked !== 'undefined' && marked.parse)
      ? marked.parse(markdown || '')
      : String(markdown || '');
    if (typeof DOMPurify === 'undefined') {
      // Sans DOMPurify (CDN indisponible), on refuse de rendre du HTML plutôt
      // que de l'injecter tel quel : dégradé mais jamais dangereux.
      var d = document.createElement('div');
      d.textContent = markdown || '';
      return d.innerHTML;
    }
    return DOMPurify.sanitize(brut, CONFIG);
  }

  /**
   * Rend les formules d'un fragment DÉJÀ inséré dans le DOM.
   *
   * auto-render de KaTeX plutôt qu'une extension de marked : marked est chargé
   * sans version épinglée, et une extension figée finit par ne plus s'accrocher
   * à son API interne — elle s'enregistre alors sans erreur mais ne convertit
   * plus rien, ce qui laissait « $O_2$ » en clair. Ici le traitement porte sur
   * le HTML produit, donc indépendamment de marked.
   *
   * Les délimiteurs sont explicites : auto-render ne reconnaît PAS « $…$ » par
   * défaut, pour éviter de confondre avec des montants en dollars.
   */
  function rendreMaths(el) {
    if (!el || typeof renderMathInElement !== 'function') return;
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$',  right: '$',  display: false },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
  }

  /** Raccourci : rend le markdown dans un élément, formules comprises. */
  function rendreDans(el, markdown) {
    if (!el) return;
    el.innerHTML = rendre(markdown);
    rendreMaths(el);
  }

  window.MarkdownSur = { rendre: rendre, rendreMaths: rendreMaths, rendreDans: rendreDans };
})();
