/* ============================================================================
   Les pages de rubrique (phase 5, livraison 2) : accueil, jeux, liste des
   cours, contact, matériel. Gabarits, montage, et pour l'accueil et le
   matériel, le contenu réel de la page, lu dans son fichier HTML.
   ============================================================================ */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { session } = await import('../../services/web/front/ui/socle/session.js');
const { Jeux } = await import('../../services/web/front/ui/pages/jeux/jeux.js');
const { CoursListe, assombrir, degradeTuile } = await import('../../services/web/front/ui/pages/cours-liste/cours-liste.js');
await import('../../services/web/front/ui/pages/contact/contact.js');
await import('../../services/web/front/ui/pages/accueil/accueil-chiffres.js');
await import('../../services/web/front/ui/pages/accueil/accueil-appel.js');
const { rechercheAchat } = await import('../../services/web/front/ui/pages/materiel/materiel.js');

const FRONT = new URL('../../services/web/front/', import.meta.url);

/** Le morceau d'une page entre deux repères, repères compris. @param {string} page @param {string} debut @param {string} fin */
function extrait(page, debut, fin) {
  const source = readFileSync(new URL(page, FRONT), 'utf8');
  const i = source.indexOf(debut);
  const j = source.indexOf(fin, i);
  assert.ok(i >= 0 && j >= 0, page + ' : ' + debut + ' … ' + fin);
  return source.slice(i, j + fin.length);
}

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

/** @param {string} source @returns {Promise<any>} */
async function monter(source) {
  const element = dom.monter(source);
  await dom.stabiliser();
  return element;
}

const MEMBRE = { logged_in: true, id: 7, username: 'lea', email: 'lea@exemple.fr', xp: 235, niveau: 3, isAdmin: false, email_verifie: true };

afterEach(async () => {
  session.oublier();
  dom.vider();
  await dom.stabiliser();
});

// ── Jeux ────────────────────────────────────────────────────────────────────

const JEUX = [
  { slug: 'tri-eclair', nom: 'Tri éclair', emoji: '⚡', description: 'Trie <vite> !', statut: 'publie', score_max: 100 },
  { slug: 'mot-mystere', nom: 'Mot mystère', emoji: '🔤', description: 'Devine le mot.', statut: 'brouillon', score_max: 50 },
];

test('jeux, gabarit : carte cliquable entière, brouillon marqué, texte échappé, pas de bouton dans le lien', () => {
  const sortie = String(new Jeux().gabaritJeu(JEUX[0], 80));
  assert.match(sortie, /<a class="jeu-card" href="\/jeu-tri-eclair">/);
  assert.match(sortie, /<div class="jeu-desc">Trie &lt;vite&gt; !<\/div>/);
  assert.match(sortie, /<span class="jeu-best">🏆 Record : 80 \/ 100<\/span>/);
  assert.match(sortie, /<span class="jeu-jouer">Jouer<\/span>/);
  assert.ok(!sortie.includes('<button'), 'un bouton dans un lien est du HTML invalide');
  assert.match(String(new Jeux().gabaritJeu(JEUX[1], undefined)), /<div class="jeu-nom">Mot mystère \(brouillon\)<\/div>/);
  assert.ok(!String(new Jeux().gabaritJeu(JEUX[1], undefined)).includes('jeu-best'));
});

test('jeux : un membre voit ses records, pas d’invitation', async () => {
  const { appels } = serveur({
    '/api/jeux/catalogue.php': { corps: { jeux: JEUX } },
    '/api/jeux/score.php': { corps: { logged_in: true, bests: { 'tri-eclair': 72 } } },
  });
  const page = await monter('<cs-jeux></cs-jeux>');
  assert.deepEqual(appels.map((a) => a.adresse).sort(), ['/api/jeux/catalogue.php?action=liste', '/api/jeux/score.php?action=bests']);
  assert.equal(page.querySelector('.login-invite'), null);
  assert.deepEqual(page.querySelectorAll('.jeu-card').map((/** @type {any} */ c) => c.getAttribute('href')), ['/jeu-tri-eclair', '/jeu-mot-mystere']);
  assert.deepEqual(page.querySelectorAll('.jeu-best').map((/** @type {any} */ b) => b.textContent), ['🏆 Record : 72 / 100']);
});

