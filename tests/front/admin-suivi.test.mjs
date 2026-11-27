/* ============================================================================
   La console d'un atelier (/evenements-admin/<id>), phase 10c-1 : ce qu'elle
   affiche, ce qu'elle ne redessine pas, et qu'elle n'écrit rien.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { FauxEvenement, fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const UI = '../../services/web/front/ui/admin/ateliers/';
const outils = await import(UI + 'suivi-outils.js');
await import(UI + 'suivi.js');

const g = /** @type {any} */ (globalThis);
g.location.origin = 'https://composmart.test';

const REGISTRE = {
  titre: { nom: 'Titre de partie', icone: '🔖', note: false, repond: false },
  quiz: { nom: 'Quiz (QCM)', icone: '🧠', note: 'auto', repond: true },
  classement: { nom: 'Classement', icone: '🏆', note: false, repond: false },
  defi: { nom: 'Défi terrain', icone: '🎯', note: 'manuel', repond: false },
};

const EVT = {
  id: 12, titre: 'Atelier <Mairie>', lieu: 'Salle 3', date_debut: '2026-03-12 14:00:00', code: 'ABC123', statut: 'en_cours', supprime: false,
  parcours_id: 7, mode_equipes: 'aucun', equipes_max: 0, equipe_taille_max: 0, mode_parcours: 'commun', theme_slides: 'papier', image_tags: '',
  nb_slides: 3, parcours_nom: 'Atelier 45 min',
};
const PARTICIPANTS = [
  { id: 1, nom_affiche: 'Léa', equipe_id: 5, rejoint_at: '2026-03-12 14:02:00', points: 20 },
  { id: 2, nom_affiche: '<Tom>', equipe_id: null, rejoint_at: '2026-03-12 14:05:00', points: 0 },
];
const SOMMAIRE = [{ id: 70, type: 'titre', titre: 'Bienvenue' }, { id: 71, type: 'quiz', titre: '' }, { id: 72, type: 'classement', titre: '' }];
const QUIZ = { id: 71, type: 'quiz', titre: '', points: 10, contenu: { question: 'Que met-on au compost ?', options: ['Viande', 'Épluchures', 'Verre'], correct: 1 } };

/**
 * Un serveur d'atelier : l'état se change entre deux tours.
 * @param {{ evenement?: object, participants?: object[], etat?: object, resultats?: object, classement?: object, equipes?: object[], panne?: boolean }} etat
 */
function serveur(etat) {
  return fauxFetch((adresse) => {
    if (etat.panne) return { statut: 500, texte: 'panne' };
    if (adresse.startsWith('/api/evenements/admin.php?action=suivi')) return { corps: { evenement: etat.evenement ?? EVT, participants: etat.participants ?? PARTICIPANTS } };
    if (adresse.startsWith('/api/evenements/parcours.php?action=types')) return { corps: { types: REGISTRE } };
    if (adresse.startsWith('/api/evenements/animation.php?action=etat')) return { corps: etat.etat };
    if (adresse.startsWith('/api/evenements/animation.php?action=resultats')) return { corps: etat.resultats };
    if (adresse.startsWith('/api/evenements/animation.php?action=classement')) return { corps: etat.classement ?? { joueurs: [], equipes: [] } };
    if (adresse.startsWith('/api/evenements/admin.php?action=equipes')) return { corps: { equipes: etat.equipes ?? [] } };
    return { statut: 404, corps: { error: 'inconnu : ' + adresse } };
  });
}

/** @param {object} [surcharge] */
const etatQuiz = (surcharge = {}) => ({
  evenement: { id: 12, theme: 'papier' }, slide: QUIZ, index: 1, total: 3, nb_reponses: 2, nb_participants: 2, sommaire: SOMMAIRE, ...surcharge,
});
const RESULTATS_QUIZ = { type: 'quiz', contenu: QUIZ.contenu, points: 10, reponses: [{ participant_id: 1, nom: 'Léa', reponse: 1 }, { participant_id: 2, nom: 'Tom', reponse: 0 }], repartition: { 0: 1, 1: 1 } };

