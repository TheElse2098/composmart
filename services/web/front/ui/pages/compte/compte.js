/* ============================================================================
   compte.js — <cs-compte> : la page « Mon compte » (/compte).

   Pour un membre : l'en-tête à son nom avec sa barre de niveau, quatre
   chiffres, puis deux colonnes — sa progression (courbe d'XP, cours terminés,
   ses signalements) et ce qui le concerne (son compte, ses badges, ses
   records de jeux). Pour un visiteur : une invitation à se connecter.

   Les parties qui ont leur propre comportement sont des composants à part :
     compte-tickets.js    « Mes signalements » et leur discussion
     compte-reglages.js   « Mon compte » : email, confirmation, export
     compte-sortie.js     déconnexion, suppression du compte
   Le reste n'est que de l'affichage et tient dans ce fichier.

   Deux services répondent, chacun ne connaissant que sa base : auth-api (le
   profil) et games-api (les jeux). Sans le second, la page s'affiche avec ce
   qu'elle a ; les deux badges de jeu restent verrouillés.

   Usage :
     <cs-compte></cs-compte>
     <script type="module" src="/ui/pages/compte/compte.js"></script>
   ============================================================================ */
import { CourbeXp } from '../../composants/courbe-xp/courbe-xp.js';
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html, jourCourt, moisAnnee, pluriel } from '../../socle/outils.js';
import { CompteReglages } from './compte-reglages.js';
import { CompteSortie } from './compte-sortie.js';
import './compte-tickets.js';

/**
 * @typedef {object} Badge
 * @property {string} emoji
 * @property {string} label
 * @property {string} desc
 * @property {boolean} unlocked
 *
 * @typedef {object} Profil  /api/auth/profile.php, pour un membre
 * @property {true} logged_in
 * @property {string} username
 * @property {string | null} email
 * @property {boolean} email_verifie
 * @property {number} xp
 * @property {number} niveau
 * @property {boolean} isAdmin
 * @property {string} membre_depuis
 * @property {number} rank  place au classement général
 * @property {{ done: number, total: number, liste: { slug: string, titre: string, emoji: string, completed_at: string }[] }} cours
 * @property {Badge[]} badges  ceux que auth-api sait calculer (cours, niveau)
 * @property {import('../../composants/courbe-xp/courbe-xp.js').Gain[]} xp_history
 *
 * @typedef {object} Jeu  un jeu, dans /api/jeux/score.php?action=profile
 * @property {string} slug
 * @property {string} nom
 * @property {string} emoji
 * @property {number} max
 * @property {number | null} best  `null` : jamais joué
 * @property {number} parties
 *
 * @typedef {{ records: Jeu[], parties: number }} Jeux
 */

/** XP qu'il faut pour passer un niveau. */
const XP_PAR_NIVEAU = 100;

/** « 1er », « 2e », « 14e ». @param {number} n */
export function ordinal(n) {
  return n === 1 ? '1er' : n + 'e';
}

/**
 * Tous les badges, dans l'ordre d'affichage. Les deux badges de jeu ne
 * peuvent être calculés que par cette page, seule à connaître à la fois le
 * profil (auth-api) et les jeux (games-api) ; ils prennent place après les
 * deux badges de cours.
 * @param {Badge[]} badges  ceux du profil
 * @param {Jeux | null} jeux  `null` : le service des jeux n'a pas répondu
 * @returns {Badge[]}
 */
export function tousLesBadges(badges, jeux) {
  const records = jeux ? jeux.records : [];
  const essayes = records.filter((r) => r.best !== null).length;
  const complets = [...badges];
  complets.splice(2, 0,
    { emoji: '🎮', label: 'Joueur', desc: 'Jouer à un mini-jeu', unlocked: !!jeux && jeux.parties >= 1 },
    { emoji: '🏆', label: 'Touche-à-tout', desc: 'Essayer tous les jeux', unlocked: records.length > 0 && essayes >= records.length });
  return complets;
}

export class Compte extends Composant {
  static balise = 'cs-compte';
  static styles = [new URL('./compte.css', import.meta.url)];