test('jeux : un visiteur est invité à se connecter', async () => {
  serveur({ '/api/jeux/catalogue.php': { corps: { jeux: JEUX } }, '/api/jeux/score.php': { corps: { logged_in: false, bests: {} } } });
  const page = await monter('<cs-jeux></cs-jeux>');
  assert.equal(page.querySelector('.login-invite a').getAttribute('href'), '/compte');
  assert.equal(page.querySelectorAll('.jeu-best').length, 0);
});

test('jeux : sans les records, la liste s’affiche quand même ; sans le catalogue, un message', async () => {
  await enSilence(async () => {
    serveur({ '/api/jeux/catalogue.php': { corps: { jeux: JEUX } }, '/api/jeux/score.php': new TypeError('fetch failed') });
    const page = await monter('<cs-jeux></cs-jeux>');
    assert.equal(page.querySelectorAll('.jeu-card').length, 2);
    assert.equal(page.querySelector('.login-invite'), null, 'on ne sait pas qui est connecté : pas d’invitation');
    dom.vider();

    serveur({ '/api/jeux/catalogue.php': { statut: 503, corps: { error: 'Jeux indisponibles.' } }, '/api/jeux/score.php': { corps: { logged_in: false, bests: {} } } });
    const panne = await monter('<cs-jeux></cs-jeux>');
    assert.equal(panne.querySelector('.cs-etat--erreur').textContent, '⚠️ Jeux indisponibles.');
  });
});

// ── Liste des cours ─────────────────────────────────────────────────────────

const THEMES = [
  { nom: 'Les bases', emoji: '🌱', description: 'Pour <commencer>.', couleur: 'linear-gradient(135deg, #1e6e3e, #2d9959)', cours: [
    { slug: 'pourquoi', titre: 'Pourquoi <composter>', emoji: '♻️', niveau: 'debutant', nb_questions: '3', statut: 'publie', completed: true },
    { slug: 'bac', titre: 'Le bac', emoji: null, niveau: 'expert', nb_questions: '0', statut: 'brouillon', completed: false },
  ] },
  { nom: 'Science', emoji: null, description: null, couleur: null, cours: [
    { slug: 'microbes', titre: 'Les microbes', emoji: '🦠', niveau: 'inconnu', nb_questions: 2, statut: 'publie', completed: false },
  ] },
];

test('assombrir et degradeTuile : la couleur du thème, de plus en plus sombre', () => {
  assert.equal(assombrir('#ffffff', 0.5), '#808080');
  assert.equal(assombrir('#1e6e3e', 1), '#1e6e3e');
  assert.equal(assombrir('pas une couleur', 0.5), 'pas une couleur');
  assert.equal(degradeTuile('linear-gradient(135deg, #1e6e3e, #2d9959)', 0), 'linear-gradient(135deg,#1e6e3e,#2d9959)');
  assert.equal(degradeTuile('linear-gradient(135deg, #ffffff, #000000)', 1), 'linear-gradient(135deg,#adadad,#000000)');
  assert.equal(degradeTuile(null, 0), 'linear-gradient(135deg,#1e6e3e,#2d9959)');
  assert.equal(degradeTuile('radial-gradient(red, blue)', 2), 'radial-gradient(red, blue)', 'une forme inattendue est rendue telle quelle');
});

test('cours, gabarit d’une tuile : niveau, questions, fait, brouillon, texte échappé', () => {
  const liste = new CoursListe();
  const fait = String(liste.gabaritCours(THEMES[0].cours[0]));
  assert.match(fait, /<a href="\/cours\/pourquoi" class="cours-card" data-slug="pourquoi">/);
  assert.match(fait, /<div class="c-done">✓ fait<\/div>/);
  assert.match(fait, /<div class="c-title">Pourquoi &lt;composter&gt;<\/div>/);
  assert.match(fait, /<div class="c-level">Débutant · 3 q\.<\/div>/);
  assert.ok(!fait.includes('c-brouillon'));

  const brouillon = String(liste.gabaritCours(THEMES[0].cours[1]));
  assert.match(brouillon, /<div class="c-brouillon">brouillon<\/div>/);
  assert.match(brouillon, /<div class="c-emoji">📖<\/div>/);
  assert.match(brouillon, /<div class="c-level">Expert<\/div>/, 'zéro question : rien après le niveau');
  assert.match(String(liste.gabaritCours(THEMES[1].cours[0])), /<div class="c-level">inconnu · 2 q\.<\/div>/);
});

