import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { session } = await import('../../services/web/front/ui/socle/session.js');
const { theme } = await import('../../services/web/front/ui/socle/theme.js');

test('session.moi() ne questionne le serveur qu’une fois par page', async () => {
  session.oublier();
  const { appels } = fauxFetch(() => ({ corps: { logged_in: true, id: 7, username: 'ana', isAdmin: false, email_verifie: true } }));
  const [a, b] = await Promise.all([session.moi(), session.moi()]);
  const c = await session.moi();
  assert.equal(appels.length, 1);
  assert.equal(appels[0].adresse, '/api/auth/me.php');
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(a.logged_in, true);
});

test('session.moi() : serveur en panne = visiteur non connecté, sans erreur', async () => {
  session.oublier();
  fauxFetch(() => new TypeError('fetch failed'));
  assert.deepEqual(await session.moi(), { logged_in: false });
});

test('session.oublier() repose la question', async () => {
  session.oublier();
  const { appels } = fauxFetch(() => ({ corps: { logged_in: false } }));
  await session.moi();
  session.oublier();
  await session.moi();
  assert.equal(appels.length, 2);
});

test('theme.basculer() pose la classe, garde le choix et prévient la page', () => {
  /** @type {any[]} */
  const recus = [];
  dom.document.addEventListener('themechange', (/** @type {any} */ e) => recus.push(e.detail));

  assert.equal(theme.sombre, false);
  assert.equal(theme.basculer(), true);
  assert.equal(theme.sombre, true);
  assert.equal(dom.stockage.get('theme'), 'dark');

  assert.equal(theme.basculer(), false);
  assert.equal(dom.stockage.get('theme'), 'light');
  assert.deepEqual(recus, [{ dark: true }, { dark: false }]);
});
