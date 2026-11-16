/* ============================================================================
   communs.js — ce que plusieurs onglets du panneau affichent de la même façon.

   Des gabarits, sans état : l'onglet garde son numéro de page et réagit au
   clic. Leur habillage est dans panel.css, sous « Communs à tous les onglets ».
   ============================================================================ */
import { html, pluriel } from '../../socle/outils.js';

/**
 * La pagination d'une liste : « ← Précédent · Page 2 / 3 · 61 actions · Suivant → ».
 * Rien s'il n'y a qu'une page. Les boutons portent `data-page` :
 *
 *   this.ecouter('click', '[data-page]', (bouton) => { this.#page = Number(bouton.dataset.page); … });
 *
 * @param {{ page: number, pages: number, total: number }} liste
 * @param {string} un         « action »
 * @param {string} plusieurs  « actions »
 */
export function gabaritPages(liste, un, plusieurs) {
  if (liste.pages <= 1) return null;
  return html`
    <div class="pages">
      <button type="button" data-page="${liste.page - 1}"${liste.page <= 1 && html` disabled`}>← Précédent</button>
      <span class="pages-info">Page ${liste.page} / ${liste.pages} · ${pluriel(liste.total, un, plusieurs)}</span>
      <button type="button" data-page="${liste.page + 1}"${liste.page >= liste.pages && html` disabled`}>Suivant →</button>
    </div>`;
}