async function stabiliser() {
  for (let i = 0; i < 6; i++) await dom.stabiliser();
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

/** Monte la console, sondage tenu à la main. */
async function monterConsole() {
  dom.aller('/evenements-admin/v2/12');
  const page = dom.monter('<cs-admin-suivi></cs-admin-suivi>');
  await stabiliser();
  return page;
}

/** Un tour de sondage (3 s). */
async function tour() {
  mock.timers.tick(outils.SONDAGE_MS);
  await stabiliser();
}

afterEach(async () => {
  mock.timers.reset();
  delete g.qrcode;
  dom.vider();
  await dom.stabiliser();
});

// ── Outils ──────────────────────────────────────────────────────────────────

test('outils : adresse, lien, couleur, zones à montrer', () => {
  assert.equal(outils.evenementDe('/evenements-admin/v2/12'), 12);
  assert.equal(outils.evenementDe('/evenements-admin/12/'), 12);
  assert.equal(outils.evenementDe('/evenements-admin/v2'), null);
  assert.equal(outils.lienRejoindre('https://composmart.fr', 'ABC123'), 'https://composmart.fr/evenement?code=ABC123');
  assert.equal(outils.couleurSure('#1e6e3e'), '#1e6e3e');
  assert.equal(outils.couleurSure('red; background: url(x)'), null);
  assert.equal(outils.couleurSure(null), null);
  assert.deepEqual(['prevu', 'ouvert', 'en_cours', 'termine'].map((statut) => outils.derouleOuvert({ statut, supprime: false })), [true, true, false, false]);
  assert.equal(outils.derouleOuvert({ statut: 'prevu', supprime: true }), false);
  assert.equal(outils.montrerResultats(null, 5), false);
  assert.equal(outils.montrerResultats({ type: 'texte' }, 0), false);
  assert.equal(outils.montrerResultats({ type: 'texte' }, 1), true);
  assert.equal(outils.montrerResultats({ type: 'defi' }, 0), true, 'un défi ne se répond pas au téléphone');
  assert.equal(outils.montrerResultats({ type: 'sondage' }, 0), true, 'les barres dès la question posée');
  assert.equal(outils.slideAvecClassement({ type: 'classement' }), true);
  assert.equal(outils.slideAvecClassement({ type: 'fin', contenu: { afficher_classement: true } }), true);
  assert.equal(outils.slideAvecClassement({ type: 'fin', contenu: {} }), false);
});

test('outils : barres des réponses — pourcentage des répondants, juste, en tête', () => {
  assert.deepEqual(outils.barresResultats(RESULTATS_QUIZ), {
    repondants: 2, multi: false,
    barres: [
      { libelle: 'Viande', nb: 1, pct: 50, juste: false, tete: false },
      { libelle: 'Épluchures', nb: 1, pct: 50, juste: true, tete: false },
      { libelle: 'Verre', nb: 0, pct: 0, juste: false, tete: false },
    ],
  });
  // Plusieurs bonnes réponses : la somme dépasse 100 %, c'est voulu.
  const multi = outils.barresResultats({ type: 'quiz', contenu: { options: ['A', 'B'], correct: [0, 1] }, reponses: [{}, {}], repartition: { 0: 2, 1: 1 } });
  assert.deepEqual(multi.barres.map((b) => [b.pct, b.juste]), [[100, true], [50, true]]);
  assert.equal(multi.multi, true);
  const vf = outils.barresResultats({ type: 'vrai_faux', contenu: { correct: false }, reponses: [{}], repartition: { 0: 1 } });
  assert.deepEqual(vf.barres.map((b) => [b.libelle, b.juste]), [['Faux', true], ['Vrai', false]]);
  const sondage = outils.barresResultats({ type: 'sondage', contenu: { options: ['Oui', 'Non', 'Bof'] }, reponses: [{}, {}, {}], repartition: { 0: 2, 2: 1 } });
  assert.deepEqual(sondage.barres.map((b) => [b.tete, b.juste]), [[true, false], [false, false], [false, false]]);
  assert.equal(outils.barresResultats({ type: 'sondage', contenu: { options: ['Oui'] }, reponses: [], repartition: {} }).barres[0].tete, false, 'personne : pas de tête');
  assert.equal(outils.barresResultats({ type: 'defi', contenu: {}, reponses: [], repartition: {} }), null);
  assert.match(outils.heureArrivee('2026-03-12 14:05:00'), /14.05/);
});

// ── La console ──────────────────────────────────────────────────────────────

test('console : carte d’accueil, QR, thème des slides, onglets', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  /** @type {string[]} */
  const qr = [];
  g.qrcode = () => ({ addData: (/** @type {string} */ l) => qr.push(l), make() {}, createDataURL: () => 'data:image/gif;base64,QR' });
  serveur({ etat: etatQuiz(), resultats: RESULTATS_QUIZ });
  const page = await monterConsole();

  assert.equal(page.querySelector('.suivi-attente').hidden, true);
  assert.equal(page.querySelector('.join-titre').textContent, 'Atelier <Mairie>');
  assert.match(page.querySelector('.join-meta').textContent, /^Salle 3 · 12 mars/);
  assert.equal(page.querySelector('.join-code').textContent, 'ABC123');
  assert.equal(page.querySelector('.join-link').textContent, 'https://composmart.test/evenement?code=ABC123');
  assert.equal(page.querySelector('.join-statut').textContent, 'En cours');
  assert.equal(page.querySelector('.join-qr').getAttribute('src'), 'data:image/gif;base64,QR');
  assert.deepEqual(qr, ['https://composmart.test/evenement?code=ABC123']);
  assert.equal(page.getAttribute('data-theme-slide'), 'papier');
  assert.equal(page.querySelector('.nb-participants').textContent, '(2)');
  assert.equal(page.querySelector('.suivi-avis a').getAttribute('href'), '/evenements-admin/12', 'le pilotage reste sur la console en service');

  // Le QR n'est pas refait à chaque tour.
  await tour();
  assert.equal(qr.length, 1);
});

