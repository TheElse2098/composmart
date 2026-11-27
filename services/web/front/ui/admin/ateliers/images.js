/* ============================================================================
   images.js — <cs-admin-images> : la banque d'images des ateliers
   (/evenements-admin/images), les illustrations du thème « simpliste ».

   Chaque événement choisit des tags dans ses réglages, et ses slides piochent
   au hasard parmi les images qui les portent : sans tag, une image n'est
   jamais tirée. Les tags se choisissent par pastilles (<cs-choix-tags>), dans
   un seul vocabulaire partagé par le formulaire d'ajout et la fenêtre de
   modification.

   Usage :
     <cs-admin-images></cs-admin-images>
     <script type="module" src="/ui/admin/ateliers/images.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { ChoixTags } from '../../composants/choix-tags/choix-tags.js';
import { html } from '../../socle/outils.js';
import { ADRESSES } from './adresses.js';
import { AUCUN_TAG, AdminImageEdition } from './image-edition.js';
import { TAILLE_MAX_IMAGE, poids } from './outils-ateliers.js';
import { PageAteliers } from './page-ateliers.js';

/** @typedef {import('./image-edition.js').ImageBanque} ImageBanque */
/** @typedef {{ tag: string, n: number }} TagBanque */

export class AdminImages extends PageAteliers {
  static balise = 'cs-admin-images';
  static styles = [...PageAteliers.styles, new URL('./images.css', import.meta.url)];

  #tag = '';
  /** @type {Map<number, ImageBanque>} */
  #images = new Map();
  #chargement = 0;
  /** Adresse locale de l'aperçu du fichier choisi, à libérer. @type {string | null} */
  #apercu = null;

