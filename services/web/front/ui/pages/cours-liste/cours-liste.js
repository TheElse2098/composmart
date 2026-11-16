/* ============================================================================
   cours-liste.js — <cs-cours-liste> : la liste des cours, rangés par thème
   (page /cours).

   Chaque thème montre ses cours en tuiles colorées : la couleur vient du
   thème (réglée dans /admin/themes) et fonce d'un cours à l'autre. Un membre
   voit les cours qu'il a terminés et, en bas, sa progression ; un visiteur,
   une invitation à se connecter (tous les cours restent en accès libre). Un
   administrateur voit aussi les cours pas encore publiés, marqués.

   Usage :
     <cs-cours-liste></cs-cours-liste>
     <script type="module" src="/ui/pages/cours-liste/cours-liste.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

/**
 * @typedef {object} Cours
 * @property {string} slug
 * @property {string} titre
 * @property {string | null} emoji
 * @property {string} niveau        `debutant`, `intermediaire`, `expert`
 * @property {number | string} nb_questions  (la base le renvoie parfois en texte)
 * @property {string} statut        `publie` ; autre chose, vu des seuls administrateurs
 * @property {boolean} completed    terminé par le membre connecté
 *
 * @typedef {object} Theme
 * @property {string} nom
 * @property {string | null} emoji
 * @property {string | null} description
 * @property {string | null} couleur  `linear-gradient(135deg, #rrggbb, #rrggbb)`
 * @property {Cours[]} cours
 *
 * @typedef {object} Progression
 * @property {number} completed
 * @property {number} xp
 * @property {number} niveau
 *
 * @typedef {{ themes: Theme[], user: Progression | null }} Liste  /api/cours/list.php
 */

/** @type {Record<string, string>} */
const NIVEAUX = { debutant: 'Débutant', intermediaire: 'Intermédiaire', expert: 'Expert' };

/** Couleur d'un thème qui n'en a pas. */
const DEGRADE_PAR_DEFAUT = 'linear-gradient(135deg,#1e6e3e,#2d9959)';

/** XP qu'il faut pour passer un niveau. */
const XP_PAR_NIVEAU = 100;

/**
 * Une couleur « #rrggbb » assombrie : 1 la laisse telle quelle, 0,7 l'assombrit de 30 %.
 * @param {string} hex
 * @param {number} facteur
 */
