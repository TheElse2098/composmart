/* ============================================================================
   Les composants montés pour de vrai dans le faux DOM : ce qu'ils affichent à
   l'ouverture, ce qu'ils demandent au serveur, ce qu'ils font d'un clic.

   C'est ici que se voit une faute de sélecteur entre un gabarit et le code
   qui s'en sert — ce que ni les types ni les tests de gabarits ne voient.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { session } = await import('../../services/web/front/ui/socle/session.js');
await import('../../services/web/front/ui/composants/bandeau/bandeau.js');
await import('../../services/web/front/ui/composants/pied/pied.js');
await import('../../services/web/front/ui/composants/rappel-email/rappel-email.js');
await import('../../services/web/front/ui/pages/classement/classement.js');
await import('../../services/web/front/ui/admin/accueil/accueil.js');

const VISITEUR = { logged_in: false };
const MEMBRE = { logged_in: true, id: 7, username: 'ana', email: 'ana@exemple.fr', xp: 120, niveau: 2, isAdmin: false, email_verifie: true };
const ADMIN = { ...MEMBRE, id: 1, username: 'eliott', isAdmin: true };
const NON_CONFIRME = { ...MEMBRE, email_verifie: false };

/** @param {number} id @param {string} username @param {number} xp */
const joueur = (id, username, xp) => ({ id, username, xp, niveau: 1 });
const TOP = [joueur(1, 'ana', 500), joueur(2, 'bob', 400), joueur(3, 'cy', 300), joueur(4, 'dee', 200)];

/**
 * Un serveur d'essai : une réponse par endpoint. Un endpoint non prévu échoue,
 * pour qu'un appel inattendu se voie.
 * @param {Record<string, { statut?: number, corps?: unknown, texte?: string } | Error | ((adresse: string) => any)>} routes
 */
function serveur(routes) {
  return fauxFetch((adresse) => {
    const chemin = adresse.split('?')[0];
    const route = routes[chemin];
    if (!route) return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + chemin } };
    return typeof route === 'function' ? route(adresse) : route;
  });
}

/** Fait taire console.error pendant une action qui provoque une erreur attendue. @param {() => Promise<void>} action */
async function enSilence(action) {
  const origine = console.error;
  console.error = () => {};
  try {
    await action();
  } finally {
    console.error = origine;
  }
}

afterEach(async () => {
  dom.vider();
  session.oublier();
  await dom.stabiliser();
});

// ── Bandeau ─────────────────────────────────────────────────────────────────

test('bandeau : barre affichée, tiroir et voile posés sous <body>, lien actif', async () => {
  serveur({ '/api/auth/me.php': { corps: VISITEUR } });
  dom.aller('/classement');
  const bandeau = dom.monter('<cs-bandeau></cs-bandeau>');
  await dom.stabiliser();

  assert.equal(bandeau.querySelector('.bandeau__logo').textContent, 'Composmart');
  assert.equal(bandeau.querySelectorAll('.bandeau__liens a.actif').length, 1);
  assert.equal(bandeau.querySelector('.bandeau__liens a.actif').textContent, 'Classement');

  const tiroir = dom.document.body.querySelector('.bandeau-tiroir');
  assert.ok(tiroir && dom.document.body.querySelector('.bandeau-voile'), 'tiroir et voile sont dans la page');
  assert.equal(tiroir.parentElement, dom.document.body, 'le tiroir est sous <body>, pas dans le bandeau');
  assert.equal(tiroir.querySelector('a.actif').textContent.trim(), '🏆 Classement');
});

