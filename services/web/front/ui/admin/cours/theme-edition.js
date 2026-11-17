/* ============================================================================
   theme-edition.js — <cs-admin-theme-edition> : la fenêtre de création ou de
   modification d'un thème, et sa suppression.

   L'adresse (slug) d'un thème se choisit à la création, puis elle est figée :
   elle compose l'adresse des pages d'édition de ses cours. Un thème ne se
   supprime que vide ; c'est le serveur qui le vérifie et le dit.

   Après un enregistrement ou une suppression, la fenêtre se ferme et émet
   « donnees-modifiees ».

   Usage, dans <cs-admin-themes> :
     <cs-admin-theme-edition></cs-admin-theme-edition>
     this.trouver('cs-admin-theme-edition', AdminThemeEdition).ouvrir(theme);  // null : nouveau thème
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Fenetre } from '../../socle/fenetre.js';
import { html } from '../../socle/outils.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';

/**
 * Ce que la fenêtre lit d'un thème.
 * @typedef {object} ThemeFiche
 * @property {number} id
 * @property {string} slug
 * @property {string} nom
 * @property {string | null} emoji
 * @property {string | null} couleur
 * @property {string | null} description
 */

/** Dégradé proposé pour un nouveau thème. */
export const DEGRADE_PAR_DEFAUT = 'linear-gradient(135deg,#1e6e3e,#2d9959)';

/** @typedef {'nom' | 'slug' | 'emoji' | 'couleur' | 'description'} Champ */

export class AdminThemeEdition extends Fenetre {
  static balise = 'cs-admin-theme-edition';
  static styles = [...Fenetre.styles, new URL('./theme-edition.css', import.meta.url)];

  /** Le thème modifié, ou null pour une création. @type {ThemeFiche | null} */
  #theme = null;

  monter() {
    this.poserFenetre(this.gabarit());
    this.ecouter('input', '[data-champ="couleur"]', () => this.#apercu());
    this.ecouter('click', '[data-action="enregistrer"]', (bouton) => this.#enregistrer(bouton));
    this.ecouter('click', '[data-action="supprimer"]', (bouton) => this.#supprimer(bouton));
  }

  /** @param {ThemeFiche | null} theme  null : nouveau thème */
  ouvrir(theme) {
    this.apresMontage(() => {
      this.#theme = theme;
      this.trouver('.fenetre__titre').textContent = theme ? 'Modifier « ' + theme.nom + ' »' : 'Nouveau thème';
      this.#champ('nom').value = theme ? theme.nom : '';
      this.#champ('slug').value = theme ? theme.slug : '';
      this.#champ('emoji').value = theme ? theme.emoji || '' : '📂';
      this.#champ('couleur').value = theme ? theme.couleur || '' : DEGRADE_PAR_DEFAUT;
      this.#champ('description').value = theme ? theme.description || '' : '';
      // Figée après la création : elle compose l'adresse des pages d'édition.
      this.#champ('slug').disabled = theme !== null;
      this.trouver('.theme-suppression').hidden = theme === null;
      this.#apercu();
      this.#erreur('');
      this.montrer();
      this.#champ('nom').focus();
    });
  }

  aLaFermeture() {
    this.#theme = null;
  }

  /**
   * @param {Champ} nom
   * @returns {HTMLInputElement | HTMLTextAreaElement}
   */
  #champ(nom) {
    const champ = this.trouver('[data-champ="' + nom + '"]');
    if (!(champ instanceof HTMLInputElement || champ instanceof HTMLTextAreaElement)) {
      throw new Error('<cs-admin-theme-edition> : « ' + nom + ' » n\'est pas un champ');
    }
    return champ;
  }

  #apercu() {
    this.trouver('.apercu-couleur').style.background = this.#champ('couleur').value || '#1e6e3e';
  }

  /** @param {string} message  vide : aucune erreur à montrer */
  #erreur(message) {
    const zone = this.trouver('.fenetre__erreur');
    zone.textContent = message;
    zone.hidden = message === '';
  }

  /** @param {HTMLElement} bouton */
  async #enregistrer(bouton) {
    if (!(bouton instanceof HTMLButtonElement)) return;
    const corps = {
      action: 'save',
      id: this.#theme ? this.#theme.id : 0,
      nom: this.#champ('nom').value,
      slug: this.#champ('slug').value,
      emoji: this.#champ('emoji').value,
      couleur: this.#champ('couleur').value,
      description: this.#champ('description').value,
    };
    bouton.disabled = true;
    try {
      await api.admin.postJson('themes_manage.php', corps);
      this.fermer();
      this.emettre('donnees-modifiees');
    } catch (erreur) {
      console.error('<cs-admin-theme-edition>', erreur);
      this.#erreur(texteErreur(erreur, 'Enregistrement impossible.'));
    } finally {
      bouton.disabled = false;
    }
  }

  /** @param {HTMLElement} bouton */
  async #supprimer(bouton) {
    const theme = this.#theme;
    if (!theme || !(bouton instanceof HTMLButtonElement)) return;
    if (!await confirmer({ titre: 'Supprimer le thème « ' + theme.nom + ' » ?', valider: 'Supprimer', danger: true })) return;
    bouton.disabled = true;
    try {
      await api.admin.postJson('themes_manage.php', { action: 'delete', id: theme.id });
      this.fermer();
      this.emettre('donnees-modifiees');
    } catch (erreur) {
      console.error('<cs-admin-theme-edition>', erreur);
      this.#erreur(texteErreur(erreur, 'Suppression impossible.'));
    } finally {
      bouton.disabled = false;
    }
  }

  // ── Gabarit ───────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="fenetre__titre">Nouveau thème</div>

      <div class="fenetre__label">Nom</div>
      <input class="fenetre__champ" data-champ="nom" type="text" maxlength="120" placeholder="ex : Pratique" aria-label="Nom">

      <div class="fenetre__label">Adresse</div>
      <input class="fenetre__champ" data-champ="slug" type="text" maxlength="80" placeholder="déduite du nom" aria-label="Adresse">
      <div class="fenetre__aide">Définitive : elle sert d'adresse aux pages d'édition des cours du thème.</div>

      <div class="fenetre__label">Emoji</div>
      <input class="fenetre__champ" data-champ="emoji" type="text" maxlength="8" placeholder="🌱" aria-label="Emoji">

      <div class="fenetre__label">Dégradé CSS</div>
      <input class="fenetre__champ" data-champ="couleur" type="text" maxlength="80" placeholder="${DEGRADE_PAR_DEFAUT}" aria-label="Dégradé CSS">
      <div class="apercu-couleur"></div>

      <div class="fenetre__label">Description</div>
      <textarea class="fenetre__champ" data-champ="description" rows="2" maxlength="200" placeholder="Une phrase affichée sous le nom du thème." aria-label="Description"></textarea>

      <div class="fenetre__erreur" role="alert" hidden></div>
      <div class="fenetre__actions">
        <button type="button" class="fenetre__annuler" data-action="fermer">Annuler</button>
        <button type="button" class="fenetre__valider" data-action="enregistrer">Enregistrer</button>
      </div>
      <div class="fenetre__actions theme-suppression" hidden>
        <button type="button" class="theme-supprimer" data-action="supprimer">Supprimer ce thème</button>
      </div>`;
  }
}

AdminThemeEdition.definir();