  monter() {
    this.poserPage({
      retour: { adresse: ADRESSES.liste, libelle: 'Tous les événements' },
      badge: '🖼️ Images',
      titre: 'Banque d’images',
      sousTitre: 'Les illustrations du thème « simpliste ». Chaque événement choisit des tags dans ses réglages, et ses slides piochent au hasard parmi les images qui les portent.',
      corps: this.gabarit(),
    });
    this.#tagsFormulaire().configurer({ tout: true, messageVide: AUCUN_TAG });
    this.ecouter('change', '[name="fichier"]', () => this.#apercevoir());
    this.ecouter('submit', '.img-form', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#televerser();
    });
    this.ecouter('click', '[data-tag]', (bouton) => {
      this.#tag = bouton.dataset.tag || '';
      // Depuis une vignette, on remonte voir la grille filtrée depuis le haut.
      if (bouton.classList.contains('pastille')) window.scrollTo({ top: 0, behavior: 'smooth' });
      this.#charger();
    });
    this.ecouter('click', '[data-modifier]', (bouton) => {
      const image = this.#images.get(Number(bouton.dataset.modifier));
      if (image) this.trouver('cs-admin-image-edition', AdminImageEdition).ouvrir(image);
    });
    this.ecouter('click', '[data-supprimer]', (bouton) => this.#supprimer(Number(bouton.dataset.supprimer)));
    this.ecouter('image-modifiee', 'cs-admin-image-edition', () => {
      this.message('Image modifiée.', true);
      this.#charger();
    });
    this.aLaFin(() => this.#libererApercu());
    this.#charger();
  }

  #tagsFormulaire() {
    return this.trouver('.img-form cs-choix-tags', ChoixTags);
  }

  async #charger() {
    const numero = ++this.#chargement;
    /** @type {{ images?: ImageBanque[], tags?: TagBanque[] }} */
    let d;
    try {
      d = await api.evenements.get('images.php', { action: 'liste', tag: this.#tag || null });
    } catch (erreur) {
      if (numero !== this.#chargement) return;
      console.error('<cs-admin-images>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), this.trouver('.img-grille'));
      return;
    }
    if (numero !== this.#chargement) return;
    const images = d.images || [];
    const tags = d.tags || [];
    this.#images = new Map(images.map((im) => [im.id, im]));
    this.trouver('.img-nb').textContent = '(' + images.length + ')';
    this.rendre(this.gabaritFiltres(tags), this.trouver('.img-filtres'));
    this.rendre(this.gabaritGrille(images), this.trouver('.img-grille'));
    // Redonner la sélection après le vocabulaire : ce qui était coché pendant
    // la saisie ne doit pas se perdre au rechargement de la liste.
    const choisis = this.#tagsFormulaire().valeur();
    this.#tagsFormulaire().disponibles(tags);
    this.#tagsFormulaire().definir(choisis);
    this.trouver('cs-admin-image-edition', AdminImageEdition).vocabulaire(tags);
  }

  /** @returns {File | null} */
  #fichier() {
    const champ = this.trouver('[name="fichier"]', HTMLInputElement);
    return (champ.files && champ.files[0]) || null;
  }

  /* Aperçu du fichier choisi, avant l'envoi : c'est le seul moment où l'on
     peut encore corriger une erreur de fichier sans avoir rempli la banque.

     createObjectURL et non un FileReader en base64 : le navigateur affiche le
     fichier depuis le disque, sans en charger plusieurs mégaoctets en mémoire.
     L'adresse se libère à la main, sinon elle survit jusqu'au rechargement de
     la page et dix fichiers choisis d'affilée en retiendraient dix. */
  #apercevoir() {
    this.#libererApercu();
    const fichier = this.#fichier();
    if (!fichier) return;
    this.#apercu = URL.createObjectURL(fichier);
    const zone = this.trouver('.img-apercu');
    this.rendre(html`
      <img class="img-vue" src="${this.#apercu}" alt="Aperçu de l’image choisie">
      <div class="img-meta">${poids(fichier.size)}</div>`, zone);
    zone.hidden = false;
    const vue = zone.querySelector('img');
    const meta = this.trouver('.img-apercu .img-meta');
    // Les dimensions ne sont connues qu'une fois l'image décodée : on les
    // ajoute à la volée plutôt que de retarder l'aperçu.
    vue?.addEventListener('load', () => {
      const image = /** @type {HTMLImageElement} */ (vue);
      meta.textContent = image.naturalWidth + '×' + image.naturalHeight + ' · ' + poids(fichier.size)
        + (fichier.size > TAILLE_MAX_IMAGE ? ' · trop lourde (8 Mo maximum)' : '');
    }, { once: true });
    vue?.addEventListener('error', () => { meta.textContent = 'Fichier illisible — ce n’est pas une image.'; }, { once: true });
  }

  #libererApercu() {
    if (this.#apercu) URL.revokeObjectURL(this.#apercu);
    this.#apercu = null;
    const zone = this.querySelector('.img-apercu');
    if (zone instanceof HTMLElement) {
      zone.hidden = true;
      this.rendre(html``, zone);
    }
  }

  async #televerser() {
    const fichier = this.#fichier();
    if (!fichier) { this.message('Choisis un fichier.'); return; }
    // Le serveur revérifie tout (taille et contenu réel) : ce contrôle-ci
    // évite seulement un envoi de plusieurs mégaoctets voué au refus.
    if (fichier.size > TAILLE_MAX_IMAGE) { this.message('Image trop lourde (8 Mo maximum).'); return; }

    const donnees = new FormData();
    donnees.append('fichier', fichier);
    donnees.append('nom', this.champ('[name="nom"]'));
    donnees.append('tags', this.#tagsFormulaire().valeur().join(','));
    const liberer = this.occuper('.img-form [type="submit"]', 'Envoi…');
    try {
      await api.evenements.post('images.php', donnees, { action: 'televerser' });
    } catch (erreur) {
      console.error('<cs-admin-images>', erreur);
      this.message(texteErreur(erreur, 'Téléversement impossible.'));
      liberer();
      return;
    }
    liberer();
    this.message('Image ajoutée.', true);
    this.trouver('.img-form', HTMLFormElement).reset();
    this.#tagsFormulaire().definir([]);
    // reset() vide le champ fichier sans déclencher « change » : sans cet
    // appel, l'aperçu resterait sur l'image déjà envoyée.
    this.#libererApercu();
    this.#charger();
  }

  /** @param {number} id */
  async #supprimer(id) {
    const ok = await confirmer({
      titre: 'Supprimer cette image ?',
      texte: 'Les slides qui la montraient piocheront une autre image parmi les tags de leur événement.',
      valider: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.evenements.post('images.php', { id }, { action: 'supprimer' });
    } catch (erreur) {
      console.error('<cs-admin-images>', erreur);
      this.message(texteErreur(erreur, 'Suppression impossible.'));
      return;
    }
    this.#charger();
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="section-titre">➕ Ajouter une image</div>
      <div class="card">
        <form class="img-form">
          <div class="field"><label for="img-fichier">Fichier</label>
            <input type="file" id="img-fichier" name="fichier" accept="image/png,image/jpeg,image/gif,image/webp" required>
            <div class="img-apercu" hidden></div></div>
          <div class="field"><label for="img-nom">Nom (facultatif)</label>
            <input type="text" id="img-nom" name="nom" maxlength="200" placeholder="Laisse vide pour reprendre le nom du fichier"></div>
          <div class="field"><span class="field-titre">Tags</span>
            <cs-choix-tags></cs-choix-tags></div>
          <button type="submit" class="btn-p">Téléverser</button>
          <div class="hint">PNG, JPEG, GIF ou WebP, 8 Mo maximum. Sans tag, l'image ne sera jamais tirée au sort : c'est le tag qui la rend éligible.</div>
        </form>
      </div>

      <div class="section-titre">🖼️ Images <span class="compteur img-nb"></span></div>
      <div class="filtres img-filtres"></div>
      <div class="img-grille"><p class="cs-etat">Chargement…</p></div>
      <cs-admin-image-edition></cs-admin-image-edition>`;
  }

  /** @param {TagBanque[]} tags */
  gabaritFiltres(tags) {
    return html`
      <button type="button" class="filtre${this.#tag === '' && ' actif'}" data-tag="">Toutes</button>
      ${tags.map((t) => html`<button type="button" class="filtre${this.#tag === t.tag && ' actif'}" data-tag="${t.tag}">${t.tag} <span class="n">${t.n}</span></button>`)}`;
  }

  /** @param {ImageBanque[]} images */
  gabaritGrille(images) {
    if (!images.length) return html`<div class="empty-msg">Aucune image. Téléverse la première ci-dessus.</div>`;
    return html`${images.map((im) => html`
      <div class="img-carte">
        <img class="img-vue" src="${im.url}" alt="${im.nom}" loading="lazy">
        <div class="img-nom" title="${im.nom}">${im.nom}</div>
        <div class="img-meta">${im.largeur ? im.largeur + '×' + im.hauteur + ' · ' : ''}${poids(im.taille)}</div>
        <div class="chips">${(im.tags || []).map((t) => html`<button type="button" class="pastille" data-tag="${t}" title="Filtrer sur ce tag">${t}</button>`)}</div>
        <div class="img-btns">
          <button type="button" class="btn-mini" data-modifier="${im.id}">✏️ Modifier</button>
          <button type="button" class="btn-mini sup" data-supprimer="${im.id}" title="Supprimer" aria-label="Supprimer l’image ${im.nom}">🗑</button>
        </div>
      </div>`)}`;
  }
}

AdminImages.definir();