export function assombrir(hex, facteur) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return '#' + [m[1], m[2], m[3]]
    .map((canal) => Math.max(0, Math.min(255, Math.round(parseInt(canal, 16) * facteur))).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * La couleur d'une tuile : celle du thème pour le premier cours, de plus en
 * plus sombre ensuite (−32 % par rang). Un dégradé qui n'a pas la forme
 * attendue est rendu tel quel.
 * @param {string | null} couleurTheme
 * @param {number} rang  0 pour le premier cours du thème
 */
export function degradeTuile(couleurTheme, rang) {
  const degrade = couleurTheme || DEGRADE_PAR_DEFAUT;
  const m = /linear-gradient\(([^,]+),\s*(#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i.exec(degrade);
  if (!m) return degrade;
  const facteur = Math.pow(0.68, rang);
  return 'linear-gradient(' + m[1] + ',' + assombrir(m[2], facteur) + ',' + assombrir(m[3], facteur) + ')';
}

export class CoursListe extends Composant {
  static balise = 'cs-cours-liste';
  static styles = [new URL('./cours-liste.css', import.meta.url)];

  async monter() {
    this.afficherChargement('Chargement des cours…');
    try {
      /** @type {Liste} */
      const d = await api.cours.get('list.php');
      this.rendre(this.gabarit(d));
      this.#colorer(d.themes);
      const barre = this.querySelector('.niveau-barre');
      if (barre instanceof HTMLElement) barre.style.width = barre.dataset.pourcent + '%';
    } catch (erreur) {
      console.error('<cs-cours-liste>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Erreur de chargement des cours.'));
    }
  }

  /**
   * La couleur de chaque tuile, posée après l'affichage : c'est une donnée de
   * la base, elle n'a rien à faire dans le HTML.
   * @param {Theme[]} themes
   */
  #colorer(themes) {
    const tuiles = this.tous('.cours-card');
    let i = 0;
    for (const theme of themes) {
      theme.cours.forEach((_c, rang) => { tuiles[i++].style.background = degradeTuile(theme.couleur, rang); });
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /** @param {Liste} d */
  gabarit(d) {
    return html`
      ${d.themes.length
        ? d.themes.map((t) => this.gabaritTheme(t, d.user !== null))
        : html`<p class="cs-etat">Aucun cours disponible.</p>`}
      ${d.user ? this.gabaritProgression(d.user) : this.gabaritInvitation()}`;
  }

  /**
   * @param {Theme} t
   * @param {boolean} membre  connecté : le badge dit combien de cours sont finis
   */
  gabaritTheme(t, membre) {
    const finis = t.cours.filter((c) => c.completed).length;
    return html`
      <div class="cat-section">
        <div class="cat-header">
          <div class="cat-icon">${t.emoji || '📂'}</div>
          <div class="cat-title">${t.nom}</div>
          ${membre && finis > 0
            ? html`<div class="cat-badge fini">${finis}/${t.cours.length} fini${finis > 1 && 's'}</div>`
            : html`<div class="cat-badge">${t.cours.length} cours</div>`}
        </div>
        ${t.description && html`<div class="cat-desc">${t.description}</div>`}
        <div class="cards-scroll">${t.cours.map((c) => this.gabaritCours(c))}</div>
      </div>`;
  }

  /** @param {Cours} c */
  gabaritCours(c) {
    const questions = Number(c.nb_questions) > 0 ? ' · ' + c.nb_questions + ' q.' : '';
    return html`
      <a href="/cours/${c.slug}" class="cours-card" data-slug="${c.slug}">
        ${c.completed && html`<div class="c-done">✓ fait</div>`}
        ${c.statut && c.statut !== 'publie' && html`<div class="c-brouillon">${c.statut}</div>`}
        <div class="c-emoji">${c.emoji || '📖'}</div>
        <div class="c-title">${c.titre}</div>
        <div class="c-level">${NIVEAUX[c.niveau] || c.niveau}${questions}</div>
      </a>`;
  }

  /** @param {Progression} u */
  gabaritProgression(u) {
    const dansNiveau = u.xp % XP_PAR_NIVEAU;
    return html`
      <div class="stats-box">
        <div class="stats-cell stats-cell-border"><div class="stats-val vert">${u.completed}</div><div class="stats-label">cours finis</div></div>
        <div class="stats-cell stats-cell-border"><div class="stats-val or">${u.xp}</div><div class="stats-label">XP gagnés</div></div>
        <div class="stats-cell"><div class="stats-val vert">Niv. ${u.niveau}</div><div class="stats-label">${dansNiveau} / ${XP_PAR_NIVEAU} XP</div></div>
      </div>
      <div class="niveau">
        <div class="niveau-piste"><div class="niveau-barre" data-pourcent="${Math.round(dansNiveau)}"></div></div>
        <span class="niveau-reste">Niveau ${u.niveau + 1} dans ${XP_PAR_NIVEAU - dansNiveau} XP</span>
      </div>`;
  }

  gabaritInvitation() {
    return html`
      <div class="login-invite">
        <div class="login-invite-emoji">🏆</div>
        <div class="login-invite-text">
          <div class="login-invite-title">Suis ta progression !</div>
          <div class="login-invite-sub">Tous les cours sont en accès libre. Connecte-toi pour sauvegarder ta progression et gagner de l'XP.</div>
        </div>
        <a href="/login" class="login-invite-btn">Se connecter</a>
      </div>`;
  }
}

CoursListe.definir();
