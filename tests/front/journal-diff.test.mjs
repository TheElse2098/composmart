/* ============================================================================
   Le vocabulaire du journal (journal-libelles.js) et la comparaison avant /
   après (journal-diff.js) : que des fonctions pures, sans page.
   ============================================================================ */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  changements, diffCoursTexte, diffListe, diffMots, diffObjet, diffQuiz, diffSuites, diffTexte,
  etatElement, ligne, panneauxCours, resumeElement, valeur,
} from '../../services/web/front/ui/admin/panel/journal-diff.js';
import {
  ACTIONS, ANNULATIONS, AVEC_AVANT_APRES, CATEGORIES, PRECISIONS_ANNULATION,
  annulable, categorieDe, dateJournal, libelleAction, libelleChamp,
} from '../../services/web/front/ui/admin/panel/journal-libelles.js';

/** @param {unknown} gabarit @param {string} motif  nombre d'occurrences */
const compter = (gabarit, motif) => String(gabarit).split(motif).length - 1;

// ── Vocabulaire ─────────────────────────────────────────────────────────────

test('libelleAction : une action connue a son libellé, une inconnue garde son code', () => {
  assert.deepEqual(libelleAction('compost_valide'), { icone: '✅', texte: 'Demande validée' });
  assert.deepEqual(libelleAction('truc_futur'), { icone: '❔', texte: 'truc_futur' });
});

test('categorieDe : rangement par préfixe, « autres » pour un préfixe inconnu', () => {
  assert.equal(categorieDe('compost_valide'), 'carte');
  assert.equal(categorieDe('signalement_rejete'), 'carte');
  assert.equal(categorieDe('media_televerse'), 'cours');
  assert.equal(categorieDe('jeux_ordre'), 'jeux');
  assert.equal(categorieDe('anecdote_modifiee'), 'ateliers');
  assert.equal(categorieDe('mdp_reinitialise'), 'comptes');
  assert.equal(categorieDe('mail_envoye'), 'emails');
  assert.equal(categorieDe('truc_futur'), 'autres');
});

test('toute action libellée a une catégorie, toute action annulable a un libellé', () => {
  assert.deepEqual(Object.keys(ACTIONS).filter((a) => categorieDe(a) === 'autres'), []);
  assert.deepEqual(Object.keys(ANNULATIONS).filter((a) => !ACTIONS[a]), []);
  assert.deepEqual(Object.keys(PRECISIONS_ANNULATION).filter((a) => !ANNULATIONS[a]), []);
  assert.equal(new Set(CATEGORIES.map((c) => c.id)).size, CATEGORIES.length);
});

test('ANNULATIONS : chaque action part vers le service qui possède les données', () => {
  assert.deepEqual(ANNULATIONS.cours_modifie, { service: 'admin', fichier: 'annuler.php' });
  assert.deepEqual(ANNULATIONS.compost_supprime, { service: 'carte', fichier: 'pending.php' });
  assert.deepEqual(ANNULATIONS.signalement_resolu, { service: 'carte', fichier: 'signalement.php' });
  assert.deepEqual(ANNULATIONS.jeux_ordre, { service: 'jeux', fichier: 'admin.php' });
  assert.deepEqual(ANNULATIONS.parcours_supprime, { service: 'evenements', fichier: 'parcours.php' });
  assert.equal(ANNULATIONS.mail_envoye, undefined);
});

test('libelleChamp : nom lisible, champ imbriqué, champ inconnu', () => {
  assert.equal(libelleChamp('xp_reserve'), "Réserve d'XP");
  assert.equal(libelleChamp('video.url'), 'Vidéo › Adresse');
  assert.equal(libelleChamp('champ_inconnu'), 'champ inconnu');
  assert.equal(libelleChamp('truc.sous_champ'), 'truc › sous champ');
  assert.equal(libelleChamp(3), '3');
});

test('dateJournal : à la minute, sans le T', () => {
  assert.equal(dateJournal('2026-10-26T14:03:12'), '2026-10-26 14:03');
  assert.equal(dateJournal('2026-10-26 14:03:12'), '2026-10-26 14:03');
  assert.equal(dateJournal(null), '');
});

test('annulable : il faut un endpoint, de quoi revenir en arrière, et ne pas l’être déjà', () => {
  assert.equal(annulable({ action: 'compost_modifie', snapshot: { changements: { type: ['a', 'b'] } } }), true);
  assert.equal(annulable({ action: 'cours_modifie', snapshot: { version_id: 12 } }), true);
  assert.equal(annulable({ action: 'compost_supprime', snapshot: { etat: { id: 4 } } }), true);
  assert.equal(annulable({ action: 'compost_modifie', snapshot: { changements: {} }, annule_at: '2026-11-01 10:00:00' }), false, 'déjà annulée');
  assert.equal(annulable({ action: 'compost_modifie', snapshot: null }), false, 'entrée d’avant le 26/10/2026');
  assert.equal(annulable({ action: 'mail_envoye', snapshot: { etat: {} } }), false, 'action sans annulation');
});