test('cours, gabarit d’un thème : un visiteur voit le nombre de cours, un membre ses cours finis', () => {
  const liste = new CoursListe();
  assert.match(String(liste.gabaritTheme(THEMES[0], false)), /<div class="cat-badge">2 cours<\/div>/);
  assert.match(String(liste.gabaritTheme(THEMES[0], true)), /<div class="cat-badge fini">1\/2 fini<\/div>/);
  assert.match(String(liste.gabaritTheme({ ...THEMES[0], cours: THEMES[0].cours.map((c) => ({ ...c, completed: true })) }, true)), /2\/2 finis/);
  assert.match(String(liste.gabaritTheme(THEMES[1], true)), /<div class="cat-badge">1 cours<\/div>/, 'rien de fini : le nombre de cours');
  assert.match(String(liste.gabaritTheme(THEMES[0], false)), /<div class="cat-desc">Pour &lt;commencer&gt;\.<\/div>/);
  assert.ok(!String(liste.gabaritTheme(THEMES[1], false)).includes('cat-desc'));
  assert.match(String(liste.gabaritTheme(THEMES[1], false)), /<div class="cat-icon">📂<\/div>/);
});

test('cours : un membre voit ses tuiles colorées et sa progression', async () => {
  serveur({ '/api/cours/list.php': { corps: { themes: THEMES, user: { xp: 235, niveau: 3, username: 'lea', completed: 1 } } } });
  const page = await monter('<cs-cours-liste></cs-cours-liste>');
  assert.deepEqual(page.querySelectorAll('.cat-title').map((/** @type {any} */ t) => t.textContent), ['Les bases', 'Science']);
  assert.deepEqual(page.querySelectorAll('.cours-card').map((/** @type {any} */ c) => c.style.background), [
    'linear-gradient(135deg,#1e6e3e,#2d9959)',
    'linear-gradient(135deg,#144b2a,#1f683d)',
    'linear-gradient(135deg,#1e6e3e,#2d9959)',
  ]);
  assert.deepEqual(page.querySelectorAll('.stats-val').map((/** @type {any} */ v) => v.textContent), ['1', '235', 'Niv. 3']);
  assert.equal(page.querySelectorAll('.stats-label')[2].textContent, '35 / 100 XP');
  assert.equal(page.querySelector('.niveau-barre').style.width, '35%');
  assert.equal(page.querySelector('.niveau-reste').textContent, 'Niveau 4 dans 65 XP');
  assert.equal(page.querySelector('.login-invite'), null);
});

test('cours : un visiteur est invité à se connecter ; aucun thème, un mot ; panne, un message', async () => {
  await enSilence(async () => {
    serveur({ '/api/cours/list.php': { corps: { themes: [], user: null } } });
    const vide = await monter('<cs-cours-liste></cs-cours-liste>');
    assert.equal(vide.querySelector('.cs-etat').textContent, 'Aucun cours disponible.');
    assert.equal(vide.querySelector('.login-invite-btn').getAttribute('href'), '/login');
    assert.equal(vide.querySelector('.stats-box'), null);
    dom.vider();

    serveur({ '/api/cours/list.php': { statut: 500, corps: { error: 'DB error' } } });
    const panne = await monter('<cs-cours-liste></cs-cours-liste>');
    assert.equal(panne.querySelector('.cs-etat--erreur').textContent, '⚠️ Erreur de chargement des cours.');
  });
});

// ── Contact ─────────────────────────────────────────────────────────────────

