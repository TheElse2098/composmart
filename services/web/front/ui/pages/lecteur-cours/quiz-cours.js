/* ============================================================================
   quiz-cours.js — <cs-quiz-cours> : le quiz de fin de cours.

   Une question à la fois, en deux temps : on choisit (réversible), puis on
   valide ; la correction ne s'affiche qu'à la validation. Une question peut
   avoir plusieurs bonnes réponses : chaque option se coche alors à part, et
   la question rapporte un crédit partiel. Les options sont mélangées à chaque
   partie ; le serveur, lui, reçoit toujours les index d'origine.

   La note suit exactement la règle de complete.php, qui revalide tout côté
   serveur : le score affiché ne contredit jamais l'XP accordée.

   Les classes communes (diapositive, barre de progression, boutons) sont
   celles du lecteur, qui contient toujours le quiz (lecteur-cours.css).

   Usage :
     <cs-quiz-cours></cs-quiz-cours>
     this.trouver('cs-quiz-cours', QuizCours).configurer(contexte, questions);
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { FinCours } from './fin-cours.js';

/**
 * Une question, telle que l'éditeur l'enregistre.
 * @typedef {object} Question
 * @property {string} question
 * @property {string[]} options
 * @property {number | number[]} correct  index de la bonne option ; tableau d'index si `multiple`
 * @property {boolean} [multiple]
 *
 * @typedef {number | number[]} Reponse  index d'origine de l'option choisie, ou des options cochées
 *
 * @typedef {object} Correction
 * @property {number} credit   entre 0 et 1
 * @property {number} vrais    bonnes options choisies
 * @property {number[]} bonnes index des bonnes options
 *
 * @typedef {object} Note
 * @property {number} score    somme des crédits, arrondie au centième (comme le serveur)
 * @property {number} total
 * @property {number} pourcent
 * @property {boolean} reussi  50 % au moins
 * @property {boolean} parfait
 */

/** Seuil de réussite, celui de complete.php. */
const SEUIL = 0.5;
const COULEURS_CONFETTIS = ['#1e6e3e', '#52b788', '#a7c957', '#f9a825', '#fff'];

/**
 * Les index 0…n-1 dans un ordre aléatoire (Fisher-Yates).
 * @param {number} n
 * @param {() => number} [aleatoire]
 * @returns {number[]}
 */
export function ordreMelange(n, aleatoire = Math.random) {
  const ordre = Array.from({ length: n }, (_v, i) => i);
  for (let j = n - 1; j > 0; j--) {
    const r = Math.floor(aleatoire() * (j + 1));
    [ordre[j], ordre[r]] = [ordre[r], ordre[j]];
  }
  return ordre;
}

/**
 * Question à plusieurs bonnes réponses : même critère que complete.php, qui
 * exige les deux. Une question mal formée est ainsi traitée de la même façon
 * des deux côtés.
 * @param {Question} q
 */
export function estMultiple(q) {
  return !!q.multiple && Array.isArray(q.correct);
}

/**
 * Corrige une réponse. Réponse unique : 1 ou 0. Réponses multiples : 1/n par
 * bonne option cochée, −1/n par mauvaise (n = nombre de bonnes réponses),
 * borné à [0, 1] — la formule de complete.php.
 * @param {Question} q
 * @param {Reponse} reponse
 * @returns {Correction}
 */
export function corriger(q, reponse) {
  if (estMultiple(q)) {
    const bonnes = /** @type {number[]} */ (q.correct).map(Number);
    const choisies = Array.isArray(reponse) ? reponse : [reponse];
    const vrais = choisies.filter((o) => bonnes.includes(o)).length;
    const faux = choisies.length - vrais;
    const credit = bonnes.length ? Math.max(0, Math.min(1, (vrais - faux) / bonnes.length)) : 0;
    return { credit, vrais, bonnes };
  }
  const bonne = Number(q.correct);
  const juste = reponse === bonne;
  return { credit: juste ? 1 : 0, vrais: juste ? 1 : 0, bonnes: [bonne] };
}

/**
 * @param {number[]} credits  un par question
 * @returns {Note}
 */
export function noter(credits) {
  const total = credits.length;
  const score = Math.round(credits.reduce((a, b) => a + b, 0) * 100) / 100;
  return {
    score,
    total,
    pourcent: total ? Math.round(score / total * 100) : 0,
    reussi: total > 0 && score / total >= SEUIL,
    parfait: total > 0 && score >= total,
  };
}

/**
 * Remplissage de la barre de progression à la question `i` (0 pour la première).
 * @param {number} i
 * @param {number} total
 */
export function progression(i, total) {
  return total <= 1 ? 50 : Math.round(i / total * 100);
}

