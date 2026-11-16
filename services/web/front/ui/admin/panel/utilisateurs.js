/* ============================================================================
   utilisateurs.js — <cs-admin-utilisateurs> : l'onglet « Utilisateurs » du
   panneau d'administration.

   Les comptes, cinquante au plus : les derniers inscrits, ou ceux dont le
   pseudo contient ce qu'on tape dans la recherche (faite par le serveur).
   Pour chacun : promouvoir administrateur, rétrograder, supprimer — toujours
   après confirmation — et ouvrir sa fiche (<cs-admin-fiche-joueur>) d'un clic
   sur son pseudo. On n'agit pas sur son propre compte.

   Le serveur garde les règles (il reste toujours un administrateur, on ne se
   rétrograde pas soi-même) ; ici on affiche son refus.

   Après une action, le composant émet « donnees-modifiees ».

   Usage, dans le panneau : <cs-admin-utilisateurs></cs-admin-utilisateurs>
   ============================================================================ */
import { confirmer, informer } from '../../composants/dialogue/dialogue.js';
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { AdminFicheJoueur } from './fiche-joueur.js';

/**
 * @typedef {object} Utilisateur
 * @property {number} id
 * @property {string} username
 * @property {number} xp
 * @property {number} niveau
 * @property {boolean} isAdmin
 * @property {string} date  inscription
 *
 * @typedef {object} Liste  /api/admin/users.php?q=
 * @property {Utilisateur[]} users  50 au plus
 * @property {number} me            le compte de l'administrateur connecté
 * @property {number} total         comptes existants
 */

/** Attente après la dernière frappe avant d'interroger le serveur. */
const DELAI_RECHERCHE = 250;

/**
 * « (12) », ou « (50 affichés sur 3204) » quand la liste est tronquée.
 * @param {number} affiches
 * @param {number} total
 */
export function compteUtilisateurs(affiches, total) {
  return total > affiches ? '(' + affiches + ' affichés sur ' + total + ')' : '(' + affiches + ')';
}

/**
 * Ce qu'on demande de confirmer avant d'agir sur un compte.
 * @param {'promouvoir' | 'retrograder' | 'supprimer'} action
 * @param {string} pseudo
 * @returns {import('../../composants/dialogue/dialogue.js').Options}
 */
export function question(action, pseudo) {
  if (action === 'supprimer') {
    return { titre: 'Supprimer définitivement « ' + pseudo + ' » ?', texte: 'Sa progression et ses scores seront perdus.', valider: 'Supprimer', danger: true };
  }
  if (action === 'promouvoir') return { titre: 'Promouvoir « ' + pseudo + ' » administrateur ?', valider: 'Promouvoir' };
  return { titre: 'Retirer les droits admin à « ' + pseudo + ' » ?', valider: 'Retirer', danger: true };
}

export class AdminUtilisateurs extends Composant {
  static balise = 'cs-admin-utilisateurs';
  static styles = [new URL('./utilisateurs.css', import.meta.url)];

  /** Ce qui est cherché. Gardé d'un onglet à l'autre. */
  #recherche = '';
  /** Les comptes affichés. @type {Utilisateur[]} */
  #utilisateurs = [];
  /** Numéro de la dernière demande : une réponse plus ancienne est ignorée. */
  #demande = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #attente = undefined;

