/* ============================================================================
   suivi-classement.js — <cs-admin-suivi-classement> : l'onglet Classement de
   la console, individuel et par équipe. Mis à jour à chaque tour tant que
   l'onglet est affiché ; rien n'est redessiné qui n'a pas changé.
   ============================================================================ */
import { api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { evenementDe } from './suivi-outils.js';

/**
 * Réponse de animation.php?action=classement.
 * @typedef {{ nom: string, points: number }} Joueur
 * @typedef {{ nom: string, points: number, membres: number }} EquipeClassee
 */

export class AdminSuiviClassement extends Composant {
  static balise = 'cs-admin-suivi-classement';
  static styles = [new URL('./suivi-classement.css', import.meta.url)];

  monter() {
    this.rendre(html`
      <div class="card">
        <div class="section-titre">🏆 Classement individuel</div>
        <div class="joueurs"><p class="cs-etat">Chargement…</p></div>
      </div>
      <div class="card classement-equipes" hidden>
        <div class="section-titre">👥 Classement par équipe</div>
        <div class="equipes"></div>
      </div>`);
  }

  async rafraichir() {
    const id = evenementDe(location.pathname);
    if (!id) return;
    /** @type {{ joueurs?: Joueur[], equipes?: EquipeClassee[] }} */
    const d = await api.evenements.get('animation.php', { action: 'classement', id });
    this.apresMontage(() => {
      const joueurs = d.joueurs || [];
      const equipes = d.equipes || [];
      this.rendreSiChange(joueurs.length
        ? html`<ul class="liste">${joueurs.map((j, i) => html`<li><span class="rang">${i + 1}</span><span class="nom">${j.nom}</span><span class="pts">${j.points}</span></li>`)}</ul>`
        : html`<div class="empty-msg">Aucun participant.</div>`, this.trouver('.joueurs'));
      this.trouver('.classement-equipes').hidden = !equipes.length;
      this.rendreSiChange(html`<ul class="liste">${equipes.map((e, i) => html`
        <li><span class="rang">${i + 1}</span><span class="nom">${e.nom}</span><span class="eq">${e.membres} membres</span><span class="pts">${e.points}</span></li>`)}</ul>`, this.trouver('.equipes'));
    });
  }
}

AdminSuiviClassement.definir();
