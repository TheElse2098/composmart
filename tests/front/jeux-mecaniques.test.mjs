/* ============================================================================
   Les quatre mini-jeux (ui/pages/jeu/) : la base commune (chargement, écran
   de fin, score enregistré, top 5), la barre du haut, puis la mécanique de
   chaque jeu, avec un jeu d'essai à la place de la base.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { melanger, palier } = await import('../../services/web/front/ui/pages/jeu/jeu.js');
await import('../../services/web/front/ui/pages/jeu/barre-jeu.js');
const { CATEGORIES } = await import('../../services/web/front/ui/pages/jeu/compost-ou-pas.js');
const { tuilesDe } = await import('../../services/web/front/ui/pages/jeu/mot-mystere.js');
const { precision, versJours, versPosition } = await import('../../services/web/front/ui/pages/jeu/temps-decompo.js');
const { duree } = await import('../../services/web/front/ui/pages/jeu/durees.js');
const { BACS, consigne, dureeManche } = await import('../../services/web/front/ui/pages/jeu/tri-eclair.js');

const MESSAGES = [{ min: 0, emoji: '🌱', texte: 'Continue !' }, { min: 0.8, emoji: '🏆', texte: 'Expert du tri !' }, { min: 0.5, emoji: '👍', texte: 'Pas mal.' }];

/** Les jeux d'essai, tels que /api/jeux/catalogue.php?action=jeu les renverrait. */
const JEUX = {
  'compost-ou-pas': {
    slug: 'compost-ou-pas', nom: 'Compost ou pas ?', emoji: '♻️', statut: 'publie', score_max: 2, messages: MESSAGES,
    regles: { nb_items: 2 },
    items: [{ emoji: '🍌', nom: 'Peau de banane', cat: 'oui', info: 'Elle se décompose vite.' }, { emoji: '🥩', nom: 'Viande', cat: 'attention', info: 'Seulement en compost mûr.' }],
  },
  'mot-mystere': {
    slug: 'mot-mystere', nom: 'Mot mystère', emoji: '🔤', statut: 'publie', score_max: 20, messages: MESSAGES,
    regles: { nb_mots: 2, points: [10, 6, 3] },
    items: [{ mot: 'VER', indice: 'Il <aère> la terre.' }, { mot: 'HUMUS', indice: 'Le résultat.' }],
  },
  'temps-decompo': {
    slug: 'temps-decompo', nom: 'Combien de temps ?', emoji: '⏳', statut: 'brouillon', score_max: 6, messages: MESSAGES,
    regles: { nb_courts: 1, nb_longs: 1, seuil_court: 365, seuils: [{ d: 0.05, pts: 3, label: '🎯 Dans le mille !' }, { d: 0.15, pts: 1, label: '👍 Pas loin' }] },
    items: [{ emoji: '🍎', nom: 'un trognon de pomme', jours: 60, info: 'Vite parti.' }, { emoji: '🧴', nom: 'une bouteille en plastique', jours: 165000, info: 'Très lent.' }],
  },
  'tri-eclair': {
    slug: 'tri-eclair', nom: 'Tri éclair', emoji: '⚡', statut: 'publie', score_max: 3, messages: MESSAGES,
    regles: { nb_items: 3, vies: 2, duree_debut: 3, duree_pas: 0.5, duree_min: 2 },
    items: [{ emoji: '🍌', nom: 'Banane', cat: 'compost', info: 'Au compost.' }, { emoji: '🥫', nom: 'Conserve', cat: 'recyclage', info: 'Au recyclage.' }, { emoji: '🧻', nom: 'Mouchoir sale', cat: 'poubelle', info: 'À la poubelle.' }],
  },
};

const mathRandom = Math.random;
/** Fixe Math.random pour que melanger() rende le tableau dans son ordre. */
function sansHasard() { Math.random = () => 0.999999; }