test('bandeau : le burger ouvre le tiroir ; la croix, le voile et Échap le ferment', async () => {
  serveur({ '/api/auth/me.php': { corps: VISITEUR } });
  const bandeau = dom.monter('<cs-bandeau></cs-bandeau>');
  await dom.stabiliser();
  const body = dom.document.body;
  const tiroir = body.querySelector('.bandeau-tiroir');
  const voile = body.querySelector('.bandeau-voile');
  const burger = bandeau.querySelector('.bandeau__burger');
  const ouvert = () => tiroir.classList.contains('bandeau-tiroir--ouvert');

  burger.click();
  assert.equal(ouvert(), true);
  assert.equal(voile.classList.contains('bandeau-voile--ouvert'), true);
  assert.equal(burger.classList.contains('bandeau__burger--ouvert'), true);
  assert.equal(burger.getAttribute('aria-expanded'), 'true');
  assert.equal(body.style.overflow, 'hidden', 'la page ne défile pas derrière le tiroir');

  tiroir.querySelector('.bandeau-tiroir__fermer').click();
  assert.equal(ouvert(), false);
  assert.equal(body.style.overflow, '');
  assert.equal(burger.getAttribute('aria-expanded'), 'false');

  burger.click();
  voile.click();
  assert.equal(ouvert(), false);

  burger.click();
  dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(ouvert(), false);
});

test('bandeau : Échap ne touche pas au défilement de la page quand le tiroir est fermé', async () => {
  serveur({ '/api/auth/me.php': { corps: VISITEUR } });
  dom.monter('<cs-bandeau></cs-bandeau>');
  await dom.stabiliser();
  dom.document.body.style.overflow = 'hidden'; // une fenêtre ouverte par un autre composant
  dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(dom.document.body.style.overflow, 'hidden');
});

test('bandeau : le bouton de thème bascule, garde le choix et change d’icône', async () => {
  serveur({ '/api/auth/me.php': { corps: VISITEUR } });
  const bandeau = dom.monter('<cs-bandeau></cs-bandeau>');
  await dom.stabiliser();
  const bouton = bandeau.querySelector('.bandeau__theme');
  assert.equal(bouton.textContent, '🌙');

  bouton.click();
  assert.equal(dom.document.documentElement.classList.contains('dark'), true);
  assert.equal(dom.stockage.get('theme'), 'dark');
  assert.equal(bouton.textContent, '☀️');

  bouton.click();
  assert.equal(dom.document.documentElement.classList.contains('dark'), false);
  assert.equal(bouton.textContent, '🌙');
});

test('bandeau : la case Admin reste masquée pour un visiteur et pour un membre', async () => {
  for (const moi of [VISITEUR, MEMBRE]) {
    serveur({ '/api/auth/me.php': { corps: moi } });
    const bandeau = dom.monter('<cs-bandeau></cs-bandeau>');
    await dom.stabiliser();
    const cases = [...bandeau.querySelectorAll('[data-admin]'), ...dom.document.body.querySelectorAll('.bandeau-tiroir [data-admin]')];
    assert.equal(cases.length, 4);
    assert.ok(cases.every((c) => c.hidden), 'les quatre éléments Admin restent masqués');
    dom.vider();
    session.oublier();
    await dom.stabiliser();
  }
});

test('bandeau : la case Admin apparaît pour un administrateur, active dans un espace d’administration', async () => {
  serveur({ '/api/auth/me.php': { corps: ADMIN } });
  dom.aller('/admin/panel');
  const bandeau = dom.monter('<cs-bandeau></cs-bandeau>');
  await dom.stabiliser();

  const cases = [...bandeau.querySelectorAll('[data-admin]'), ...dom.document.body.querySelectorAll('.bandeau-tiroir [data-admin]')];
  assert.ok(cases.every((c) => !c.hidden), 'les quatre éléments Admin sont révélés');
  assert.equal(bandeau.querySelector('.bandeau__admin a').classList.contains('actif'), true);
  assert.equal(bandeau.querySelector('.bandeau__admin-mini').classList.contains('actif'), true);
  assert.equal(dom.document.body.querySelector('.bandeau-tiroir__admin a').classList.contains('actif'), true);
});

test('bandeau : hors administration, la case Admin d’un administrateur n’est pas marquée active', async () => {
  serveur({ '/api/auth/me.php': { corps: ADMIN } });
  dom.aller('/classement');
  const bandeau = dom.monter('<cs-bandeau></cs-bandeau>');
  await dom.stabiliser();
  assert.equal(bandeau.querySelector('.bandeau__admin-mini').hidden, false);
  assert.equal(bandeau.querySelector('.bandeau__admin-mini').classList.contains('actif'), false);
});

