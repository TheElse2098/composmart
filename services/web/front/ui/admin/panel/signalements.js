/* ============================================================================
   signalements.js — <cs-admin-signalements> : l'onglet « Signalements » du
   panneau d'administration.

   Les signalements ouverts sur des composteurs de la carte (mauvaise position,
   règles fausses, composteur disparu…), du plus récent au plus ancien. Chacun
   se clôt d'un clic : « Résolu » ou « Rejeter ». Pas de confirmation : la
   décision se défait depuis le journal.

   Après une décision, le composant émet « donnees-modifiees » (le panneau
   recompte la pastille de l'onglet).

   Usage, dans le panneau : <cs-admin-signalements></cs-admin-signalements>
   ============================================================================ */
import { informer } from '../../composants/dialogue/dialogue.js';
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { libelleMotif } from '../../pages/carte/carte-libelles.js';

/**
 * @typedef {object} Signalement  /api/carte/signalement.php?action=liste
 * @property {number} id
 * @property {number} compost_id
 * @property {string} motif
 * @property {string | null} commentaire
 * @property {string} date
 * @property {string} par  pseudo, ou « Anonyme »
 */

export class AdminSignalements extends Composant {
  static balise = 'cs-admin-signalements';
  static styles = [new URL('./signalements.css', import.meta.url)];

  async monter() {
    this.rendre(this.gabarit());
    this.ecouter('click', '[data-statut]', (bouton) => this.#traiter(bouton));
    await this.#charger();
  }

  /** Recharge la liste. Appelé par le panneau à chaque retour sur l'onglet. */
  async rafraichir() {
    await this.#charger();
  }

  async #charger() {
    const zone = this.trouver('[data-zone="liste"]');
    try {
      /** @type {{ signalements: Signalement[] }} */
      const d = await api.carte.get('signalement.php', { action: 'liste' });
      this.rendre(this.gabaritListe(d.signalements), zone);
    } catch (erreur) {
      console.error('<cs-admin-signalements>', erreur);
      this.afficherErreur(texteErreur(erreur, "Les signalements n'ont pas pu être chargés."), zone);
    }
  }

  /** @param {HTMLElement} bouton  porte `data-statut` (`resolu` ou `rejete`) et `data-id` */
  async #traiter(bouton) {
    const carte = bouton.closest('.signal-item');
    const boutons = carte ? [...carte.querySelectorAll('button')] : [];
    for (const b of boutons) b.disabled = true; // pas de double décision pendant l'envoi
    try {
      await api.carte.post('signalement.php', { action: 'traiter', id: bouton.dataset.id, statut: bouton.dataset.statut });
      this.emettre('donnees-modifiees');
      await this.#charger();
    } catch (erreur) {
      for (const b of boutons) b.disabled = false;
      console.error('<cs-admin-signalements>', erreur);
      informer({ titre: 'Action impossible', texte: texteErreur(erreur, "La décision n'a pas pu être enregistrée.") });
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="section-title">🚩 Signalements ouverts</div>
      <div data-zone="liste"><p class="cs-etat">Chargement…</p></div>`;
  }

  /** @param {Signalement[]} liste */
  gabaritListe(liste) {
    if (!liste.length) return html`<div class="empty-msg">Aucun signalement ouvert 🎉</div>`;
    return html`${liste.map((s) => html`
      <div class="signal-item">
        <div class="signal-item-motif">${libelleMotif(s.motif)}</div>
        <div class="signal-item-meta">Composteur #${s.compost_id} · par ${s.par} · ${(s.date || '').slice(0, 10)}</div>
        ${s.commentaire && html`<div class="signal-item-comment">« ${s.commentaire} »</div>`}
        <div class="signal-item-actions">
          <a class="action-voir" href="/carte" title="Ouvre la carte">📍 Carte</a>
          <button type="button" class="action-oui" data-statut="resolu" data-id="${s.id}">✓ Résolu</button>
          <button type="button" class="action-non" data-statut="rejete" data-id="${s.id}">✗ Rejeter</button>
        </div>
      </div>`)}`;
  }
}

AdminSignalements.definir();
