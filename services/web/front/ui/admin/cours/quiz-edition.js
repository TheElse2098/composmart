/* ============================================================================
   quiz-edition.js — les questions du quiz telles que l'éditeur les modifie.

   Une question à réponse unique garde `correct` entier ; à réponses
   multiples, `correct` est un tableau d'index et `multiple` vaut vrai. Les
   index désignent des options : chaque opération qui déplace ou retire une
   option les fait suivre, sinon ils désigneraient silencieusement une autre
   réponse. Le serveur (cours_save.php) nettoie et revalide tout à
   l'enregistrement.

   Reprise exacte de l'ancien éditeur ; fonctions pures, qui rendent une
   nouvelle question plutôt que de modifier celle reçue.
   ============================================================================ */

/**
 * @typedef {object} QuestionEditee
 * @property {string} question
 * @property {string[]} options
 * @property {number | number[]} correct
 * @property {boolean} [multiple]
 */

/** Une question neuve : deux réponses vides, la première cochée. @returns {QuestionEditee} */
export function nouvelleQuestion() {
  return { question: '', options: ['', ''], correct: 0 };
}

/**
 * Les questions reçues du serveur, dans la forme que l'éditeur manipule.
 * @param {unknown} quiz  `quiz` de cours_get.php
 * @returns {QuestionEditee[]}
 */
export function questionsDuServeur(quiz) {
  if (!Array.isArray(quiz)) return [];
  return quiz.map((/** @type {any} */ q) => {
    const multiple = !!q.multiple;
    const correct = multiple ? (Array.isArray(q.correct) ? q.correct.slice() : []) : (q.correct || 0);
    return { question: q.question || '', options: (q.options || []).slice(), correct, multiple };
  });
}

/**
 * Passe une question en réponses multiples, ou l'inverse, en convertissant la
 * bonne réponse d'un format à l'autre.
 * @param {QuestionEditee} q
 * @param {boolean} multiple
 * @returns {QuestionEditee}
 */
export function basculerMultiple(q, multiple) {
  const correct = multiple
    ? (typeof q.correct === 'number' ? [q.correct] : (q.correct || []))
    : (Array.isArray(q.correct) ? (q.correct[0] || 0) : (q.correct || 0));
  return { ...q, multiple, correct };
}

/**
 * Coche ou décoche l'option `j` comme bonne réponse.
 * @param {QuestionEditee} q
 * @param {number} j
 * @param {boolean} coche
 * @returns {QuestionEditee}
 */
export function cocher(q, j, coche) {
  if (!q.multiple) return { ...q, correct: j };
  const bonnes = Array.isArray(q.correct) ? q.correct.slice() : [];
  const i = bonnes.indexOf(j);
  if (coche && i === -1) bonnes.push(j);
  else if (!coche && i !== -1) bonnes.splice(i, 1);
  return { ...q, correct: bonnes };
}

/**
 * Retire l'option `j`. Une question garde au moins deux réponses : `null` si
 * la retirer en laisserait moins.
 * @param {QuestionEditee} q
 * @param {number} j
 * @returns {QuestionEditee | null}
 */
export function retirerOption(q, j) {
  if (q.options.length <= 2) return null;
  const options = q.options.filter((_o, k) => k !== j);
  if (q.multiple) {
    const correct = (Array.isArray(q.correct) ? q.correct : [])
      .filter((n) => n !== j)
      .map((n) => (n > j ? n - 1 : n));
    return { ...q, options, correct };
  }
  let correct = Number(q.correct);
  if (correct === j) correct = 0;
  else if (correct > j) correct--;
  return { ...q, options, correct };
}

// Échanger deux éléments voisins sert à plusieurs pages : socle/outils.js.
export { echanger } from '../../socle/outils.js';