/**
 * Le serveur des jeux.
 * @param {{ jeu?: any, enregistrement?: any, top?: any[] }} [options]
 */
function serveur({ jeu, enregistrement = { corps: { ok: true, record: true, xp_gagne: 4 } }, top = [{ username: 'ana', score: 9 }, { username: 'bob <b>', score: 7 }] } = {}) {
  return fauxFetch((adresse, options) => {
    const p = new URL(adresse, 'https://composmart.test').searchParams;
    if (adresse.startsWith('/api/jeux/catalogue.php')) return jeu ?? { corps: { jeu: structuredClone(JEUX[/** @type {keyof typeof JEUX} */ (p.get('slug'))]) } };
    if (adresse.startsWith('/api/jeux/score.php') && options.method === 'POST') return enregistrement;
    if (adresse.startsWith('/api/jeux/score.php')) return { corps: { top } };
    return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
  });
}

/** @param {{ adresse: string, options: any }[]} appels */
const envois = (appels) => appels.filter((a) => a.options && a.options.method === 'POST');

/** @param {() => Promise<void>} action */
async function enSilence(action) {
  const origine = console.error;
  console.error = () => {};
  try {
    await action();
  } finally {
    console.error = origine;
  }
}

/** Laisse aboutir les réponses sans faire avancer les minuteries figées. */
async function laisserRepondre() {
  for (let i = 0; i < 15; i++) await new Promise((resoudre) => setImmediate(resoudre));
}

/** Monte un jeu, minuteries figées, et attend qu'il soit prêt. @param {string} slug @returns {Promise<any>} */
async function monterJeu(slug) {
  mock.timers.enable({ apis: ['setTimeout'] });
  const element = dom.monter('<cs-' + slug + '></cs-' + slug + '>');
  await laisserRepondre();
  return element;
}

/** Le texte de la barre d'état. @param {any} jeu */
const statut = (jeu) => jeu.querySelectorAll('.game-status span').map((/** @type {any} */ s) => s.textContent);

afterEach(async () => {
  Math.random = mathRandom;
  mock.timers.reset();
  dom.vider();
  await dom.stabiliser();
});

// ── Fonctions communes ──────────────────────────────────────────────────────