test('console : sans bibliothèque QR, la page marche et le QR arrive au tour suivant', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  serveur({ etat: etatQuiz(), resultats: RESULTATS_QUIZ });
  const page = await monterConsole();
  assert.equal(page.querySelector('.join-qr').hasAttribute('src'), false);
  g.qrcode = () => ({ addData() {}, make() {}, createDataURL: () => 'data:image/gif;base64,TARD' });
  await tour();
  assert.equal(page.querySelector('.join-qr').getAttribute('src'), 'data:image/gif;base64,TARD');
});

test('animation : avancement, carte corrigée, réponses en barres, déroulé', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  serveur({ etat: etatQuiz(), resultats: RESULTATS_QUIZ });
  const page = await monterConsole();
  const anim = page.querySelector('cs-admin-suivi-animation');

  assert.equal(anim.querySelector('.console-pos').textContent, '2 / 3');
  assert.equal(anim.querySelector('.repondu').textContent, '2 / 2 ont répondu');
  assert.equal(anim.querySelector('.progress div').getAttribute('style'), 'width: 66.66666666666666%');
  const carte = anim.querySelector('.apercu .sl');
  assert.ok(carte, 'la carte de la slide');
  assert.ok(anim.querySelector('.apercu .sl__rep--juste'), 'avec la correction');
  assert.equal(anim.querySelector('.anim-resultats').hidden, false);
  const barres = anim.querySelectorAll('.res-opt');
  assert.equal(barres.length, 3);
  assert.equal(barres[1].getAttribute('class'), 'res-opt juste');
  assert.equal(barres[1].getAttribute('style'), '--pct: 50%');
  assert.equal(anim.querySelector('.res-total').textContent.trim(), '2 répondants');
  const lignes = anim.querySelectorAll('.sommaire li');
  assert.deepEqual(lignes.map((/** @type {any} */ l) => l.querySelector('.nom').textContent), ['Bienvenue', 'Quiz (QCM)', 'Classement']);
  assert.equal(lignes[1].getAttribute('class'), 'courante');
  assert.equal(lignes[0].querySelector('.ic').textContent, '🔖');
  // Atelier démarré : plus de lien vers l'édition du déroulé.
  assert.equal(anim.querySelector('.anim-deroule').hidden, true);
  assert.equal(anim.querySelector('.anim-sans-parcours').hidden, true);
});

test('animation : rien n’est redessiné qui n’a pas changé ; la carte change avec la slide', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const etat = { etat: etatQuiz(), resultats: RESULTATS_QUIZ };
  serveur(etat);
  const page = await monterConsole();
  const anim = page.querySelector('cs-admin-suivi-animation');
  const carte = anim.querySelector('.apercu .sl');
  const barre = anim.querySelector('.res-opt');
  const accueil = page.querySelector('.join-titre');

  await tour();
  assert.equal(anim.querySelector('.apercu .sl'), carte, 'la carte n’est pas redessinée (son animation continue)');
  assert.equal(anim.querySelector('.res-opt'), barre, 'les barres non plus');
  assert.equal(page.querySelector('.join-titre'), accueil, 'ni l’accueil');

  // Une réponse arrive : les barres changent, la carte reste.
  etat.resultats = { ...RESULTATS_QUIZ, reponses: [...RESULTATS_QUIZ.reponses, { participant_id: 3, nom: 'Max', reponse: 1 }], repartition: { 0: 1, 1: 2 } };
  etat.etat = etatQuiz({ nb_reponses: 3, nb_participants: 3 });
  await tour();
  assert.equal(anim.querySelector('.apercu .sl'), carte);
  assert.notEqual(anim.querySelector('.res-opt'), barre);
  assert.equal(anim.querySelectorAll('.res-opt')[1].getAttribute('style'), '--pct: 67%');

  // Même slide, mais le thème change : la carte se redessine.
  etat.etat = etatQuiz({ evenement: { id: 12, theme: 'foret' } });
  await tour();
  assert.notEqual(anim.querySelector('.apercu .sl'), carte);
});