export class QuizCours extends Composant {
  static balise = 'cs-quiz-cours';
  static styles = [new URL('./quiz-cours.css', import.meta.url)];

  /** @type {import('./fin-cours.js').ContexteCours | null} */
  #contexte = null;
  /** @type {Question[]} */
  #questions = [];
  /** Ordre d'affichage des options, par question. @type {number[][]} */
  #ordres = [];
  #courante = 0;
  /** Sélection en cours, avant validation. @type {Reponse | undefined} */
  #choix = undefined;
  /** Réponses validées, figées. @type {Reponse[]} */
  #reponses = [];
  /** @type {number[]} */
  #credits = [];

  monter() {
    this.ecouter('click', '.quiz-opt', (option) => this.#choisir(option));
    this.ecouter('click', '[data-action="valider"]', () => this.#valider());
    this.ecouter('click', '[data-action="suivante"]', () => this.#montrerQuestion(this.#courante + 1));
    this.ecouter('click', '[data-action="resultat"]', () => this.#montrerResultat());
    this.ecouter('click', '[data-action="recommencer"]', () => {
      this.#commencer();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /**
   * @param {import('./fin-cours.js').ContexteCours} contexte
   * @param {Question[]} questions
   */
  configurer(contexte, questions) {
    this.apresMontage(() => {
      this.#contexte = contexte;
      this.#questions = questions;
      this.#commencer();
    });
  }

  #commencer() {
    this.#ordres = this.#questions.map((q) => ordreMelange(q.options.length));
    this.#reponses = [];
    this.#credits = [];
    this.rendre(html`
      <div class="progress-wrap">
        <div class="progress-info"><span class="progress-label"></span></div>
        <div class="progress-bar"><div class="progress-fill"></div></div>
      </div>
      <div class="quiz-zone"></div>
      <div class="confettis" aria-hidden="true"></div>`);
    this.#montrerQuestion(0, false);
  }

  /**
   * @param {number} i
   * @param {boolean} [remonter]  ramener la page en haut
   */
  #montrerQuestion(i, remonter = true) {
    if (i >= this.#questions.length) return;
    this.#courante = i;
    this.#choix = undefined;
    const total = this.#questions.length;
    this.trouver('.progress-fill').style.width = progression(i, total) + '%';
    this.trouver('.progress-label').textContent = 'Question ' + (i + 1) + ' / ' + total;
    // La diapositive reste la même jusqu'à la question suivante : la valider
    // ne redessine que son contenu, sans rejouer l'animation d'arrivée.
    this.rendre(html`<div class="lesson-slide active"></div>`, this.trouver('.quiz-zone'));
    this.#dessinerQuestion();
    if (remonter) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  #dessinerQuestion() {
    const i = this.#courante;
    this.rendre(
      this.gabaritQuestion(this.#questions[i], i, this.#questions.length, this.#ordres[i], this.#reponses[i]),
      this.trouver('.quiz-zone .lesson-slide'),
    );
  }

  /**
   * Choisir ne fait que marquer l'option et débloquer la validation. On touche
   * aux classes sans redessiner : le bouton qui a le focus le garde.
   * @param {HTMLElement} option
   */
  #choisir(option) {
    if (this.#reponses[this.#courante] !== undefined) return;
    const index = Number(option.dataset.option);
    if (estMultiple(this.#questions[this.#courante])) {
      const cochees = Array.isArray(this.#choix) ? this.#choix : [];
      this.#choix = cochees.includes(index) ? cochees.filter((o) => o !== index) : [...cochees, index];
    } else {
      this.#choix = index;
    }
    const choix = this.#choix;
    for (const autre of this.tous('.quiz-opt')) {
      const o = Number(autre.dataset.option);
      autre.classList.toggle('choisi', Array.isArray(choix) ? choix.includes(o) : choix === o);
    }
    const valider = this.trouver('[data-action="valider"]');
    if (valider instanceof HTMLButtonElement) valider.disabled = Array.isArray(choix) ? choix.length === 0 : choix === undefined;
  }

  #valider() {
    const i = this.#courante;
    const choix = this.#choix;
    if (this.#reponses[i] !== undefined) return; // déjà validée : pas de double comptage
    if (choix === undefined || (Array.isArray(choix) && !choix.length)) return;
    this.#reponses[i] = choix;
    this.#credits[i] = corriger(this.#questions[i], choix).credit;
    this.#dessinerQuestion();
    this.trouver('.quiz-zone .btn-next').focus({ preventScroll: true });
  }

  #montrerResultat() {
    if (this.#credits.length < this.#questions.length || !this.#contexte) return;
    const note = noter(this.#credits);
    this.trouver('.progress-fill').style.width = '100%';
    this.trouver('.progress-label').textContent = 'Résultats';
    this.rendre(html`<div class="lesson-slide active">${this.gabaritResultat(note)}</div>`, this.trouver('.quiz-zone'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (note.parfait) this.#confettis();
    this.trouver('cs-fin-cours', FinCours).enregistrer(this.#contexte, this.#reponses);
  }

  #confettis() {
    const zone = this.trouver('.confettis');
    for (let n = 0; n < 60; n++) {
      const piece = document.createElement('div');
      piece.className = 'confetti';
      const cote = 6 + Math.random() * 8;
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = COULEURS_CONFETTIS[Math.floor(Math.random() * COULEURS_CONFETTIS.length)];
      piece.style.width = cote + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
      piece.style.animationDelay = (Math.random() * 0.8) + 's';
      piece.addEventListener('animationend', () => piece.remove());
      zone.appendChild(piece);
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /**
   * Une question : choix en cours (sans réponse) ou corrigée.
   * @param {Question} q
   * @param {number} i
   * @param {number} total
   * @param {number[]} ordre    ordre d'affichage des options
   * @param {Reponse | undefined} reponse  la réponse validée, s'il y en a une
   */
  gabaritQuestion(q, i, total, ordre, reponse) {
    const multiple = estMultiple(q);
    const correction = reponse === undefined ? null : corriger(q, reponse);
    const choisies = reponse === undefined ? [] : Array.isArray(reponse) ? reponse : [reponse];
    const derniere = i === total - 1;

    const options = ordre.map((o) => {
      let etat = '';
      if (correction) etat = correction.bonnes.includes(o) ? ' correct' : choisies.includes(o) ? ' wrong' : '';
      return html`<button type="button" class="quiz-opt${etat}" data-option="${o}"${correction && html` disabled`}>${q.options[o]}</button>`;
    });

    return html`
      <div class="quiz-card">
        <div class="quiz-badge">🧠 Question ${i + 1} / ${total}${multiple && ' · plusieurs bonnes réponses'}</div>
        <div class="quiz-question">${q.question}</div>
        <div class="quiz-options">${options}</div>
        ${correction && this.gabaritRetour(correction, multiple)}
      </div>
      ${!correction
        ? html`<button type="button" class="btn-next" data-action="valider" disabled>Valider ma réponse</button>`
        : derniere
          ? html`<button type="button" class="btn-next" data-action="resultat">Voir mes résultats 🎉</button>`
          : html`<button type="button" class="btn-next" data-action="suivante">Continuer ➜</button>`}`;
  }

  /**
   * @param {Correction} c
   * @param {boolean} multiple
   */
  gabaritRetour(c, multiple) {
    if (multiple) {
      if (c.credit >= 1) return html`<div class="quiz-feedback ok">✅ <strong>Toutes les bonnes réponses !</strong></div>`;
      if (c.credit > 0) return html`<div class="quiz-feedback ok">🌗 <strong>${c.vrais} / ${c.bonnes.length} bonnes réponses.</strong> Les bonnes réponses sont surlignées en vert.</div>`;
      return html`<div class="quiz-feedback ko">❌ <strong>Pas de bonne réponse cette fois.</strong> Les bonnes réponses sont surlignées en vert.</div>`;
    }
    return c.credit
      ? html`<div class="quiz-feedback ok">✅ <strong>Bonne réponse !</strong></div>`
      : html`<div class="quiz-feedback ko">❌ <strong>Pas tout à fait.</strong> La bonne réponse est surlignée en vert.</div>`;
  }

  /** @param {Note} note */
  gabaritResultat(note) {
    const [emoji, titre, message] = !note.reussi
      ? ['💪', 'Continue !', 'Score insuffisant (' + note.pourcent + '%). Il faut 50% minimum pour valider.']
      : note.parfait
        ? ['🏆', 'Parfait !', 'Tu as tout bon ! Tu maîtrises ce sujet.']
        : ['🌟', 'Très bien !', 'Bon score ! Relis les leçons pour consolider.'];
    return html`
      <div class="result-card">
        <span class="result-emoji">${emoji}</span>
        <div class="result-title">${titre}</div>
        <div class="result-score">${Math.round(note.score)} / ${note.total}</div>
        <div class="result-msg">${message}</div>
        <cs-fin-cours></cs-fin-cours>
      </div>
      <a class="btn-next" href="/cours">Retour aux cours 📚</a>
      <button type="button" class="btn-secondary" data-action="recommencer">Recommencer le quiz 🔄</button>`;
  }
}

QuizCours.definir();