test('contact : un visiteur est invité à se connecter, sans formulaire', async () => {
  serveur({ '/api/auth/me.php': { corps: { logged_in: false } } });
  const page = await monter('<cs-contact></cs-contact>');
  assert.equal(page.querySelector('form'), null);
  assert.equal(page.querySelector('.guard-text').textContent, 'Tu dois être connecté pour nous envoyer un message.');
  assert.deepEqual(page.querySelectorAll('.guard-btns a').map((/** @type {any} */ a) => a.getAttribute('href')), ['/login', '/signin']);
});

test('contact : un membre envoie un message, le formulaire se vide et le dit', async () => {
  const { appels } = serveur({ '/api/auth/me.php': { corps: MEMBRE }, '/api/contact/send.php': { corps: { ok: true, ticket: 14 } } });
  const page = await monter('<cs-contact></cs-contact>');
  assert.equal(page.querySelector('label[for="contact-sujet"]').textContent, 'Sujet');
  page.querySelector('[name="categorie"]').choisir('bug');
  page.querySelector('[name="sujet"]').value = '  La carte plante  ';
  page.querySelector('[name="message"]').value = ' Elle ne charge plus depuis hier. ';

  const soumission = new CustomEvent('submit');
  let empeche = false;
  soumission.preventDefault = () => { empeche = true; };
  page.querySelector('form').dispatchEvent(soumission);
  assert.equal(empeche, true);
  assert.deepEqual([page.querySelector('.btn-submit').disabled, page.querySelector('.btn-submit').textContent], [true, 'Envoi…']);
  await dom.stabiliser();

  const envoi = appels.find((a) => a.adresse === '/api/contact/send.php');
  assert.equal(String(envoi?.options.body), 'categorie=bug&sujet=La+carte+plante&message=Elle+ne+charge+plus+depuis+hier.');
  const message = page.querySelector('.msg');
  assert.deepEqual([message.hidden, message.className], [false, 'msg ok']);
  assert.match(message.textContent, /Message envoyé, merci !.*« Mes signalements »/);
  assert.deepEqual([page.querySelector('[name="sujet"]').value, page.querySelector('[name="categorie"]').value], ['', 'question']);
  assert.deepEqual([page.querySelector('.btn-submit').disabled, page.querySelector('.btn-submit').textContent], [false, 'Envoyer']);
});

test('contact : refusé, la raison du serveur s’affiche et le texte reste', async () => {
  await enSilence(async () => {
    serveur({ '/api/auth/me.php': { corps: MEMBRE }, '/api/contact/send.php': { statut: 429, corps: { error: 'Trop de messages récents. Réessaie plus tard.' } } });
    const page = await monter('<cs-contact></cs-contact>');
    page.querySelector('[name="sujet"]').value = 'Sujet';
    page.querySelector('form').dispatchEvent(new CustomEvent('submit'));
    await dom.stabiliser();
    assert.deepEqual([page.querySelector('.msg').className, page.querySelector('.msg').textContent], ['msg error', 'Trop de messages récents. Réessaie plus tard.']);
    assert.equal(page.querySelector('[name="sujet"]').value, 'Sujet');
  });
});

// ── Accueil ─────────────────────────────────────────────────────────────────

const CHIFFRES = extrait('index.html', '<cs-accueil-chiffres', '</cs-accueil-chiffres>');
const APPEL = extrait('index.html', '<cs-accueil-appel>', '</cs-accueil-appel>');

test('accueil : les chiffres du jour remplacent ceux écrits dans la page', async () => {
  serveur({
    '/api/carte/count.php': { corps: { composts: 5812, en_attente: 0, signalements: 0 } },
    '/api/cours/count.php': { corps: { cours: 7 } },
    '/api/jeux/catalogue.php': { corps: { jeux: [...JEUX, { ...JEUX[0], slug: 'x' }] } },
  });
  const chiffres = await monter(CHIFFRES);
  assert.deepEqual(chiffres.querySelectorAll('.stat-num').map((/** @type {any} */ n) => n.textContent), [(5812).toLocaleString('fr-FR') + '+', '7', '2', '100%']);
  assert.deepEqual(chiffres.querySelectorAll('.stat-label').map((/** @type {any} */ n) => n.textContent), ['Composteurs recensés', 'Cours interactifs', 'Mini-jeux', 'Gratuit & open data']);
});