test('bandeau : retiré de la page, il emporte son tiroir et son voile', async () => {
  serveur({ '/api/auth/me.php': { corps: VISITEUR } });
  const bandeau = dom.monter('<cs-bandeau></cs-bandeau>');
  await dom.stabiliser();
  bandeau.querySelector('.bandeau__burger').click();

  bandeau.remove();
  await dom.stabiliser();
  assert.equal(dom.document.body.querySelector('.bandeau-tiroir'), null);
  assert.equal(dom.document.body.querySelector('.bandeau-voile'), null);
  assert.equal(dom.document.body.style.overflow, '', 'le défilement est rendu à la page');
});

// ── Pied ────────────────────────────────────────────────────────────────────

test('pied : affiché sans rien demander au serveur', async () => {
  const { appels } = serveur({});
  const pied = dom.monter('<cs-pied></cs-pied>');
  await dom.stabiliser();
  assert.equal(pied.querySelectorAll('.pied__legal a').length, 3);
  assert.equal(pied.querySelector('.pied__logo').textContent, 'Composmart');
  assert.equal(appels.length, 0);
});

// ── Rappel de confirmation d'email ──────────────────────────────────────────

test('rappel email : rien pour un visiteur ni pour un compte confirmé', async () => {
  for (const moi of [VISITEUR, MEMBRE]) {
    serveur({ '/api/auth/me.php': { corps: moi } });
    const rappel = dom.monter('<cs-rappel-email></cs-rappel-email>');
    await dom.stabiliser();
    assert.equal(rappel.children.length, 0);
    dom.vider();
    session.oublier();
    await dom.stabiliser();
  }
});

test('rappel email : compte non confirmé, puis renvoi du lien', async () => {
  const { appels } = serveur({ '/api/auth/me.php': { corps: NON_CONFIRME }, '/api/auth/resend.php': { corps: { ok: true } } });
  const rappel = dom.monter('<cs-rappel-email></cs-rappel-email>');
  await dom.stabiliser();
  assert.equal(rappel.querySelector('strong').textContent, 'ana@exemple.fr');

  const bouton = rappel.querySelector('button');
  bouton.click();
  assert.equal(bouton.disabled, true);
  assert.equal(bouton.textContent, 'Envoi…');
  await dom.stabiliser();
  assert.equal(bouton.textContent, 'Email envoyé ✓');
  assert.equal(bouton.disabled, true);
  const envoi = appels.find((a) => a.adresse === '/api/auth/resend.php');
  assert.equal(envoi?.options.method, 'POST');
});

test('rappel email : un refus du serveur rend la main pour un nouvel essai', async () => {
  serveur({ '/api/auth/me.php': { corps: NON_CONFIRME }, '/api/auth/resend.php': { statut: 429, corps: { error: 'Trop de demandes.' } } });
  const rappel = dom.monter('<cs-rappel-email></cs-rappel-email>');
  await dom.stabiliser();
  const bouton = rappel.querySelector('button');
  await enSilence(async () => {
    bouton.click();
    await dom.stabiliser();
  });
  assert.equal(bouton.textContent, 'Échec');
  assert.equal(bouton.disabled, false);
});

// ── Classement ──────────────────────────────────────────────────────────────

test('classement : à l’ouverture, le général est demandé et affiché', async () => {
  const { appels } = serveur({ '/api/auth/leaderboard.php': { corps: { top: TOP, me: null, periode: 'total' } } });
  const page = dom.monter('<cs-classement></cs-classement>');
  await dom.stabiliser();

  assert.deepEqual(appels.map((a) => a.adresse), ['/api/auth/leaderboard.php?periode=total']);
  assert.deepEqual(page.querySelectorAll('.pod-name').map((e) => e.textContent), ['bob', 'ana', 'cy']);
  assert.deepEqual(page.querySelectorAll('.lb-rank').map((e) => e.textContent), ['#4']);
  assert.equal(page.querySelector('.hero-sub').textContent, 'Les meilleurs composteurs de la communauté');
  assert.equal(page.querySelector('.per-btn.active').dataset.periode, 'total');
  assert.equal(page.querySelector('.periode-wrap').hidden, false);
});

