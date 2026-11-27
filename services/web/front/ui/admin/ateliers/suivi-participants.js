/* ============================================================================
   suivi-participants.js — <cs-admin-suivi-participants> : l'onglet
   Participants de la console — les équipes et qui a rejoint.

   La page lui passe la liste des participants à chaque tour
   (poserParticipants) ; il va chercher les équipes lui-même quand l'onglet
   est affiché (rafraichir). Rien n'est redessiné qui n'a pas changé.

   Phase 10c-1 : affichage seul. Créer, redéfinir, répartir les équipes et y
   placer quelqu'un arrivent en 10c-2.
   ============================================================================ */
import { api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { couleurSure, evenementDe, heureArrivee } from './suivi-outils.js';

/**
 * Réponse de admin.php?action=equipes.
 * @typedef {{ id: number, nom: string, couleur: string, membres: number }} Equipe
 * @typedef {import('./suivi.js').Participant} Participant
 */

export class AdminSuiviParticipants extends Composant {
  static balise = 'cs-admin-suivi-participants';
  static styles = [new URL('./suivi-participants.css', import.meta.url)];

  /** @type {Participant[]} */
  #participants = [];
  /** @type {Equipe[]} */
  #equipes = [];
  /** Les équipes ont été chargées au moins une fois. */
  #equipesConnues = false;

  monter() {
    this.rendre(html`
      <div class="card">
        <div class="section-titre"><span>🏳️ Équipes</span></div>
        <div class="equipes"><p class="cs-etat">Chargement…</p></div>
      </div>
      <div class="card">
        <div class="section-titre">👥 Participants <span class="compteur nb"></span></div>
        <div class="participants"><p class="cs-etat">Chargement…</p></div>
      </div>`);
  }

  /**
   * La liste du dernier tour.
   * @param {Participant[]} participants
   */
  poserParticipants(participants) {
    this.apresMontage(() => {
      this.#participants = participants;
      this.#dessiner();
    });
  }

  async rafraichir() {
    const id = evenementDe(location.pathname);
    if (!id) return;
    /** @type {{ equipes?: Equipe[] }} */
    const d = await api.evenements.get('admin.php', { action: 'equipes', id });
    this.#equipes = d.equipes || [];
    this.#equipesConnues = true;
    this.apresMontage(() => this.#dessiner());
  }

  #dessiner() {
    if (this.#equipesConnues) this.rendreSiChange(this.gabaritEquipes(this.#equipes), this.trouver('.equipes'));
    this.rendreSiChange(html`(${this.#participants.length})`, this.trouver('.nb'));
    this.rendreSiChange(this.gabaritParticipants(this.#participants, this.#equipes), this.trouver('.participants'));
  }

  /** @param {Equipe[]} equipes */
  gabaritEquipes(equipes) {
    if (!equipes.length) return html`<div class="hint">Pas encore d'équipe. Leur création se fait encore sur la console en service ; le mode de répartition se règle dans les réglages de l'événement.</div>`;
    return html`<ul class="liste">${equipes.map((e) => html`
      <li>${this.gabaritCouleur(e.couleur)}<span class="nom">${e.nom}</span><span class="eq">${e.membres} membre(s)</span></li>`)}</ul>`;
  }

  /** @param {string} couleur */
  gabaritCouleur(couleur) {
    const sure = couleurSure(couleur);
    return html`<span class="rang"${sure && html` style="color: ${sure}"`} aria-hidden="true">■</span>`;
  }

  /**
   * @param {Participant[]} participants
   * @param {Equipe[]} equipes
   */
  gabaritParticipants(participants, equipes) {
    if (!participants.length) return html`<div class="empty-msg">Personne n'a encore rejoint.</div>`;
    const nomEquipe = (/** @type {number | null} */ id) => {
      const e = equipes.find((x) => x.id === id);
      return e ? e.nom : '— sans équipe —';
    };
    return html`<ul class="liste">${participants.map((p) => html`
      <li>
        <span class="nom">${p.nom_affiche}</span>
        ${equipes.length > 0 && html`<span class="eq">${nomEquipe(p.equipe_id)}</span>`}
        <span class="pts">${p.points} pts</span>
        <span class="eq">${heureArrivee(p.rejoint_at)}</span>
      </li>`)}</ul>`;
  }
}

AdminSuiviParticipants.definir();