test('accueil : une source en panne laisse la valeur écrite dans la page', async () => {
  await enSilence(async () => {
    serveur({ '/api/carte/count.php': new TypeError('fetch failed'), '/api/cours/count.php': { corps: { cours: 7 } }, '/api/jeux/catalogue.php': { statut: 503, corps: { error: 'Jeux indisponibles.' } } });
    const chiffres = await monter(CHIFFRES);
    assert.deepEqual(chiffres.querySelectorAll('.stat-num').map((/** @type {any} */ n) => n.textContent), ['5 800+', '7', '–', '100%']);
  });
});

test('accueil : le bouton final invite un visiteur à s’inscrire, un membre à continuer ses cours', async () => {
  serveur({ '/api/auth/me.php': { corps: { logged_in: false } } });
  const visiteur = await monter(APPEL);
  assert.deepEqual([visiteur.querySelector('a').getAttribute('href'), visiteur.querySelector('a').textContent], ['/signin', '🌱 Créer mon compte']);
  dom.vider();
  session.oublier();

  serveur({ '/api/auth/me.php': { corps: MEMBRE } });
  const membre = await monter(APPEL);
  assert.deepEqual([membre.querySelector('a').getAttribute('href'), membre.querySelector('a').textContent], ['/cours', '📚 Continuer mes cours']);
  assert.equal(membre.querySelector('a').className, 'btn btn-primary');
});

// ── Matériel ────────────────────────────────────────────────────────────────

const MATERIEL = extrait('materiel.html', '<cs-materiel>', '</cs-materiel>');

test('matériel : rechercheAchat cherche l’objet sur Ecosia, espaces en « + »', () => {
  assert.equal(rechercheAchat('Bac à compost'), 'https://www.ecosia.org/shopping?q=Bac+%C3%A0+compost');
});

test('matériel : un onglet montre sa fiche et cache les autres', async () => {
  const page = await monter(MATERIEL);
  const actif = () => page.querySelectorAll('.tab.active').map((/** @type {any} */ o) => o.dataset.tab);
  const visible = () => page.querySelectorAll('.tab-content.active').map((/** @type {any} */ c) => c.getAttribute('id'));
  assert.deepEqual([actif(), visible()], [['bac'], ['tab-bac']]);

  page.querySelector('[data-tab="lombri"]').click();
  assert.deepEqual([actif(), visible()], [['lombri'], ['tab-lombri']]);
  page.querySelector('[data-tab="commun"]').click();
  assert.deepEqual([actif(), visible()], [['commun'], ['tab-commun']]);
  assert.ok(page.querySelector('.no-compost-fixed'), 'l’encadré « à ne jamais composter » reste, quel que soit l’onglet');
});

test('matériel : seules les fiches achetables ouvrent une recherche, dans un nouvel onglet', async () => {
  /** @type {any[][]} */
  const ouvertures = [];
  /** @type {any} */ (globalThis).open = (/** @type {any[]} */ ...args) => { ouvertures.push(args); };
  const page = await monter(MATERIEL);
  const fiches = page.querySelectorAll('.item-card');
  const achetables = fiches.filter((/** @type {any} */ f) => f.classList.contains('achetable'));
  assert.equal(fiches.length, 21);
  assert.ok(achetables.length > 0 && achetables.length < fiches.length, 'certaines s’achètent, d’autres non');
  for (const fiche of fiches) {
    const prix = fiche.querySelector('.item-price').textContent.trim();
    assert.equal(fiche.classList.contains('achetable'), prix !== 'Gratuit' && prix !== '—', 'prix « ' + prix + ' »');
  }

  fiches.find((/** @type {any} */ f) => !f.classList.contains('achetable')).click();
  assert.equal(ouvertures.length, 0);
  achetables[0].querySelector('.item-desc').click(); // un clic n'importe où sur la fiche
  assert.equal(ouvertures.length, 1);
  assert.deepEqual(ouvertures[0], [rechercheAchat(achetables[0].querySelector('.item-name').textContent.trim()), '_blank', 'noopener']);
});