test('melanger : mêmes éléments, nouveau tableau, l’original intact', () => {
  const t = [1, 2, 3, 4, 5];
  const m = melanger(t);
  assert.notEqual(m, t);
  assert.deepEqual([...m].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(t, [1, 2, 3, 4, 5]);
  assert.deepEqual(melanger([]), []);
});

test('palier : le plus exigeant atteint, sinon le plus bas ; rien de défini, un message neutre', () => {
  assert.equal(palier(MESSAGES, 0.9).texte, 'Expert du tri !');
  assert.equal(palier(MESSAGES, 0.8).texte, 'Expert du tri !');
  assert.equal(palier(MESSAGES, 0.6).texte, 'Pas mal.');
  assert.equal(palier(MESSAGES, 0).texte, 'Continue !');
  assert.equal(palier([{ min: 0.5, emoji: '👍', texte: 'Bien' }], 0.1).texte, 'Bien', 'en dessous de tout : le plus bas');
  assert.deepEqual(palier([], 1), { emoji: '🎮', texte: '' });
  assert.deepEqual(palier(null, 1), { emoji: '🎮', texte: '' });
});

// ── La barre du haut ────────────────────────────────────────────────────────

test('barre de jeu : logo, compte, quitter vers la liste ; le bouton de thème bascule et change d’icône', async () => {
  const barre = dom.monter('<cs-barre-jeu></cs-barre-jeu>');
  await dom.stabiliser();
  assert.deepEqual(barre.querySelectorAll('a').map((/** @type {any} */ a) => a.getAttribute('href')), ['/', '/compte', '/jeux']);
  const bouton = barre.querySelector('[data-action="theme"]');
  assert.equal(bouton.textContent, '🌙');
  bouton.click();
  assert.equal(dom.document.documentElement.classList.contains('dark'), true);
  assert.equal(bouton.textContent, '☀️');
  assert.equal(dom.stockage.get('theme'), 'dark');
});

// ── La base : chargement, écran de fin ──────────────────────────────────────

test('base : chargement, puis l’en-tête au nom du jeu et la première manche', async () => {
  sansHasard();
  const { appels } = serveur();
  const jeu = await monterJeu('compost-ou-pas');
  assert.equal(appels[0].adresse, '/api/jeux/catalogue.php?action=jeu&slug=compost-ou-pas');
  assert.equal(jeu.classList.contains('jeu'), true);
  assert.equal(jeu.querySelector('.hero-badge').textContent, '♻️ Compost ou pas ?');
  assert.equal(jeu.querySelector('h1').textContent, "Bien trier, ça s'apprend");
  assert.equal(jeu.querySelector('.jeu-brouillon').hidden, true);
  assert.equal(jeu.querySelector('.jeu-etat'), null);
  assert.deepEqual([jeu.querySelector('.game-zone').hidden, jeu.querySelector('.end-screen').hidden], [false, true]);
});

test('base : un brouillon (vu d’un administrateur) le rappelle', async () => {
  serveur();
  const jeu = await monterJeu('temps-decompo');
  assert.equal(jeu.querySelector('.jeu-brouillon').hidden, false);
});

test('base : jeu indisponible, un mot et un lien vers les autres jeux, pas de zone de jeu', async () => {
  await enSilence(async () => {
    serveur({ jeu: { statut: 404, corps: { error: 'Jeu introuvable.' } } });
    const jeu = await monterJeu('compost-ou-pas');
    assert.match(jeu.querySelector('.jeu-etat').textContent, /Ce jeu n'est pas disponible pour le moment\./);
    assert.equal(jeu.querySelector('.jeu-etat a').getAttribute('href'), '/jeux');
    assert.equal(jeu.querySelector('.game-zone'), null);
  });
});

/** Joue une partie entière de Compost ou pas, bonnes réponses ou non. @param {any} jeu @param {boolean[]} justes */
async function jouerCompost(jeu, justes) {
  for (const juste of justes) {
    const nom = jeu.querySelector('.item-nom').textContent;
    const bonne = JEUX['compost-ou-pas'].items.find((d) => d.nom === nom)?.cat;
    const choix = juste ? bonne : (bonne === 'non' ? 'oui' : 'non');
    jeu.querySelector('[data-choix="' + choix + '"]').click();
    mock.timers.tick(2400);
    await laisserRepondre();
  }
}

test('fin de partie, membre : score, palier, record, XP, top 5 échappé', async () => {
  sansHasard();
  const { appels } = serveur();
  const jeu = await monterJeu('compost-ou-pas');
  await jouerCompost(jeu, [true, true]);

  assert.deepEqual([jeu.querySelector('.game-zone').hidden, jeu.querySelector('.end-screen').hidden], [true, false]);
  assert.equal(jeu.querySelector('.end-score').textContent, '2 / 2');
  assert.equal(jeu.querySelector('.end-emoji').textContent, '🏆');
  assert.equal(jeu.querySelector('.end-msg').textContent, 'Expert du tri !');
  assert.equal(String(envois(appels)[0].options.body), 'action=save&jeu_id=compost-ou-pas&score=2');
  assert.equal(jeu.querySelector('.end-record').hidden, false);
  assert.deepEqual([jeu.querySelector('.end-xp').hidden, jeu.querySelector('.end-xp').textContent], [false, '⚡ +4 XP']);
  assert.ok(appels.some((a) => a.adresse === '/api/jeux/score.php?action=infos&jeu_id=compost-ou-pas'));
  assert.deepEqual(jeu.querySelectorAll('.lb-row').map((/** @type {any} */ r) => r.textContent), ['🥇 ana9', '🥈 bob <b>7']);
  assert.equal(jeu.querySelector('.lb-row b'), null);
  assert.equal(jeu.querySelector('.save-info').hidden, true);
});

test('fin de partie, visiteur : l’invitation à se connecter, et le top 5 quand même', async () => {
  sansHasard();
  serveur({ enregistrement: { corps: { error: 'not_logged_in' } } });
  const jeu = await monterJeu('compost-ou-pas');
  await jouerCompost(jeu, [true, false]);
  assert.equal(jeu.querySelector('.end-score').textContent, '1 / 2');
  assert.equal(jeu.querySelector('.end-msg').textContent, 'Pas mal.');
  assert.equal(jeu.querySelector('.save-info').hidden, false);
  assert.deepEqual(jeu.querySelectorAll('.save-info a').map((/** @type {any} */ a) => a.getAttribute('href')), ['/login', '/signin']);
  assert.equal(jeu.querySelector('.end-record').hidden, true);
  assert.equal(jeu.querySelectorAll('.lb-row').length, 2);
});

test('fin de partie : pas de record annoncé pour un score nul ; panne du classement sans conséquence', async () => {
  await enSilence(async () => {
    sansHasard();
    fauxFetch((adresse, options) => {
      if (adresse.startsWith('/api/jeux/catalogue.php')) return { corps: { jeu: structuredClone(JEUX['compost-ou-pas']) } };
      if (options.method === 'POST') return { corps: { ok: true, record: true, xp_gagne: 0 } };
      return new TypeError('fetch failed');
    });
    const jeu = await monterJeu('compost-ou-pas');
    await jouerCompost(jeu, [false, false]);
    assert.equal(jeu.querySelector('.end-score').textContent, '0 / 2');
    assert.equal(jeu.querySelector('.end-record').hidden, true);
    assert.equal(jeu.querySelector('.end-xp').hidden, true);
    assert.equal(jeu.querySelector('.leaderboard').hidden, true);
  });
});

test('rejouer : l’écran de fin se vide et une partie neuve commence', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('compost-ou-pas');
  await jouerCompost(jeu, [true, true]);
  jeu.querySelector('[data-action="rejouer"]').click();
  assert.deepEqual([jeu.querySelector('.game-zone').hidden, jeu.querySelector('.end-screen').hidden], [false, true]);
  assert.equal(jeu.querySelector('.end-record').hidden, true, 'le record de la partie d’avant ne reste pas affiché');
  assert.deepEqual(statut(jeu), ['Déchet 1/2', 'Score : 0']);
});

test('page quittée en pleine manche : l’attente est annulée, rien ne se passe après', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('compost-ou-pas');
  jeu.querySelector('[data-choix="oui"]').click();
  jeu.remove();
  await laisserRepondre();
  assert.doesNotThrow(() => mock.timers.tick(5000));
});