test('AVEC_AVANT_APRES : les modifications, pas les créations', () => {
  assert.ok(AVEC_AVANT_APRES.test('cours_modifie'));
  assert.ok(AVEC_AVANT_APRES.test('evenement_en_cours'));
  assert.ok(!AVEC_AVANT_APRES.test('cours_cree'));
  assert.ok(!AVEC_AVANT_APRES.test('evenement_supprime'));
});

// ── Valeurs ─────────────────────────────────────────────────────────────────

test('ligne : clé, valeur échappée, valeur absente en retrait', () => {
  assert.equal(String(ligne('Objet', '<b>x</b>')), '<div class="audit-row"><span class="audit-key">Objet</span><span class="audit-val">&lt;b&gt;x&lt;/b&gt;</span></div>');
  assert.match(String(ligne('Commentaire', 'aucun', true)), /class="audit-val empty">aucun</);
});

test('resumeElement : emoji en tête, ni numéro ni champ vide, coupé à 140 caractères', () => {
  assert.equal(resumeElement({ id: 3, emoji: '🍌', nom: 'Banane', bac: 'compost', note: '', detail: { x: 1 } }), '🍌 Banane · compost');
  assert.equal(resumeElement('texte'), 'texte');
  assert.equal(resumeElement(12), '12');
  const long = resumeElement({ nom: 'a'.repeat(200) });
  assert.equal(long.length, 141);
  assert.ok(long.endsWith('…'));
});

