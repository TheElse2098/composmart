/* ============================================================================
   editeur-medias.js — <cs-admin-editeur-medias> : l'onglet « Vidéo & podcast »
   de l'éditeur de cours.

   Deux fiches (adresse, titre, auteur, durée, description). Chacune ajoute un
   onglet à la page du cours ; une fiche sans adresse vaut absence (le serveur
   la ramène à null). Le podcast peut être téléversé : son adresse se remplit
   alors toute seule.

   Prévient son parent par « modifie », « etat » ({ texte, sorte }) pendant un
   téléversement, et « erreur » (le texte) s'il échoue.

   Usage, dans <cs-admin-editeur> :
     this.trouver('cs-admin-editeur-medias', AdminEditeurMedias).configurer(video, podcast, contexte);
     … .fiches()   { video, podcast }, à enregistrer
   ============================================================================ */
import { texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { televerser } from './televersement.js';

/**
 * @typedef {{ url: string, titre: string, auteur: string, duree: string, description: string }} FicheMedia
 * @typedef {'video' | 'podcast'} Sorte
 * @typedef {'url' | 'titre' | 'auteur' | 'duree' | 'description'} ChampMedia
 */

/** @type {ChampMedia[]} */
const CHAMPS = ['url', 'titre', 'auteur', 'duree', 'description'];

export class AdminEditeurMedias extends Composant {
  static balise = 'cs-admin-editeur-medias';
  static styles = [new URL('./editeur-medias.css', import.meta.url)];

  /** @type {import('./editeur.js').ContexteEditeur | null} */
  #contexte = null;

  monter() {
    this.rendre(this.gabarit());
    this.ecouter('input', '[data-champ]', (champ) => {
      if (champ.dataset.fiche === 'podcast' && champ.dataset.champ === 'url') this.#apercuAudio();
      this.emettre('modifie');
    });
    this.ecouter('change', 'input[type="file"]', (champ) => this.#televerser(champ));
  }

  /**
   * @param {Partial<FicheMedia> | null} video
   * @param {Partial<FicheMedia> | null} podcast
   * @param {import('./editeur.js').ContexteEditeur} contexte
   */
  configurer(video, podcast, contexte) {
    this.apresMontage(() => {
      this.#contexte = contexte;
      this.#remplir('video', video);
      this.#remplir('podcast', podcast);
      this.#apercuAudio();
    });
  }

  /** @returns {{ video: FicheMedia, podcast: FicheMedia }} */
  fiches() {
    return { video: this.#lire('video'), podcast: this.#lire('podcast') };
  }

  /** @param {Sorte} sorte @param {ChampMedia} nom @returns {HTMLInputElement | HTMLTextAreaElement} */
  #champ(sorte, nom) {
    const champ = this.trouver('[data-fiche="' + sorte + '"][data-champ="' + nom + '"]');
    if (!(champ instanceof HTMLInputElement || champ instanceof HTMLTextAreaElement)) {
      throw new Error('<cs-admin-editeur-medias> : ' + sorte + '.' + nom + ' n\'est pas un champ');
    }
    return champ;
  }

  /** @param {Sorte} sorte @param {Partial<FicheMedia> | null} fiche */
  #remplir(sorte, fiche) {
    for (const nom of CHAMPS) this.#champ(sorte, nom).value = (fiche && fiche[nom]) || '';
  }

  /** @param {Sorte} sorte @returns {FicheMedia} */
  #lire(sorte) {
    return {
      url: this.#champ(sorte, 'url').value,
      titre: this.#champ(sorte, 'titre').value,
      auteur: this.#champ(sorte, 'auteur').value,
      duree: this.#champ(sorte, 'duree').value,
      description: this.#champ(sorte, 'description').value,
    };
  }

  #apercuAudio() {
    const url = this.#champ('podcast', 'url').value.trim();
    this.rendre(url ? html`<audio controls src="${url}"></audio>` : html``, this.trouver('.apercu-audio'));
  }

  /** @param {HTMLElement} champ */
  async #televerser(champ) {
    if (!(champ instanceof HTMLInputElement)) return;
    const fichier = champ.files && champ.files[0];
    champ.value = '';
    if (!fichier) return;
    this.emettre('etat', { texte: 'Téléversement…', sorte: '' });
    try {
      const media = await televerser(fichier, 'audio', this.#contexte ? this.#contexte.id : 0);
      this.#champ('podcast', 'url').value = media.url;
      // Titre pré-rempli au nom du fichier s'il est vide : mieux que rien côté
      // lecteur, où le titre s'affiche au-dessus du lecteur audio.
      const titre = this.#champ('podcast', 'titre');
      if (!titre.value.trim()) titre.value = media.nom.replace(/\.[^.]+$/, '');
      this.#apercuAudio();
      this.emettre('erreur', '');
      this.emettre('etat', { texte: 'Fichier ajouté ✓', sorte: 'ok' });
      this.emettre('modifie');
    } catch (erreur) {
      console.error('<cs-admin-editeur-medias>', erreur);
      this.emettre('erreur', texteErreur(erreur, 'Téléversement impossible.'));
      this.emettre('etat', { texte: 'Échec', sorte: 'ko' });
    }
  }

  // ── Gabarit ───────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="aide">
        Chacun ajoute un onglet à la page du cours. Laisse l'adresse vide pour qu'il n'apparaisse pas.
      </div>

      <div class="carte">
        <div class="carte-tete"><div class="carte-titre">🎬 Vidéo</div></div>
        <div class="champ">
          <div class="champ-titre">Adresse de la vidéo</div>
          <input type="text" data-fiche="video" data-champ="url" maxlength="500" placeholder="https://www.youtube.com/watch?v=…" aria-label="Adresse de la vidéo">
          <small>YouTube, Vimeo ou lien direct. Le lecteur est construit à partir de l'adresse.</small>
        </div>
        ${this.gabaritDetails('video', '3:47', 'ex : ADEME')}
      </div>

      <div class="carte">
        <div class="carte-tete"><div class="carte-titre">🎧 Podcast</div></div>
        <div class="champ">
          <div class="champ-titre">Téléverser un fichier audio</div>
          <input type="file" accept="audio/*,.mp3,.m4a,.mp4,.wav,.ogg" aria-label="Téléverser un fichier audio">
          <small>MP3, M4A, MP4, WAV ou OGG, 20 Mo maximum. L'adresse ci-dessous se remplit toute seule.
          Le serveur renvoie sa limite exacte si le fichier est refusé.</small>
        </div>
        <div class="champ espace">
          <div class="champ-titre">Adresse du fichier</div>
          <input type="text" data-fiche="podcast" data-champ="url" maxlength="500" placeholder="/api/cours/media.php?id=… ou une adresse externe" aria-label="Adresse du fichier audio">
        </div>
        <div class="apercu-audio"></div>
        ${this.gabaritDetails('podcast', '12:30', 'Composmart')}
      </div>`;
  }

  /**
   * Titre, auteur, durée, description d'une fiche.
   * @param {Sorte} sorte
   * @param {string} exempleDuree
   * @param {string} exempleAuteur
   */
  gabaritDetails(sorte, exempleDuree, exempleAuteur) {
    return html`
      <div class="champs trois espace">
        <div class="champ"><div class="champ-titre">Titre</div><input type="text" data-fiche="${sorte}" data-champ="titre" maxlength="200" aria-label="Titre"></div>
        <div class="champ"><div class="champ-titre">Auteur</div><input type="text" data-fiche="${sorte}" data-champ="auteur" maxlength="120" placeholder="${exempleAuteur}" aria-label="Auteur"></div>
        <div class="champ"><div class="champ-titre">Durée</div><input type="text" data-fiche="${sorte}" data-champ="duree" maxlength="20" placeholder="${exempleDuree}" aria-label="Durée"></div>
      </div>
      <div class="champ espace">
        <div class="champ-titre">Description</div>
        <textarea data-fiche="${sorte}" data-champ="description" rows="2" maxlength="600" aria-label="Description"></textarea>
      </div>`;
  }
}

AdminEditeurMedias.definir();
