/* ============================================================================
   ajouts.js — <cs-admin-ajouts> : l'onglet « Ajouts » du panneau
   d'administration.

   Les composteurs proposés par les visiteurs, en attente de validation, vingt
   par page. Chaque demande se valide, se refuse ou se corrige
   (<cs-admin-ajout-edition>) ; plusieurs se traitent d'un coup en les cochant.

   La sélection ne vaut que pour la page affichée : elle est oubliée à chaque
   rechargement, pour ne jamais valider une ligne qu'on ne voit pas.

   Après une décision, le composant émet « donnees-modifiees » (le panneau
   recompte la pastille de l'onglet).

   Usage, dans le panneau : <cs-admin-ajouts></cs-admin-ajouts>
   ============================================================================ */
import { confirmer, informer } from '../../composants/dialogue/dialogue.js';
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html, pluriel } from '../../socle/outils.js';
import { AdminAjoutEdition } from './ajout-edition.js';
import { gabaritPages } from './communs.js';

/**
 * @typedef {import('./ajout-edition.js').Demande} Demande
 *
 * @typedef {object} Page  /api/carte/pending.php?action=liste
 * @property {Demande[]} demandes
 * @property {string[]} elements  le référentiel des déchets
 * @property {number} page
 * @property {number} pages
 * @property {number} total       demandes en attente, toutes pages confondues
 */

/**
 * L'adresse d'un point sur OpenStreetMap, pour vérifier où se trouve le composteur proposé.
 * @param {number} lat
 * @param {number} lon
 */
export function lienCarte(lat, lon) {
  return 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=19/' + lat + '/' + lon;
}

export class AdminAjouts extends Composant {
  static balise = 'cs-admin-ajouts';
  static styles = [new URL('./ajouts.css', import.meta.url)];

  #page = 1;
  /** Les demandes de la page affichée. @type {Demande[]} */
  #demandes = [];
  /** Le référentiel des déchets, pour la fenêtre de correction. @type {string[]} */
  #dechets = [];
  /** Numéros des demandes cochées. @type {Set<number>} */
  #selection = new Set();
  /** Une décision est en cours d'envoi : un second clic ne la double pas. */
  #envoi = false;
  /** Numéro de la dernière demande de liste : une réponse plus ancienne est ignorée. */
  #demande = 0;