test('animation : une carte de classement suit le classement, sans se redessiner s’il ne bouge pas', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const etat = {
    etat: etatQuiz({ slide: { id: 72, type: 'classement', titre: '', points: 0, contenu: { portee: 'individuel' } }, index: 2, nb_reponses: 0 }),
    classement: { joueurs: [{ nom: 'Léa', points: 20 }, { nom: 'Tom', points: 0 }], equipes: [] },
  };
  const reseau = serveur(etat);
  const page = await monterConsole();
  const anim = page.querySelector('cs-admin-suivi-animation');
  const carte = anim.querySelector('.apercu .sl');
  assert.match(carte.textContent, /Léa/);
  assert.equal(anim.querySelector('.anim-resultats').hidden, true);

  await tour();
  assert.equal(anim.querySelector('.apercu .sl'), carte, 'classement inchangé : rien ne bouge');
  etat.classement = { joueurs: [{ nom: 'Tom', points: 30 }, { nom: 'Léa', points: 20 }], equipes: [] };
  await tour();
  assert.notEqual(anim.querySelector('.apercu .sl'), carte);
  assert.ok(reseau.appels.filter((a) => a.adresse.includes('action=classement')).length >= 3);
});

test('animation : avant le démarrage, salle d’attente et lien vers le déroulé ; sans slides, aucune console', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const etat = { evenement: { ...EVT, statut: 'ouvert' }, etat: etatQuiz({ slide: null, index: -1, nb_reponses: 0 }) };
  const reseau = serveur(etat);
  let page = await monterConsole();
  let anim = page.querySelector('cs-admin-suivi-animation');
  assert.equal(anim.querySelector('.apercu-titre').textContent, "Le parcours n'a pas encore démarré");
  assert.equal(anim.querySelector('.console-pos').textContent, '0 / 3');
  assert.equal(anim.querySelector('.anim-deroule').hidden, false);
  assert.equal(anim.querySelector('.anim-lien-deroule').getAttribute('href'), '/evenements-admin/v2/12/deroule');
  assert.equal(anim.querySelector('.anim-deroule-source').textContent, '3 slide(s) dans cet événement.');
  dom.vider();

  etat.evenement = { ...EVT, statut: 'prevu', nb_slides: 0 };
  const avant = reseau.appels.length;
  page = await monterConsole();
  anim = page.querySelector('cs-admin-suivi-animation');
  assert.equal(anim.querySelector('.anim-sans-parcours').hidden, false);
  assert.equal(anim.querySelector('.anim-console').hidden, true);
  assert.equal(reseau.appels.slice(avant).filter((a) => a.adresse.includes('action=etat')).length, 0, 'pas de slides : pas d’état à demander');
});

test('animation : notation à la main — réponses listées, en lecture', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  serveur({
    etat: etatQuiz({ slide: { id: 73, type: 'defi', titre: 'Défi', points: 50, contenu: { consigne: 'Trouve un ver' } }, nb_reponses: 0 }),
    resultats: { type: 'defi', contenu: {}, points: 50, reponses: [{ participant_id: 1, nom: 'Léa', reponse: '<b>fait</b>', points: 50 }], repartition: {} },
  });
  const page = await monterConsole();
  const anim = page.querySelector('cs-admin-suivi-animation');
  assert.equal(anim.querySelector('.anim-resultats').hidden, false);
  assert.equal(anim.querySelector('.resultats .liste .nom').textContent, 'Léa — <b>fait</b>');
  assert.equal(anim.querySelector('.resultats .liste .pts').textContent, '50');
  assert.equal(anim.querySelectorAll('.resultats input, .resultats button').length, 0, 'pas encore de notation (10c-2)');
});