  async monter() {
    // L'en-tête s'affiche tout de suite, à son état neutre, pendant le chargement.
    this.rendre(this.gabaritCadre());
    try {
      const [profil, jeux] = await Promise.all([
        /** @type {Promise<Profil | { logged_in: false }>} */ (api.auth.get('profile.php')),
        /** @type {Promise<Jeux | null>} */ (api.jeux.get('score.php', { action: 'profile' }).catch((erreur) => {
          console.error('<cs-compte>', erreur);
          return null;
        })),
      ]);
      if (profil.logged_in) this.#montrerMembre(profil, jeux);
      else this.#montrerVisiteur();
    } catch (erreur) {
      console.error('<cs-compte>', erreur);
      this.afficherErreur(texteErreur(erreur, "Ton compte n'a pas pu être chargé."), this.trouver('.col-main'));
    }
  }

  /**
   * @param {Profil} u
   * @param {Jeux | null} jeux
   */
  #montrerMembre(u, jeux) {
    const badges = tousLesBadges(u.badges, jeux);

    this.trouver('.avatar').textContent = u.username.charAt(0).toUpperCase();
    this.trouver('h1').textContent = 'Bonjour, ' + u.username + ' !';
    this.trouver('.hero-sub').textContent = 'Niveau ' + u.niveau + ' · membre depuis ' + moisAnnee(u.membre_depuis);
    this.rendre(this.gabaritNiveau(u), this.trouver('[data-zone="niveau"]'));
    // La largeur de la barre est une donnée : elle se pose ici, pas dans une feuille de style.
    this.trouver('.hero-xp-fill').style.width = Math.min(100, Math.round(u.xp % XP_PAR_NIVEAU)) + '%';

    const chiffres = this.trouver('.stats');
    chiffres.hidden = false;
    this.rendre(this.gabaritChiffres(u, jeux, badges), chiffres);
    this.rendre(this.gabaritProgression(u), this.trouver('.col-main'));
    this.rendre(this.gabaritIdentite(badges, jeux), this.trouver('.col-side'));
    this.rendre(html`<cs-compte-sortie></cs-compte-sortie>`, this.trouver('[data-zone="sortie"]'));

