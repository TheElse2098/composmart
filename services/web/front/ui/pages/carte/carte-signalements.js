/* ============================================================================
   carte-signalements.js — <cs-carte-signalements> : les signalements ouverts,
   pour un administrateur, sur la carte même.

   Un bouton 🚩 en haut à droite, avec leur nombre, ouvre la liste. Chacun se
   voit sur la carte (« Voir »), se marque résolu ou se rejette. Le même
   traitement existe dans le panneau d'administration ; ici, on peut regarder
   le point en même temps. Les droits sont vérifiés par map-api.

   Prévient son parent par « voir-compost » ({ id, lat, lon }).

   Usage, dans <cs-carte> :
     <cs-carte-signalements></cs-carte-signalements>
     this.trouver('cs-carte-signalements', CarteSignalements).activer();   // administrateur
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { libelleMotif } from './carte-libelles.js';

/**
 * Réponse de signalement.php (action=liste).
 * @typedef {object} Signalement
 * @property {number} id
 * @property {number} compost_id
 * @property {string} motif
 * @property {string} commentaire
 * @property {string} date
 * @property {string} par       pseudo, ou « Anonyme »
 * @property {number} lat
 * @property {number} lon
 */

export class CarteSignalements extends Composant {
  static balise = 'cs-carte-signalements';
  static styles = [new URL('./carte-signalements.css', import.meta.url)];

  /** @type {Signalement[]} */
  #liste = [];

  monter() {
    this.rendre(this.gabarit());
    this.ecouter('click', '[data-action="basculer"]', () => {
      const panneau = this.trouver('.signal-panneau');
      panneau.hidden = !panneau.hidden;
    });
    this.ecouter('click', '[data-action="fermer"]', () => { this.trouver('.signal-panneau').hidden = true; });
    this.ecouter('click', '[data-voir]', (b) => {
      const s = this.#liste.find((x) => x.id === Number(b.dataset.voir));
      if (s) this.emettre('voir-compost', { id: s.compost_id, lat: s.lat, lon: s.lon });
    });
    this.ecouter('click', '[data-traiter]', (b) => this.#traiter(b));
  }

  /** Affiche le bouton et charge la liste : réservé à un administrateur. */
  activer() {
    this.apresMontage(() => {
      this.trouver('.signal-bouton').hidden = false;
      this.#charger();
    });
  }

  async #charger() {
    const liste = this.trouver('.signal-liste');
    try {
      /** @type {{ signalements: Signalement[] }} */
      const d = await api.carte.get('signalement.php', { action: 'liste' });
      this.#liste = d.signalements || [];
    } catch (erreur) {
      console.error('<cs-carte-signalements>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Les signalements n\'ont pas pu être chargés.'), liste);
      return;
    }
    this.trouver('.signal-nombre').textContent = String(this.#liste.length);
    this.rendre(this.gabaritListe(this.#liste), liste);
  }

  /** @param {HTMLElement} bouton */
  async #traiter(bouton) {
    if (!(bouton instanceof HTMLButtonElement)) return;
    bouton.disabled = true;
    try {
      await api.carte.post('signalement.php', { action: 'traiter', id: bouton.dataset.traiter || '', statut: bouton.dataset.statut || '' });
    } catch (erreur) {
      console.error('<cs-carte-signalements>', erreur);
      bouton.disabled = false;
      const item = bouton.closest('.signal-item');
      if (item) this.rendre(html`<div class="signal-erreur">⚠️ ${texteErreur(erreur, 'Action impossible, réessaie.')}</div>`, item.querySelector('.signal-retour') || item);
      return;
    }
    await this.#charger();
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <button type="button" class="signal-bouton" data-action="basculer" hidden aria-label="Signalements ouverts">🚩 <span class="signal-nombre">0</span></button>
      <div class="signal-panneau" hidden>
        <div class="signal-tete">🚩 Signalements ouverts <button type="button" data-action="fermer" aria-label="Fermer">✕</button></div>
        <div class="signal-liste"></div>
      </div>`;
  }

  /** @param {Signalement[]} liste */
  gabaritListe(liste) {
    if (!liste.length) return html`<div class="signal-vide">Aucun signalement ouvert 🎉</div>`;
    return html`${liste.map((s) => html`
      <div class="signal-item">
        <div class="signal-motif">${libelleMotif(s.motif)}</div>
        <div class="signal-meta">Compost #${s.compost_id} · par ${s.par} · ${(s.date || '').slice(0, 10)}</div>
        ${s.commentaire && html`<div class="signal-commentaire">« ${s.commentaire} »</div>`}
        <div class="signal-actions">
          <button type="button" class="sig-voir" data-voir="${s.id}">📍 Voir</button>
          <button type="button" class="sig-ok" data-traiter="${s.id}" data-statut="resolu">✓ Résolu</button>
          <button type="button" class="sig-rej" data-traiter="${s.id}" data-statut="rejete">✗ Rejeter</button>
        </div>
        <div class="signal-retour"></div>
      </div>`)}`;
  }
}

CarteSignalements.definir();
