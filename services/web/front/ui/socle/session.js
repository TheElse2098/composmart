/* ============================================================================
   session.js — qui est connecté, demandé une seule fois par page.

   Avant, chaque script posait la question de son côté : admin-badge.js,
   verif-banner.js et la page elle-même appelaient /api/auth/me.php, soit deux
   ou trois requêtes identiques par chargement. Tous les composants passent
   désormais par `session.moi()`, qui partage la même réponse.
   ============================================================================ */
import { api } from './api.js';

/**
 * Réponse de /api/auth/me.php (services/auth-api/auth/me.php).
 * @typedef {object} Visiteur
 * @property {false} logged_in
 *
 * @typedef {object} Membre
 * @property {true} logged_in
 * @property {number} id
 * @property {string} username
 * @property {string} email
 * @property {number} xp
 * @property {number} niveau
 * @property {boolean} isAdmin
 * @property {boolean} email_verifie
 *
 * @typedef {Visiteur | Membre} Moi
 */

class Session {
  /** @type {Promise<Moi> | null} */
  #demande = null;

  /**
   * Le compte connecté, ou `{ logged_in: false }`. Ne lève jamais : si le
   * serveur ne répond pas, le visiteur est traité comme non connecté. Les
   * éléments qui en dépendent (case Admin, rappel de confirmation) sont des
   * raccourcis d'affichage ; les droits sont vérifiés par les API.
   * @returns {Promise<Moi>}
   */
  moi() {
    if (!this.#demande) {
      this.#demande = api.auth.get('me.php').catch(() => ({ logged_in: false }));
    }
    return this.#demande;
  }

  /** À appeler après une connexion ou une déconnexion sans rechargement de page. */
  oublier() {
    this.#demande = null;
  }
}

export const session = new Session();
