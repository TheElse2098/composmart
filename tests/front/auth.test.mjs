/* ============================================================================
   Les pages d'authentification (ui/pages/auth/) : connexion, inscription,
   mot de passe oublié, nouveau mot de passe, confirmation de l'email, compte
   admin initial.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { session } = await import('../../services/web/front/ui/socle/session.js');
await import('../../services/web/front/ui/pages/auth/connexion.js');
await import('../../services/web/front/ui/pages/auth/inscription.js');
await import('../../services/web/front/ui/pages/auth/mot-de-passe-oublie.js');
await import('../../services/web/front/ui/pages/auth/reinitialiser.js');
await import('../../services/web/front/ui/pages/auth/verification-email.js');
await import('../../services/web/front/ui/pages/auth/lancement.js');

/** @param {Record<string, { statut?: number, corps?: unknown } | Error | ((adresse: string, options: any) => any)>} routes */
function serveur(routes) {
  return fauxFetch((adresse, options) => {
    const route = routes[adresse.split('?')[0]];
    if (!route) return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
    return typeof route === 'function' ? route(adresse, options) : route;
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

/** @param {string} balise @returns {Promise<any>} */
async function monter(balise) {
  const element = dom.monter('<' + balise + '></' + balise + '>');
  await dom.stabiliser();
  return element;
}

/** Note les navigations demandées par la page. */
function surveillerNavigation() {
  /** @type {string[]} */
  const vus = [];
  /** @type {any} */ (globalThis).location.assign = (/** @type {string} */ adresse) => { vus.push(adresse); };
  return vus;
}

/** Soumet le formulaire de la carte. @param {any} carte */
function soumettre(carte) {
  const soumission = new CustomEvent('submit');
  let empeche = false;
  soumission.preventDefault = () => { empeche = true; };
  carte.querySelector('form').dispatchEvent(soumission);
  assert.equal(empeche, true, 'la page n’est pas rechargée par le navigateur');
}

/** @param {any} carte @param {Record<string, string>} valeurs  id du champ → valeur */
function remplir(carte, valeurs) {
  for (const [id, valeur] of Object.entries(valeurs)) carte.querySelector('#' + id).value = valeur;
}

/** Laisse aboutir les réponses sans faire avancer les minuteries figées. */
async function laisserRepondre() {
  for (let i = 0; i < 12; i++) await new Promise((resoudre) => setImmediate(resoudre));
}

afterEach(async () => {
  mock.timers.reset();
  session.oublier();
  dom.vider();
  dom.aller('/');
  await dom.stabiliser();
});

// ── La carte commune ────────────────────────────────────────────────────────

test('carte : logo vers l’accueil, titre en h1, aucun message affiché d’emblée', async () => {
  const carte = await monter('cs-connexion');
  assert.equal(carte.querySelector('.auth-logo').getAttribute('href'), '/');
  assert.equal(carte.querySelector('.auth-logo').textContent, 'Composmart');
  assert.equal(carte.querySelector('h1.auth-title').textContent, 'Se connecter');
  assert.equal(carte.querySelector('.avis').hidden, true);
});

test('carte : le bouton 👁 affiche puis masque le mot de passe, et le dit', async () => {
  const carte = await monter('cs-inscription');
  const champ = carte.querySelector('#inscription-mdp');
  const oeil = carte.querySelector('[data-afficher="inscription-mdp"]');
  assert.equal(champ.type, 'password');
  oeil.click();
  assert.deepEqual([champ.type, oeil.getAttribute('aria-label')], ['text', 'Masquer le mot de passe']);
  assert.equal(carte.querySelector('#inscription-mdp2').type, 'password', 'l’autre champ ne bouge pas');
  oeil.click();
  assert.deepEqual([champ.type, oeil.getAttribute('aria-label')], ['password', 'Afficher le mot de passe']);
});

// ── Connexion ───────────────────────────────────────────────────────────────

test('connexion : les champs, les liens vers « mot de passe oublié » et l’inscription', async () => {
  const carte = await monter('cs-connexion');
  assert.equal(carte.querySelector('#connexion-identifiant').getAttribute('autocomplete'), 'username');
  assert.equal(carte.querySelector('#connexion-mdp').getAttribute('autocomplete'), 'current-password');
  assert.equal(carte.querySelector('label[for="connexion-mdp"]').textContent, 'Mot de passe');
  assert.deepEqual(carte.querySelectorAll('.auth-footer a').map((/** @type {any} */ a) => a.getAttribute('href')), ['/mot-de-passe-oublie', '/signin']);
});

test('connexion : acceptée, la demande part et on arrive sur son compte', async () => {
  const navigation = surveillerNavigation();
  const { appels } = serveur({ '/api/auth/login.php': { corps: { ok: true, username: 'lea' } } });
  const carte = await monter('cs-connexion');
  remplir(carte, { 'connexion-identifiant': '  lea  ', 'connexion-mdp': ' mot de passe ' });
  soumettre(carte);
  assert.deepEqual([carte.querySelector('.btn-submit').disabled, carte.querySelector('.btn-submit').textContent], [true, 'Connexion…']);
  await dom.stabiliser();

  assert.equal(envois(appels)[0].adresse, '/api/auth/login.php');
  assert.equal(String(envois(appels)[0].options.body), 'username=lea&password=+mot+de+passe+', 'le pseudo est nettoyé, le mot de passe jamais');
  assert.deepEqual(navigation, ['/compte']);
});

test('connexion : refusée, la raison du serveur s’affiche et on peut réessayer', async () => {
  await enSilence(async () => {
    const navigation = surveillerNavigation();
    serveur({ '/api/auth/login.php': { corps: { error: 'Identifiants incorrects' } } });
    const carte = await monter('cs-connexion');
    soumettre(carte);
    soumettre(carte); // double clic
    await dom.stabiliser();
    const avis = carte.querySelector('.avis');
    assert.deepEqual([avis.hidden, avis.className, avis.textContent], [false, 'avis ko', 'Identifiants incorrects']);
    assert.deepEqual([carte.querySelector('.btn-submit').disabled, carte.querySelector('.btn-submit').textContent], [false, 'Se connecter']);
    assert.deepEqual(navigation, []);
  });
});

test('connexion : trop de tentatives, ou serveur injoignable', async () => {
  await enSilence(async () => {
    serveur({ '/api/auth/login.php': { statut: 429, corps: { error: 'Trop de tentatives. Réessaie dans quelques minutes.' } } });
    const carte = await monter('cs-connexion');
    soumettre(carte);
    await dom.stabiliser();
    assert.equal(carte.querySelector('.avis').textContent, 'Trop de tentatives. Réessaie dans quelques minutes.');

    serveur({ '/api/auth/login.php': new TypeError('fetch failed') });
    soumettre(carte);
    await dom.stabiliser();
    assert.equal(carte.querySelector('.avis').textContent, 'Connexion au serveur impossible.');
  });
});

// ── Inscription ─────────────────────────────────────────────────────────────

test('inscription : mots de passe différents, rien ne part', async () => {
  const { appels } = serveur({ '/api/auth/register.php': { corps: { ok: true } } });
  const carte = await monter('cs-inscription');
  remplir(carte, { 'inscription-mdp': 'abc12345', 'inscription-mdp2': 'abc12346' });
  soumettre(carte);
  await dom.stabiliser();
  assert.equal(envois(appels).length, 0);
  assert.equal(carte.querySelector('.avis').textContent, 'Les mots de passe ne correspondent pas.');
});

test('inscription : acceptée, vers la page de confirmation de l’email', async () => {
  const navigation = surveillerNavigation();
  const { appels } = serveur({ '/api/auth/register.php': { corps: { ok: true, username: 'lea', mail_envoye: true } } });
  const carte = await monter('cs-inscription');
  remplir(carte, { 'inscription-pseudo': ' lea ', 'inscription-email': ' lea@exemple.fr ', 'inscription-mdp': 'abc12345', 'inscription-mdp2': 'abc12345' });
  carte.querySelector('#inscription-cgu').checked = true;
  soumettre(carte);
  await dom.stabiliser();
  assert.equal(String(envois(appels)[0].options.body), 'username=lea&email=lea%40exemple.fr&password=abc12345&cgu=1');
  assert.deepEqual(navigation, ['/verifier']);
});

test('inscription : conditions non cochées, le serveur refuse et le dit', async () => {
  await enSilence(async () => {
    surveillerNavigation();
    const { appels } = serveur({ '/api/auth/register.php': { corps: { error: "Merci d'accepter les conditions d'utilisation." } } });
    const carte = await monter('cs-inscription');
    remplir(carte, { 'inscription-mdp': 'a', 'inscription-mdp2': 'a' });
    soumettre(carte);
    await dom.stabiliser();
    assert.match(String(envois(appels)[0].options.body), /&cgu=$/);
    assert.equal(carte.querySelector('.avis').textContent, "Merci d'accepter les conditions d'utilisation.");
    assert.equal(carte.querySelector('.btn-submit').textContent, 'Créer mon compte');
  });
});

test('inscription : l’information sur les données et les conditions sont là, avec leurs liens', async () => {
  const carte = await monter('cs-inscription');
  assert.equal(carte.querySelector('.cgu-check a').getAttribute('href'), '/cgu');
  assert.equal(carte.querySelector('.rgpd-info a').getAttribute('href'), '/confidentialite');
  assert.match(carte.querySelector('.rgpd-info').textContent, /jamais de publicité, jamais de revente/);
  assert.match(carte.querySelectorAll('.field-aide')[1].textContent, /supprimé au bout de 30 jours/);
});

// ── Mot de passe oublié ─────────────────────────────────────────────────────

test('oubli : la réponse du serveur s’affiche telle quelle et le formulaire disparaît', async () => {
  const { appels } = serveur({ '/api/auth/forgot.php': { corps: { ok: true, message: 'Si un compte correspond, un email vient d’être envoyé.' } } });
  const carte = await monter('cs-mot-de-passe-oublie');
  remplir(carte, { 'oubli-identifiant': '  lea ' });
  soumettre(carte);
  await dom.stabiliser();
  assert.equal(String(envois(appels)[0].options.body), 'identifiant=lea');
  assert.deepEqual([carte.querySelector('.avis').className, carte.querySelector('.avis').textContent], ['avis ok', 'Si un compte correspond, un email vient d’être envoyé.']);
  assert.equal(carte.querySelector('form').hidden, true);
});

test('oubli : sans message du serveur, la phrase neutre ; serveur injoignable, on peut réessayer', async () => {
  serveur({ '/api/auth/forgot.php': { corps: { ok: true } } });
  const carte = await monter('cs-mot-de-passe-oublie');
  soumettre(carte);
  await dom.stabiliser();
  assert.equal(carte.querySelector('.avis').textContent, "Si un compte correspond, un email vient d'être envoyé.");
  dom.vider();

  await enSilence(async () => {
    serveur({ '/api/auth/forgot.php': new TypeError('fetch failed') });
    const panne = await monter('cs-mot-de-passe-oublie');
    soumettre(panne);
    await dom.stabiliser();
    assert.deepEqual([panne.querySelector('.avis').className, panne.querySelector('.avis').textContent], ['avis ko', 'Erreur réseau. Réessaie dans un instant.']);
    assert.equal(panne.querySelector('form').hidden, false);
    assert.equal(panne.querySelector('.btn-submit').disabled, false);
  });
});

// ── Nouveau mot de passe ────────────────────────────────────────────────────

test('nouveau mot de passe : sans jeton dans l’adresse, pas de formulaire', async () => {
  dom.aller('/reinitialiser');
  const carte = await monter('cs-reinitialiser');
  assert.equal(carte.querySelector('form').hidden, true);
  assert.equal(carte.querySelector('.avis').textContent, 'Lien incomplet. Refais une demande depuis « Mot de passe oublié ».');
});

test('nouveau mot de passe : enregistré avec le jeton, puis un bouton pour se connecter', async () => {
  dom.aller('/reinitialiser?token=abc123');
  const { appels } = serveur({ '/api/auth/reset.php': { corps: { ok: true } } });
  const carte = await monter('cs-reinitialiser');
  remplir(carte, { 'reinit-mdp': 'nouveau123', 'reinit-mdp2': 'nouveau123' });
  soumettre(carte);
  await dom.stabiliser();
  assert.equal(String(envois(appels)[0].options.body), 'token=abc123&password=nouveau123');
  assert.equal(carte.querySelector('form').hidden, true);
  assert.equal(carte.querySelector('.avis').textContent, 'Mot de passe modifié. Tu peux maintenant te connecter.');
  const bouton = carte.querySelector('.auth-footer a');
  assert.deepEqual([bouton.getAttribute('href'), bouton.className, bouton.textContent], ['/login', 'btn-submit', 'Se connecter']);
});

test('nouveau mot de passe : différents, rien ne part ; lien expiré, la raison du serveur', async () => {
  await enSilence(async () => {
    dom.aller('/reinitialiser?token=vieux');
    const { appels } = serveur({ '/api/auth/reset.php': { corps: { error: 'Ce lien est invalide ou a expiré. Refais une demande.' } } });
    const carte = await monter('cs-reinitialiser');
    remplir(carte, { 'reinit-mdp': 'a', 'reinit-mdp2': 'b' });
    soumettre(carte);
    await dom.stabiliser();
    assert.equal(envois(appels).length, 0);
    assert.equal(carte.querySelector('.avis').textContent, 'Les mots de passe ne correspondent pas.');

    remplir(carte, { 'reinit-mdp2': 'a' });
    soumettre(carte);
    await dom.stabiliser();
    assert.equal(carte.querySelector('.avis').textContent, 'Ce lien est invalide ou a expiré. Refais une demande.');
    assert.equal(carte.querySelector('form').hidden, false);
    assert.equal(carte.querySelector('.btn-submit').textContent, 'Enregistrer');
  });
});

// ── Confirmation de l'email ─────────────────────────────────────────────────

test('confirmation : le lien du mail confirme l’adresse, en POST', async () => {
  dom.aller('/verifier?token=jeton1');
  const { appels } = serveur({ '/api/auth/verify.php': { corps: { ok: true, username: 'lea' } } });
  const carte = await monter('cs-verification-email');
  assert.equal(envois(appels)[0].adresse, '/api/auth/verify.php');
  assert.equal(String(envois(appels)[0].options.body), 'token=jeton1');
  assert.equal(carte.querySelector('.auth-title').textContent, 'Compte confirmé');
  assert.equal(carte.querySelector('.etat-titre').textContent, "C'est confirmé !");
  assert.equal(carte.querySelector('.btn-submit').getAttribute('href'), '/cours');
});

test('confirmation : lien expiré, la raison et un bouton pour en recevoir un autre', async () => {
  await enSilence(async () => {
    dom.aller('/verifier?token=vieux');
    const { appels } = serveur({
      '/api/auth/verify.php': { corps: { error: 'Ce lien est invalide ou a expiré. Demande un nouvel email de confirmation.' } },
      '/api/auth/resend.php': { corps: { ok: true } },
    });
    const carte = await monter('cs-verification-email');
    assert.equal(carte.querySelector('.auth-title').textContent, 'Lien invalide');
    assert.equal(carte.querySelector('.etat-texte').textContent, 'Ce lien est invalide ou a expiré. Demande un nouvel email de confirmation.');
    assert.equal(carte.querySelector('.lien-secondaire').getAttribute('href'), '/login');

    const bouton = carte.querySelector('[data-action="renvoyer"]');
    assert.equal(bouton.textContent, 'Recevoir un nouveau lien');
    bouton.click();
    await dom.stabiliser();
    assert.equal(envois(appels).at(-1)?.adresse, '/api/auth/resend.php');
    assert.deepEqual([bouton.disabled, bouton.textContent], [true, 'Lien renvoyé']);
    assert.equal(carte.querySelector('.avis').textContent, 'Email envoyé ! Vérifie ta boîte de réception.');
  });
});

test('confirmation : serveur injoignable, un mot, sans prétendre que le lien est mort', async () => {
  await enSilence(async () => {
    dom.aller('/verifier?token=jeton1');
    serveur({ '/api/auth/verify.php': new TypeError('fetch failed') });
    const carte = await monter('cs-verification-email');
    assert.equal(carte.querySelector('.etat-titre').textContent, 'Erreur réseau');
    assert.equal(carte.querySelector('.auth-title').textContent, "Confirmation de l'email");
  });
});

test('confirmation, juste après l’inscription : l’adresse affichée est échappée, le renvoi possible', async () => {
  dom.aller('/verifier');
  serveur({ '/api/auth/me.php': { corps: { logged_in: true, id: 7, username: 'lea', email: 'lea<b>@exemple.fr', xp: 0, niveau: 1, isAdmin: false, email_verifie: false } } });
  const carte = await monter('cs-verification-email');
  assert.equal(carte.querySelector('.etat-titre').textContent, 'Vérifie ta boîte mail');
  assert.equal(carte.querySelector('.etat-texte strong').textContent, 'lea<b>@exemple.fr');
  assert.equal(carte.querySelector('.etat-texte b'), null);
  assert.equal(carte.querySelector('[data-action="renvoyer"]').textContent, 'Renvoyer le lien');
  assert.equal(carte.querySelector('.lien-secondaire').getAttribute('href'), '/compte');
});

test('confirmation, sans lien : visiteur, ou compte déjà confirmé', async () => {
  dom.aller('/verifier');
  serveur({ '/api/auth/me.php': { corps: { logged_in: false } } });
  const visiteur = await monter('cs-verification-email');
  assert.equal(visiteur.querySelector('.etat-titre').textContent, 'Confirme ton adresse');
  assert.equal(visiteur.querySelector('.btn-submit').getAttribute('href'), '/login');
  dom.vider();
  session.oublier();

  serveur({ '/api/auth/me.php': { corps: { logged_in: true, id: 7, username: 'lea', email: 'a@b.fr', xp: 0, niveau: 1, isAdmin: false, email_verifie: true } } });
  const confirme = await monter('cs-verification-email');
  assert.equal(confirme.querySelector('.auth-title').textContent, 'Compte confirmé');
  assert.equal(confirme.querySelector('.etat-titre').textContent, 'Ton compte est déjà confirmé');
});

test('confirmation : renvoi refusé (session expirée), la raison et le bouton de nouveau utilisable', async () => {
  await enSilence(async () => {
    dom.aller('/verifier');
    serveur({
      '/api/auth/me.php': { corps: { logged_in: true, id: 7, username: 'lea', email: 'a@b.fr', xp: 0, niveau: 1, isAdmin: false, email_verifie: false } },
      '/api/auth/resend.php': { statut: 401, corps: { error: 'Connexion requise' } },
    });
    const carte = await monter('cs-verification-email');
    const bouton = carte.querySelector('[data-action="renvoyer"]');
    bouton.click();
    await dom.stabiliser();
    assert.deepEqual([carte.querySelector('.avis').className, carte.querySelector('.avis').textContent], ['avis ko', 'Connexion requise']);
    assert.deepEqual([bouton.disabled, bouton.textContent], [false, 'Renvoyer le lien']);
  });
});

// ── Compte admin initial ────────────────────────────────────────────────────

test('lancement : un administrateur existe déjà, on est renvoyé vers son compte', async () => {
  const navigation = surveillerNavigation();
  mock.timers.enable({ apis: ['setTimeout'] });
  serveur({ '/api/auth/launchpad.php': { corps: { has_admin: true } } });
  const carte = dom.monter('<cs-lancement></cs-lancement>');
  await laisserRepondre();
  assert.equal(carte.querySelector('.etat-titre').textContent, 'Admin déjà configuré');
  assert.equal(carte.querySelector('form'), null);
  assert.deepEqual(navigation, []);
  mock.timers.tick(1800);
  assert.deepEqual(navigation, ['/compte']);
});

test('lancement : site neuf, le formulaire violet, puis le compte créé', async () => {
  const navigation = surveillerNavigation();
  const { appels } = serveur({ '/api/auth/launchpad.php': (_adresse, options) => (options.method === 'POST' ? { corps: { ok: true, username: 'admin' } } : { corps: { has_admin: false } }) });
  const carte = await monter('cs-lancement');
  assert.equal(carte.querySelector('.auth-badge').textContent, '🛠️ Configuration initiale');
  assert.equal(carte.querySelector('.auth-title').textContent, 'Créer le compte admin');
  assert.match(carte.querySelector('.warn-box').textContent, /ne s'affiche qu'une seule fois/);

  remplir(carte, { 'lancement-pseudo': ' admin ', 'lancement-email': 'admin@exemple.fr', 'lancement-mdp': 'abc12345', 'lancement-mdp2': 'abc12345' });
  mock.timers.enable({ apis: ['setTimeout'] });
  soumettre(carte);
  await laisserRepondre();
  assert.equal(String(envois(appels)[0].options.body), 'username=admin&email=admin%40exemple.fr&password=abc12345');
  assert.equal(carte.querySelector('.btn-submit').textContent, '✓ Compte créé, redirection…');
  mock.timers.tick(1000);
  assert.deepEqual(navigation, ['/compte']);
});

test('lancement : serveur muet au départ, le formulaire est proposé ; refus du serveur affiché', async () => {
  await enSilence(async () => {
    serveur({ '/api/auth/launchpad.php': (_adresse, options) => (options.method === 'POST' ? { corps: { error: 'Un compte admin existe déjà.' } } : new TypeError('fetch failed')) });
    const carte = await monter('cs-lancement');
    assert.ok(carte.querySelector('form'));
    remplir(carte, { 'lancement-mdp': 'a', 'lancement-mdp2': 'a' });
    soumettre(carte);
    await dom.stabiliser();
    assert.equal(carte.querySelector('.avis').textContent, 'Un compte admin existe déjà.');
    assert.equal(carte.querySelector('.btn-submit').textContent, '🚀 Créer le compte admin');
  });
});