test('classement : changer de période redemande, déplace le bouton actif et change le sous-titre', async () => {
  const { appels } = serveur({
    '/api/auth/leaderboard.php': (adresse) => ({
      corps: adresse.includes('periode=semaine')
        ? { top: [joueur(9, 'zoe', 30)], me: null, periode: 'semaine' }
        : { top: TOP, me: null, periode: 'total' },
    }),
  });
  const page = dom.monter('<cs-classement></cs-classement>');
  await dom.stabiliser();

  page.querySelector('[data-periode="semaine"]').click();
  assert.equal(page.querySelector('.board .lb-empty').textContent, 'Chargement…');
  await dom.stabiliser();

  assert.equal(appels[1].adresse, '/api/auth/leaderboard.php?periode=semaine');
  assert.deepEqual(page.querySelectorAll('.per-btn.active').map((b) => b.dataset.periode), ['semaine']);
  assert.equal(page.querySelector('.hero-sub').textContent, 'XP gagnée au cours des 7 derniers jours');
  assert.deepEqual(page.querySelectorAll('.lb-xp').map((e) => e.textContent), ['30 XP gagnés']);
  assert.equal(page.querySelector('.podium'), null);

  // Recliquer sur la période affichée ne redemande rien.
  page.querySelector('[data-periode="semaine"]').click();
  await dom.stabiliser();
  assert.equal(appels.length, 2);
});

test('classement : une réponse arrivée après un changement de période est ignorée', async () => {
  /** @type {((reponse: Response) => void)[]} */
  const enAttente = [];
  /** @type {any} */ (globalThis).fetch = () => new Promise((resoudre) => { enAttente.push(resoudre); });
  const page = dom.monter('<cs-classement></cs-classement>');
  await dom.stabiliser();
  page.querySelector('[data-periode="jour"]').click();
  await dom.stabiliser();
  assert.equal(enAttente.length, 2);

  // Le serveur répond d'abord à la seconde demande, puis à la première.
  enAttente[1](new Response(JSON.stringify({ top: [joueur(5, 'du-jour', 10)], me: null })));
  await dom.stabiliser();
  enAttente[0](new Response(JSON.stringify({ top: TOP, me: null })));
  await dom.stabiliser();

  const noms = page.querySelectorAll('.lb-name');
  assert.equal(noms.length, 1);
  assert.match(noms[0].textContent, /^du-jour\s+Niveau 1/);
  assert.equal(page.querySelector('.podium'), null, 'le tableau général, arrivé en retard, n’a pas écrasé celui du jour');
});

test('classement : visiteur non connecté, invitation à la place du tableau', async () => {
  serveur({ '/api/auth/leaderboard.php': { statut: 401, corps: { error: 'Connexion requise.' } } });
  const page = dom.monter('<cs-classement></cs-classement>');
  await dom.stabiliser();

  assert.equal(page.querySelector('.periode-wrap').hidden, true);
  assert.equal(page.querySelector('.hero-sub').textContent, 'Connecte-toi pour découvrir le classement de la communauté');
  assert.equal(page.querySelector('.board .join-cta .btn-primary').getAttribute('href'), '/login');
});

test('classement : serveur en panne, un message d’erreur et non « aucun joueur »', async () => {
  await enSilence(async () => {
    serveur({ '/api/auth/leaderboard.php': { corps: { error: 'db' } } });
    const page = dom.monter('<cs-classement></cs-classement>');
    await dom.stabiliser();
    assert.equal(page.querySelector('.board .lb-empty').textContent, "Le classement n'a pas pu être chargé. Réessaie dans un instant.");

    dom.vider();
    await dom.stabiliser();
    fauxFetch(() => new TypeError('fetch failed'));
    const autre = dom.monter('<cs-classement></cs-classement>');
    await dom.stabiliser();
    assert.equal(autre.querySelector('.board .lb-empty').textContent, 'Connexion au serveur impossible.');
  });
});

// ── Accueil de l'administration ─────────────────────────────────────────────

/** @param {any} page @param {string} cle */
const puces = (page, cle) => page.querySelectorAll('[data-etat="' + cle + '"] .puce').map((/** @type {any} */ p) => p.textContent + (p.classList.contains('alerte') ? ' !' : ''));

