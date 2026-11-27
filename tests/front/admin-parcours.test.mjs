/* ============================================================================
   L'éditeur de parcours des ateliers (/evenements-admin/parcours…) :
   équivalence du formulaire de slide avec l'ancien éditeur, fenêtre d'une
   slide, éditeur (parcours et déroulé d'événement), bibliothèque.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FauxEvenement, fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const UI = '../../services/web/front/ui/admin/ateliers/';
const ancien = await import('./reference/ancien-editeur-parcours.js');
const formulaire = await import(UI + 'formulaire-slide.js');
const { rangDepot, deplacer } = await import(UI + 'outils-ateliers.js');
const { cibleDe, resumeDeroule } = await import(UI + 'parcours-edition.js');
await import(UI + 'parcours.js');

const g = /** @type {any} */ (globalThis);

/** Le registre des types, tel que parcours.php?action=types le rend. */
const REGISTRE = {
  titre: { nom: 'Titre de partie', icone: '🔖', note: false, repond: false },
  texte: { nom: 'Texte', icone: '📄', note: false, repond: false },
  anecdote: { nom: 'Anecdote', icone: '💡', note: false, repond: false },
  sommaire: { nom: 'Sommaire', icone: '🗂️', note: false, repond: false },
  media: { nom: 'Média plein écran', icone: '🎬', note: false, repond: false },
  classement: { nom: 'Classement', icone: '🏆', note: false, repond: false },
  fin: { nom: 'Remerciement', icone: '🙏', note: false, repond: false },
  encouragement: { nom: 'Encouragement', icone: '🌱', note: false, repond: false },
  quiz: { nom: 'Quiz (QCM)', icone: '🧠', note: 'auto', repond: true },
  vrai_faux: { nom: 'Vrai / Faux', icone: '⚖️', note: 'auto', repond: true },
  estimation: { nom: 'Estimation', icone: '📏', note: 'auto', repond: true },
  jeu: { nom: 'Extrait de jeu', icone: '🎮', note: 'auto', repond: true },
  sondage: { nom: 'Sondage', icone: '📊', note: false, repond: true },
  question_ouverte: { nom: 'Question ouverte', icone: '✍️', note: 'manuel', repond: true },
  defi: { nom: 'Défi terrain', icone: '🎯', note: 'manuel', repond: false },
};

const BANQUE = {
  themes: ['eau', 'tri'],
  mots: [],
  anecdotes: [
    { id: 4, texte: 'Un mégot pollue 500 litres d’eau.', emoji: '🚬', theme: 'eau', mots: [] },
    { id: 9, texte: 'Le tri, c’est 30 % de déchets en moins.', emoji: null, theme: 'tri', mots: [] },
  ],
};
const POOLS = {
  'compost-ou-pas': { nom: 'Compost ou pas', items: [{ emoji: '🍌', nom: 'Peau de banane', cat: 'oui', info: 'Oui !' }, { emoji: '🥩', nom: 'Viande', cat: 'non', info: '' }] },
  'mot-mystere': { nom: 'Mot mystère', items: [{ emoji: '🪱', nom: 'Il aère la terre', mot: 'ver', info: '' }] },
};

/** Les réponses du serveur : banque, pools, registre. */
function reseauDeBase(/** @type {(adresse: string, options: any) => any} */ autre = () => null) {
  return fauxFetch((adresse, options) => {
    const r = autre(adresse, options);
    if (r) return r;
    if (adresse.startsWith('/api/evenements/anecdotes.php')) return { corps: structuredClone(BANQUE) };
    if (adresse.startsWith('/api/jeux/catalogue.php')) return { corps: { pools: structuredClone(POOLS) } };
    if (adresse === '/api/evenements/parcours.php?action=types') return { corps: { types: REGISTRE, jeux: formulaire.JEUX_SLIDE } };
    return { corps: { ok: true } };
  });
}

/** La boîte de confirmation la plus récente. */
const boite = () => dom.document.querySelectorAll('cs-dialogue').at(-1);