test('participants et classement : chargés à l’ouverture de l’onglet, couleurs sûres', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const reseau = serveur({
    etat: etatQuiz(), resultats: RESULTATS_QUIZ,
    equipes: [{ id: 5, nom: 'Les vers', couleur: '#e53935', membres: 1 }, { id: 6, nom: 'Les <b>', couleur: 'red;x', membres: 0 }],
    classement: { joueurs: [{ nom: 'Léa', points: 20 }], equipes: [{ nom: 'Les vers', points: 20, membres: 1 }] },
  });
  const page = await monterConsole();
  assert.equal(reseau.appels.filter((a) => a.adresse.includes('action=equipes')).length, 0);

  page.querySelector('[data-onglet="participants"]').click();
  await stabiliser();
  assert.equal(page.querySelector('.onglet-participants').hidden, false);
  assert.equal(page.querySelector('.onglet-animation').hidden, true);
  assert.equal(page.classList.contains('large'), false, 'la page reprend sa largeur');
  const part = page.querySelector('cs-admin-suivi-participants');
  const equipes = part.querySelectorAll('.equipes li');
  assert.equal(equipes[0].querySelector('.rang').getAttribute('style'), 'color: #e53935');
  assert.equal(equipes[1].querySelector('.rang').hasAttribute('style'), false, 'couleur douteuse : écartée');
  assert.equal(equipes[1].querySelector('.nom').textContent, 'Les <b>');
  const lignes = part.querySelectorAll('.participants li');
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0].querySelector('.nom').textContent, 'Léa');
  assert.equal(lignes[0].querySelectorAll('.eq')[0].textContent, 'Les vers');
  assert.equal(lignes[1].querySelectorAll('.eq')[0].textContent, '— sans équipe —');
  assert.equal(lignes[0].querySelector('.pts').textContent, '20 pts');
  assert.equal(part.querySelector('.nb').textContent, '(2)');

  page.querySelector('[data-onglet="classement"]').click();
  await stabiliser();
  const cl = page.querySelector('cs-admin-suivi-classement');
  assert.equal(cl.querySelector('.joueurs .nom').textContent, 'Léa');
  assert.equal(cl.querySelector('.classement-equipes').hidden, false);
  assert.equal(cl.querySelector('.equipes .eq').textContent, '1 membres');
});

test('console : panne au premier chargement, puis panne passagère signalée et effacée', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const etat = { panne: true, etat: etatQuiz(), resultats: RESULTATS_QUIZ };
  serveur(etat);
  let page;
  await enSilence(async () => { page = await monterConsole(); });
  assert.ok(page.querySelector('.suivi-contenu .cs-etat--erreur'), 'pas de console vide figée sur « Chargement… »');
  dom.vider();

  etat.panne = false;
  page = await monterConsole();
  etat.panne = true;
  await enSilence(tour);
  const msg = page.querySelector('.msg-page');
  assert.equal(msg.hidden, false);
  assert.match(msg.textContent, /Nouvel essai/);
  assert.ok(page.querySelector('.apercu .sl'), 'la dernière carte reste affichée');
  etat.panne = false;
  await tour();
  assert.equal(msg.hidden, true);
});

test('console : projection — classes posées, Échap la quitte ; la console n’écrit jamais rien', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const reseau = serveur({ etat: etatQuiz(), resultats: RESULTATS_QUIZ });
  const page = await monterConsole();
  page.querySelector('[data-action="projection"]').click();
  assert.ok(page.classList.contains('projection'));
  assert.ok(page.classList.contains('sl-scene'));
  assert.equal(dom.document.body.style.overflow, 'hidden');
  dom.document.dispatchEvent(new g.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(page.classList.contains('projection'), false);
  assert.equal(page.classList.contains('sl-scene'), false);
  assert.equal(dom.document.body.style.overflow, '');

  page.querySelector('[data-onglet="participants"]').click();
  await stabiliser();
  page.querySelector('[data-onglet="classement"]').click();
  await stabiliser();
  await tour();
  assert.equal(reseau.appels.filter((a) => a.options && a.options.method === 'POST').length, 0);
});

test('console : une adresse qui ne désigne aucun événement', async () => {
  serveur({});
  dom.aller('/evenements-admin/v2/abc');
  const page = dom.monter('<cs-admin-suivi></cs-admin-suivi>');
  await stabiliser();
  assert.equal(page.querySelector('.suivi-contenu .cs-etat--erreur').textContent, '⚠️ Adresse inconnue.');
});
