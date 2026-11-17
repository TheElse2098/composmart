/* ============================================================================
   editeur-fiche.js — <cs-admin-editeur-fiche> : l'onglet « Fiche » de
   l'éditeur de cours.

   Identité du cours (titre, adresse, description, emoji, niveau, XP, thème,
   statut), images à insérer dans le texte, date de dernière modification, et
   suppression du cours (en saisissant son adresse pour confirmer).

   L'adresse (slug) se choisit à la création, puis elle est figée : la
   progression des lecteurs y est rattachée.

   Prévient son parent par :
     « modifie »                        un champ a changé
     « statut »   (le nouveau statut)   pour le badge de la barre du bas
     « inserer »  (le markdown)         « Insérer » une image dans le texte
     « etat » ({ texte, sorte }), « erreur » (le texte)   téléversement, suppression
     « supprime »                       le cours n'existe plus

   Usage, dans <cs-admin-editeur> :
     this.trouver('cs-admin-editeur-fiche', AdminEditeurFiche).configurer({ cours, themes, themeId, contexte });
     … .valeurs()   l'identité du cours, à enregistrer
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { televerser } from './televersement.js';

/**
 * Réponse de /api/admin/cours_get.php (la partie que lit la fiche).
 * @typedef {object} CoursEdite
 * @property {number} id
 * @property {string} slug
 * @property {number} theme_id
 * @property {string} titre
 * @property {string | null} description
 * @property {string | null} emoji
 * @property {string} niveau
 * @property {number} xp
 * @property {string} statut
 * @property {string | null} maj_at
 * @property {string | null} maj_par
 * @property {number} termine_par
 *
 * @typedef {{ id: number, slug: string, nom: string, emoji: string | null }} ThemeChoix
 *
 * @typedef {object} Identite
 * @property {string} titre
 * @property {string} slug
 * @property {string} description
 * @property {string} emoji
 * @property {string} niveau
 * @property {number} xp
 * @property {number} theme_id
 * @property {string} theme_slug
 * @property {string} statut
 *
 * @typedef {'titre' | 'slug' | 'description' | 'emoji' | 'niveau' | 'xp' | 'theme' | 'statut' | 'confirmation'} ChampFiche
 */

/** Phrase sous l'adresse, avant et après la création. */
const AIDE_SLUG_NOUVEAU = 'Déduite du titre. Définitive une fois le cours créé.';
const AIDE_SLUG_FIGE = 'Définitive : la progression des lecteurs y est rattachée.';

/**
 * Les phrases qui dépendent du nombre de personnes ayant terminé le cours.
 * @param {number} n
 */
export function avertissements(n) {
  return {
    xp: n > 0 ? "Modifier l'XP ne change rien pour les " + n + ' personnes qui ont déjà terminé le cours.' : '',
    suppression: n > 0
      ? n + " personne(s) ont terminé ce cours : leur progression sera effacée, mais l'XP déjà gagnée leur reste acquise."
      : "Personne n'a encore terminé ce cours.",
  };
}

/** @param {string | null} majAt @param {string | null} majPar */
export function historique(majAt, majPar) {
  return majAt ? 'Dernière modification le ' + majAt + (majPar ? ' par ' + majPar : '') : "Jamais modifié depuis l'éditeur.";
}

export class AdminEditeurFiche extends Composant {
  static balise = 'cs-admin-editeur-fiche';
  static styles = [new URL('./editeur-fiche.css', import.meta.url)];

  /** @type {import('./editeur.js').ContexteEditeur | null} */
  #contexte = null;
  /** Images téléversées pendant cette visite. @type {{ url: string, nom: string }[]} */
  #images = [];

