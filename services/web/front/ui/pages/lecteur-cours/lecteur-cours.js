/* ============================================================================
   lecteur-cours.js — <cs-lecteur-cours> : la lecture d'un cours (/cours/<slug>).

   En-tête du cours, puis quatre onglets :
     - Cours : le texte, découpé en sections sur ses titres « ## », une par
       diapositive ; la dernière mène au quiz, ou termine le cours s'il n'y en
       a pas ;
     - Vidéo et Podcast : seulement si le cours en a ;
     - Quiz : grisé si le cours n'en a pas (il fait partie du parcours
       attendu, son absence est l'exception).

   Les cours sont en accès libre : seule la sauvegarde de la progression
   demande d'être connecté (cf. fin-cours.js). Un administrateur peut aussi
   lire un brouillon, que get.php refuse à tout autre.

   Usage :
     <cs-lecteur-cours></cs-lecteur-cours>
     <script type="module" src="/ui/pages/lecteur-cours/lecteur-cours.js"></script>
   ============================================================================ */
import { api, ErreurApi } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { chargerMoteur, finaliser, markdownEnHtml } from '../../socle/markdown.js';
import { html } from '../../socle/outils.js';
import { session } from '../../socle/session.js';
import '../../composants/video/video.js';
import { FinCours } from './fin-cours.js';
import { QuizCours } from './quiz-cours.js';

/**
 * Réponse de /api/cours/get.php.
 * @typedef {object} Media
 * @property {string} url
 * @property {string} [titre]
 * @property {string} [auteur]
 * @property {string} [duree]
 * @property {string} [description]
 *
 * @typedef {object} CoursComplet
 * @property {string} slug
 * @property {{ titre?: string, emoji?: string | null, niveau?: string, xp?: number }} meta
 * @property {string} [texte]  markdown
 * @property {import('./quiz-cours.js').Question[]} [quiz]
 * @property {Media} [video]
 * @property {Media} [podcast]
 *
 * @typedef {{ titre: string, contenu: string }} Section  une diapositive du cours
 */

/** @type {Record<string, string>} */
const NIVEAUX = { debutant: '🌿 Débutant', intermediaire: '🌿 Intermédiaire', expert: '🔥 Expert' };

/**
 * Le cours demandé par l'adresse : `/cours/<slug>`.
 * @param {string} chemin
 * @returns {string}  vide si l'adresse ne désigne pas un cours
 */
export function slugDe(chemin) {
  const m = /^\/cours\/([^/]+)\/?$/.exec(chemin);
  return m ? m[1] : '';
}

/**
 * Découpe le texte d'un cours en sections, sur ses titres « ## ». Ce qui
 * précède le premier « ## » forme une section sans titre, débarrassée du
 * titre principal « # » (déjà affiché dans l'en-tête). Une section sans
 * contenu est ignorée.
 * @param {string} texte
 * @returns {Section[]}
 */
