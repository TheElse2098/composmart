/* ============================================================================
   Le lecteur de cours (phase 7) : découpage du texte, rendu du markdown,
   façade vidéo, quiz (notation identique à complete.php, index d'origine
   envoyés au serveur), fin de cours et barre d'XP.
   ============================================================================ */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import vm from 'node:vm';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { session } = await import('../../services/web/front/ui/socle/session.js');
const markdown = await import('../../services/web/front/ui/socle/markdown.js');
const { integration } = await import('../../services/web/front/ui/composants/video/video.js');
const { etapesXp } = await import('../../services/web/front/ui/pages/lecteur-cours/barre-xp.js');
const { bilanFin } = await import('../../services/web/front/ui/pages/lecteur-cours/fin-cours.js');
const { ordreMelange, estMultiple, corriger, noter, progression } = await import('../../services/web/front/ui/pages/lecteur-cours/quiz-cours.js');
const { slugDe, decouper, progressionSection } = await import('../../services/web/front/ui/pages/lecteur-cours/lecteur-cours.js');

const g = /** @type {any} */ (globalThis);

// Bibliothèques du rendu, telles que les pages les trouvent une fois chargées :
// marked met chaque bloc dans un paragraphe, DOMPurify note sa configuration.
/** @type {unknown[]} */
const nettoyages = [];
g.marked = { parse: (/** @type {string} */ t) => '<p>' + t + '</p>' };
g.DOMPurify = { sanitize: (/** @type {string} */ h, /** @type {unknown} */ config) => { nettoyages.push(config); return h; } };
/** @type {Element[]} */
const zonesMaths = [];
g.renderMathInElement = (/** @type {Element} */ zone) => { zonesMaths.push(zone); };

/** @param {Record<string, { statut?: number, corps?: unknown } | Error | ((adresse: string, options: any) => any)>} routes */
function serveur(routes) {
  return fauxFetch((adresse, options) => {
    const route = routes[adresse.split('?')[0]];
    if (!route) return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
    return typeof route === 'function' ? route(adresse, options) : route;
  });
}

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

async function stabiliser() {
  for (let i = 0; i < 4; i++) await dom.stabiliser();
}

const MEMBRE = { logged_in: true, id: 7, username: 'lea', email: 'lea@exemple.fr', xp: 235, niveau: 3, isAdmin: false, email_verifie: true };
const VISITEUR = { logged_in: false };

const QUIZ = [
  { question: 'Le marc de café ?', options: ['Poubelle', 'Compost', 'Recyclage'], correct: 1 },
  { question: 'Lesquels sont des bruns ?', options: ['Carton', 'Tonte', 'Feuilles mortes', 'Épluchures'], correct: [0, 2], multiple: true },
];

/**
 * Monte le lecteur sur /cours-v2/<slug>.
 * @param {{ cours?: any, moi?: any, complete?: any, slug?: string }} [options]
 */
async function monterLecteur({ cours = {}, moi = MEMBRE, complete = { corps: { success: true, xp_earned: 0, score: null } }, slug = 'compost' } = {}) {
  const reseau = serveur({
    '/api/auth/me.php': { corps: moi },
    '/api/cours/get.php': 'statut' in cours ? cours : { corps: { slug, meta: { titre: 'Le compost', emoji: '🌱', niveau: 'debutant', xp: 20 }, texte: TEXTE, ...cours } },
    '/api/cours/complete.php': complete,
  });
  dom.aller('/cours-v2/' + slug);
  const lecteur = dom.monter('<cs-lecteur-cours></cs-lecteur-cours>');
  await stabiliser();
  return { lecteur, reseau };
}

const TEXTE = '# Le compost\n\nIntroduction.\n\n## Les bruns\n\nCarton et feuilles.\n\n## Les verts\n\nTonte, épluchures.\n';

afterEach(async () => {
  session.oublier();
  dom.vider();
  await dom.stabiliser();
});

// ── Fonctions pures ─────────────────────────────────────────────────────────

test('slugDe : /cours/<slug> et l’adresse provisoire /cours-v2/<slug>, rien d’autre', () => {
  assert.equal(slugDe('/cours/le-compost'), 'le-compost');
  assert.equal(slugDe('/cours-v2/le-compost/'), 'le-compost');
  assert.equal(slugDe('/cours'), '');
  assert.equal(slugDe('/cours/a/b'), '');
  assert.equal(slugDe('/cours-detail'), '');
});

