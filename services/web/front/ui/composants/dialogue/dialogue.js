/* ============================================================================
   dialogue.js — <cs-dialogue> : confirmation et message, intégrés à la page.

   Remplace confirm() et alert() du navigateur, qui sont dépareillés, figent la
   page derrière eux, et que certains navigateurs mobiles suppriment purement
   et simplement — l'action passait alors sans confirmation.

   On ne pose pas la balise soi-même, on appelle :

     const ok = await confirmer({
       titre: 'Annuler cet événement ?',
       texte: 'Les participants seront déconnectés.',
       valider: 'Annuler l’événement',   // libellé du bouton qui confirme
       annuler: 'Garder',                // libellé de l'autre bouton
       danger: true,                     // bouton rouge
     });
     if (!ok) return;

     await informer({ titre: 'Action impossible', texte: erreur.message });

   La promesse se résout à true ou false. Échap et un clic hors de la boîte
   valent « non » ; Entrée vaut « oui », sauf si le focus a été porté sur le
   bouton qui renonce. Mêmes options que l'ancien assets/js/confirmer.js, qu'il
   remplace dans les pages migrées.
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

/**
 * @typedef {object} Options
 * @property {string} [titre]
 * @property {string} [texte]
 * @property {string} [valider]  libellé du bouton qui confirme
 * @property {string} [annuler]  libellé du bouton qui renonce
 * @property {boolean} [danger]  l'action est destructrice : bouton rouge
 * @property {boolean} [seul]    un seul bouton (message d'information)
 */

export class Dialogue extends Composant {
  static balise = 'cs-dialogue';
  static styles = [new URL('./dialogue.css', import.meta.url)];

  /** @type {Options} */
  #options = {};
  /** @type {((reponse: boolean) => void) | null} */
  #repondre = null;

  /**
   * Ouvre une boîte et attend la réponse.
   * @param {Options} options
   * @returns {Promise<boolean>}
   */
  static demander(options) {
    const boite = document.createElement(Dialogue.balise);
    if (!(boite instanceof Dialogue)) throw new Error('<cs-dialogue> non enregistré');
    boite.#options = options || {};
    const reponse = new Promise((resoudre) => { boite.#repondre = resoudre; });
    document.body.append(boite);
    return reponse;
  }

  monter() {
    this.rendre(this.gabarit(this.#options));
    this.ecouter('click', '[data-reponse]', (bouton) => this.#fermer(bouton.dataset.reponse === 'oui'));
    this.ecouter('click', '.dialogue__fond', (fond, evenement) => {
      if (evenement.target === fond) this.#fermer(false); // clic hors de la boîte
    });
    this.ecouterSur(document, 'keydown', (evenement) => {
      if (!(evenement instanceof KeyboardEvent)) return;
      if (evenement.key === 'Escape') this.#fermer(false);
      // Entrée sur un bouton de la boîte l'actionne déjà : on laisse son clic
      // répondre, sinon Entrée sur « Annuler » vaudrait « oui ».
      const surBouton = document.activeElement instanceof HTMLButtonElement && this.contains(document.activeElement);
      if (evenement.key === 'Enter' && !surBouton) this.#fermer(true);
    });
    // Le focus part sur le bouton qui confirme.
    this.trouver('[data-reponse="oui"]').focus();
  }

  /** @param {boolean} reponse */
  #fermer(reponse) {
    const repondre = this.#repondre;
    if (!repondre) return; // déjà fermé
    this.#repondre = null;
    repondre(reponse);
    // Le temps du fondu, puis la boîte quitte la page.
    this.classList.add('ferme');
    setTimeout(() => this.remove(), 180);
  }

  /** @param {Options} o */
  gabarit(o) {
    return html`
      <div class="dialogue__fond">
        <div class="dialogue__boite" role="dialog" aria-modal="true">
          <div class="dialogue__titre">${o.titre || 'Confirmer ?'}</div>
          ${o.texte && html`<div class="dialogue__texte">${o.texte}</div>`}
          <div class="dialogue__actions">
            ${!o.seul && html`<button type="button" class="dialogue__non" data-reponse="non">${o.annuler || 'Annuler'}</button>`}
            <button type="button" class="dialogue__oui${o.danger ? ' danger' : ''}" data-reponse="oui">${o.valider || 'Confirmer'}</button>
          </div>
        </div>
      </div>`;
  }
}

Dialogue.definir();

/**
 * Demande une confirmation.
 * @param {Options} options
 * @returns {Promise<boolean>} vrai si la personne a confirmé
 */
export function confirmer(options) {
  return Dialogue.demander(options);
}

/**
 * Affiche un message, avec un seul bouton. La promesse se résout à la fermeture.
 * @param {Options} options
 * @returns {Promise<boolean>}
 */
export function informer(options) {
  return Dialogue.demander({ titre: options.titre || 'Information', texte: options.texte, valider: options.valider || 'OK', seul: true });
}
