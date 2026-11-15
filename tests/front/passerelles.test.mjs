/* ============================================================================
   Les passerelles de la transition : les scripts communs des pages pas encore
   migrées (site-nav.js, site-footer.js, verif-banner.js), exécutés dans une
   page historique type.

   À garantir : les nouveaux composants prennent exactement la place des
   anciens conteneurs, sous les mêmes identifiants, et les scripts restés tels
   quels (theme.js, admin-badge.js) ne s'en mêlent pas.

   Ce fichier n'importe aucun composant d'avance : comme dans une vraie page,
   les balises existent avant que leur module n'arrive.
   ============================================================================ */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { session } = await import('../../services/web/front/ui/socle/session.js');

const FRONT = new URL('../../services/web/front/', import.meta.url);
/** @param {string} chemin */
const lireFront = (chemin) => readFileSync(fileURLToPath(new URL(chemin, FRONT)), 'utf8');

const VISITEUR = { logged_in: false };
const ADMIN_NON_CONFIRME = { logged_in: true, id: 1, username: 'eliott', email: 'e@exemple.fr', xp: 0, niveau: 1, isAdmin: true, email_verifie: false };

/** L'ordre des scripts communs dans les pages du site. */
const PAGE_COMPLETE = ['site-footer.js', 'site-nav.js', 'theme.js', 'verif-banner.js', 'admin-badge.js'];
const PAGE_SANS_RAPPEL = ['site-footer.js', 'site-nav.js', 'theme.js', 'admin-badge.js'];
const PAGE_ADMIN_ATELIERS = ['site-nav.js', 'admin-badge.js', 'theme.js'];
const PAGE_CARTE = ['site-nav.js', 'theme.js', 'verif-banner.js', 'admin-badge.js'];

/**
 * Ouvre une page historique type : son squelette, un faux serveur, puis ses
 * scripts communs exécutés dans l'ordre, comme autant de <script src>.
 * @param {string} adresse
 * @param {string[]} scripts
 * @param {unknown} [moi]
 */
async function ouvrir(adresse, scripts, moi = VISITEUR) {
  const serveur = fauxFetch((demande) => {
    const chemin = demande.split('?')[0];
    if (chemin === '/api/auth/me.php') return { corps: moi };
    return { statut: 404, corps: { error: 'non prévu : ' + chemin } };
  });
  dom.aller(adresse);
  dom.document.body.innerHTML = '<div id="site-nav"></div><div class="fil-retour"></div><main class="contenu">La page</main><div id="site-footer"></div>';
  for (const script of scripts) new Function(lireFront('assets/js/' + script))();
  await dom.stabiliser();
  return serveur;
}

/** Les enfants directs de <body>, dans l'ordre. */
const plan = () => dom.document.body.children.map((/** @type {any} */ e) => e.localName + (e.id ? '#' + e.id : '') + (e.className ? '.' + e.className.split(' ')[0] : ''));

afterEach(async () => {
  dom.vider();
  session.oublier();
  await dom.stabiliser();
});

test('page complète : bandeau, rappel et pied à la place des conteneurs, sous les mêmes identifiants', async () => {
  const { appels } = await ouvrir('/cours', PAGE_COMPLETE, ADMIN_NON_CONFIRME);

  assert.deepEqual(plan().slice(0, 5), ['cs-bandeau#site-nav', 'cs-rappel-email', 'div.fil-retour', 'main.contenu', 'cs-pied#site-footer']);
  assert.deepEqual([...dom.modulesDemandes].sort(), [
    '/ui/composants/bandeau/bandeau.js',
    '/ui/composants/pied/pied.js',
    '/ui/composants/rappel-email/rappel-email.js',
  ]);

  // Les trois composants sont montés, pas seulement posés.
  const bandeau = dom.document.getElementById('site-nav');
  assert.equal(bandeau.querySelector('.bandeau__liens a.actif').textContent, 'Cours');
  assert.ok(dom.document.getElementById('site-footer').querySelector('.pied__legal'));
  assert.equal(dom.document.querySelector('cs-rappel-email strong').textContent, 'e@exemple.fr');
  assert.ok(dom.document.body.querySelector('.bandeau-tiroir'), 'le tiroir est sous <body>');
  assert.ok(dom.liensAjoutes.some((l) => l.getAttribute('href') === '/ui/composants/bandeau/bandeau.css'), 'la feuille du bandeau est demandée d’emblée');

  // Plus rien de l'ancien bandeau, et les anciens fragments ne sont plus demandés.
  assert.equal(dom.document.querySelector('.nav-logo'), null);
  assert.equal(dom.document.querySelector('.verif-bandeau'), null);
  assert.equal(dom.document.getElementById('drawer'), null);
  assert.ok(!appels.some((a) => a.adresse.startsWith('/partials/')));

  // La case Admin est celle du bandeau ; admin-badge.js n'en a pas ajouté une seconde.
  assert.equal(bandeau.querySelector('.bandeau__admin-mini').hidden, false);
  assert.equal(dom.document.getElementById('adminBadge'), null);
});

test('le burger garde l’identifiant que la carte guette', async () => {
  await ouvrir('/carte', PAGE_CARTE);
  const burger = dom.document.getElementById('burgerBtn');
  assert.ok(burger && burger.classList.contains('bandeau__burger'));
  burger.click();
  assert.equal(dom.document.body.querySelector('.bandeau-tiroir').classList.contains('bandeau-tiroir--ouvert'), true);
});

test('le bouton de thème bascule une fois : l’ancien theme.js ne s’en mêle pas', async () => {
  await ouvrir('/cours', PAGE_COMPLETE);
  const bouton = dom.document.getElementById('site-nav').querySelector('.bandeau__theme');
  bouton.click();
  assert.equal(dom.document.documentElement.classList.contains('dark'), true);
  assert.equal(bouton.textContent, '☀️');
});

test('page sans rappel : bandeau et pied seulement', async () => {
  await ouvrir('/contact', PAGE_SANS_RAPPEL, ADMIN_NON_CONFIRME);
  assert.deepEqual(plan().slice(0, 4), ['cs-bandeau#site-nav', 'div.fil-retour', 'main.contenu', 'cs-pied#site-footer']);
  assert.equal(dom.document.querySelector('cs-rappel-email'), null, 'pas de rappel sur une page qui ne charge pas verif-banner.js');
});

test('page d’administration des ateliers : seul le bandeau est posé, le reste est intact', async () => {
  await ouvrir('/evenements-admin', PAGE_ADMIN_ATELIERS);
  assert.deepEqual(plan().slice(0, 4), ['cs-bandeau#site-nav', 'div.fil-retour', 'main.contenu', 'div#site-footer']);
  assert.equal(dom.document.querySelector('cs-pied'), null, 'une page qui ne charge pas site-footer.js garde son conteneur tel quel');
});

test('un script exécuté deux fois ne pose pas deux composants', async () => {
  await ouvrir('/cours', [...PAGE_COMPLETE, 'site-nav.js', 'site-footer.js', 'verif-banner.js']);
  assert.equal(dom.document.querySelectorAll('cs-bandeau').length, 1);
  assert.equal(dom.document.querySelectorAll('cs-pied').length, 1);
  assert.equal(dom.document.querySelectorAll('cs-rappel-email').length, 1);
  assert.equal(dom.document.body.querySelectorAll('.bandeau-tiroir').length, 1);
});