test('decouper : une section par « ## », l’introduction sans le titre « # », sections vides ignorées', () => {
  assert.deepEqual(decouper(TEXTE), [
    { titre: '', contenu: 'Introduction.' },
    { titre: 'Les bruns', contenu: 'Carton et feuilles.' },
    { titre: 'Les verts', contenu: 'Tonte, épluchures.' },
  ]);
  // « ### » ne coupe pas, une fin de ligne Windows ne reste pas dans le titre,
  // un titre sans contenu disparaît.
  assert.deepEqual(decouper('## A\r\nUn\n### sous-titre\nDeux\n## Vide\n\n## B\nTrois'), [
    { titre: 'A', contenu: 'Un\n### sous-titre\nDeux' },
    { titre: 'B', contenu: 'Trois' },
  ]);
  assert.deepEqual(decouper('# Seulement le titre\n'), []);
});

test('barres de progression : sections de 0 à 100 %, questions comme avant', () => {
  assert.deepEqual([0, 1, 2].map((i) => progressionSection(i, 3)), [0, 50, 100]);
  assert.equal(progressionSection(0, 1), 100);
  assert.deepEqual([0, 1, 2, 3].map((i) => progression(i, 4)), [0, 25, 50, 75]);
  assert.equal(progression(0, 1), 50);
});