// ── Compost ou pas ? ────────────────────────────────────────────────────────

test('compost ou pas : bonne réponse, boutons figés, explication, puis le déchet suivant', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('compost-ou-pas');
  assert.deepEqual(statut(jeu), ['Déchet 1/2', 'Score : 0']);
  assert.deepEqual([jeu.querySelector('.item-emoji').textContent, jeu.querySelector('.item-nom').textContent], ['🍌', 'Peau de banane']);

  jeu.querySelector('[data-choix="oui"]').click();
  assert.ok(jeu.querySelectorAll('[data-choix]').every((/** @type {any} */ b) => b.disabled));
  assert.deepEqual([jeu.querySelector('.feedback').className, jeu.querySelector('.feedback').textContent], ['feedback ok', '✓ Bien vu ! Elle se décompose vite.']);
  assert.deepEqual(statut(jeu), ['Déchet 1/2', 'Score : 1']);
  jeu.querySelector('[data-choix="non"]').click(); // un second clic ne compte pas
  assert.deepEqual(statut(jeu), ['Déchet 1/2', 'Score : 1']);

  mock.timers.tick(2399);
  assert.equal(jeu.querySelector('.item-nom').textContent, 'Peau de banane', 'le temps de lire');
  mock.timers.tick(1);
  assert.equal(jeu.querySelector('.item-nom').textContent, 'Viande');
  assert.ok(jeu.querySelectorAll('[data-choix]').every((/** @type {any} */ b) => !b.disabled));
  assert.equal(jeu.querySelector('.feedback').className, 'feedback');
});

