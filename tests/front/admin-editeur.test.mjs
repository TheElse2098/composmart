/* ============================================================================
   L'éditeur de cours (/admin/themes/<thème>/<cours>) : découpage du texte en
   panneaux et recomposition, comparés à l'ancien éditeur (copie gelée dans
   reference/) sur tous les vrais cours ; édition du quiz. Le montage :
   admin-editeur-montage.test.mjs.
   ============================================================================ */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const panneaux = await import('../../services/web/front/ui/admin/cours/panneaux-markdown.js');
const quiz = await import('../../services/web/front/ui/admin/cours/quiz-edition.js');

const RACINE = new URL('../../', import.meta.url);
/** Copie gelée des fonctions de l'ancien éditeur, remplacé le 17/11/2026. */
const ANCIEN_EDITEUR = new URL('reference/ancien-editeur-cours.js', import.meta.url);
const COURS = new URL('content/cours/', RACINE);

/**
 * Les fonctions de l'ancien éditeur, exécutées dans un contexte isolé.
 * @param {{ sansCorrection?: boolean }} [options]  sansCorrection : telles
 *   quelles, défaut compris
 * @returns {{ parserMarkdown: (md: string) => any[], composer: (p: any[]) => string }}
 */
function ancienEditeur({ sansCorrection = false } = {}) {
  /** @type {any} */
  const contexte = {};
  vm.runInNewContext(readFileSync(ANCIEN_EDITEUR, 'utf8') + '\nthis.parserMarkdown = parserMarkdown; this.composerMarkdown = composerMarkdown; this.fixer = function (p) { panneaux = p; };', contexte);
  return {
    parserMarkdown: (md) => {
      const decoupe = JSON.parse(JSON.stringify(contexte.parserMarkdown(md)));
      return sansCorrection ? decoupe : corrige(decoupe);
    },
    composer: (p) => { contexte.fixer(JSON.parse(JSON.stringify(p))); return contexte.composerMarkdown(); },
  };
}

/**
 * La seule différence voulue avec l'ancien éditeur : une source sans lien
 * (« - Antoine Doré… ») perd sa puce à la lecture, puisque la recomposition
 * la remet. L'ancien la gardait, et chaque enregistrement ajoutait un tiret.
 * @param {any[]} decoupe
 */
function corrige(decoupe) {
  for (const p of decoupe) {
    for (const s of p.sources) if (s.url === '') s.libelle = s.libelle.replace(/^-\s+/, '');
  }
  return decoupe;
}

/** Le texte de chaque cours du dépôt. @returns {[string, string][]} */
function vraisCours() {
  return readdirSync(COURS)
    .filter((slug) => existsSync(new URL(slug + '/texte.md', COURS)))
    .map((slug) => [slug, readFileSync(new URL(slug + '/texte.md', COURS), 'utf8')]);
}

/** Cas limites écrits à la main : sources, sous-titres, retours Windows, vide. */
const CAS = [
  '',
  '   \n\n',
  '# Titre seul',
  'Une introduction sans titre.\n\n## Première\n\nTexte.',
  '## A\n### Sources\n- [ADEME](https://ademe.fr)\n- une ligne libre\n\n### La suite\nTexte après les sources.',
  '## B\nCorps\n### Source\n- [Sans adresse]()\n## C\nAutre',
  '## Windows\r\nLigne\r\n### Sources\r\n- [X](https://x.fr)\r\n',
  '## Vide\n\n## Plein\nOui',
  '##Pas un titre\n## Vrai titre\ncorps',
  '## Titre sans corps',
];

test('panneaux : découpage identique à l’ancien éditeur, sur tous les vrais cours et les cas limites', () => {
  const ancien = ancienEditeur();
  const textes = [...vraisCours().map(([, t]) => t), ...CAS];
  assert.ok(textes.length >= CAS.length + 9, 'les cours du dépôt sont lus');
  for (const texte of textes) {
    assert.deepEqual(panneaux.decouperPanneaux(texte), ancien.parserMarkdown(texte), JSON.stringify(texte.slice(0, 60)));
  }
});

test('panneaux : recomposition identique à l’ancien éditeur, et stable à l’aller-retour', () => {
  const ancien = ancienEditeur();
  for (const [slug, texte] of [...vraisCours(), ...CAS.map((c, i) => /** @type {[string, string]} */ (['cas ' + i, c]))]) {
    const decoupe = panneaux.decouperPanneaux(texte);
    const recompose = panneaux.composerPanneaux(decoupe);
    assert.equal(recompose, ancien.composer(ancien.parserMarkdown(texte)), slug);
    // Ouvrir puis enregistrer sans rien toucher, deux fois de suite, ne change plus rien.
    assert.equal(panneaux.composerPanneaux(panneaux.decouperPanneaux(recompose)), recompose, slug + ' (aller-retour)');
  }
});