test('ordreMelange : une permutation des index, pilotable par le tirage', () => {
  const ordre = ordreMelange(6);
  assert.deepEqual([...ordre].sort(), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(ordreMelange(4, () => 0), [1, 2, 3, 0]);
  assert.deepEqual(ordreMelange(4, () => 0.999), [0, 1, 2, 3]);
});

test('corriger : réponse unique, réponses multiples à crédit partiel (formule de complete.php)', () => {
  const [simple, multiple] = QUIZ;
  assert.equal(corriger(simple, 1).credit, 1);
  assert.equal(corriger(simple, 0).credit, 0);
  assert.equal(corriger(multiple, [0, 2]).credit, 1);
  assert.equal(corriger(multiple, [0]).credit, 0.5);
  assert.equal(corriger(multiple, [0, 1]).credit, 0);        // une bonne, une mauvaise
  assert.equal(corriger(multiple, [0, 2, 1]).credit, 0.5);   // deux bonnes, une mauvaise
  assert.equal(corriger(multiple, [1, 3]).credit, 0);        // jamais négatif
  assert.deepEqual(corriger(multiple, [0, 1]), { credit: 0, vrais: 1, bonnes: [0, 2] });
  // « multiple » sans tableau, ou l’inverse : réponse unique, comme le serveur.
  assert.equal(estMultiple({ question: '', options: [], correct: 1, multiple: true }), false);
  assert.equal(estMultiple({ question: '', options: [], correct: [1] }), false);
});

test('noter : arrondi au centième et seuil de 50 % jugés comme le serveur', () => {
  assert.deepEqual(noter([1, 0.5]), { score: 1.5, total: 2, pourcent: 75, reussi: true, parfait: false });
  assert.deepEqual(noter([1, 1]), { score: 2, total: 2, pourcent: 100, reussi: true, parfait: true });
  assert.equal(noter([1, 0]).reussi, true);
  // 1,49 / 3 = 49,7 % : affiché « 50 % » une fois arrondi, mais refusé par
  // complete.php. Le résultat doit dire la même chose que le serveur.
  const juste = noter([1, 0.49, 0]);
  assert.equal(juste.pourcent, 50);
  assert.equal(juste.reussi, false);
});

test('bilanFin : XP gagnée, cours déjà fini, refus du serveur', () => {
  assert.deepEqual(bilanFin({ success: true, xp_earned: 20, xp_total: 255, niveau: 3 }, 235), { gagne: 20, ancien: 235, nouveau: 255, niveau: 3 });
  assert.deepEqual(bilanFin({ success: true, xp_earned: 0 }, 235), { gagne: 0, ancien: 235, nouveau: 235, niveau: 3 });
  assert.equal(bilanFin({ success: false }, 235), null);
});

test('etapesXp : départ, arrivée, niveau franchi ou non', () => {
  assert.deepEqual(etapesXp(20, 40, 1), { depart: 20, arrivee: 40, niveau: 1, monte: false });
  assert.deepEqual(etapesXp(95, 115, 2), { depart: 95, arrivee: 15, niveau: 2, monte: true });
  assert.deepEqual(etapesXp(95, 115, null), { depart: 95, arrivee: 15, niveau: 2, monte: true });
});

test('integration : YouTube (court, Shorts, watch) et Vimeo derrière un préfixe fixe, fichier sinon', () => {
  assert.equal(integration('https://youtu.be/abcDEF_123')?.source, 'https://www.youtube-nocookie.com/embed/abcDEF_123?autoplay=1');
  assert.equal(integration('https://www.youtube.com/shorts/abcDEF_123')?.plateforme, 'YouTube');
  assert.equal(integration('https://www.youtube.com/watch?v=abcDEF_123&t=4')?.source, 'https://www.youtube-nocookie.com/embed/abcDEF_123?autoplay=1');
  assert.equal(integration('https://vimeo.com/123456')?.source, 'https://player.vimeo.com/video/123456?dnt=1&autoplay=1');
  assert.equal(integration('/content/cours/x/video.mp4'), null);
  assert.equal(integration(''), null);
});

// ── Rendu du markdown ───────────────────────────────────────────────────────

test('markdown : même configuration de nettoyage que markdown-sur.js (aperçu de l’éditeur)', () => {
  const source = readFileSync(new URL('../../services/web/front/assets/js/markdown-sur.js', import.meta.url), 'utf8');
  /** @type {unknown} */
  let config = null;
  const contexte = { window: {}, marked: { parse: (/** @type {string} */ t) => t }, DOMPurify: { sanitize: (/** @type {string} */ h, /** @type {unknown} */ c) => { config = c; return h; } } };
  vm.runInNewContext(source, contexte);
  /** @type {any} */ (contexte.window).MarkdownSur.rendre('x');
  assert.deepEqual(JSON.parse(JSON.stringify(config)), markdown.NETTOYAGE);
});

test('markdown : sortie de DOMPurify telle quelle ; sans DOMPurify, texte échappé', () => {
  nettoyages.length = 0;
  assert.equal(String(markdown.markdownEnHtml('**gras**')), '<p>**gras**</p>');
  assert.equal(nettoyages[0], markdown.NETTOYAGE);
  const purify = g.DOMPurify;
  delete g.DOMPurify;
  try {
    assert.equal(String(markdown.markdownEnHtml('<img src=x onerror=alert(1)>')), '&lt;img src=x onerror=alert(1)&gt;');
  } finally {
    g.DOMPurify = purify;
  }
});

test('markdown : KaTeX est chargé avant son module de rendu automatique', async () => {
  await markdown.chargerMoteur();
  const demandes = dom.bibliothequesDemandees;
  const katex = demandes.findIndex((a) => a.endsWith('/katex.min.js'));
  const auto = demandes.findIndex((a) => a.endsWith('/auto-render.min.js'));
  assert.ok(katex >= 0 && auto > katex, 'ordre des demandes : ' + demandes.join(', '));
  assert.ok(dom.liensAjoutes.some((l) => String(l.getAttribute('href')).endsWith('/katex.min.css')));
});

test('markdown : finaliser rend les formules et met chaque tableau dans une boîte qui défile, une seule fois', () => {
  const zone = dom.monter('<div><p>$x$</p><table><tr><td>1</td></tr></table></div>');
  zonesMaths.length = 0;
  markdown.finaliser(zone);
  markdown.finaliser(zone);
  assert.equal(zonesMaths[0], zone);
  assert.equal(zone.querySelectorAll('.table-scroll').length, 1);
  assert.equal(zone.querySelector('.table-scroll table') !== null, true);
});

// ── Le lecteur ──────────────────────────────────────────────────────────────

test('lecteur : en-tête échappé, sections, navigation, quiz au bout', async () => {
  const { lecteur, reseau } = await monterLecteur({ cours: { quiz: QUIZ, meta: { titre: 'Le <b>compost</b>', emoji: '🌱', niveau: 'expert', xp: 20 } } });
  assert.equal(reseau.appels.find((a) => a.adresse.startsWith('/api/cours/get.php'))?.adresse, '/api/cours/get.php?slug=compost');
  assert.equal(lecteur.querySelector('.course-title-main').textContent, 'Le <b>compost</b>');
  assert.equal(dom.document.title, 'CompoSmart – Le <b>compost</b>');
  assert.match(lecteur.querySelector('.course-badges').textContent, /🔥 Expert\s*\+20 XP/);

  // Pas de vidéo ni de podcast : pas d’onglet. Le quiz existe : onglet actif.
  assert.deepEqual(lecteur.querySelectorAll('[data-onglet]').map((/** @type {any} */ b) => b.dataset.onglet), ['cours', 'quiz']);
  assert.ok(!lecteur.querySelector('[data-onglet="quiz"]').classList.contains('disabled'));

  const sections = lecteur.querySelectorAll('[data-section]');
  assert.equal(sections.length, 3);
  assert.ok(sections[0].classList.contains('active'));
  assert.equal(sections[0].querySelector('.lesson-title'), null);
  assert.equal(sections[1].querySelector('.lesson-title').textContent, 'Les bruns');
  assert.equal(sections[1].querySelector('.lesson-body p').textContent, 'Carton et feuilles.');
  assert.equal(lecteur.querySelector('.lecon-progression .progress-label').textContent, 'Section 1 / 3');
  assert.equal(sections[0].querySelector('[data-action="precedente"]'), null);

  sections[0].querySelector('[data-action="suivante"]').click();
  assert.ok(sections[1].classList.contains('active') && !sections[0].classList.contains('active'));
  assert.equal(lecteur.querySelector('.lecon-progression .progress-label').textContent, 'Section 2 / 3');
  assert.equal(lecteur.querySelector('.lecon-progression .progress-fill').style.width, '50%');
  sections[1].querySelector('[data-action="precedente"]').click();
  assert.ok(sections[0].classList.contains('active'));

  const fin = sections[2].querySelector('.btn-next');
  assert.equal(fin.textContent, 'Faire le quiz 🧠');
  fin.click();
  assert.ok(lecteur.querySelector('[data-panneau="quiz"]').classList.contains('active'));
  assert.ok(!lecteur.querySelector('[data-panneau="cours"]').classList.contains('active'));
  assert.ok(lecteur.querySelector('[data-onglet="quiz"]').classList.contains('active'));
  assert.equal(lecteur.querySelector('cs-quiz-cours .progress-label').textContent, 'Question 1 / 2');
});

test('lecteur : vidéo et podcast en onglets, adresse et textes échappés, champs vides omis', async () => {
  const { lecteur } = await monterLecteur({ cours: {
    video: { titre: 'Bien démarrer', auteur: 'Léa', duree: '4 min', url: 'https://youtu.be/abcDEF_123' },
    podcast: { url: '/content/cours/compost/episode "1".mp3', auteur: 'Composmart' },
  } });
  assert.deepEqual(lecteur.querySelectorAll('[data-onglet]').map((/** @type {any} */ b) => b.dataset.onglet), ['cours', 'video', 'podcast', 'quiz']);
  assert.ok(lecteur.querySelector('[data-onglet="quiz"]').classList.contains('disabled'));

  lecteur.querySelector('[data-onglet="video"]').click();
  const video = lecteur.querySelector('[data-panneau="video"]');
  assert.ok(video.classList.contains('active'));
  assert.equal(video.querySelector('cs-video').getAttribute('adresse'), 'https://youtu.be/abcDEF_123');
  assert.equal(video.querySelector('.media-title').textContent, 'Bien démarrer');
  // Avant le clic : la façade, aucune iframe vers la plateforme.
  assert.equal(video.querySelector('iframe'), null);
  video.querySelector('.video-facade-btn').click();
  const cadre = video.querySelector('iframe');
  assert.equal(cadre.src, 'https://www.youtube-nocookie.com/embed/abcDEF_123?autoplay=1');
  assert.equal(video.querySelector('.video-facade'), null);

  const podcast = lecteur.querySelector('[data-panneau="podcast"]');
  assert.equal(podcast.querySelector('audio').getAttribute('src'), '/content/cours/compost/episode "1".mp3');
  assert.equal(podcast.querySelector('.media-title'), null, 'pas de titre vide');
  assert.equal(podcast.querySelector('.media-duration'), null, 'pas de durée vide');
  assert.equal(podcast.querySelector('.media-author').textContent, 'par Composmart');
});

test('lecteur : vidéo hébergée sur le site, lue par <video>', async () => {
  const { lecteur } = await monterLecteur({ cours: { video: { url: '/content/cours/compost/video.mp4' } } });
  assert.equal(lecteur.querySelector('cs-video video').getAttribute('src'), '/content/cours/compost/video.mp4');
  assert.equal(lecteur.querySelector('cs-video .video-facade'), null);
});

test('lecteur : onglet Quiz grisé sans quiz, le cours se termine sur sa dernière section', async () => {
  const { lecteur, reseau } = await monterLecteur({ complete: { corps: { success: true, xp_earned: 20, xp_total: 255, niveau: 3 } } });
  lecteur.querySelector('[data-onglet="quiz"]').click();
  assert.ok(lecteur.querySelector('[data-panneau="cours"]').classList.contains('active'), 'onglet grisé : rien ne change');

  const derniere = lecteur.querySelectorAll('[data-section]')[2];
  derniere.querySelector('[data-action="terminer"]').click();
  derniere.querySelector('[data-action="terminer"]').click();
  await stabiliser();
  const envois = reseau.appels.filter((a) => a.adresse === '/api/cours/complete.php');
  assert.equal(envois.length, 1, 'une seule validation');
  assert.deepEqual(JSON.parse(envois[0].options.body), { slug: 'compost', answers: [] });
  const fin = derniere.querySelector('cs-fin-cours[encadre]');
  assert.equal(fin.querySelector('.xp-gained').textContent, '+20 XP gagnés ! 🎉');
  assert.equal(fin.querySelector('cs-barre-xp .xp-niveau').textContent, 'Niveau 3');
  assert.equal(fin.querySelector('cs-barre-xp .xp-texte').textContent, '55 / 100 XP');
});

test('lecteur : un visiteur qui termine est invité à se connecter, le serveur est quand même prévenu', async () => {
  const { lecteur, reseau } = await monterLecteur({ moi: VISITEUR, complete: { corps: { success: true, xp_earned: 0, score: null } } });
  lecteur.querySelectorAll('[data-section]')[2].querySelector('[data-action="terminer"]').click();
  await stabiliser();
  assert.equal(reseau.appels.filter((a) => a.adresse === '/api/cours/complete.php').length, 1);
  assert.ok(lecteur.querySelector('cs-fin-cours .fin-invitation'));
  assert.equal(lecteur.querySelector('cs-fin-cours a.fin-connexion').getAttribute('href'), '/login');
  assert.equal(lecteur.querySelector('cs-fin-cours .xp-gained'), null);
});

test('lecteur : panne à l’enregistrement d’un membre, dite au lieu d’être avalée', async () => {
  await enSilence(async () => {
    const { lecteur } = await monterLecteur({ complete: { statut: 500, corps: { error: 'DB error' } } });
    lecteur.querySelectorAll('[data-section]')[2].querySelector('[data-action="terminer"]').click();
    await stabiliser();
    assert.match(lecteur.querySelector('cs-fin-cours .fin-erreur').textContent, /progression n'a pas pu être enregistrée/);
  });
});

test('lecteur : cours inconnu, panne, adresse sans cours', async () => {
  await enSilence(async () => {
    const { lecteur } = await monterLecteur({ cours: { statut: 404, corps: { error: 'cours introuvable' } } });
    assert.equal(lecteur.querySelector('.introuvable h1').textContent, 'Cours introuvable');
    assert.equal(lecteur.querySelector('.introuvable a').getAttribute('href'), '/cours');
  });
  dom.vider();
  session.oublier();
  await enSilence(async () => {
    const { lecteur } = await monterLecteur({ cours: { statut: 500, corps: { error: 'DB error' } } });
    assert.equal(lecteur.querySelector('.introuvable h1').textContent, "Ce cours n'a pas pu être chargé");
  });
  dom.vider();
  const reseau = serveur({});
  dom.aller('/cours-v2/');
  const lecteur = dom.monter('<cs-lecteur-cours></cs-lecteur-cours>');
  await stabiliser();
  assert.equal(lecteur.querySelector('.introuvable h1').textContent, 'Cours introuvable');
  assert.equal(reseau.appels.length, 0);
});

// ── Le quiz ─────────────────────────────────────────────────────────────────

/** @param {any} quiz @param {number} option */
function option(quiz, option) {
  return quiz.querySelector('.quiz-opt[data-option="' + option + '"]');
}

test('quiz : options mélangées mais repérées par leur index d’origine, deux temps, correction', async () => {
  const { lecteur } = await monterLecteur({ cours: { quiz: QUIZ } });
  const quiz = lecteur.querySelector('cs-quiz-cours');

  // Chaque bouton porte l’index de son option dans la question, quel que soit l’ordre affiché.
  for (const [i, texte] of QUIZ[0].options.entries()) assert.equal(option(quiz, i).textContent, texte);
  assert.equal(quiz.querySelector('.quiz-question').textContent, 'Le marc de café ?');
  const valider = quiz.querySelector('[data-action="valider"]');
  assert.equal(valider.disabled, true);

  option(quiz, 0).click();
  option(quiz, 1).click();
  assert.ok(option(quiz, 1).classList.contains('choisi') && !option(quiz, 0).classList.contains('choisi'));
  assert.equal(valider.disabled, false);
  assert.equal(quiz.querySelector('.quiz-feedback'), null, 'rien de révélé avant validation');

  valider.click();
  assert.ok(option(quiz, 1).classList.contains('correct'));
  assert.equal(option(quiz, 0).className, 'quiz-opt');
  assert.equal(option(quiz, 0).disabled, true);
  assert.match(quiz.querySelector('.quiz-feedback.ok').textContent, /Bonne réponse/);
  option(quiz, 0).click();
  assert.ok(!option(quiz, 0).classList.contains('choisi'), 'réponse figée');
  assert.equal(dom.document.activeElement, quiz.querySelector('[data-action="suivante"]'));

  // Question à plusieurs réponses : cocher, décocher.
  quiz.querySelector('[data-action="suivante"]').click();
  assert.match(quiz.querySelector('.quiz-badge').textContent, /Question 2 \/ 2 · plusieurs bonnes réponses/);
  assert.equal(quiz.querySelector('.progress-fill').style.width, '50%');
  option(quiz, 0).click();
  option(quiz, 1).click();
  option(quiz, 1).click();
  assert.ok(option(quiz, 0).classList.contains('choisi') && !option(quiz, 1).classList.contains('choisi'));
  quiz.querySelector('[data-action="valider"]').click();
  assert.ok(option(quiz, 0).classList.contains('correct'));
  assert.ok(option(quiz, 2).classList.contains('correct'), 'la bonne réponse oubliée est montrée');
  assert.match(quiz.querySelector('.quiz-feedback.ok').textContent, /1 \/ 2 bonnes réponses/);
  assert.equal(quiz.querySelector('[data-action="resultat"]').textContent, 'Voir mes résultats 🎉');
});

test('quiz : mauvaises réponses signalées, multiple sans aucune bonne', async () => {
  const { lecteur } = await monterLecteur({ cours: { quiz: QUIZ } });
  const quiz = lecteur.querySelector('cs-quiz-cours');
  option(quiz, 2).click();
  quiz.querySelector('[data-action="valider"]').click();
  assert.ok(option(quiz, 2).classList.contains('wrong'));
  assert.ok(option(quiz, 1).classList.contains('correct'));
  assert.match(quiz.querySelector('.quiz-feedback.ko').textContent, /Pas tout à fait/);
  quiz.querySelector('[data-action="suivante"]').click();
  option(quiz, 1).click();
  option(quiz, 3).click();
  quiz.querySelector('[data-action="valider"]').click();
  assert.ok(option(quiz, 1).classList.contains('wrong') && option(quiz, 3).classList.contains('wrong'));
  assert.match(quiz.querySelector('.quiz-feedback.ko').textContent, /Pas de bonne réponse/);
});

/** Répond aux deux questions : la première juste, la seconde à moitié (1,5 / 2). @param {any} quiz */
function repondre(quiz) {
  option(quiz, 1).click();
  quiz.querySelector('[data-action="valider"]').click();
  quiz.querySelector('[data-action="suivante"]').click();
  option(quiz, 0).click();
  quiz.querySelector('[data-action="valider"]').click();
  quiz.querySelector('[data-action="resultat"]').click();
}

test('quiz : résultat, réponses envoyées avec leurs index d’origine, XP et barre de niveau', async () => {
  const { lecteur, reseau } = await monterLecteur({ cours: { quiz: QUIZ }, complete: { corps: { success: true, xp_earned: 20, xp_total: 255, niveau: 3 } } });
  const quiz = lecteur.querySelector('cs-quiz-cours');
  repondre(quiz);
  await stabiliser();

  const envois = reseau.appels.filter((a) => a.adresse === '/api/cours/complete.php');
  assert.equal(envois.length, 1);
  assert.deepEqual(JSON.parse(envois[0].options.body), { slug: 'compost', answers: [1, [0]] });

  assert.equal(quiz.querySelector('.progress-label').textContent, 'Résultats');
  assert.equal(quiz.querySelector('.progress-fill').style.width, '100%');
  assert.equal(quiz.querySelector('.result-title').textContent, 'Très bien !');
  assert.equal(quiz.querySelector('.result-score').textContent, '2 / 2');
  assert.equal(quiz.querySelector('.confetti'), null, 'confettis réservés au sans-faute');
  assert.equal(quiz.querySelector('.xp-gained').textContent, '+20 XP gagnés ! 🎉');
  assert.equal(quiz.querySelector('cs-barre-xp .xp-texte').textContent, '55 / 100 XP');
  assert.equal(quiz.querySelector('a.btn-next').getAttribute('href'), '/cours');

  // Recommencer : nouvelle partie, nouvel envoi, et la barre part de l’XP à jour.
  quiz.querySelector('[data-action="recommencer"]').click();
  assert.equal(quiz.querySelector('.progress-label').textContent, 'Question 1 / 2');
  assert.equal(quiz.querySelector('.result-card'), null);
});

test('quiz : sans-faute avec confettis ; cours déjà fini ; visiteur', async () => {
  let reponse = { success: true, xp_earned: 0, score: { correct: 2, total: 2 } };
  const { lecteur, reseau } = await monterLecteur({ cours: { quiz: QUIZ }, complete: () => ({ corps: reponse }) });
  const quiz = lecteur.querySelector('cs-quiz-cours');
  option(quiz, 1).click();
  quiz.querySelector('[data-action="valider"]').click();
  quiz.querySelector('[data-action="suivante"]').click();
  option(quiz, 0).click();
  option(quiz, 2).click();
  quiz.querySelector('[data-action="valider"]').click();
  quiz.querySelector('[data-action="resultat"]').click();
  await stabiliser();
  assert.equal(quiz.querySelector('.result-title').textContent, 'Parfait !');
  assert.equal(quiz.querySelectorAll('.confetti').length, 60);
  assert.equal(quiz.querySelector('.xp-gained.deja').textContent, 'Cours déjà complété.');
  assert.equal(quiz.querySelector('cs-barre-xp .xp-texte').textContent, '35 / 100 XP');
  assert.equal(reseau.appels.filter((a) => a.adresse === '/api/cours/complete.php').length, 1);

  dom.vider();
  session.oublier();
  reponse = { success: true, xp_earned: 0, score: null };
  const visiteur = await monterLecteur({ cours: { quiz: QUIZ }, moi: VISITEUR, complete: () => ({ corps: reponse }) });
  const quizVisiteur = visiteur.lecteur.querySelector('cs-quiz-cours');
  repondre(quizVisiteur);
  await stabiliser();
  assert.ok(quizVisiteur.querySelector('.fin-invitation'));
});

test('quiz : sous les 50 %, le résultat le dit et rien n’est accordé', async () => {
  const { lecteur } = await monterLecteur({ cours: { quiz: QUIZ }, complete: { corps: { success: false, score: { correct: 0, total: 2 }, message: 'Score insuffisant (minimum 50%)' } } });
  const quiz = lecteur.querySelector('cs-quiz-cours');
  option(quiz, 0).click();
  quiz.querySelector('[data-action="valider"]').click();
  quiz.querySelector('[data-action="suivante"]').click();
  option(quiz, 1).click();
  quiz.querySelector('[data-action="valider"]').click();
  quiz.querySelector('[data-action="resultat"]').click();
  await stabiliser();
  assert.equal(quiz.querySelector('.result-title').textContent, 'Continue !');
  assert.match(quiz.querySelector('.result-msg').textContent, /Score insuffisant \(0%\)/);
  assert.equal(quiz.querySelector('cs-fin-cours').textContent.trim(), '');
});