test('compost ou pas : un raté nomme la bonne catégorie', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('compost-ou-pas');
  jeu.querySelector('[data-choix="non"]').click();
  assert.deepEqual([jeu.querySelector('.feedback').className, jeu.querySelector('.feedback').textContent], ['feedback ko', '✗ Raté, c\'était « Au compost ». Elle se décompose vite.']);
  assert.deepEqual(CATEGORIES, { oui: 'Au compost', attention: 'Avec prudence', non: 'Poubelle' });
});

// ── Mot mystère ─────────────────────────────────────────────────────────────

test('tuilesDe : jamais dans l’ordre du mot, sauf si c’est impossible', () => {
  assert.deepEqual(tuilesDe('VER', (l) => l), ['E', 'V', 'R'], 'mélange tombé dans l’ordre : deux lettres échangées');
  assert.deepEqual(tuilesDe('VER', (l) => [...l].reverse()), ['R', 'E', 'V']);
  assert.deepEqual(tuilesDe('A', (l) => l), ['A']);
});

/** Les tuiles du mot en cours, dans l'ordre où elles écrivent le mot. @param {any} jeu @param {string} mot */
function tuilesPour(jeu, mot) {
  const libres = jeu.querySelectorAll('.tile');
  return mot.split('').map((lettre) => {
    const i = libres.findIndex((/** @type {any} */ t) => t && t.textContent === lettre);
    const tuile = libres[i];
    libres[i] = null;
    return tuile;
  });
}

test('mot mystère : indice échappé, une case par lettre, une tuile par lettre', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('mot-mystere');
  assert.deepEqual(statut(jeu), ['Mot 1/2', 'Score : 0']);
  assert.equal(jeu.querySelector('.indice').textContent, '💡 Indice : Il <aère> la terre.');
  assert.equal(jeu.querySelector('.indice b').textContent, 'Indice :');
  assert.equal(jeu.querySelectorAll('.slot').length, 3);
  assert.deepEqual(jeu.querySelectorAll('.tile').map((/** @type {any} */ t) => t.textContent).sort(), ['E', 'R', 'V']);
});

test('mot mystère : trouvé du premier coup, tous les points, puis le mot suivant', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('mot-mystere');
  const [v, e, r] = tuilesPour(jeu, 'VER');
  v.click();
  assert.deepEqual([v.disabled, jeu.querySelector('.slot').textContent, jeu.querySelector('.slot').classList.contains('filled')], [true, 'V', true]);
  e.click();
  r.click();
  assert.equal(jeu.querySelector('.slots').classList.contains('good'), true);
  assert.deepEqual(statut(jeu), ['Mot 1/2', 'Score : 10']);
  jeu.querySelector('[data-action="passer"]').click(); // le mot est trouvé : « Passer » ne fait plus rien
  mock.timers.tick(900);
  assert.deepEqual(statut(jeu), ['Mot 2/2', 'Score : 10']);
  assert.equal(jeu.querySelectorAll('.slot').length, 5);
});

test('mot mystère : une erreur vide la réponse après un instant, et coûte des points', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('mot-mystere');
  const [v, e, r] = tuilesPour(jeu, 'VER');
  r.click(); e.click(); v.click(); // « REV »
  assert.equal(jeu.querySelector('.slots').classList.contains('bad'), true);
  mock.timers.tick(600);
  assert.equal(jeu.querySelector('.slots').classList.contains('bad'), false);
  assert.ok(jeu.querySelectorAll('.slot').every((/** @type {any} */ s) => s.textContent === ''));
  assert.ok([v, e, r].every((t) => !t.disabled));

  v.click(); e.click(); r.click();
  assert.deepEqual(statut(jeu), ['Mot 1/2', 'Score : 6'], 'deuxième essai : 6 points');
});