export function decouper(texte) {
  /** @type {Section[]} */
  const sections = [];
  for (const morceau of texte.split(/(?=^## )/m)) {
    const bloc = morceau.trim();
    if (!bloc) continue;
    if (bloc.startsWith('## ')) {
      const lignes = bloc.split('\n');
      const contenu = lignes.slice(1).join('\n').trim();
      if (contenu) sections.push({ titre: lignes[0].slice(3).trim(), contenu });
    } else {
      const contenu = bloc.replace(/^# .+\n?/, '').trim();
      if (contenu) sections.push({ titre: '', contenu });
    }
  }
  return sections;
}

/**
 * Remplissage de la barre de progression à la section `i` (0 pour la première).
 * @param {number} i
 * @param {number} total
 */
export function progressionSection(i, total) {
  return total <= 1 ? 100 : Math.round(i / (total - 1) * 100);
}

export class LecteurCours extends Composant {
  static balise = 'cs-lecteur-cours';
  static styles = [new URL('./lecteur-cours.css', import.meta.url)];

  /** @type {Section[]} */
  #sections = [];
  #section = 0;
  #termine = false;
  /** @type {import('./fin-cours.js').ContexteCours | null} */
  #contexte = null;

  async monter() {
    this.ecouter('click', '[data-onglet]', (bouton) => this.#ouvrir(bouton.dataset.onglet || ''));
    this.ecouter('click', '[data-action="suivante"]', () => this.#allerA(this.#section + 1));
    this.ecouter('click', '[data-action="precedente"]', () => this.#allerA(this.#section - 1));
    this.ecouter('click', '[data-action="quiz"]', () => this.#ouvrir('quiz'));
    this.ecouter('click', '[data-action="terminer"]', () => this.#terminer());

    const slug = slugDe(location.pathname);
    if (!slug) {
      this.rendre(this.gabaritIntrouvable(true));
      return;
    }

    this.afficherChargement('Chargement du cours…');
    /** @type {CoursComplet} */
    let cours;
    /** @type {import('../../socle/session.js').Moi} */
    let moi;
    try {
      [cours, moi] = await Promise.all([api.cours.get('get.php', { slug }), session.moi(), chargerMoteur()]);
    } catch (erreur) {
      console.error('<cs-lecteur-cours>', erreur);
      const absent = erreur instanceof ErreurApi && (erreur.statut === 404 || erreur.statut === 400);
      this.rendre(this.gabaritIntrouvable(absent));
      return;
    }

    this.#contexte = { slug, membre: moi.logged_in, xp: moi.logged_in ? Number(moi.xp) || 0 : 0 };
    this.#sections = cours.texte ? decouper(cours.texte) : [];
    const quiz = Array.isArray(cours.quiz) && cours.quiz.length ? cours.quiz : null;
    document.title = 'CompoSmart – ' + (cours.meta.titre || slug);

    this.rendre(this.gabarit(cours, this.#sections, quiz !== null));
    // Après insertion : les formules se rendent sur des nœuds réels.
    for (const corps of this.tous('.lesson-body')) finaliser(corps);
    this.#montrerProgression();
    if (quiz) this.trouver('cs-quiz-cours', QuizCours).configurer(this.#contexte, quiz);
  }

  /** @param {string} onglet */
  #ouvrir(onglet) {
    const panneau = this.tous('[data-panneau]').find((p) => p.dataset.panneau === onglet);
    if (!panneau) return; // onglet grisé : pas de quiz pour ce cours
    for (const p of this.tous('[data-panneau]')) p.classList.toggle('active', p === panneau);
    for (const b of this.tous('[data-onglet]')) b.classList.toggle('active', b.dataset.onglet === onglet);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** @param {number} cible */
  #allerA(cible) {
    if (cible < 0 || cible >= this.#sections.length) return;
    this.#section = cible;
    for (const diapo of this.tous('[data-section]')) diapo.classList.toggle('active', Number(diapo.dataset.section) === cible);
    this.#montrerProgression();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  #montrerProgression() {
    const total = this.#sections.length;
    this.trouver('.lecon-progression .progress-fill').style.width = progressionSection(this.#section, total) + '%';
    this.trouver('.lecon-progression .progress-label').textContent = total > 0 ? 'Section ' + (this.#section + 1) + ' / ' + total : '';
  }

  /** Cours sans quiz : la dernière section le termine. */
  #terminer() {
    if (this.#termine || !this.#contexte) return;
    this.#termine = true;
    this.trouver('cs-fin-cours', FinCours).enregistrer(this.#contexte, []);
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /**
   * @param {CoursComplet} cours
   * @param {Section[]} sections
   * @param {boolean} aQuiz
   */
  gabarit(cours, sections, aQuiz) {
    const meta = cours.meta;
    const xp = Number(meta.xp) || 0;
    return html`
      <div class="course-header">
        <div class="course-hero">
          <div class="course-emoji-big">${meta.emoji || '📖'}</div>
          <div class="course-meta">
            <h1 class="course-title-main">${meta.titre || cours.slug}</h1>
            <div class="course-badges">
              ${meta.niveau && html`<span class="badge badge-niveau">${NIVEAUX[meta.niveau] || meta.niveau}</span>`}
              ${xp > 0 && html`<span class="badge badge-xp">+${xp} XP</span>`}
            </div>
          </div>
        </div>
      </div>

      <div class="tabs-wrap">
        <div class="tabs-nav">
          <button type="button" class="tab-btn active" data-onglet="cours">📖 Cours</button>
          ${cours.video && html`<button type="button" class="tab-btn" data-onglet="video">▶️ Vidéo</button>`}
          ${cours.podcast && html`<button type="button" class="tab-btn" data-onglet="podcast">🎧 Podcast</button>`}
          ${aQuiz
            ? html`<button type="button" class="tab-btn" data-onglet="quiz">🧠 Quiz</button>`
            : html`<button type="button" class="tab-btn disabled" data-onglet="quiz" aria-disabled="true" title="Pas de quiz pour ce cours">🧠 Quiz</button>`}
        </div>
      </div>

      <div class="page-content">
        <div class="tab-panel active" data-panneau="cours">
          <div class="progress-wrap lecon-progression">
            <div class="progress-info"><span class="progress-label"></span></div>
            <div class="progress-bar"><div class="progress-fill"></div></div>
          </div>
          ${sections.map((s, i) => this.gabaritSection(s, i, sections.length, aQuiz))}
        </div>
        ${cours.video && html`<div class="tab-panel" data-panneau="video">${this.gabaritMedia(cours.video, html`<div class="video-wrapper"><cs-video adresse="${cours.video.url}"></cs-video></div>`)}</div>`}
        ${cours.podcast && html`<div class="tab-panel" data-panneau="podcast">${this.gabaritMedia(cours.podcast, html`<div class="podcast-inner"><audio controls src="${cours.podcast.url}"></audio></div>`)}</div>`}
        ${aQuiz && html`<div class="tab-panel" data-panneau="quiz"><cs-quiz-cours></cs-quiz-cours></div>`}
      </div>`;
  }

  /**
   * @param {Section} s
   * @param {number} i
   * @param {number} total
   * @param {boolean} aQuiz
   */
  gabaritSection(s, i, total, aQuiz) {
    const derniere = i === total - 1;
    return html`
      <div class="lesson-slide${i === 0 && ' active'}" data-section="${i}">
        <div class="lesson-card">
          ${s.titre && html`<h2 class="lesson-title">${s.titre}</h2>`}
          <div class="lesson-body">${markdownEnHtml(s.contenu)}</div>
        </div>
        <div class="lesson-nav">
          ${i > 0 && html`<button type="button" class="btn-prev" data-action="precedente" aria-label="Section précédente">← Précédent</button>`}
          ${!derniere
            ? html`<button type="button" class="btn-next" data-action="suivante">Continuer ➜</button>`
            : aQuiz
              ? html`<button type="button" class="btn-next" data-action="quiz">Faire le quiz 🧠</button>`
              : html`<button type="button" class="btn-next" data-action="terminer">Terminer le cours ✓</button>`}
        </div>
        ${derniere && !aQuiz && html`<cs-fin-cours encadre></cs-fin-cours>`}
      </div>`;
  }

  /**
   * Carte d'une vidéo ou d'un podcast. Titre, auteur et durée ne s'affichent
   * que s'ils sont renseignés : un podcast déposé tel quel n'en a pas.
   * @param {Media} m
   * @param {import('../../socle/outils.js').Html} lecteur
   */
  gabaritMedia(m, lecteur) {
    return html`
      <div class="media-card">
        ${m.titre && html`<div class="media-title">${m.titre}</div>`}
        ${m.auteur && html`<div class="media-author">par ${m.auteur}</div>`}
        ${m.duree && html`<span class="media-duration">⏱ ${m.duree}</span>`}
        ${m.description && html`<div class="media-desc">${m.description}</div>`}
        ${lecteur}
      </div>`;
  }

  /** @param {boolean} absent  le cours n'existe pas (sinon : panne) */
  gabaritIntrouvable(absent) {
    return html`
      <div class="introuvable" role="alert">
        <h1>${absent ? 'Cours introuvable' : "Ce cours n'a pas pu être chargé"}</h1>
        <a href="/cours">← Retour aux cours</a>
      </div>`;
  }
}

LecteurCours.definir();