  async monter() {
    this.rendre(this.gabarit());

    this.ecouter('change', '.pending-cb[data-id]', (case_) => {
      if (case_ instanceof HTMLInputElement) this.#cocher(Number(case_.dataset.id), case_.checked);
    });
    this.ecouter('change', '[data-action="tout-cocher"]', (case_) => {
      if (!(case_ instanceof HTMLInputElement)) return;
      // Lu une fois : #cocher() remet cette case à jour à chaque ligne traitée.
      const cochee = case_.checked;
      for (const d of this.#demandes) this.#cocher(d.id, cochee);
    });

    this.ecouter('click', '[data-decision]', (bouton) => {
      const decision = bouton.dataset.decision === 'valider' ? 'valider' : 'refuser';
      // Un bouton de ligne porte le numéro de sa demande ; ceux de la barre valent pour la sélection.
      this.#decider(decision, bouton.dataset.id ? [Number(bouton.dataset.id)] : [...this.#selection]);
    });
    this.ecouter('click', '[data-action="modifier"]', (bouton) => {
      const demande = this.#demandes.find((d) => d.id === Number(bouton.dataset.id));
      if (demande) this.trouver('cs-admin-ajout-edition', AdminAjoutEdition).ouvrir(demande, this.#dechets);
    });
    this.ecouter('click', '[data-page]', (bouton) => {
      this.#page = Number(bouton.dataset.page);
      this.#charger();
    });

    // Une demande corrigée : la liste montre ses nouvelles valeurs.
    this.ecouter('donnees-modifiees', 'cs-admin-ajout-edition', () => this.#charger());

    await this.#charger();
  }

  /** Recharge la page affichée. Appelé par le panneau à chaque retour sur l'onglet. */
  async rafraichir() {
    await this.#charger();
  }

  async #charger() {
    const demande = ++this.#demande;
    const zone = this.trouver('[data-zone="liste"]');
    try {
      /** @type {Page} */
      const d = await api.carte.get('pending.php', { action: 'liste', page: this.#page });
      if (demande !== this.#demande) return;
      // Le serveur ramène une page trop lointaine à la dernière (dernière
      // demande d'une page validée) : on se cale sur ce qu'il a servi.
      this.#page = d.page;
      this.#demandes = d.demandes;
      if (d.elements.length) this.#dechets = d.elements;
      this.#selection = new Set();
      this.trouver('.section-compte').textContent = d.total ? '(' + d.total + ')' : '';
      this.rendre(this.gabaritListe(d), zone);
    } catch (erreur) {
      if (demande !== this.#demande) return;
      console.error('<cs-admin-ajouts>', erreur);
      this.#demandes = [];
      this.#selection = new Set();
      this.afficherErreur(texteErreur(erreur, "Les demandes n'ont pas pu être chargées."), zone);
    }
  }

  /**
   * Coche ou décoche une demande, et met la barre d'actions groupées à jour.
   * @param {number} id
   * @param {boolean} cochee
   */
  #cocher(id, cochee) {
    if (cochee) this.#selection.add(id);
    else this.#selection.delete(id);

    const ligne = this.trouver('.pending-item[data-id="' + id + '"]');
    ligne.classList.toggle('sel', cochee);
    this.trouver('.pending-item[data-id="' + id + '"] .pending-cb', HTMLInputElement).checked = cochee;

    const n = this.#selection.size;
    this.trouver('.bulk-count').textContent = n ? pluriel(n, 'sélectionné', 'sélectionnés') : '';
    for (const bouton of this.tous('.bulk-btn')) {
      if (bouton instanceof HTMLButtonElement) bouton.disabled = n === 0;
    }
    const tout = this.trouver('[data-action="tout-cocher"]', HTMLInputElement);
    tout.checked = n > 0 && n === this.#demandes.length;
    tout.indeterminate = n > 0 && n < this.#demandes.length;
  }

  /**
   * Valide ou refuse des demandes. Un refus se confirme.
   * @param {'valider' | 'refuser'} decision
   * @param {number[]} ids
   */
  async #decider(decision, ids) {
    if (!ids.length || this.#envoi) return;
    if (decision === 'refuser') {
      const quoi = ids.length > 1 ? 'ces ' + ids.length + ' demandes' : 'cette demande';
      if (!await confirmer({ titre: 'Refuser ' + quoi + ' ?', valider: 'Refuser', danger: true })) return;
    }

    const corps = new URLSearchParams({ action: decision });
    for (const id of ids) corps.append('ids[]', String(id));
    this.#envoi = true;
    try {
      await api.carte.post('pending.php', corps);
      this.emettre('donnees-modifiees');
      await this.#charger();
    } catch (erreur) {
      console.error('<cs-admin-ajouts>', erreur);
      informer({ titre: 'Action impossible', texte: texteErreur(erreur, "La décision n'a pas pu être enregistrée.") });
    } finally {
      this.#envoi = false;
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="section-title">🌱 Demandes d'ajout <span class="section-compte"></span></div>
      <div data-zone="liste"><p class="cs-etat">Chargement…</p></div>
      <cs-admin-ajout-edition></cs-admin-ajout-edition>`;
  }

  /** @param {Page} d */
  gabaritListe(d) {
    if (!d.demandes.length) return html`<div class="empty-msg">Aucune demande en attente 🎉</div>`;
    return html`
      <div class="bulk-bar">
        <label class="bulk-check"><input type="checkbox" class="pending-cb" data-action="tout-cocher"> Tout sélectionner</label>
        <span class="bulk-count"></span>
        <div class="bulk-actions">
          <button type="button" class="bulk-btn action-oui" data-decision="valider" disabled>✓ Valider</button>
          <button type="button" class="bulk-btn action-non" data-decision="refuser" disabled>✗ Refuser</button>
        </div>
      </div>
      ${d.demandes.map((p) => this.gabaritDemande(p))}
      ${gabaritPages(d, 'demande', 'demandes')}`;
  }

  /** @param {Demande} p */
  gabaritDemande(p) {
    const regles = p.mettre.length > 0 || p.pas_mettre.length > 0;
    return html`
      <div class="pending-item" data-id="${p.id}">
        <input type="checkbox" class="pending-cb" data-id="${p.id}" aria-label="Sélectionner la demande #${p.id}">
        <div class="pending-main">
          <div class="pending-head">
            <span class="pending-id">#${p.id}</span>
            ${p.type ? html`<span class="pending-badge">${p.type}</span>` : html`<span class="pending-badge vide">type manquant</span>`}
            ${p.acces ? html`<span class="pending-badge">${p.acces}</span>` : html`<span class="pending-badge vide">accès manquant</span>`}
          </div>
          <div class="pending-meta">📍 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} · par ${p.propose_par} · ${(p.date || '').slice(0, 16).replace('T', ' ')}${p.gestion && ' · ' + p.gestion}</div>
          ${regles && html`<div class="pending-rules">${p.mettre.map((x) => html`<span class="regle">${x}</span>`)}${p.pas_mettre.map((x) => html`<span class="regle nok">${x}</span>`)}</div>`}
          <div class="pending-actions">
            <a class="action-voir" href="${lienCarte(p.lat, p.lon)}" target="_blank" rel="noopener">📍 Voir</a>
            <button type="button" class="action-modifier" data-action="modifier" data-id="${p.id}">✏️ Modifier</button>
            <button type="button" class="action-oui" data-decision="valider" data-id="${p.id}">✓ Valider</button>
            <button type="button" class="action-non" data-decision="refuser" data-id="${p.id}">✗ Refuser</button>
          </div>
        </div>
      </div>`;
  }
}

AdminAjouts.definir();