test('mot mystère : une case rend sa lettre ; « Effacer » les rend toutes', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('mot-mystere');
  const [v, e] = tuilesPour(jeu, 'VER');
  v.click(); e.click();
  jeu.querySelectorAll('.slot')[0].click();
  assert.deepEqual(jeu.querySelectorAll('.slot').map((/** @type {any} */ s) => s.textContent), ['E', '', '']);
  assert.deepEqual([v.disabled, e.disabled], [false, true]);
  jeu.querySelector('[data-action="effacer"]').click();
  assert.ok(jeu.querySelectorAll('.slot').every((/** @type {any} */ s) => s.textContent === ''));
  assert.equal(e.disabled, false);
});

test('mot mystère : « Passer » montre le mot, ne rapporte rien, et ne saute qu’un mot', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('mot-mystere');
  jeu.querySelector('[data-action="passer"]').click();
  assert.deepEqual(jeu.querySelectorAll('.slot').map((/** @type {any} */ s) => s.textContent), ['V', 'E', 'R']);
  assert.ok(jeu.querySelectorAll('.tile').every((/** @type {any} */ t) => t.disabled));
  jeu.querySelector('[data-action="passer"]').click(); // double clic
  mock.timers.tick(1100);
  assert.deepEqual(statut(jeu), ['Mot 2/2', 'Score : 0']);
});

// ── Combien de temps ? ──────────────────────────────────────────────────────

test('temps : l’échelle va d’un jour à mille ans, en ordres de grandeur', () => {
  assert.equal(versJours(0), 1);
  assert.ok(Math.abs(versJours(1) - 365000) < 1e-6);
  assert.equal(versPosition(1), 0);
  assert.equal(versPosition(0.5), 0, 'moins d’un jour compte pour un jour');
  assert.ok(Math.abs(versPosition(versJours(0.37)) - 0.37) < 1e-12);
});

test('temps : une durée telle qu’on la dit', () => {
  assert.deepEqual([1, 3, 13.6, 20, 59, 61, 349, 365, 800, 36500].map(duree),
    ['1 jour', '3 jours', '14 jours', '3 semaines', '8 semaines', '2 mois', '12 mois', '1 an', '2 ans', '100 ans']);
});

test('temps : le palier de précision selon l’écart', () => {
  const seuils = JEUX['temps-decompo'].regles.seuils;
  assert.deepEqual(precision(seuils, 0.01), { rang: 0, pts: 3, label: '🎯 Dans le mille !' });
  assert.deepEqual(precision(seuils, 0.1), { rang: 1, pts: 1, label: '👍 Pas loin' });
  assert.deepEqual(precision(seuils, 0.5), { rang: -1, pts: 0, label: '❌ Raté !' });
});

