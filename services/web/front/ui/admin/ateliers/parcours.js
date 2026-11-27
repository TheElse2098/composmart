/* ============================================================================
   parcours.js — <cs-admin-parcours> : la bibliothèque de parcours
   (/evenements-admin/parcours). Un parcours est un déroulé d'atelier
   réutilisable d'une entreprise à l'autre ; un événement en recopie les
   slides, si bien que modifier ou supprimer un parcours ne touche jamais un
   atelier déjà monté.

   Usage :
     <cs-admin-parcours></cs-admin-parcours>
     <script type="module" src="/ui/admin/ateliers/parcours.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { html } from '../../socle/outils.js';
import { ADRESSES } from './adresses.js';
import { PageAteliers } from './page-ateliers.js';

/**
 * Réponse de /api/evenements/parcours.php?action=liste.
 * @typedef {{ id: number, nom: string, description: string | null, nb_slides: number, total_points: number }} Parcours
 */

export class AdminParcours extends PageAteliers {
  static balise = 'cs-admin-parcours';
  static styles = [...PageAteliers.styles, new URL('./parcours.css', import.meta.url)];

  /** @type {Map<number, Parcours>} */
  #parcours = new Map();

  monter() {
    this.poserPage({
      retour: { adresse: ADRESSES.liste, libelle: 'Tous les événements' },
      badge: '🎬 Parcours',
      titre: 'Bibliothèque de parcours',
      sousTitre: 'Un parcours est un déroulé d’atelier réutilisable d’une entreprise à l’autre.',
      corps: this.gabarit(),
    });
    this.ecouter('submit', '.parcours-creation', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#creer();
    });
    this.ecouter('click', '[data-dupliquer]', (b) => this.#dupliquer(Number(b.dataset.dupliquer), b));
    this.ecouter('click', '[data-supprimer]', (b) => {
      const p = this.#parcours.get(Number(b.dataset.supprimer));
      if (p) this.#supprimer(p);
    });
    this.#charger();
  }

  async #charger() {
    const zone = this.trouver('.parcours-liste');
    /** @type {Parcours[]} */
    let liste;
    try {
      const d = await api.evenements.get('parcours.php', { action: 'liste' });
      liste = d.parcours || [];
    } catch (erreur) {
      console.error('<cs-admin-parcours>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), zone);
      return;
    }
    this.#parcours = new Map(liste.map((p) => [p.id, p]));
    this.rendre(this.gabaritListe(liste), zone);
  }

  async #creer() {
    const liberer = this.occuper('.parcours-creation [type="submit"]', 'Création…');
    try {
      const d = await api.evenements.post('parcours.php', { nom: this.champ('[name="nom"]'), description: this.champ('[name="description"]') }, { action: 'creer' });
      location.assign(ADRESSES.parcoursEdition(d.id));
    } catch (erreur) {
      console.error('<cs-admin-parcours>', erreur);
      this.message(texteErreur(erreur, 'Erreur réseau.'));
      liberer();
    }
  }

  /** @param {number} id @param {HTMLElement} bouton */
  async #dupliquer(id, bouton) {
    if (!(bouton instanceof HTMLButtonElement) || bouton.disabled) return;
    bouton.disabled = true;
    try {
      const d = await api.evenements.post('parcours.php', { id }, { action: 'dupliquer' });
      location.assign(ADRESSES.parcoursEdition(d.id));
    } catch (erreur) {
      console.error('<cs-admin-parcours>', erreur);
      this.message(texteErreur(erreur, 'Duplication impossible.'));
      bouton.disabled = false;
    }
  }

  /** @param {Parcours} p */
  async #supprimer(p) {
    const ok = await confirmer({
      titre: 'Supprimer ce parcours ?',
      texte: '« ' + p.nom + ' » sera retiré de la bibliothèque. Les ateliers déjà joués ne sont pas touchés : leurs slides en sont des copies.',
      valider: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.evenements.post('parcours.php', { id: p.id }, { action: 'supprimer' });
    } catch (erreur) {
      console.error('<cs-admin-parcours>', erreur);
      this.message(texteErreur(erreur, 'Suppression impossible.'));
      return;
    }
    this.#charger();
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="section-titre">➕ Nouveau parcours</div>
      <div class="card">
        <form class="parcours-creation">
          <div class="field"><label for="parcours-nom">Nom</label>
            <input type="text" id="parcours-nom" name="nom" maxlength="150" placeholder="Atelier compostage — 45 min" required></div>
          <div class="field"><label for="parcours-description">Description</label>
            <input type="text" id="parcours-description" name="description" maxlength="300" placeholder="Découverte, quiz et défis"></div>
          <button type="submit" class="btn-p">Créer</button>
        </form>
      </div>

      <div class="section-titre">📚 Parcours existants</div>
      <div class="parcours-liste"><p class="cs-etat">Chargement…</p></div>`;
  }

  /** @param {Parcours[]} liste */
  gabaritListe(liste) {
    if (!liste.length) return html`<div class="empty-msg">Aucun parcours pour le moment.</div>`;
    return html`${liste.map((p) => html`
      <div class="p-item">
        <div class="p-main">
          <div class="p-nom">${p.nom}</div>
          <div class="p-meta">${p.nb_slides} slide(s) · ${p.total_points} pts${p.description && ' · ' + p.description}</div>
        </div>
        <div class="p-actions">
          <a class="p-bouton ouvrir" href="${ADRESSES.parcoursEdition(p.id)}">✏️ Ouvrir</a>
          <button type="button" class="p-bouton dupliquer" data-dupliquer="${p.id}">⧉ Dupliquer</button>
          <button type="button" class="p-bouton supprimer" data-supprimer="${p.id}" aria-label="Supprimer ${p.nom}">🗑</button>
        </div>
      </div>`)}`;
  }
}

AdminParcours.definir();
