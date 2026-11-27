/* ============================================================================
   image-edition.js — <cs-admin-image-edition> : la fenêtre qui renomme une
   image de la banque et change ses tags.

   Le fichier, lui, ne se remplace pas : son identifiant sert de clé de cache
   « immutable » pendant un an. Pour changer d'image, on en téléverse une autre.

   Usage, dans le gabarit du parent :
     <cs-admin-image-edition></cs-admin-image-edition>
     this.trouver('cs-admin-image-edition', AdminImageEdition).ouvrir(image);
     this.ecouter('image-modifiee', 'cs-admin-image-edition', …);
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Fenetre } from '../../socle/fenetre.js';
import { html } from '../../socle/outils.js';
import { ChoixTags } from '../../composants/choix-tags/choix-tags.js';

/**
 * Une image de la banque (/api/evenements/images.php?action=liste).
 * @typedef {object} ImageBanque
 * @property {number} id
 * @property {string} url
 * @property {string} nom
 * @property {number} taille
 * @property {number | null} [largeur]
 * @property {number | null} [hauteur]
 * @property {string[]} [tags]
 */

/** Ce que montre un sélecteur de tags quand la banque n'en a aucun. */
export const AUCUN_TAG = 'Aucun tag encore. Crée le premier avec le +.';

export class AdminImageEdition extends Fenetre {
  static balise = 'cs-admin-image-edition';
  static styles = [...Fenetre.styles, new URL('./image-edition.css', import.meta.url)];

  /** @type {ImageBanque | null} */
  #image = null;

  monter() {
    this.poserFenetre(html`
      <div class="fenetre__titre">Modifier l’image</div>
      <img class="image-edition__vue" src="" alt="">
      <label class="fenetre__label" for="image-edition-nom">Nom</label>
      <input type="text" class="fenetre__champ" id="image-edition-nom" maxlength="200" placeholder="Un nom lisible">
      <div class="fenetre__label">Tags</div>
      <cs-choix-tags></cs-choix-tags>
      <div class="fenetre__erreur" role="alert" hidden></div>
      <div class="fenetre__actions">
        <button type="button" class="fenetre__annuler" data-action="fermer">Annuler</button>
        <button type="button" class="fenetre__valider" data-action="enregistrer">Enregistrer</button>
      </div>`);
    this.#tags().configurer({ tout: true, messageVide: AUCUN_TAG });
    this.ecouter('click', '[data-action="enregistrer"]', (bouton) => this.#enregistrer(bouton));
    this.ecouter('keydown', '.fenetre__champ', (_champ, evenement) => {
      if (evenement instanceof KeyboardEvent && evenement.key === 'Enter') {
        evenement.preventDefault();
        this.#enregistrer(this.trouver('[data-action="enregistrer"]'));
      }
    });
  }

  /** Le vocabulaire de la banque. @param {{ tag: string, n: number }[]} tags */
  vocabulaire(tags) {
    this.apresMontage(() => {
      // Redonner la sélection après le vocabulaire : ce qui était coché ne
      // doit pas se perdre parce que la liste vient d'être rechargée.
      const choisis = this.#tags().valeur();
      this.#tags().disponibles(tags);
      this.#tags().definir(choisis);
    });
  }

  /** @param {ImageBanque} image */
  ouvrir(image) {
    this.apresMontage(() => {
      this.#image = image;
      this.trouver('.image-edition__vue').setAttribute('src', image.url);
      this.#nom().value = image.nom || '';
      this.#tags().definir(image.tags || []);
      this.#erreur('');
      this.montrer();
      this.#nom().focus();
    });
  }

  aLaFermeture() {
    this.#image = null;
  }

  #tags() {
    return this.trouver('cs-choix-tags', ChoixTags);
  }

  #nom() {
    return this.trouver('.fenetre__champ', HTMLInputElement);
  }

  /** @param {string} message  vide : aucune erreur à montrer */
  #erreur(message) {
    const zone = this.trouver('.fenetre__erreur');
    zone.textContent = message;
    zone.hidden = message === '';
  }

  /** @param {HTMLElement} bouton */
  async #enregistrer(bouton) {
    const image = this.#image;
    if (!image || !(bouton instanceof HTMLButtonElement) || bouton.disabled) return;
    const nom = this.#nom().value.trim();
    // Le serveur traite un nom vide comme « inchangé » : le dire ici évite de
    // laisser croire à un effacement qui n'aura pas lieu.
    if (!nom) {
      this.#erreur('Donne un nom à l’image.');
      return;
    }
    bouton.disabled = true;
    try {
      await api.evenements.post('images.php', { id: image.id, nom, tags: this.#tags().valeur().join(',') }, { action: 'modifier' });
      this.fermer();
      this.emettre('image-modifiee');
    } catch (erreur) {
      console.error('<cs-admin-image-edition>', erreur);
      this.#erreur(texteErreur(erreur, 'Enregistrement impossible.'));
    } finally {
      bouton.disabled = false;
    }
  }
}

AdminImageEdition.definir();