test('temps : une manche, du curseur à la réponse ; la vraie durée se pose sur la ligne', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('temps-decompo');
  const curseur = jeu.querySelector('input[type="range"]');
  curseur.rectangle = { left: 0, top: 0, right: 446, bottom: 46, width: 446, height: 46 };
  globalThis.dispatchEvent(new CustomEvent('resize'));
  assert.equal(jeu.querySelectorAll('.tick').length, 6);
  assert.equal(jeu.querySelectorAll('.tick')[0].style.left, '23px', '1 jour : tout à gauche, au centre du pion');
  assert.equal(jeu.querySelectorAll('.tick')[5].style.left, '423px', '1000 ans : tout à droite');

  assert.deepEqual(statut(jeu), ['Déchet 1/2', 'Score : 0']);
  assert.equal(jeu.querySelector('.item-question').textContent, 'Combien de temps met un trognon de pomme à se décomposer ?');
  curseur.value = String(Math.round(versPosition(60) * 1000));
  curseur.dispatchEvent(new CustomEvent('input'));
  assert.equal(jeu.querySelector('.bubble').textContent, '~2 mois');

  jeu.querySelector('[data-action="valider"]').click();
  assert.equal(curseur.disabled, true);
  assert.equal(jeu.querySelector('[data-action="valider"]').hidden, true);
  assert.equal(jeu.querySelector('.true-marker').classList.contains('show'), true);
  assert.equal(jeu.querySelector('.feedback').className, 'feedback ok');
  assert.equal(jeu.querySelector('.feedback').textContent, '🎯 Dans le mille ! +3 pts\nRéponse : 2 mois. Vite parti.'.replace('\n', ''));
  assert.deepEqual(statut(jeu), ['Déchet 1/2', 'Score : 3']);

  jeu.querySelector('[data-action="continuer"]').click();
  assert.equal(jeu.querySelector('.item-question').textContent, 'Combien de temps met une bouteille en plastique à se décomposer ?');
  assert.deepEqual([curseur.disabled, curseur.value, jeu.querySelector('.true-marker').classList.contains('show')], [false, '500', false]);
});

test('temps : loin du compte, aucun point ; à moitié, un retour « moyen »', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('temps-decompo');
  const curseur = jeu.querySelector('input[type="range"]');
  curseur.value = String(Math.round((versPosition(60) + 0.1) * 1000));
  jeu.querySelector('[data-action="valider"]').click();
  assert.equal(jeu.querySelector('.feedback').className, 'feedback mid');
  jeu.querySelector('[data-action="continuer"]').click();
  curseur.value = '0';
  jeu.querySelector('[data-action="valider"]').click();
  assert.equal(jeu.querySelector('.feedback').className, 'feedback ko');
  assert.match(jeu.querySelector('.feedback strong').textContent, /❌ Raté ! \+0 pt$/);
  jeu.querySelector('[data-action="continuer"]').click();
  assert.equal(jeu.querySelector('.end-score').textContent, '1 / 6');
});

// ── Tri éclair ──────────────────────────────────────────────────────────────

test('tri éclair : le chrono raccourcit à chaque manche, jamais sous le plancher ; la consigne suit les règles', () => {
  const r = JEUX['tri-eclair'].regles;
  assert.deepEqual([0, 1, 2, 5].map((m) => dureeManche(r, m)), [3, 2.5, 2, 2]);
  assert.equal(consigne(r), 'Glisse le déchet vers le bon bac, ou touche directement le bac. 2 vies, et le temps se resserre à chaque manche !');
  assert.equal(consigne({ vies: 1, duree_pas: 0 }), 'Glisse le déchet vers le bon bac, ou touche directement le bac. 1 vie, et le chrono ne pardonne pas !');
  assert.deepEqual(BACS, { compost: 'Compost', recyclage: 'Recyclage', poubelle: 'Poubelle' });
});

test('tri éclair : le bon bac rapporte un point ; le chrono est figé pendant le retour', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('tri-eclair');
  assert.equal(jeu.querySelector('.regle').textContent, consigne(JEUX['tri-eclair'].regles));
  assert.deepEqual(statut(jeu), ['Déchet 1/3', '❤️❤️', 'Score : 0']);
  const barre = jeu.querySelector('.timer-bar');
  assert.deepEqual([barre.style.transition, barre.style.width], ['width 3s linear', '0%']);

  jeu.querySelector('[data-bac="compost"]').click();
  assert.deepEqual([jeu.querySelector('.feedback').className, jeu.querySelector('.feedback').textContent], ['feedback ok', '✓ Au compost.']);
  assert.equal(barre.style.transition, 'none', 'la barre ne file plus');
  assert.ok(jeu.querySelectorAll('[data-bac]').every((/** @type {any} */ b) => b.disabled));
  mock.timers.tick(3000); // l'ancien chrono ne doit plus rien trancher
  assert.deepEqual(statut(jeu), ['Déchet 2/3', '❤️❤️', 'Score : 1'], 'manche suivante (1,1 s), sans vie perdue');
  assert.equal(barre.style.transition, 'width 2.5s linear');
});

