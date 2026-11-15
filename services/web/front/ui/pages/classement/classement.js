/* ============================================================================
   classement.js — <cs-classement> : la page /classement.

   Le classement des joueurs sur trois périodes (général, 7 jours, 24 h) :
   un podium pour les trois premiers, une liste ensuite, et la ligne du
   visiteur s'il est classé plus loin. Réservé aux membres : un visiteur non
   connecté reçoit une invitation à se connecter (le serveur répond 401).

   Usage :
     <cs-classement></cs-classement>
     <script type="module" src="/ui/pages/classement/classement.js"></script>
   ============================================================================ */
import { ErreurApi, api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

/**
 * Réponse de /api/auth/leaderboard.php (services/auth-api/auth/leaderboard.php).
 *
 * @typedef {object} Joueur
 * @property {number} id
 * @property {string} username
 * @property {number} xp      XP cumulée (général) ou gagnée sur la période
 * @property {number} niveau
 *
 * @typedef {Joueur & { rank: number }} MaPlace
 *
 * @typedef {object} ReponseClassement
 * @property {Joueur[]} top
 * @property {MaPlace | null} me       la place du visiteur, même hors du tableau
 * @property {boolean} [indisponible]  classement par période pas encore en service
 */

/** @typedef {'total' | 'semaine' | 'jour'} Periode */

/**
 * Libellés par période. En « général » on montre un cumul, sur une fenêtre
 * glissante on montre un gain : le dire évite de croire que l'XP totale d'un
 * joueur a fondu en changeant d'onglet.
 * @type {Record<Periode, { bouton: string, sous: string, suffixe: string, vide: string }>}
 */
const PERIODES = {
  total:   { bouton: '🏆 Général', sous: 'Les meilleurs composteurs de la communauté', suffixe: 'XP',        vide: "Aucun joueur classé pour l'instant." },
  semaine: { bouton: '📅 7 jours', sous: 'XP gagnée au cours des 7 derniers jours',    suffixe: 'XP gagnés', vide: "Personne n'a gagné d'XP cette semaine." },
  jour:    { bouton: '⚡ 24 h',    sous: 'XP gagnée au cours des dernières 24 heures', suffixe: 'XP gagnés', vide: "Personne n'a gagné d'XP aujourd'hui." },
};

const MEDAILLES = ['🥇', '🥈', '🥉'];

/**
 * @param {string | undefined} valeur
 * @returns {valeur is Periode}
 */
function estPeriode(valeur) {
  return valeur === 'total' || valeur === 'semaine' || valeur === 'jour';
}

/** @param {string} nom */
function initiale(nom) {
  return (nom || '?').charAt(0).toUpperCase();
}

export class Classement extends Composant {
  static balise = 'cs-classement';
  static styles = [new URL('./classement.css', import.meta.url)];

  /** @type {Periode} */
  #periode = 'total';

  /** Numéro de la dernière demande envoyée. Une réponse qui arrive après un
   *  changement de période porte un numéro dépassé : elle est ignorée, au
   *  lieu d'afficher le tableau d'une période sous le bouton d'une autre. */
  #demande = 0;

  async monter() {
    this.rendre(this.gabaritCadre(this.#periode));
    this.ecouter('click', '[data-periode]', (bouton) => this.#choisir(bouton.dataset.periode));
    await this.#charger();
  }

  /** @param {string | undefined} periode */
  #choisir(periode) {
    if (!estPeriode(periode) || periode === this.#periode) return;
    this.#periode = periode;
    for (const bouton of this.tous('[data-periode]')) {
      bouton.classList.toggle('active', bouton.dataset.periode === periode);
    }
    this.#charger();
  }

  async #charger() {
    const numero = ++this.#demande;
    const periode = this.#periode;
    const tableau = this.trouver('.board');

    this.trouver('.hero-sub').textContent = PERIODES[periode].sous;
    this.rendre(html`<div class="lb-empty">Chargement…</div>`, tableau);

    try {
      /** @type {ReponseClassement} */
      const reponse = await api.auth.get('leaderboard.php', { periode });
      if (numero !== this.#demande) return;
      this.rendre(this.gabaritTableau(reponse, periode), tableau);
    } catch (erreur) {
      if (numero !== this.#demande) return;
      if (erreur instanceof ErreurApi && erreur.statut === 401) {
        this.#inviter();
        return;
      }
      console.error('<cs-classement>', erreur);
      const message = texteErreur(erreur, "Le classement n'a pas pu être chargé. Réessaie dans un instant.");
      this.rendre(html`<div class="lb-empty">${message}</div>`, tableau);
    }
  }

  /** Visiteur non connecté : le sélecteur de période n'a plus d'objet, on le
   *  masque et on remplace le tableau par une invitation à se connecter. */
  #inviter() {
    this.trouver('.hero-sub').textContent = 'Connecte-toi pour découvrir le classement de la communauté';
    this.trouver('.periode-wrap').hidden = true;
    this.rendre(this.gabaritInvitation(), this.trouver('.board'));
  }

  // ── Gabarits : des données vers du HTML, sans rien lire d'autre ───────────

  /**
   * Ce qui ne change pas : en-tête, sélecteur de période, zone du tableau.
   * @param {Periode} periode période sélectionnée à l'ouverture
   */
  gabaritCadre(periode) {
    return html`
      <header class="hero">
        <div class="hero-inner">
          <h1>🏆 Classement</h1>
          <p class="hero-sub">${PERIODES[periode].sous}</p>
        </div>
      </header>

      <div class="periode-wrap">
        <div class="periode-switch">
          ${Object.entries(PERIODES).map(([cle, p]) => html`
            <button type="button" class="per-btn${cle === periode ? ' active' : ''}" data-periode="${cle}">${p.bouton}</button>`)}
        </div>
      </div>

      <main class="board"></main>`;
  }

  /**
   * @param {ReponseClassement} reponse
   * @param {Periode} periode
   */
  gabaritTableau(reponse, periode) {
    const { suffixe, vide } = PERIODES[periode];
    const top = reponse.top || [];
    const moi = reponse.me || null;

    if (reponse.indisponible) {
      return html`<div class="lb-empty">Le classement par période n'est pas encore disponible.</div>`;
    }
    if (!top.length) return html`<div class="lb-empty">${vide}</div>`;

    /** @param {Joueur} joueur */
    const estMoi = (joueur) => moi !== null && joueur.id === moi.id;

    // Podium : les trois premiers, le vainqueur au centre et surélevé. En
    // dessous de trois joueurs, pas de podium : tout le monde est en liste.
    const podium = top.length >= 3 ? top.slice(0, 3) : [];
    const reste = podium.length ? top.slice(3) : top;
    const premierRang = podium.length ? 4 : 1;

    return html`
      ${podium.length > 0 && html`
        <div class="podium">
          ${[1, 0, 2].map((i) => html`
            <div class="pod pod-${i + 1}${estMoi(podium[i]) ? ' is-me' : ''}">
              <div class="pod-medal">${MEDAILLES[i]}</div>
              <div class="pod-ava">${initiale(podium[i].username)}</div>
              <div class="pod-name">${podium[i].username}</div>
              <div class="pod-xp">${podium[i].xp} ${suffixe}</div>
            </div>`)}
        </div>`}

      ${reste.length > 0 && html`
        <div class="lb-list">
          ${reste.map((joueur, i) => this.gabaritLigne(joueur, premierRang + i, estMoi(joueur), suffixe))}
        </div>`}

      ${moi !== null && !top.some(estMoi) && html`
        <div class="lb-sep">···</div>
        <div class="lb-list">${this.gabaritLigne(moi, moi.rank, true, suffixe)}</div>`}`;
  }

  /**
   * @param {Joueur} joueur
   * @param {number} rang
   * @param {boolean} estMoi
   * @param {string} suffixe
   */
  gabaritLigne(joueur, rang, estMoi, suffixe) {
    return html`
      <div class="lb-row${estMoi ? ' lb-me' : ''}">
        <div class="lb-rank">#${rang}</div>
        <div class="lb-ava">${initiale(joueur.username)}</div>
        <div class="lb-name">${joueur.username}${estMoi && html`<span class="lb-me-tag">moi</span>`}
          <div class="lb-lvl">Niveau ${joueur.niveau}</div>
        </div>
        <div class="lb-xp">${joueur.xp} ${suffixe}</div>
      </div>`;
  }

  gabaritInvitation() {
    return html`
      <div class="join-cta">
        <div class="cta-cadenas">🔒</div>
        <p>Le classement est réservé aux membres. Connecte-toi pour voir les meilleurs composteurs — et y figurer à ton tour !</p>
        <a href="/login" class="btn-primary">Se connecter</a>
        <div class="cta-inscription"><a href="/signin">Pas encore de compte ? Créer un compte</a></div>
      </div>`;
  }
}

Classement.definir();