async function stabiliser() {
  for (let i = 0; i < 5; i++) await dom.stabiliser();
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

const corpsDe = (/** @type {any} */ options) => Object.fromEntries(new URLSearchParams(String(options.body)));
const jsonDe = (/** @type {any} */ options) => JSON.parse(String(options.body));
const soumettre = (/** @type {any} */ formulaire_) => formulaire_.dispatchEvent(new FauxEvenement('submit'));

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

// ── Équivalence avec l'ancien éditeur ───────────────────────────────────────

/** Des slides comme on en trouve dans les parcours : chaque type, ses variantes. */
const CAS = [
  ['titre', { sous_titre: 'Découverte du compost' }],
  ['titre', {}],
  ['texte', { corps: "Ligne 1\nLigne 2 avec <b>balise</b> & esperluette, l'apostrophe" }],
  ['anecdote', { source: 'libre', emoji: '💡', corps: 'Un ver de terre mange son poids par jour.' }],
  ['anecdote', { source: 'banque', anecdote_id: 4 }],
  ['anecdote', { source: 'aleatoire', theme: 'eau' }],
  ['anecdote', {}],
  ['sommaire', {}],
  ['media', { media_type: 'video', url: 'https://www.youtube.com/watch?v=abc&t=3', legende: 'Démo' }],
  ['media', {}],
  ['classement', { portee: 'equipe' }],
  ['encouragement', { animation: 'confettis', message: 'Bravo à tous', sous_titre: '', montrer_score: true }],
  ['encouragement', { animation: 'pousse', message: 'On continue', montrer_score: false }],
  ['fin', { message: 'Merci !', afficher_classement: true }],
  ['fin', {}],
  ['quiz', { question: 'Que met-on au compost ?', multiple: false, options: ['Viande', 'Épluchures', 'Verre'], correct: 1, explication: 'Les épluchures.' }],
  ['quiz', { question: 'Lesquels ?', multiple: true, options: ['A', 'B', 'C', 'D'], correct: [0, 3], explication: '' }],
  ['quiz', { question: 'Aucune cochée', multiple: false, options: ['x', 'y'], correct: 0 }],
  ['quiz', {}],
  ['vrai_faux', { question: 'Le compost sent mauvais.', correct: false, explication: 'Pas s’il est bien fait.' }],
  ['vrai_faux', { question: 'Les vers aident.', correct: true }],
  ['estimation', { question: 'Combien de kg par an ?', valeur: 1250.5, unite: 'kg', tolerance: 10, explication: '' }],
  ['estimation', { question: 'Sans valeur', valeur: null, tolerance: null }],
  ['sondage', { question: 'Vous compostez ?', options: ['Oui', 'Non', 'Pas encore'] }],
  ['sondage', {}],
  ['jeu', { jeu: 'compost-ou-pas', items: [{ emoji: '🍌', nom: 'Peau de banane', cat: 'oui', info: 'Se composte' }, { emoji: '', nom: 'Viande', cat: 'non', info: '' }, { emoji: '🥚', nom: 'Coquille', cat: 'attention', info: '' }] }],
  ['jeu', { jeu: 'temps-decompo', items: [{ emoji: '🍎', nom: 'un trognon', jours: 60, info: 'Deux mois' }, { emoji: '🧴', nom: 'une bouteille', jours: 160000, info: '' }] }],
  ['jeu', { jeu: 'mot-mystere', items: [{ emoji: '🪱', nom: 'Il aère la terre', mot: 'ver', info: '' }] }],
  ['jeu', {}],
  ['question_ouverte', { question: 'Une idée pour le quartier ?', max_car: 280 }],
  ['defi', { consigne: 'Trouve trois insectes du compost.' }],
];

/** @param {string} type @param {object} contenu */
async function avecAncien(type, contenu) {
  dom.monter('<div><div id="champsType"></div><div id="champPoints"></div></div>');
  ancien.poserRegistre(REGISTRE);
  ancien.rendreChamps(type, structuredClone(contenu));
  await stabiliser();
  const lu = ancien.lireChamps(type);
  dom.vider();
  return lu;
}

/** @param {string} type @param {object} contenu */
async function avecNouveau(type, contenu) {
  const fenetre = dom.monter('<cs-admin-slide-edition></cs-admin-slide-edition>');
  fenetre.ouvrir({ type, slide: { id: 1, type, titre: '', points: 0, contenu: structuredClone(contenu) }, registre: REGISTRE, modifiable: true, cible: { fichier: 'parcours.php', cle: 'parcours_id', id: 1 } });
  await stabiliser();
  const lu = fenetre.contenu();
  dom.vider();
  return lu;
}

// 31 slides ouvertes deux fois chacune : plus long que les autres tests.
test('équivalence : une slide ouverte puis enregistrée sans changement donne le même contenu qu’avec l’ancien éditeur', { timeout: 180000 }, async () => {
  reseauDeBase();
  assert.deepEqual(Object.keys(formulaire.CHAMPS), Object.keys(ancien.CHAMPS), 'mêmes types');
  assert.deepEqual(formulaire.CHAMPS, ancien.CHAMPS, 'mêmes champs, mêmes libellés');
  for (const [type, contenu] of CAS) {
    const avant = await avecAncien(type, contenu);
    const apres = await avecNouveau(type, contenu);
    assert.deepEqual(apres, avant, type + ' ' + JSON.stringify(contenu));
  }
  // Chaque type du registre a au moins un cas.
  for (const type of Object.keys(REGISTRE)) assert.ok(CAS.some(([t]) => t === type), type);
});

test('défaut ancien corrigé : un texte avec des guillemets survivait tronqué à la réouverture', async () => {
  reseauDeBase();
  const contenu = { question: 'Q', multiple: false, options: ['Le « bac » dit "marron"', 'B'], correct: 0 };
  // L'ancien echap() n'échappait pas les guillemets : value="Le « bac » dit "marron""
  // se refermait au premier guillemet (un navigateur garde « Le « bac » dit »,
  // le faux DOM refuse carrément ce HTML).
  await assert.rejects(avecAncien('quiz', contenu), /HTML illisible/);
  dom.vider();
  const apres = await avecNouveau('quiz', contenu);
  assert.deepEqual(apres.options, contenu.options);
  const item = { jeu: 'compost-ou-pas', items: [{ emoji: '', nom: 'Sac "compostable"', cat: 'attention', info: 'Lire "OK compost"' }] };
  assert.deepEqual((await avecNouveau('jeu', item)).items, item.items);
});

// ── Fenêtre d'une slide ─────────────────────────────────────────────────────

/** @param {object} ouverture */
async function ouvrirFenetre(ouverture) {
  const fenetre = dom.monter('<cs-admin-slide-edition></cs-admin-slide-edition>');
  fenetre.ouvrir({ registre: REGISTRE, modifiable: true, cible: { fichier: 'parcours.php', cle: 'parcours_id', id: 5 }, slide: null, ...ouverture });
  await stabiliser();
  return fenetre;
}

test('fenêtre : titre, points selon le type, consultation sans bouton d’enregistrement', async () => {
  reseauDeBase();
  let f = await ouvrirFenetre({ type: 'quiz' });
  assert.equal(f.querySelector('.fenetre__titre').textContent, '🧠  Nouvelle slide — Quiz (QCM)');
  assert.equal(f.querySelector('.slide-points').hidden, false);
  assert.equal(f.querySelector('#slide-points').value, '10');
  dom.vider();
  f = await ouvrirFenetre({ type: 'texte', slide: { id: 3, type: 'texte', titre: 'Intro', points: 0, contenu: { corps: 'x' } } });
  assert.equal(f.querySelector('.fenetre__titre').textContent, '📄  Modifier — Texte');
  assert.equal(f.querySelector('.slide-points').hidden, true);
  assert.equal(f.querySelector('#slide-titre').value, 'Intro');
  dom.vider();
  f = await ouvrirFenetre({ type: 'texte', modifiable: false, slide: { id: 3, type: 'texte', titre: '', points: 0, contenu: { corps: 'x' } } });
  assert.equal(f.querySelector('.fenetre__titre').textContent, '📄  Consulter — Texte');
  assert.equal(f.querySelector('[data-action="enregistrer"]').hidden, true);
});

test('fenêtre : réponses ajoutées, retirées, bascule « plusieurs bonnes réponses » sans perte', async () => {
  reseauDeBase();
  const f = await ouvrirFenetre({ type: 'quiz', slide: { id: 1, type: 'quiz', titre: '', points: 10, contenu: { question: 'Q', multiple: false, options: ['A', 'B', 'C'], correct: 2 } } });
  const lignes = () => f.querySelectorAll('[data-cle="options"] .rep-row');
  lignes()[0].querySelector('input[type="text"]').value = 'A modifiée';
  f.querySelector('[data-ajouter="options"]').click();
  assert.equal(lignes().length, 4);
  assert.equal(lignes()[0].querySelector('input[type="text"]').value, 'A modifiée', 'la saisie reste');
  assert.equal(lignes()[2].querySelector('input[type="radio"]').checked, true, 'la coche reste');

  // Plusieurs bonnes réponses : des cases à cocher, et une ligne ajoutée en
  // prend une aussi (l'ancien éditeur y remettait un bouton radio, qu'on ne
  // pouvait plus jamais compter juste).
  const multiple = f.querySelector('[data-cle="multiple"]');
  multiple.cocher(true);
  assert.equal(lignes()[2].querySelector('input[type="checkbox"]').checked, true);
  f.querySelector('[data-ajouter="options"]').click();
  assert.ok(lignes()[4].querySelector('input[type="checkbox"]'));
  lignes()[4].querySelector('input[type="text"]').value = 'E';
  lignes()[4].querySelector('input[type="checkbox"]').checked = true;
  lignes()[1].querySelector('.rep-del').click();
  assert.deepEqual(f.contenu(), { question: 'Q', multiple: true, options: ['A modifiée', 'C', 'E'], correct: [1, 3], explication: '' });

  // Retour à une seule bonne réponse : seule la première coche reste.
  multiple.cocher(false);
  assert.deepEqual(f.contenu().correct, 1);
  assert.equal(f.querySelectorAll('[data-cle="options"] input[type="radio"][checked], [data-cle="options"] input[type="checkbox"]').length, 1);
});

test('fenêtre : changer de jeu repart d’une ligne vide ; import des éléments du jeu du site', async () => {
  const reseau = reseauDeBase();
  const f = await ouvrirFenetre({ type: 'jeu', slide: { id: 1, type: 'jeu', titre: '', points: 10, contenu: { jeu: 'compost-ou-pas', items: [{ emoji: '🍌', nom: 'Peau', cat: 'oui', info: '' }] } } });
  const jeu = f.querySelector('[data-cle="jeu"]');
  jeu.value = 'mot-mystere';
  jeu.dispatchEvent(new FauxEvenement('change'));
  const lignes = f.querySelectorAll('[data-cle="items"] .rep-row');
  assert.equal(lignes.length, 1);
  assert.ok(lignes[0].querySelector('.rep-mot'), 'la ligne a la forme du nouveau jeu');

  f.querySelector('[data-action="importer"]').click();
  await stabiliser();
  assert.equal(reseau.appels.filter((a) => a.adresse === '/api/jeux/catalogue.php?action=pools').length, 1);
  assert.deepEqual(f.contenu().items, [{ emoji: '🪱', nom: 'Il aère la terre', mot: 'ver', info: '' }]);
  assert.equal(f.querySelector('.slide-msg').textContent, '1 éléments importés — retire ceux que tu ne veux pas.');

  // Un jeu sans éléments le dit ; les éléments ne sont demandés qu'une fois.
  jeu.value = 'temps-decompo';
  jeu.dispatchEvent(new FauxEvenement('change'));
  f.querySelector('[data-action="importer"]').click();
  await stabiliser();
  assert.equal(f.querySelector('.slide-msg').textContent, 'Aucun élément disponible pour ce jeu.');
  assert.equal(reseau.appels.filter((a) => a.adresse.startsWith('/api/jeux/')).length, 1);
});

test('fenêtre : anecdote — champs selon la provenance, une anecdote absente de la banque reste choisie', async () => {
  reseauDeBase();
  const f = await ouvrirFenetre({ type: 'anecdote', slide: { id: 1, type: 'anecdote', titre: '', points: 0, contenu: { source: 'banque', anecdote_id: 77 } } });
  const visible = (/** @type {string} */ cle) => !f.querySelector('[data-champ="' + cle + '"]').hidden;
  assert.deepEqual(['corps', 'emoji', 'anecdote_id', 'theme'].map(visible), [false, false, true, false]);
  const choix = f.querySelector('[data-cle="anecdote_id"]');
  assert.equal(choix.value, '77', 'pas de remplacement silencieux par la première anecdote');
  assert.match(choix.querySelector('option').textContent, /absente de la banque/);
  assert.equal(choix.querySelectorAll('option').length, 3);

  const source = f.querySelector('[data-cle="source"]');
  source.value = 'aleatoire';
  source.dispatchEvent(new FauxEvenement('change'));
  assert.deepEqual(['corps', 'emoji', 'anecdote_id', 'theme'].map(visible), [false, false, false, true]);
  assert.deepEqual(f.querySelectorAll('[data-cle="theme"] option').map((/** @type {any} */ o) => o.getAttribute('value')), ['', 'eau', 'tri']);
});

test('fenêtre : une banque injoignable le dit, sans perdre l’anecdote choisie', async () => {
  reseauDeBase((adresse) => (adresse.startsWith('/api/evenements/anecdotes.php') ? { statut: 500, texte: 'panne' } : null));
  let f;
  await enSilence(async () => {
    f = await ouvrirFenetre({ type: 'anecdote', slide: { id: 1, type: 'anecdote', titre: '', points: 0, contenu: { source: 'banque', anecdote_id: 4 } } });
  });
  assert.equal(f.querySelector('.slide-msg').hidden, false);
  assert.equal(f.querySelector('[data-cle="anecdote_id"]').value, '4');
});

test('fenêtre : enregistrer — ajout puis modification, refus affiché dans la fenêtre', async () => {
  let refus = false;
  const reseau = reseauDeBase((_adresse, options) => (options.method === 'POST' ? (refus ? { corps: { error: 'Le texte est vide ou trop long.' } } : { corps: { ok: true, id: 8 } }) : null));
  const f = await ouvrirFenetre({ type: 'texte' });
  let enregistree = 0;
  f.addEventListener('slide-enregistree', () => { enregistree++; });
  f.querySelector('#slide-titre').value = ' Intro ';
  f.querySelector('[data-cle="corps"]').value = 'Bonjour';
  f.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  let envoi = reseau.appels.filter((a) => a.options.method === 'POST').at(-1);
  assert.equal(envoi.adresse, '/api/evenements/parcours.php?action=slide_ajouter');
  // Les points cachés partent quand même, à leur valeur par défaut, comme avant.
  assert.deepEqual(jsonDe(envoi.options), { titre: ' Intro ', points: 10, contenu: { corps: 'Bonjour' }, parcours_id: 5, type: 'texte' });
  assert.equal(f.ouverte, false);
  assert.equal(enregistree, 1);

  // Déroulé d'un événement : autre endpoint, même corps.
  f.ouvrir({ type: 'quiz', registre: REGISTRE, modifiable: true, cible: { fichier: 'admin.php', cle: 'evenement_id', id: 12 }, slide: { id: 40, type: 'quiz', titre: '', points: 20, contenu: { question: 'Q', options: ['A', 'B'], correct: 1 } } });
  await stabiliser();
  refus = true;
  await enSilence(async () => {
    f.querySelector('[data-action="enregistrer"]').click();
    await stabiliser();
  });
  envoi = reseau.appels.filter((a) => a.options.method === 'POST').at(-1);
  assert.equal(envoi.adresse, '/api/evenements/admin.php?action=slide_modifier');
  assert.deepEqual(jsonDe(envoi.options), { titre: '', points: 20, contenu: { question: 'Q', multiple: false, options: ['A', 'B'], correct: 1, explication: '' }, id: 40 });
  assert.equal(f.ouverte, true, 'un refus laisse la fenêtre ouverte');
  assert.equal(f.querySelector('.slide-msg').textContent, 'Le texte est vide ou trop long.');
  assert.equal(enregistree, 1);
});

// ── L'éditeur ───────────────────────────────────────────────────────────────

test('éditeur : l’adresse dit ce qu’on édite ; résumé ; place d’une ligne lâchée', () => {
  assert.deepEqual(cibleDe('/evenements-admin/v2/parcours/7'), { fichier: 'parcours.php', detail: 'detail', cle: 'parcours_id', id: 7, evenement: false });
  assert.deepEqual(cibleDe('/evenements-admin/parcours/7/'), { fichier: 'parcours.php', detail: 'detail', cle: 'parcours_id', id: 7, evenement: false });
  assert.deepEqual(cibleDe('/evenements-admin/v2/12/deroule'), { fichier: 'admin.php', detail: 'deroule', cle: 'evenement_id', id: 12, evenement: true });
  assert.equal(cibleDe('/evenements-admin/v2/parcours'), null);
  assert.equal(cibleDe('/evenements-admin/v2/parcours/abc'), null);

  assert.equal(resumeDeroule([{ points: 10 }, { points: 0 }, { points: 5 }].map((s, i) => ({ id: i, type: 'quiz', titre: '', contenu: {}, ...s }))), '3 slide(s) · 15 points au total');
  assert.equal(resumeDeroule([], [{ nom: 'Base', nb_slides: 4 }, { nom: 'Quiz', nb_slides: 2 }]), '0 slide(s) · 0 points au total · monté depuis Base (4) + Quiz (2)');

  // 4 lignes [a b c d] : où atterrit la ligne `depart` lâchée sur `survol`.
  assert.equal(rangDepot(0, 2, true), 1);    // a avant c → [b a c d]
  assert.equal(rangDepot(0, 2, false), 2);   // a après c → [b c a d]
  assert.equal(rangDepot(3, 0, true), 0);    // d avant a
  assert.equal(rangDepot(3, 1, false), 2);   // d après b
  assert.equal(rangDepot(1, 2, true), null); // b avant c : ne bouge pas
  assert.equal(rangDepot(2, 1, false), null);
  assert.equal(rangDepot(1, 1, true), null);
  assert.deepEqual(deplacer(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
});

const PARCOURS = {
  parcours: { id: 7, nom: 'Atelier 45 min', description: 'Découverte' },
  slides: [
    { id: 70, ordre: 0, type: 'titre', titre: 'Bienvenue', points: 0, contenu: { sous_titre: '' } },
    { id: 71, ordre: 1, type: 'quiz', titre: '', points: 10, contenu: { question: 'Q', options: ['A', 'B'], correct: 0 } },
    { id: 72, ordre: 2, type: 'inconnu', titre: '<b>x</b>', points: 0, contenu: {} },
  ],
};

test('éditeur de parcours : chargement, lignes, informations, ajout d’une slide', async () => {
  dom.aller('/evenements-admin/v2/parcours/7');
  const reseau = reseauDeBase((adresse) => (adresse === '/api/evenements/parcours.php?action=detail&id=7' ? { corps: structuredClone(PARCOURS) } : null));
  const page = dom.monter('<cs-admin-parcours-edition></cs-admin-parcours-edition>');
  await stabiliser();

  assert.equal(page.querySelector('.hero h1').textContent, 'Atelier 45 min');
  assert.equal(page.querySelector('.pe-resume').textContent, '3 slide(s) · 10 points au total');
  assert.equal(page.querySelector('[name="nom"]').value, 'Atelier 45 min');
  assert.equal(page.querySelector('[name="description"]').value, 'Découverte');
  const lignes = page.querySelectorAll('.slide-row');
  assert.equal(lignes.length, 3);
  assert.equal(lignes[0].querySelector('.slide-titre').textContent, 'Bienvenue');
  assert.equal(lignes[1].querySelector('.slide-titre').textContent, 'Quiz (QCM)', 'sans titre : le nom du type');
  assert.equal(lignes[1].querySelector('.slide-pts').textContent, '10 pts');
  assert.equal(lignes[2].querySelector('.slide-titre').textContent, '<b>x</b>');
  assert.equal(lignes[2].querySelector('.slide-icone').textContent, '📄', 'type inconnu : icône par défaut');
  assert.equal(lignes[0].querySelector('[data-monter]').disabled, true);
  assert.equal(lignes[2].querySelector('[data-descendre]').disabled, true);
  assert.ok(lignes[0].hasAttribute('draggable'));
  assert.equal(page.querySelector('.pe-ajout').hidden, false);
  assert.equal(page.querySelectorAll('.pe-type option').length, 15);

  // Modifier le nom.
  page.querySelector('[name="nom"]').value = ' Atelier 1 h ';
  soumettre(page.querySelector('.pe-infos'));
  await stabiliser();
  const envoi = reseau.appels.find((a) => a.adresse === '/api/evenements/parcours.php?action=modifier');
  assert.deepEqual(corpsDe(envoi.options), { id: '7', nom: 'Atelier 1 h', description: 'Découverte' });
  assert.equal(page.querySelector('.msg-page').textContent, 'Enregistré.');

  // Ajouter : la fenêtre s'ouvre sur le type choisi, pour ce parcours.
  page.querySelector('.pe-type').value = 'defi';
  page.querySelector('[data-action="ajouter"]').click();
  await stabiliser();
  const fenetre = page.querySelector('cs-admin-slide-edition');
  assert.equal(fenetre.ouverte, true);
  assert.equal(fenetre.querySelector('.fenetre__titre').textContent, '🎯  Nouvelle slide — Défi terrain');
  fenetre.querySelector('[data-cle="consigne"]').value = 'Trouve un ver';
  const avant = reseau.appels.length;
  fenetre.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.deepEqual(jsonDe(reseau.appels[avant].options), { titre: '', points: 10, contenu: { consigne: 'Trouve un ver' }, parcours_id: 7, type: 'defi' });
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/parcours.php?action=detail&id=7', 'la liste est rechargée');
  assert.equal(reseau.appels.filter((a) => a.adresse.endsWith('action=types')).length, 1, 'le registre n’est demandé qu’une fois');
});

test('éditeur : flèches, glisser-déposer, suppression ; un ordre refusé revient à celui du serveur', async () => {
  dom.aller('/evenements-admin/v2/parcours/7');
  let refus = false;
  const reseau = reseauDeBase((adresse) => {
    if (adresse === '/api/evenements/parcours.php?action=detail&id=7') return { corps: structuredClone(PARCOURS) };
    if (adresse.includes('slide_reordonner') && refus) return { corps: { error: 'Ordre invalide.' } };
    return null;
  });
  const page = dom.monter('<cs-admin-parcours-edition></cs-admin-parcours-edition>');
  await stabiliser();
  const ordre = () => page.querySelectorAll('.slide-row .slide-titre').map((/** @type {any} */ t) => t.textContent);

  page.querySelector('[data-descendre="0"]').click();
  assert.deepEqual(ordre(), ['Quiz (QCM)', 'Bienvenue', '<b>x</b>']);
  await stabiliser();
  let envoi = reseau.appels.filter((a) => a.adresse.includes('slide_reordonner')).at(-1);
  assert.deepEqual(jsonDe(envoi.options), { parcours_id: 7, ordre: [71, 70, 72] });

  // Glisser la 3e ligne avant la 1re.
  const lignes = page.querySelectorAll('.slide-row');
  lignes[2].dispatchEvent(new FauxEvenement('dragstart'));
  assert.ok(lignes[2].classList.contains('glisse'));
  lignes[0].rectangle = { top: 0, height: 40 };
  const survol = new FauxEvenement('dragover');
  survol.clientY = 5;
  lignes[0].dispatchEvent(survol);
  assert.ok(lignes[0].classList.contains('cible-avant'));
  const depot = new FauxEvenement('drop');
  depot.clientY = 5;
  lignes[0].dispatchEvent(depot);
  assert.deepEqual(ordre(), ['<b>x</b>', 'Quiz (QCM)', 'Bienvenue']);
  await stabiliser();
  envoi = reseau.appels.filter((a) => a.adresse.includes('slide_reordonner')).at(-1);
  assert.deepEqual(jsonDe(envoi.options).ordre, [72, 71, 70]);

  // Refusé : message, et la liste revient à celle du serveur.
  refus = true;
  await enSilence(async () => {
    page.querySelector('[data-descendre="0"]').click();
    await stabiliser();
  });
  assert.equal(page.querySelector('.msg-page').textContent, 'Ordre invalide.');
  assert.deepEqual(ordre(), ['Bienvenue', 'Quiz (QCM)', '<b>x</b>']);

  page.querySelector('[data-retirer="1"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Supprimer cette slide ?');
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  envoi = reseau.appels.find((a) => a.adresse === '/api/evenements/parcours.php?action=slide_supprimer');
  assert.deepEqual(corpsDe(envoi.options), { id: '71' });
});

test('déroulé d’un événement démarré : lecture seule, verrou expliqué, retour à l’événement', async () => {
  dom.aller('/evenements-admin/v2/12/deroule');
  const reseau = reseauDeBase((adresse) => (adresse === '/api/evenements/admin.php?action=deroule&id=12'
    ? { corps: { evenement: { id: 12, titre: 'Atelier Mairie', code: 'ABC', statut: 'en_cours' }, slides: structuredClone(PARCOURS.slides), sources: [{ parcours_id: 7, nom: 'Atelier 45 min', nb_slides: 3 }], modifiable: false, verrou: 'L’atelier a démarré.', types: REGISTRE } }
    : null));
  const page = dom.monter('<cs-admin-parcours-edition></cs-admin-parcours-edition>');
  await stabiliser();

  assert.equal(page.querySelector('.hero h1').textContent, 'Déroulé — Atelier Mairie');
  assert.equal(page.querySelector('.hero-badge').textContent, '🎬 Déroulé de l’événement');
  assert.equal(page.querySelector('.pe-resume').textContent, '3 slide(s) · 10 points au total · monté depuis Atelier 45 min (3)');
  assert.equal(page.querySelector('.pe-retour a').getAttribute('href'), '/evenements-admin/12');
  assert.equal(page.querySelector('.pe-infos'), null, 'le nom vient de l’événement');
  assert.deepEqual([page.querySelector('.pe-verrou').hidden, page.querySelector('.pe-verrou').textContent], [false, '🔒 L’atelier a démarré.']);
  assert.equal(page.querySelector('.pe-ajout').hidden, true);
  const ligne = page.querySelector('.slide-row');
  assert.equal(ligne.hasAttribute('draggable'), false);
  assert.equal(ligne.querySelector('.slide-poignee'), null);
  assert.deepEqual(['[data-monter]', '[data-descendre]', '[data-retirer]'].map((s) => ligne.querySelector(s).disabled), [true, true, true]);
  assert.equal(ligne.querySelector('[data-ouvrir]').textContent, '👁');

  ligne.querySelector('[data-ouvrir]').click();
  await stabiliser();
  const fenetre = page.querySelector('cs-admin-slide-edition');
  assert.equal(fenetre.querySelector('.fenetre__titre').textContent, '🔖  Consulter — Titre de partie');
  assert.equal(fenetre.querySelector('[data-action="enregistrer"]').hidden, true);
  assert.equal(reseau.appels.filter((a) => a.options && a.options.method === 'POST').length, 0);
});

test('éditeur : une adresse qui ne désigne rien, un déroulé introuvable', async () => {
  dom.aller('/evenements-admin/v2/parcours/abc');
  reseauDeBase();
  let page = dom.monter('<cs-admin-parcours-edition></cs-admin-parcours-edition>');
  await stabiliser();
  assert.equal(page.querySelector('.pe-slides .cs-etat--erreur').textContent, '⚠️ Adresse inconnue.');
  dom.vider();

  dom.aller('/evenements-admin/v2/parcours/99');
  reseauDeBase((adresse) => (adresse.includes('action=detail') ? { corps: { error: 'Parcours introuvable.' } } : null));
  await enSilence(async () => {
    page = dom.monter('<cs-admin-parcours-edition></cs-admin-parcours-edition>');
    await stabiliser();
  });
  assert.equal(page.querySelector('.pe-slides .cs-etat--erreur').textContent, '⚠️ Parcours introuvable.');
});

// ── La bibliothèque ─────────────────────────────────────────────────────────

test('bibliothèque : liste, création, duplication, suppression', async () => {
  /** @type {string[]} */
  const allees = [];
  g.location.assign = (/** @type {string} */ adresse) => { allees.push(adresse); };
  let refusDuplication = false;
  const reseau = fauxFetch((adresse, options) => {
    if (adresse === '/api/evenements/parcours.php?action=liste') return { corps: { parcours: [{ id: 7, nom: 'Atelier <45>', description: 'Découverte', nb_slides: 3, total_points: 10 }, { id: 8, nom: 'Court', description: '', nb_slides: 0, total_points: 0 }] } };
    if (adresse.includes('action=dupliquer') && refusDuplication) return { corps: { error: 'Parcours introuvable.' } };
    if (options && options.method === 'POST') return { corps: { ok: true, id: 31 } };
    return { corps: {} };
  });
  const page = dom.monter('<cs-admin-parcours></cs-admin-parcours>');
  await stabiliser();

  const items = page.querySelectorAll('.p-item');
  assert.equal(items.length, 2);
  assert.equal(items[0].querySelector('.p-nom').textContent, 'Atelier <45>');
  assert.equal(items[0].querySelector('.p-meta').textContent, '3 slide(s) · 10 pts · Découverte');
  assert.equal(items[1].querySelector('.p-meta').textContent, '0 slide(s) · 0 pts');
  assert.equal(items[0].querySelector('a.ouvrir').getAttribute('href'), '/evenements-admin/v2/parcours/7');

  page.querySelector('[name="nom"]').value = ' Nouveau ';
  soumettre(page.querySelector('.parcours-creation'));
  await stabiliser();
  assert.deepEqual(corpsDe(reseau.appels.find((a) => a.adresse.includes('action=creer')).options), { nom: 'Nouveau', description: '' });
  assert.deepEqual(allees, ['/evenements-admin/v2/parcours/31']);

  page.querySelector('[data-dupliquer="8"]').click();
  await stabiliser();
  assert.deepEqual(corpsDe(reseau.appels.find((a) => a.adresse.includes('action=dupliquer')).options), { id: '8' });
  assert.equal(allees.at(-1), '/evenements-admin/v2/parcours/31');

  // L'ancienne page ne disait rien d'une duplication refusée.
  refusDuplication = true;
  await enSilence(async () => {
    page.querySelector('[data-dupliquer="7"]').click();
    await stabiliser();
  });
  assert.equal(page.querySelector('.msg-page').textContent, 'Parcours introuvable.');
  assert.equal(page.querySelector('[data-dupliquer="7"]').disabled, false);

  page.querySelector('[data-supprimer="7"]').click();
  await stabiliser();
  assert.match(boite().querySelector('.dialogue__texte').textContent, /« Atelier <45> » sera retiré/);
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  assert.deepEqual(corpsDe(reseau.appels.find((a) => a.adresse.includes('action=supprimer')).options), { id: '7' });
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/parcours.php?action=liste');
  delete g.location.assign;
});