test('panneaux : un vrai cours garde ses sections, son HTML et ses formules', () => {
  const [, texte] = vraisCours().find(([slug]) => slug === 'les-solutions-de-compostage') ?? ['', ''];
  const recompose = panneaux.composerPanneaux(panneaux.decouperPanneaux(texte));
  for (const morceau of ['schema-solutions', 'sch-feuille']) {
    if (texte.includes(morceau)) assert.ok(recompose.includes(morceau), morceau);
  }
  assert.equal((recompose.match(/^## /gm) || []).length, (texte.match(/^## /gm) || []).length);
});

test('panneaux : une source sans lien ne gagne plus un tiret à chaque enregistrement', () => {
  const texte = '## Insecte\n\nTexte.\n\n### Sources\n\n- Antoine Doré. Insectes. CNRS Éditions, 2020.';
  let courant = texte;
  for (let i = 0; i < 3; i++) courant = panneaux.composerPanneaux(panneaux.decouperPanneaux(courant));
  assert.equal(courant, texte);
  // L'ancien éditeur, lui, en ajoutait un à chaque passage.
  const ancien = ancienEditeur({ sansCorrection: true });
  assert.match(ancien.composer(ancien.parserMarkdown(texte)), /^- - Antoine Doré/m);
});

test('panneaux : sources ajoutées dans l’éditeur, intitulé ou adresse manquants', () => {
  assert.equal(panneaux.composerPanneaux([
    { titre: ' Titre ', corps: 'Corps\n', sources: [{ libelle: '', url: 'https://a.fr' }, { libelle: 'Livre', url: '' }, { libelle: ' ', url: ' ' }] },
    { titre: '', corps: '  ', sources: [] },
  ]), '## Titre\n\nCorps\n\n### Sources\n\n- [https://a.fr](https://a.fr)\n- Livre');
});

test('entourer / inserer : sélection gardée, curseur après le bloc', () => {
  assert.deepEqual(panneaux.entourer('un mot ici', 3, 6, '**', '**'), { texte: 'un **mot** ici', debut: 5, fin: 8 });
  assert.deepEqual(panneaux.entourer('abc', 3, 3, '$', '$'), { texte: 'abc$$', debut: 4, fin: 4 });
  assert.deepEqual(panneaux.inserer('avant|après', 5, 6, '\nBLOC\n'), { texte: 'avant\nBLOC\naprès', debut: 11, fin: 11 });
});

// ── Quiz ────────────────────────────────────────────────────────────────────

test('quiz : lecture du serveur comme l’ancien éditeur', () => {
  assert.deepEqual(quiz.questionsDuServeur([
    { question: 'Q1', options: ['a', 'b'], correct: 1 },
    { question: 'Q2', options: ['a', 'b', 'c'], correct: [0, 2], multiple: true },
    { options: ['a', 'b'] },
    { question: 'Q4', options: ['a', 'b'], correct: 1, multiple: true },
  ]), [
    { question: 'Q1', options: ['a', 'b'], correct: 1, multiple: false },
    { question: 'Q2', options: ['a', 'b', 'c'], correct: [0, 2], multiple: true },
    { question: '', options: ['a', 'b'], correct: 0, multiple: false },
    { question: 'Q4', options: ['a', 'b'], correct: [], multiple: true },
  ]);
  assert.deepEqual(quiz.questionsDuServeur(null), []);
});

test('quiz : passer en réponses multiples et revenir, cocher, décocher', () => {
  const simple = { question: 'Q', options: ['a', 'b', 'c'], correct: 2 };
  const multiple = quiz.basculerMultiple(simple, true);
  assert.deepEqual(multiple, { question: 'Q', options: ['a', 'b', 'c'], correct: [2], multiple: true });
  assert.deepEqual(quiz.cocher(multiple, 0, true).correct, [2, 0]);
  assert.deepEqual(quiz.cocher(multiple, 2, false).correct, []);
  assert.deepEqual(quiz.basculerMultiple({ ...multiple, correct: [1, 2] }, false).correct, 1);
  assert.equal(quiz.basculerMultiple({ ...multiple, correct: [] }, false).correct, 0);
  assert.equal(quiz.cocher(simple, 1, true).correct, 1);
  assert.equal(simple.correct, 2, 'la question reçue n’est pas modifiée');
});

test('quiz : retirer une option fait suivre les bonnes réponses ; jamais moins de deux', () => {
  assert.deepEqual(quiz.retirerOption({ question: 'Q', options: ['a', 'b', 'c', 'd'], correct: [1, 3], multiple: true }, 1),
    { question: 'Q', options: ['a', 'c', 'd'], correct: [2], multiple: true });
  assert.deepEqual(quiz.retirerOption({ question: 'Q', options: ['a', 'b', 'c'], correct: 2 }, 0).correct, 1);
  assert.deepEqual(quiz.retirerOption({ question: 'Q', options: ['a', 'b', 'c'], correct: 1 }, 1).correct, 0);
  assert.deepEqual(quiz.retirerOption({ question: 'Q', options: ['a', 'b', 'c'], correct: 0 }, 2).correct, 0);
  assert.equal(quiz.retirerOption({ question: 'Q', options: ['a', 'b'], correct: 0 }, 0), null);
});

test('echanger : avec le voisin, sans effet au bord', () => {
  assert.deepEqual(quiz.echanger(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(quiz.echanger(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
  assert.deepEqual(quiz.echanger(['a', 'b'], 0, -1), ['a', 'b']);
  assert.deepEqual(quiz.echanger(['a', 'b'], 1, 1), ['a', 'b']);
});