test('valeur : vide, oui/non, liste, objet, statut traduit', () => {
  assert.match(String(valeur(null)), /audit-vide">—</);
  assert.match(String(valeur('')), /audit-vide">—</);
  assert.equal(valeur(true), 'oui');
  assert.equal(valeur(false), 'non');
  assert.equal(valeur(1, 'admin'), 'oui');
  assert.equal(valeur(0, 'user.admin'), 'non');
  assert.equal(valeur(1, 'xp'), '1');
  assert.match(String(valeur([])), /audit-vide">\(vide\)</);
  assert.equal(String(valeur(['a', '<b>'])), '<span class="audit-chip">a</span><span class="audit-chip">&lt;b&gt;</span>');
  assert.equal(valeur('en_attente', 'statut'), 'En attente');
  assert.equal(valeur('expert', 'niveau'), 'Expert');
  assert.equal(valeur('en_attente', 'titre'), 'en_attente', 'seuls statut et niveau sont traduits');
  assert.equal(String(valeur({ url: 'https://x', duree: null })), '<div class="audit-obj"><span class="k">Adresse</span><span>https://x</span><span class="k">Durée</span><span><span class="audit-vide">—</span></span></div>');
  assert.match(String(valeur({})), /\(vide\)/);
});

test('valeur : au-delà de deux niveaux, l’objet est donné tel quel plutôt que déplié sans fin', () => {
  const sortie = String(valeur({ a: { b: { c: 1 } } }));
  assert.match(sortie, /\{&quot;c&quot;:1\}/);
});

// ── Suites, mots, textes ────────────────────────────────────────────────────

test('diffSuites : gardé, retiré, ajouté, dans l’ordre', () => {
  assert.deepEqual(diffSuites(['a', 'b', 'c'], ['a', 'x', 'c']), [['=', 'a'], ['-', 'b'], ['+', 'x'], ['=', 'c']]);
  assert.deepEqual(diffSuites([], ['a']), [['+', 'a']]);
  assert.deepEqual(diffSuites(['a'], []), [['-', 'a']]);
  assert.deepEqual(diffSuites(['a', 'b'], ['a', 'b']), [['=', 'a'], ['=', 'b']]);
  assert.deepEqual(diffSuites(['a', 'b', 'c', 'd'], ['b', 'd', 'e']), [['-', 'a'], ['=', 'b'], ['-', 'c'], ['=', 'd'], ['+', 'e']]);
});

test('diffSuites : deux suites trop longues ne sont pas alignées, mais rien ne se perd', () => {
  const a = Array.from({ length: 1600 }, (_, i) => 'a' + i);
  const b = Array.from({ length: 1600 }, (_, i) => 'b' + i);
  const ops = diffSuites(['debut', ...a, 'fin'], ['debut', ...b, 'fin']);
  assert.equal(ops.length, 3202);
  assert.deepEqual(ops[0], ['=', 'debut']);
  assert.deepEqual(ops[ops.length - 1], ['=', 'fin']);
  assert.equal(ops.filter((o) => o[0] === '-').length, 1600);
  assert.equal(ops.filter((o) => o[0] === '+').length, 1600);
});

test('diffMots : seuls les mots changés sont surlignés', () => {
  const [avant, apres] = diffMots('le chat noir', 'le chien noir');
  assert.equal(String(avant), 'le <del class="dw">chat</del> noir');
  assert.equal(String(apres), 'le <ins class="dw">chien</ins> noir');
});

test('diffTexte : identique, retouche mot à mot, lignes inchangées repliées', () => {
  assert.match(String(diffTexte('a\nb', 'a\nb')), /Texte identique\./);
  assert.match(String(diffTexte(null, '')), /Texte identique\./);

  const avant = ['l1', 'l2', 'l3', 'le chat', 'l5', 'l6', 'l7'].join('\n');
  const apres = ['l1', 'l2', 'l3', 'le chien', 'l5', 'l6', 'l7'].join('\n');
  const sortie = String(diffTexte(avant, apres));
  assert.equal(sortie, '<div class="diff-bloc">'
    + '<div class="dl dl-saut">… 2 lignes inchangées …</div>'
    + '<div class="dl dl-eq">l3</div>'
    + '<div class="dl dl-del">le <del class="dw">chat</del></div>'
    + '<div class="dl dl-add">le <ins class="dw">chien</ins></div>'
    + '<div class="dl dl-eq">l5</div>'
    + '<div class="dl dl-saut">… 2 lignes inchangées …</div>'
    + '</div>');
});

test('diffTexte : ajout pur, retrait pur, ligne vide gardée, HTML échappé', () => {
  assert.equal(String(diffTexte('', 'a\n\nb')), '<div class="diff-bloc"><div class="dl dl-add">a</div><div class="dl dl-add">\u00a0</div><div class="dl dl-add">b</div></div>');
  assert.equal(String(diffTexte('a', '')), '<div class="diff-bloc"><div class="dl dl-del">a</div></div>');
  const sortie = String(diffTexte('<script>', '<b>'));
  assert.ok(!sortie.includes('<script>') && !sortie.includes('<b>'));
  assert.match(sortie, /&lt;script&gt;/);
});

// ── Listes, tableaux, objets ────────────────────────────────────────────────

test('diffListe : courte, tout est montré, retraits barrés et ajouts en vert', () => {
  const sortie = String(diffListe(['a', 'b'], ['b', 'c']));
  assert.equal(sortie, '<div class="val-avant"><span class="audit-chip retrait">a</span><span class="audit-chip">b</span></div>'
    + '<div class="val-apres"><span class="audit-chip">b</span><span class="audit-chip ajout">c</span></div>');
  assert.match(String(diffListe(null, ['a'])), /class="val-avant"><span class="audit-vide">\(vide\)/);
});

test('diffListe : longue, seulement ce qui bouge et le compte du reste', () => {
  const avant = Array.from({ length: 20 }, (_, i) => ({ id: i, nom: 'dechet ' + i }));
  const apres = [...avant.slice(1), { id: 99, nom: 'nouveau' }];
  const sortie = String(diffListe(avant, apres));
  assert.match(sortie, /<b>Retirés \(1\)<\/b> <span class="audit-chip retrait">dechet 0</);
  assert.match(sortie, /<b>Ajoutés \(1\)<\/b> <span class="audit-chip ajout">nouveau</);
  assert.match(sortie, /19 éléments inchangés\./);
  assert.equal(compter(sortie, 'audit-chip'), 2);

  const melange = String(diffListe(avant, [...avant].reverse()));
  assert.match(melange, /Mêmes éléments, ordre changé\./);
});

test('changements : une ligne par champ, selon la nature de la valeur', () => {
  assert.match(String(changements({})), /Enregistré sans aucune différence\./);
  assert.match(String(changements(null)), /Enregistré sans aucune différence\./);

  const sortie = String(changements({
    xp_reserve: [10, 20],
    statut: ['brouillon', 'publie'],
    mettre: [['épluchures'], ['épluchures', 'marc de café']],
    description: ['court', 'un texte\nsur deux lignes'],
  }));
  assert.match(sortie, /^<div class="audit-chg"><span class="audit-chg-entete"><\/span><span class="audit-chg-entete">Avant<\/span><span class="audit-chg-entete">Après<\/span>/);
  assert.match(sortie, /<span class="audit-chg-cle">Réserve d&#39;XP<\/span><div class="val-avant">10<\/div><div class="val-apres">20<\/div>/);
  assert.match(sortie, /<div class="val-avant">Brouillon<\/div><div class="val-apres">Publié<\/div>/);
  assert.match(sortie, /<span class="audit-chip ajout">marc de café<\/span>/);
  assert.match(sortie, /<span class="audit-chg-cle">Description<\/span><div class="audit-chg-large"><div class="diff-bloc">/);
});

test('diffObjet : seuls les champs qui diffèrent', () => {
  const sortie = String(diffObjet({ url: 'a', auteur: 'x' }, { url: 'b', auteur: 'x', duree: 12 }));
  assert.equal(compter(sortie, 'audit-chg-cle'), 2);
  assert.match(sortie, />Adresse<\/span><div class="val-avant">a<\/div><div class="val-apres">b</);
  assert.match(sortie, />Durée<\/span><div class="val-avant"><span class="audit-vide">—<\/span><\/div><div class="val-apres">12</);
  assert.match(String(diffObjet(null, null)), /sans aucune différence/);
});

test('etatElement : l’élément entier, champ par champ', () => {
  const sortie = String(etatElement({ nom: 'Compost du parc', admin: 0, statut: 'valide' }));
  assert.equal(compter(sortie, 'audit-row'), 3);
  assert.match(sortie, />Nom<\/span><span class="audit-val">Compost du parc</);
  assert.match(sortie, />Administrateur<\/span><span class="audit-val">non</);
  assert.match(sortie, />Statut<\/span><span class="audit-val">Validé</);
  assert.match(String(etatElement(null)), /audit-note">—</);
});

// ── Cours et quiz ───────────────────────────────────────────────────────────

test('panneauxCours : découpe sur les titres ##, l’introduction a un nom, ### reste dans le corps', () => {
  assert.deepEqual(panneauxCours('intro\n## Un\ncorps un\n### Sources\nlien\n## Deux\ncorps deux'), [
    { titre: 'introduction', corps: 'intro' },
    { titre: 'Un', corps: 'corps un\n### Sources\nlien' },
    { titre: 'Deux', corps: 'corps deux' },
  ]);
  assert.deepEqual(panneauxCours(''), []);
  assert.deepEqual(panneauxCours(null), []);
});

test('diffCoursTexte : panneau ajouté, modifié, supprimé, inchangés comptés', () => {
  const avant = '## Un\ntexte un\n## Deux\ntexte deux\n## Trois\ntexte trois';
  const apres = '## Un\ntexte un\n## Deux\ntexte DEUX\n## Quatre\ntexte quatre';
  const sortie = String(diffCoursTexte(avant, apres));
  assert.match(sortie, /✏️ Panneau modifié — « Deux »/);
  assert.match(sortie, /➕ Panneau ajouté — « Quatre »/);
  assert.match(sortie, /🗑️ Panneau supprimé — « Trois »/);
  assert.match(sortie, /1 panneau inchangé\./);
  assert.ok(!sortie.includes('ordre des panneaux'));

  assert.match(String(diffCoursTexte(avant, avant)), /3 panneaux inchangés\./);
  assert.match(String(diffCoursTexte('', '')), /Texte identique\./);
});

test('diffCoursTexte : un ordre de panneaux changé est dit', () => {
  const sortie = String(diffCoursTexte('## Un\na\n## Deux\nb', '## Deux\nb\n## Un\na'));
  assert.match(sortie, /L&#39;ordre des panneaux a changé\./);
  assert.match(sortie, /2 panneaux inchangés\./);
});

test('diffQuiz : question ajoutée, modifiée, supprimée, inchangées comptées', () => {
  const avant = [
    { question: 'Q1', options: ['a', 'b'], correct: 0 },
    { question: 'Q2', options: ['a', 'b'], correct: 0 },
    { question: 'Q3', options: ['a', 'b'], correct: 1 },
  ];
  const apres = [
    { question: 'Q1', options: ['a', 'b'], correct: 0 },
    { question: 'Q2', options: ['a', 'b'], correct: 1 },
    { question: 'Q4', options: ['x', 'y'], correct: [0, 1] },
  ];
  const sortie = String(diffQuiz(avant, apres));
  assert.match(sortie, /✏️ Question modifiée — « Q2 »/);
  assert.match(sortie, /Bonne\(s\) réponse\(s\)<\/span><div class="val-avant"><span class="audit-chip retrait">a<\/span><\/div><div class="val-apres"><span class="audit-chip ajout">b<\/span>/);
  assert.match(sortie, /➕ Question ajoutée — « Q4 »/);
  assert.match(sortie, /🗑️ Question supprimée — « Q3 »/);
  assert.match(sortie, /1 question inchangée\./);

  assert.match(String(diffQuiz(avant, avant)), /3 questions inchangées\./);
  assert.match(String(diffQuiz(null, [])), /Quiz identique\./);
});