  async monter() {
    this.rendre(this.gabarit());

    // La recherche part quand la frappe s'arrête, pas à chaque lettre.
    this.ecouter('input', '.user-search', (champ) => {
      if (!(champ instanceof HTMLInputElement)) return;
      this.#recherche = champ.value;
      clearTimeout(this.#attente);
      this.#attente = setTimeout(() => this.#charger(), DELAI_RECHERCHE);
    });
    this.aLaFin(() => clearTimeout(this.#attente));

    this.ecouter('click', '[data-fiche]', (bouton) => {
      const u = this.#trouverUtilisateur(bouton.dataset.fiche);
      if (u) this.trouver('cs-admin-fiche-joueur', AdminFicheJoueur).ouvrir(u.id, u.username);
    });
    this.ecouter('click', '[data-agir]', (bouton) => {
      const u = this.#trouverUtilisateur(bouton.dataset.id);
      const action = bouton.dataset.agir;
      if (u && (action === 'promouvoir' || action === 'retrograder' || action === 'supprimer')) this.#agir(action, u);
    });

    await this.#charger();
  }

  /** Recharge la liste, recherche conservée. Appelé par le panneau à chaque
   *  retour sur l'onglet. */
  async rafraichir() {
    await this.#charger();
  }

  /** @param {string | undefined} id */
  #trouverUtilisateur(id) {
    return this.#utilisateurs.find((u) => String(u.id) === id);
  }

  async #charger() {
    const demande = ++this.#demande;
    const lignes = this.trouver('tbody');
    try {
      /** @type {Liste} */
      const d = await api.admin.get('users.php', { q: this.#recherche });
      if (demande !== this.#demande) return;
      this.#utilisateurs = d.users;
      this.trouver('.section-compte').textContent = compteUtilisateurs(d.users.length, d.total);
      this.rendre(this.gabaritLignes(d.users, d.me), lignes);
    } catch (erreur) {
      if (demande !== this.#demande) return;
      console.error('<cs-admin-utilisateurs>', erreur);
      this.#utilisateurs = [];
      this.trouver('.section-compte').textContent = '';
      this.rendre(html`<tr><td colspan="6" class="user-empty" role="alert">⚠️ ${texteErreur(erreur, "Les utilisateurs n'ont pas pu être chargés.")}</td></tr>`, lignes);
    }
  }

  /**
   * @param {'promouvoir' | 'retrograder' | 'supprimer'} action
   * @param {Utilisateur} u
   */
  async #agir(action, u) {
    if (!await confirmer(question(action, u.username))) return;
    const demande = action === 'supprimer'
      ? { action: 'delete', user_id: u.id }
      : { action: 'set_admin', user_id: u.id, value: action === 'promouvoir' ? 1 : 0 };
    try {
      await api.admin.post('users.php', demande);
      this.emettre('donnees-modifiees');
      await this.#charger();
    } catch (erreur) {
      console.error('<cs-admin-utilisateurs>', erreur);
      informer({ titre: 'Action impossible', texte: texteErreur(erreur, "L'action n'a pas pu être enregistrée.") });
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="section-title">👥 Utilisateurs <span class="section-compte"></span></div>
      <input class="user-search" type="search" placeholder="🔍 Rechercher un utilisateur par pseudo…" autocomplete="off" aria-label="Rechercher un utilisateur par pseudo">
      <div class="user-table-wrap">
        <table>
          <thead><tr><th>Pseudo</th><th>Niveau</th><th>XP</th><th>Inscrit le</th><th>Rôle</th><th>Actions</th></tr></thead>
          <tbody><tr><td colspan="6" class="user-empty">Chargement…</td></tr></tbody>
        </table>
      </div>
      <cs-admin-fiche-joueur></cs-admin-fiche-joueur>`;
  }

  /**
   * @param {Utilisateur[]} utilisateurs
   * @param {number} moi  le compte de l'administrateur connecté
   */
  gabaritLignes(utilisateurs, moi) {
    if (!utilisateurs.length) return html`<tr><td colspan="6" class="user-empty">Aucun utilisateur trouvé.</td></tr>`;
    return html`${utilisateurs.map((u) => html`
      <tr>
        <td><button type="button" class="fiche-user-btn" data-fiche="${u.id}"><b>${u.username}</b></button></td>
        <td><span class="lvl-pill">Niv. ${u.niveau}</span></td>
        <td>${u.xp}</td>
        <td>${(u.date || '').slice(0, 10)}</td>
        <td>${u.isAdmin ? html`<span class="badge-admin">ADMIN</span>` : '—'}</td>
        <td class="act-cell">${u.id === moi ? html`<span class="act-self">moi</span>` : this.gabaritActions(u)}</td>
      </tr>`)}`;
  }

  /** Les boutons d'un compte qui n'est pas le sien. @param {Utilisateur} u */
  gabaritActions(u) {
    return html`${u.isAdmin
      ? html`<button type="button" class="act-btn act-demote" data-agir="retrograder" data-id="${u.id}">Rétrograder</button>`
      : html`<button type="button" class="act-btn act-promote" data-agir="promouvoir" data-id="${u.id}">Promouvoir</button>`} <button type="button" class="act-btn act-delete" data-agir="supprimer" data-id="${u.id}" aria-label="Supprimer ${u.username}">🗑</button>`;
  }
}

AdminUtilisateurs.definir();