test('tri éclair : trop lent, une vie perdue ; plus de vies, la partie s’arrête', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('tri-eclair');
  mock.timers.tick(3000);
  assert.deepEqual([jeu.querySelector('.feedback').className, jeu.querySelector('.feedback').textContent], ['feedback ko', '⏱️ Trop lent ! C\'était : Compost. Au compost.']);
  assert.deepEqual(statut(jeu), ['Déchet 1/3', '❤️🤍', 'Score : 0']);
  mock.timers.tick(1100);
  jeu.querySelector('[data-bac="poubelle"]').click();
  assert.equal(jeu.querySelector('.feedback').textContent, '✗ Raté ! C\'était : Recyclage. Au recyclage.');
  mock.timers.tick(1100);
  await laisserRepondre();
  assert.equal(jeu.querySelector('.end-screen').hidden, false);
  assert.equal(jeu.querySelector('.end-msg').textContent, 'Continue ! Partie écourtée : plus de vies !');
});

test('tri éclair : glisser le déchet sur un bac le trie', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('tri-eclair');
  const objet = jeu.querySelector('.item-chip');
  objet.rectangle = { left: 100, top: 100, right: 200, bottom: 160, width: 100, height: 60 };
  jeu.querySelector('[data-bac="recyclage"]').rectangle = { left: 300, top: 400, right: 400, bottom: 460, width: 100, height: 60 };
  jeu.querySelector('[data-bac="compost"]').rectangle = { left: 100, top: 400, right: 200, bottom: 460, width: 100, height: 60 };

  objet.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: 150, clientY: 130 }));
  assert.deepEqual([objet.classList.contains('en-cours'), objet.style.position, objet.style.left, objet.captures.has(7)], [true, 'fixed', '100px', true]);
  assert.equal(jeu.querySelector('.item-chip-slot').style.height, '60px', 'la place ne se replie pas');

  objet.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 150, clientY: 430 }));
  assert.equal(objet.style.top, '400px');
  assert.deepEqual(jeu.querySelectorAll('.bac.survole').map((/** @type {any} */ b) => b.dataset.bac), ['compost']);
  objet.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 999, clientY: 999 })); // un autre doigt : ignoré
  assert.equal(objet.style.top, '400px');

  objet.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 150, clientY: 430 }));
  assert.equal(jeu.querySelector('.feedback').className, 'feedback ok');
  assert.deepEqual([objet.classList.contains('en-cours'), objet.style.position], [false, '']);
  assert.equal(jeu.querySelectorAll('.bac.survole').length, 0);
});

test('tri éclair : lâché hors des bacs, rien ne se passe ; temps écoulé pendant le geste, le geste est annulé', async () => {
  sansHasard();
  serveur();
  const jeu = await monterJeu('tri-eclair');
  const objet = jeu.querySelector('.item-chip');
  objet.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3 }));
  objet.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, clientX: 5000, clientY: 5000 }));
  assert.equal(jeu.querySelector('.feedback').className, 'feedback', 'pas de bac : la manche continue');

  objet.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4 }));
  mock.timers.tick(3000);
  assert.equal(jeu.querySelector('.feedback').className, 'feedback ko');
  assert.deepEqual([objet.captures.has(4), objet.classList.contains('en-cours')], [false, false]);
  mock.timers.tick(1100);
  objet.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, clientX: 150, clientY: 430 }));
  assert.equal(jeu.querySelector('.feedback').className, 'feedback', 'le doigt levé tard ne compte pas pour la manche suivante');
});