test('accueil admin : quatre tuiles, chacune remplie par sa source', async () => {
  const { appels } = serveur({
    '/api/carte/count.php': { corps: { composts: 5800, en_attente: 2, signalements: 1 } },
    '/api/admin/tickets.php': { corps: { a_traiter: 0 } },
    '/api/admin/themes_manage.php': { corps: { themes: [{ cours: [{ statut: 'publie' }, { statut: 'brouillon' }] }, { cours: [{ statut: 'publie' }] }] } },
    '/api/jeux/admin.php': { corps: { jeux: [{ statut: 'publie' }, { statut: 'publie' }, { statut: 'publie' }, { statut: 'publie' }] } },
    '/api/evenements/admin.php': { corps: { evenements: [{ statut: 'en_cours' }, { statut: 'termine' }] } },
  });
  const page = dom.monter('<cs-admin-accueil></cs-admin-accueil>');
  await dom.stabiliser();

  assert.deepEqual(page.querySelectorAll('.tuile').map((/** @type {any} */ t) => t.getAttribute('href')), ['/admin/panel', '/admin/themes', '/jeux-admin', '/evenements-admin']);
  assert.deepEqual(puces(page, 'panel'), ['1 signalement !', '2 ajouts à valider !']);
  assert.deepEqual(puces(page, 'cours'), ['2 cours publiés', '1 brouillon !']);
  assert.deepEqual(puces(page, 'jeux'), ['4 jeux publiés']);
  assert.deepEqual(puces(page, 'evenements'), ['1 en cours !']);
  assert.deepEqual(appels.map((a) => a.adresse).sort(), [
    '/api/admin/themes_manage.php',
    '/api/admin/tickets.php?count=1',
    '/api/carte/count.php',
    '/api/evenements/admin.php?action=liste',
    '/api/jeux/admin.php?action=liste',
  ]);
});

test('accueil admin : un service en panne laisse les autres tuiles se remplir', async () => {
  await enSilence(async () => {
    serveur({
      '/api/carte/count.php': { statut: 500, corps: { error: 'db' } },
      '/api/admin/tickets.php': { corps: { a_traiter: 3 } },
      '/api/admin/themes_manage.php': { corps: { themes: [] } },
      '/api/jeux/admin.php': new TypeError('fetch failed'),
      '/api/evenements/admin.php': { corps: { evenements: [] } },
    });
    const page = dom.monter('<cs-admin-accueil></cs-admin-accueil>');
    await dom.stabiliser();

    assert.deepEqual(puces(page, 'panel'), ['3 messages !', 'Carte injoignable']);
    assert.deepEqual(puces(page, 'cours'), ['0 cours publié']);
    assert.deepEqual(puces(page, 'jeux'), ['État indisponible']);
    assert.deepEqual(puces(page, 'evenements'), ['Aucun événement à venir']);
    assert.equal(page.querySelectorAll('.tuile').length, 4, 'les quatre tuiles restent cliquables');
  });
});

// ── Une page entière ────────────────────────────────────────────────────────

test('page /classement : les quatre morceaux ensemble, une seule question « qui suis-je »', async () => {
  const { appels } = serveur({
    '/api/auth/me.php': { corps: { ...ADMIN, email_verifie: false } },
    '/api/auth/leaderboard.php': { corps: { top: TOP, me: { ...joueur(1, 'eliott', 0), rank: 5 }, periode: 'total' } },
  });
  dom.aller('/classement');
  const page = dom.monter('<main><cs-bandeau></cs-bandeau><cs-rappel-email></cs-rappel-email><cs-classement></cs-classement><cs-pied></cs-pied></main>');
  await dom.stabiliser();

  assert.equal(appels.filter((a) => a.adresse === '/api/auth/me.php').length, 1, 'le bandeau et le rappel partagent la même réponse');
  assert.equal(page.querySelector('cs-bandeau .bandeau__admin-mini').hidden, false);
  assert.ok(page.querySelector('cs-rappel-email .rappel-email__barre'));
  assert.equal(page.querySelectorAll('cs-classement .pod').length, 3);
  assert.ok(page.querySelector('cs-pied .pied'));
});