  monter() {
    this.rendre(this.gabarit());
    this.#dessinerImages();

    this.ecouter('input', '[data-champ]', (champ) => { if (champ.dataset.champ !== 'confirmation') this.emettre('modifie'); });
    this.ecouter('change', '[data-champ]', (champ) => {
      if (champ.dataset.champ === 'confirmation') return;
      this.emettre('modifie');
      if (champ.dataset.champ === 'statut') this.emettre('statut', this.#champ('statut').value);
    });
    this.ecouter('change', 'input[type="file"]', (champ) => this.#televerser(champ));
    this.ecouter('click', '[data-image]', (b) => {
      const image = this.#images[Number(b.dataset.image)];
      if (image) this.emettre('inserer', '\n![' + image.nom + '](' + image.url + ')\n');
    });
    this.ecouter('click', '[data-action="supprimer"]', (b) => this.#supprimer(b));
  }

  /**
   * @param {{ cours: CoursEdite | null, themes: ThemeChoix[], themeId: number, contexte: import('./editeur.js').ContexteEditeur }} reglage
   */
  configurer({ cours, themes, themeId, contexte }) {
    this.apresMontage(() => {
      this.#contexte = contexte;
      this.rendre(html`${themes.map((t) => html`<option value="${t.id}" data-slug="${t.slug}">${(t.emoji || '') + ' ' + t.nom}</option>`)}`, this.#champ('theme'));
      this.#champ('theme').value = String(cours ? cours.theme_id : themeId);
      if (!cours) {
        this.fixerStatut('brouillon');
        return;
      }
      this.#champ('titre').value = cours.titre;
      this.#champ('slug').value = cours.slug;
      this.#champ('description').value = cours.description || '';
      this.#champ('emoji').value = cours.emoji || '';
      this.#champ('niveau').value = cours.niveau;
      this.#champ('xp').value = String(cours.xp);
      this.fixerStatut(cours.statut);
      this.trouver('.historique').textContent = historique(cours.maj_at, cours.maj_par);
      const textes = avertissements(cours.termine_par);
      this.trouver('.aide-xp').textContent = textes.xp;
      this.trouver('.aide-suppression').textContent = textes.suppression;
      this.#figer(cours.slug);
    });
  }

  /** Le cours vient d'être créé : son adresse est figée, il peut être supprimé. @param {string} slug */
  apresCreation(slug) {
    this.apresMontage(() => {
      this.#champ('slug').value = slug;
      this.#figer(slug);
    });
  }

  /** @param {string} statut */
  fixerStatut(statut) {
    this.apresMontage(() => { this.#champ('statut').value = statut; });
  }

  /** @returns {Identite} */
  valeurs() {
    const theme = this.#champ('theme');
    const choisi = theme instanceof HTMLSelectElement ? theme.querySelector('option[value="' + theme.value + '"]') : null;
    return {
      titre: this.#champ('titre').value,
      slug: this.#champ('slug').value,
      description: this.#champ('description').value,
      emoji: this.#champ('emoji').value,
      niveau: this.#champ('niveau').value,
      xp: parseInt(this.#champ('xp').value, 10) || 0,
      theme_id: parseInt(theme.value, 10) || 0,
      theme_slug: choisi instanceof HTMLElement ? choisi.dataset.slug || '' : '',
      statut: this.#champ('statut').value,
    };
  }

  /** @param {ChampFiche} nom @returns {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */
  #champ(nom) {
    const champ = this.trouver('[data-champ="' + nom + '"]');
    if (!(champ instanceof HTMLInputElement || champ instanceof HTMLTextAreaElement || champ instanceof HTMLSelectElement)) {
      throw new Error('<cs-admin-editeur-fiche> : « ' + nom + ' » n\'est pas un champ');
    }
    return champ;
  }

  /** @param {string} slug */
  #figer(slug) {
    const champ = this.#champ('slug');
    if (champ instanceof HTMLInputElement) champ.disabled = true;
    this.trouver('.aide-slug').textContent = AIDE_SLUG_FIGE;
    this.trouver('.carte-suppression').hidden = false;
    const confirmation = this.#champ('confirmation');
    if (confirmation instanceof HTMLInputElement) confirmation.placeholder = slug;
  }

  #dessinerImages() {
    this.rendre(this.gabaritImages(this.#images), this.trouver('.images'));
  }

  /** @param {HTMLElement} champ */
  async #televerser(champ) {
    if (!(champ instanceof HTMLInputElement)) return;
    const fichier = champ.files && champ.files[0];
    champ.value = '';
    if (!fichier) return;
    this.emettre('etat', { texte: 'Téléversement…', sorte: '' });
    try {
      const media = await televerser(fichier, 'image', this.#contexte ? this.#contexte.id : 0);
      this.#images.push({ url: media.url, nom: media.nom });
      this.#dessinerImages();
      this.emettre('erreur', '');
      this.emettre('etat', { texte: 'Fichier ajouté ✓', sorte: 'ok' });
    } catch (erreur) {
      console.error('<cs-admin-editeur-fiche>', erreur);
      this.emettre('erreur', texteErreur(erreur, 'Téléversement impossible.'));
      this.emettre('etat', { texte: 'Échec', sorte: 'ko' });
    }
  }

  /** La saisie de l'adresse vaut confirmation ; c'est le serveur qui la vérifie. @param {HTMLElement} bouton */
  async #supprimer(bouton) {
    if (!this.#contexte || !this.#contexte.id || !(bouton instanceof HTMLButtonElement)) return;
    this.emettre('erreur', '');
    bouton.disabled = true;
    try {
      await api.admin.postJson('cours_delete.php', { id: this.#contexte.id, confirmation: this.#champ('confirmation').value });
      this.emettre('supprime');
    } catch (erreur) {
      console.error('<cs-admin-editeur-fiche>', erreur);
      this.emettre('erreur', texteErreur(erreur, 'Suppression impossible.'));
    } finally {
      bouton.disabled = false;
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="carte">
        <div class="carte-tete"><div class="carte-titre">Identité</div></div>
        <div class="champs deux">
          <div class="champ">
            <div class="champ-titre">Titre</div>
            <input type="text" data-champ="titre" maxlength="200" placeholder="ex : Les vers de terre et le compost" aria-label="Titre">
          </div>
          <div class="champ">
            <div class="champ-titre">Adresse</div>
            <input type="text" data-champ="slug" maxlength="80" placeholder="déduite du titre" aria-label="Adresse">
            <small class="aide-slug">${AIDE_SLUG_NOUVEAU}</small>
          </div>
        </div>
        <div class="champs espace">
          <div class="champ">
            <div class="champ-titre">Description</div>
            <textarea data-champ="description" rows="2" maxlength="500" placeholder="Une phrase affichée sur la vignette du catalogue." aria-label="Description"></textarea>
          </div>
        </div>
        <div class="champs trois espace">
          <div class="champ">
            <div class="champ-titre">Emoji</div>
            <input type="text" data-champ="emoji" maxlength="8" placeholder="📖" aria-label="Emoji">
          </div>
          <div class="champ">
            <div class="champ-titre">Niveau</div>
            <select data-champ="niveau" aria-label="Niveau">
              <option value="debutant">Débutant</option>
              <option value="intermediaire">Intermédiaire</option>
              <option value="expert">Expert</option>
            </select>
          </div>
          <div class="champ">
            <div class="champ-titre">XP accordée</div>
            <input type="number" data-champ="xp" min="0" max="1000" step="10" value="50" aria-label="XP accordée">
            <small class="aide-xp"></small>
          </div>
        </div>
        <div class="champs deux espace">
          <div class="champ">
            <div class="champ-titre">Thème</div>
            <select data-champ="theme" aria-label="Thème"></select>
          </div>
          <div class="champ">
            <div class="champ-titre">Statut</div>
            <select data-champ="statut" aria-label="Statut">
              <option value="brouillon">Brouillon — invisible des lecteurs</option>
              <option value="publie">Publié — visible au catalogue</option>
              <option value="archive">Archivé — retiré du catalogue</option>
            </select>
          </div>
        </div>
      </div>

      <div class="carte">
        <div class="carte-tete"><div class="carte-titre">Images du cours</div></div>
        <div class="aide">
          Téléverse une image puis clique sur « Insérer » : le lien est placé à l'endroit du curseur
          dans le panneau sélectionné. JPEG, PNG, GIF ou WebP, 2 Mo maximum.
        </div>
        <input type="file" class="choix-image" accept="image/jpeg,image/png,image/gif,image/webp" aria-label="Téléverser une image">
        <div class="images"></div>
      </div>

      <div class="carte">
        <div class="carte-tete"><div class="carte-titre">Historique</div></div>
        <div class="historique">—</div>
      </div>

      <div class="carte carte-suppression" hidden>
        <div class="carte-tete"><div class="carte-titre danger">Supprimer ce cours</div></div>
        <div class="champ">
          <div class="champ-titre">Saisis l'adresse du cours pour confirmer</div>
          <input type="text" data-champ="confirmation" aria-label="Adresse du cours, pour confirmer">
          <small class="aide-suppression"></small>
        </div>
        <button type="button" class="btn btn-danger espace" data-action="supprimer">Supprimer définitivement</button>
      </div>`;
  }

  /** @param {{ url: string, nom: string }[]} images */
  gabaritImages(images) {
    if (!images.length) return html`<div class="images-vide">Aucune image téléversée pour l'instant.</div>`;
    return html`${images.map((im, i) => html`
      <div class="image">
        <img src="${im.url}" alt="">
        <span class="image-nom">${im.nom}</span>
        <button type="button" class="btn btn-clair btn-petit" data-image="${i}">Insérer</button>
      </div>`)}`;
  }
}

AdminEditeurFiche.definir();