    this.trouver('cs-courbe-xp', CourbeXp).montrer(u.xp_history || [],
      'Pas encore assez de données pour tracer une courbe. Termine un cours ou joue à un mini-jeu !');
    this.trouver('cs-compte-reglages', CompteReglages).configurer(u);
    this.trouver('cs-compte-sortie', CompteSortie).configurer(u.username);
  }

  /** Pas de chiffres ni de colonnes pour un visiteur : une seule carte. */
  #montrerVisiteur() {
    this.trouver('.avatar').textContent = '🌱';
    this.trouver('.hero-sub').textContent = 'Rejoins la communauté Composmart';
    this.trouver('.profil-layout').classList.add('guest');
    this.trouver('.col-side').hidden = true;
    this.rendre(this.gabaritVisiteur(), this.trouver('.col-main'));
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabaritCadre() {
    return html`
      <header class="hero">
        <div class="hero-inner">
          <div class="avatar">👤</div>
          <h1>Mon compte</h1>
          <p class="hero-sub"></p>
          <div data-zone="niveau"></div>
        </div>
      </header>

      <div class="stats" hidden></div>

      <main class="profil-layout">
        <div class="col-main"></div>
        <aside class="col-side"></aside>
      </main>

      <div class="logout-wrap" data-zone="sortie"></div>`;
  }

  /** La barre de niveau, et la place au classement (les administrateurs n'y figurent pas).
   *  @param {Profil} u */
  gabaritNiveau(u) {
    return html`
      <div class="hero-xp">
        <div class="hero-xp-track"><div class="hero-xp-fill"></div></div>
        <div class="hero-xp-label">${u.xp % XP_PAR_NIVEAU} / ${XP_PAR_NIVEAU} XP pour le niveau ${u.niveau + 1}</div>
      </div>
      ${!u.isAdmin && html`<a href="/classement" class="hero-chip">🏆 ${ordinal(u.rank)} au classement général</a>`}`;
  }

  /**
   * Le niveau est déjà dans l'en-tête : pas de doublon ici.
   * @param {Profil} u
   * @param {Jeux | null} jeux
   * @param {Badge[]} badges
   */
  gabaritChiffres(u, jeux, badges) {
    const chiffres = [
      { n: u.xp, libelle: 'XP total' },
      { n: u.cours.done, libelle: 'Cours terminés' },
      { n: jeux ? jeux.parties : '—', libelle: 'Parties jouées' },
      { n: badges.filter((b) => b.unlocked).length, libelle: 'Badges obtenus' },
    ];
    return html`${chiffres.map((c) => html`<div class="stat"><div class="stat-num">${c.n}</div><div class="stat-label">${c.libelle}</div></div>`)}`;
  }

  /** Colonne principale : la progression. @param {Profil} u */
  gabaritProgression(u) {
    return html`
      <section class="panel">
        <div class="panel-head">📈 Progression de l'XP</div>
        <cs-courbe-xp></cs-courbe-xp>
      </section>
      <section class="panel">
        <div class="panel-head">📚 Cours terminés <span class="panel-count">${u.cours.done} / ${u.cours.total}</span></div>
        ${u.cours.liste.length
          ? html`<div class="history-list">${u.cours.liste.map((c) => html`
              <a href="/cours/${c.slug}" class="history-row">
                <span class="history-emoji">${c.emoji}</span>
                <span class="history-title">${c.titre}</span>
                <span class="history-date">${jourCourt(c.completed_at)}</span>
              </a>`)}</div>`
          : html`<div class="course-empty">Aucun cours terminé pour l'instant. <a href="/cours">Commence ici !</a></div>`}
      </section>
      <cs-compte-tickets hidden></cs-compte-tickets>`;
  }

  /**
   * Colonne d'appoint : le compte, les badges, les records.
   * @param {Badge[]} badges
   * @param {Jeux | null} jeux
   */
  gabaritIdentite(badges, jeux) {
    return html`
      <cs-compte-reglages></cs-compte-reglages>
      <section class="panel">
        <div class="panel-head">🎖️ Badges <span class="panel-count">${badges.filter((b) => b.unlocked).length} / ${badges.length}</span></div>
        <div class="badge-grid">
          ${badges.map((b) => html`
            <div class="badge${!b.unlocked && ' locked'}" title="${b.desc}">
              <div class="badge-emoji">${b.emoji}</div>
              <div class="badge-label">${b.label}</div>
              <div class="badge-desc">${b.desc}</div>
            </div>`)}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">🎮 Records de jeux</div>
        ${jeux ? jeux.records.map((r) => this.gabaritRecord(r)) : html`<div class="course-empty">Records indisponibles pour le moment.</div>`}
      </section>`;
  }

  /** @param {Jeu} r */
  gabaritRecord(r) {
    return html`
      <a href="/jeu-${r.slug}" class="game-row">
        <div class="game-row-emoji">${r.emoji}</div>
        <div class="game-row-info">
          <div class="game-row-name">${r.nom}</div>
          <div class="game-row-sub">${r.parties > 0 ? pluriel(r.parties, 'partie jouée', 'parties jouées') : 'Pas encore joué'}</div>
        </div>
        ${r.best !== null
          ? html`<div class="game-row-best">🏆 ${r.best} / ${r.max}</div>`
          : html`<div class="game-row-best none">Jouer →</div>`}
      </a>`;
  }

  gabaritVisiteur() {
    return html`
      <section class="panel">
        <div class="guest-title">Bienvenue !</div>
        <div class="guest-sub">Connecte-toi pour suivre ta progression, gagner de l'XP et débloquer des badges.</div>
        <a href="/signin" class="btn btn-primary">Créer un compte</a>
        <a href="/login" class="btn btn-secondary">Se connecter</a>
      </section>`;
  }
}

Compte.definir();
