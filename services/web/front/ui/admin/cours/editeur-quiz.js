/* ============================================================================
   editeur-quiz.js — <cs-admin-editeur-quiz> : l'onglet « Quiz » de l'éditeur
   de cours.

   Une carte par question : énoncé, réponses, bonne réponse cochée (bouton
   radio), ou bonnes réponses (cases à cocher) quand « Réponses multiples »
   est activé. Les transformations sont des fonctions pures
   (quiz-edition.js) ; ce composant ne fait que les appliquer et redessiner.

   Prévient son parent par « modifie », et par « erreur » (le texte en
   détail) quand une action est refusée.

   Usage, dans <cs-admin-editeur> :
     this.trouver('cs-admin-editeur-quiz', AdminEditeurQuiz).configurer(questions);
     … .questions()   les questions à enregistrer
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { basculerMultiple, cocher, echanger, nouvelleQuestion, retirerOption } from './quiz-edition.js';

/** @typedef {import('./quiz-edition.js').QuestionEditee} QuestionEditee */

export class AdminEditeurQuiz extends Composant {
  static balise = 'cs-admin-editeur-quiz';
  static styles = [new URL('./editeur-quiz.css', import.meta.url)];

  /** @type {QuestionEditee[]} */
  #questions = [];

  monter() {
    this.rendre(this.gabarit());

    // Saisie : l'état suit, sans redessiner (le curseur reste en place).
    this.ecouter('input', '[data-q-texte]', (champ) => {
      if (!(champ instanceof HTMLTextAreaElement)) return;
      this.#questions[Number(champ.dataset.qTexte)].question = champ.value;
      this.emettre('modifie');
    });
    this.ecouter('input', '[data-q-opt]', (champ) => {
      if (!(champ instanceof HTMLInputElement)) return;
      const [i, j] = this.#reperes(champ.dataset.qOpt);
      this.#questions[i].options[j] = champ.value;
      this.emettre('modifie');
    });
    this.ecouter('change', '[data-q-correct]', (champ) => {
      if (!(champ instanceof HTMLInputElement)) return;
      const [i, j] = this.#reperes(champ.dataset.qCorrect);
      this.#questions[i] = cocher(this.#questions[i], j, champ.checked);
      this.emettre('modifie');
    });

    // Changements de structure : on redessine.
    this.ecouter('change', '[data-q-multi]', (champ) => {
      if (!(champ instanceof HTMLInputElement)) return;
      const i = Number(champ.dataset.qMulti);
      this.#modifier(i, basculerMultiple(this.#questions[i], champ.checked));
    });
    this.ecouter('click', '[data-q-opt-sup]', (b) => {
      const [i, j] = this.#reperes(b.dataset.qOptSup);
      const question = retirerOption(this.#questions[i], j);
      if (!question) {
        this.emettre('erreur', 'Une question doit garder au moins deux réponses.');
        return;
      }
      this.#modifier(i, question);
    });
    this.ecouter('click', '[data-q-opt-ajout]', (b) => {
      const i = Number(b.dataset.qOptAjout);
      this.#modifier(i, { ...this.#questions[i], options: [...this.#questions[i].options, ''] });
    });
    this.ecouter('click', '[data-q-monter]', (b) => this.#ranger(echanger(this.#questions, Number(b.dataset.qMonter), -1)));
    this.ecouter('click', '[data-q-descendre]', (b) => this.#ranger(echanger(this.#questions, Number(b.dataset.qDescendre), 1)));
    this.ecouter('click', '[data-q-sup]', (b) => this.#supprimer(Number(b.dataset.qSup)));
    this.ecouter('click', '[data-action="ajouter-question"]', () => this.#ranger([...this.#questions, nouvelleQuestion()]));

    this.#dessiner();
  }

  /** @param {QuestionEditee[]} questions */
  configurer(questions) {
    this.apresMontage(() => {
      this.#questions = questions;
      this.#dessiner();
    });
  }

  /** Les questions, telles qu'à envoyer au serveur. @returns {QuestionEditee[]} */
  questions() {
    return this.#questions.map((q) => ({ ...q, options: q.options.slice(), correct: Array.isArray(q.correct) ? q.correct.slice() : q.correct }));
  }

  /** @param {string | undefined} repere  « i-j » @returns {[number, number]} */
  #reperes(repere) {
    const [i, j] = (repere || '').split('-').map(Number);
    return [i, j];
  }

  /** @param {number} i @param {QuestionEditee} question */
  #modifier(i, question) {
    this.#questions = this.#questions.map((q, k) => (k === i ? question : q));
    this.#dessiner();
    this.emettre('modifie');
  }

  /** @param {QuestionEditee[]} questions */
  #ranger(questions) {
    this.#questions = questions;
    this.#dessiner();
    this.emettre('modifie');
  }

  /** @param {number} i */
  async #supprimer(i) {
    if (!await confirmer({ titre: 'Supprimer cette question ?', valider: 'Supprimer', danger: true })) return;
    this.#ranger(this.#questions.filter((_q, k) => k !== i));
  }

  #dessiner() {
    this.rendre(html`${this.#questions.map((q, i) => this.gabaritQuestion(q, i, this.#questions.length))}`, this.trouver('.questions'));
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="aide">
        Le quiz s'affiche après la dernière section. Coche la bonne réponse ; il faut au moins deux
        options pour qu'une question soit conservée. Pour une question à plusieurs bonnes réponses,
        active « Réponses multiples » : chaque bonne réponse cochée par le joueur rapporte 1/n du
        point de la question, chaque mauvaise en retire 1/n (n = nombre de bonnes réponses) — jamais
        moins que 0, jamais plus que le point plein.
      </div>
      <div class="questions"></div>
      <button type="button" class="btn btn-clair" data-action="ajouter-question">＋ Ajouter une question</button>`;
  }

  /**
   * @param {QuestionEditee} q
   * @param {number} i
   * @param {number} total
   */
  gabaritQuestion(q, i, total) {
    const multiple = !!q.multiple;
    /** @param {number} j */
    const estBonne = (j) => (multiple ? Array.isArray(q.correct) && q.correct.includes(j) : q.correct === j);
    return html`
      <div class="carte">
        <div class="carte-tete">
          <div class="carte-titre">Question ${i + 1}</div>
          <label class="q-multi-toggle"><input type="checkbox" data-q-multi="${i}"${multiple && html` checked`}> Réponses multiples</label>
          <button type="button" class="btn btn-clair btn-petit" data-q-monter="${i}"${i === 0 && html` disabled`} aria-label="Monter la question">↑</button>
          <button type="button" class="btn btn-clair btn-petit" data-q-descendre="${i}"${i === total - 1 && html` disabled`} aria-label="Descendre la question">↓</button>
          <button type="button" class="btn btn-clair btn-petit btn-retirer" data-q-sup="${i}">Supprimer</button>
        </div>
        <div class="champ champ-espace">
          <div class="champ-titre">Énoncé</div>
          <textarea data-q-texte="${i}" rows="2" aria-label="Énoncé de la question ${i + 1}">${q.question}</textarea>
        </div>
        <div class="champ">
          <div class="champ-titre">Réponses — ${multiple ? 'coche toutes les bonnes réponses' : 'coche la bonne'}</div>
          ${q.options.map((o, j) => html`
            <div class="option">
              ${multiple
                ? html`<input type="checkbox" data-q-correct="${i}-${j}"${estBonne(j) && html` checked`} aria-label="Bonne réponse">`
                : html`<input type="radio" name="correct-${i}" data-q-correct="${i}-${j}"${estBonne(j) && html` checked`} aria-label="Bonne réponse">`}
              <input type="text" data-q-opt="${i}-${j}" value="${o}" placeholder="Réponse ${j + 1}" aria-label="Réponse ${j + 1}">
              <button type="button" class="sup" data-q-opt-sup="${i}-${j}" title="Retirer" aria-label="Retirer la réponse">✕</button>
            </div>`)}
          <button type="button" class="btn btn-clair btn-petit" data-q-opt-ajout="${i}">＋ Ajouter une réponse</button>
        </div>
      </div>`;
  }
}

AdminEditeurQuiz.definir();
