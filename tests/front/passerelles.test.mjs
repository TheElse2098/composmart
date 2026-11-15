/* ============================================================================
   Les passerelles de la transition (phase 2) : les anciens scripts communs
   (site-nav.js, site-footer.js, verif-banner.js) exécutés dans une page
   historique type, avec et sans le paramètre ?ui=2.

   Deux choses à garantir : sans le paramètre, rien ne change pour un
   visiteur ; avec, les nouveaux composants prennent exactement la place des
   anciens, sous les mêmes identifiants.

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
    if (chemin === '/partials/site-nav') return { texte: lireFront('partials/site-nav.html') };
    if (chemin === '/partials/site-footer') return { texte: lireFront('partials/site-footer.html') };
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
  dom.stockageOnglet.clear(); // chaque test repart d'un onglet neuf
  session.oublier();
  await dom.stabiliser();
});

test('sans le paramètre : l’ancien bandeau et l’ancien pied, aucun nouveau composant', async () => {
  const { appels } = await ouvrir('/cours', PAGE_COMPLETE, ADMIN_NON_CONFIRME);

  assert.equal(dom.document.querySelector('cs-bandeau'), null);
  assert.equal(dom.document.querySelector('cs-pied'), null);
  assert.equal(dom.document.querySelector('cs-rappel-email'), null);
  assert.deepEqual(dom.modulesDemandes, [], 'aucun module de ui/ n’est demandé');

  const bandeau = dom.document.getElementById('site-nav');
  assert.equal(bandeau.localName, 'div');
  assert.ok(bandeau.querySelector('.nav-logo'), 'le bandeau historique est injecté');
  assert.ok(dom.document.getElementById('site-footer').querySelector('.footer-inner'), 'le pied historique aussi');
  assert.ok(dom.document.querySelector('.verif-bandeau'), 'et l’ancien rappel');
  assert.ok(appels.some((a) => a.adresse === '/partials/site-nav'));
  assert.ok(appels.some((a) => a.adresse === '/partials/site-footer'));
});

test('avec ?ui=2 : les nouveaux composants à la place des anciens, sous les mêmes identifiants', async () => {
  const { appels } = await ouvrir('/cours?ui=2', PAGE_COMPLETE, ADMIN_NON_CONFIRME);

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
  assert.ok(dom.document.body.querySelector('.bandeau-tiroir'), 'le nouveau tiroir est sous <body>');

  // Rien de l'ancien monde ne s'est affiché en double.
  assert.equal(dom.document.querySelector('.nav-logo'), null);
  assert.equal(dom.document.querySelector('.verif-bandeau'), null);
  assert.equal(dom.document.getElementById('drawer'), null);
  assert.equal(dom.document.getElementById('adminBadge'), null, 'admin-badge.js n’a rien ajouté');
  assert.ok(!appels.some((a) => a.adresse.startsWith('/partials/')), 'les anciens fragments ne sont plus demandés');

  // La case Admin est celle du nouveau bandeau.
  assert.equal(bandeau.querySelector('.bandeau__admin-mini').hidden, false);
  assert.ok(dom.liensAjoutes.some((l) => l.getAttribute('href') === '/ui/composants/bandeau/bandeau.css'), 'la feuille du bandeau est demandée d’emblée');
});

test('?ui=2 : le burger garde l’identifiant que la carte guette', async () => {
  await ouvrir('/carte?ui=2', ['site-nav.js', 'theme.js', 'verif-banner.js', 'admin-badge.js']);
  const burger = dom.document.getElementById('burgerBtn');
  assert.ok(burger && burger.classList.contains('bandeau__burger'));
  burger.click();
  assert.equal(dom.document.body.querySelector('.bandeau-tiroir').classList.contains('bandeau-tiroir--ouvert'), true);
});

test('?ui=2 : le bouton de thème bascule une fois, l’ancien theme.js ne s’en mêle pas', async () => {
  await ouvrir('/cours?ui=2', PAGE_COMPLETE);
  const bouton = dom.document.getElementById('site-nav').querySelector('.bandeau__theme');
  bouton.click();
  assert.equal(dom.document.documentElement.classList.contains('dark'), true);
  assert.equal(bouton.textContent, '☀️');
});

test('le choix suit la navigation dans l’onglet ; ?ui=1 revient à l’ancien', async () => {
  await ouvrir('/cours?ui=2', PAGE_SANS_RAPPEL);
  assert.equal(dom.document.getElementById('site-nav').localName, 'cs-bandeau');
  dom.vider();
  await dom.stabiliser();

  // Page suivante, sans paramètre : toujours le nouveau bandeau.
  await ouvrir('/jeux', PAGE_SANS_RAPPEL);
  assert.equal(dom.document.getElementById('site-nav').localName, 'cs-bandeau');
  assert.equal(dom.document.getElementById('site-footer').localName, 'cs-pied');
  dom.vider();
  await dom.stabiliser();

  // ?ui=1 : retour à l'ancien, et il tient.
  await ouvrir('/jeux?ui=1', PAGE_SANS_RAPPEL);
  assert.equal(dom.document.getElementById('site-nav').localName, 'div');
  dom.vider();
  await dom.stabiliser();
  await ouvrir('/materiel', PAGE_SANS_RAPPEL);
  assert.equal(dom.document.getElementById('site-nav').localName, 'div');
  assert.equal(dom.document.querySelector('cs-bandeau'), null);
});

test('?ui=2 sur une page sans rappel ni pied : seul le bandeau est remplacé', async () => {
  await ouvrir('/evenements-admin?ui=2', PAGE_ADMIN_ATELIERS);
  assert.deepEqual(plan().slice(0, 4), ['cs-bandeau#site-nav', 'div.fil-retour', 'main.contenu', 'div#site-footer']);
  assert.equal(dom.document.querySelector('cs-rappel-email'), null);
  assert.equal(dom.document.querySelector('cs-pied'), null, 'une page qui ne charge pas site-footer.js garde son conteneur tel quel');
});
