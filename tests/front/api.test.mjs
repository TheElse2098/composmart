import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxFetch } from './faux-dom.mjs';
import { Api, ErreurApi, api, texteErreur } from '../../services/web/front/ui/socle/api.js';

/** @param {Promise<unknown>} appel @returns {Promise<ErreurApi>} */
async function erreurDe(appel) {
  try {
    await appel;
  } catch (erreur) {
    assert.ok(erreur instanceof ErreurApi, 'une ErreurApi est attendue');
    return erreur;
  }
  throw new assert.AssertionError({ message: "l'appel aurait dû échouer" });
}

test('get construit l’adresse et ignore les paramètres vides', async () => {
  const { appels } = fauxFetch(() => ({ corps: { top: [] } }));
  const d = await new Api('/api/auth/').get('leaderboard.php', { periode: 'semaine', vide: null, absent: undefined, n: 0 });
  assert.deepEqual(d, { top: [] });
  assert.equal(appels[0].adresse, '/api/auth/leaderboard.php?periode=semaine&n=0');
  assert.equal(appels[0].options.method, 'GET');
});

test('post envoie un formulaire, avec les paramètres dans l’adresse', async () => {
  const { appels } = fauxFetch(() => ({ corps: { ok: true } }));
  await new Api('/api/contact').post('tickets.php', { action: 'repondre', id: 12, corps: 'à & b' }, { v: 1 });
  assert.equal(appels[0].adresse, '/api/contact/tickets.php?v=1');
  assert.equal(appels[0].options.method, 'POST');
  assert.ok(appels[0].options.body instanceof URLSearchParams);
  assert.equal(appels[0].options.body.toString(), 'action=repondre&id=12&corps=%C3%A0+%26+b');
});

test('post sans corps n’envoie pas de corps, un FormData passe tel quel', async () => {
  const { appels } = fauxFetch(() => ({ corps: { ok: true } }));
  const service = new Api('/api/auth');
  await service.post('resend.php');
  assert.equal(appels[0].options.body, undefined);
  const formulaire = new FormData();
  await service.post('envoi.php', formulaire);
  assert.equal(appels[1].options.body, formulaire);
});

test('postJson envoie du JSON', async () => {
  const { appels } = fauxFetch(() => ({ corps: { ok: true } }));
  await new Api('/api/admin').postJson('cours_save.php', { titre: 'Été' });
  assert.equal(appels[0].options.headers['Content-Type'], 'application/json');
  assert.equal(appels[0].options.body, '{"titre":"Été"}');
});

test('une réponse vide en succès donne null', async () => {
  fauxFetch(() => ({ texte: '' }));
  assert.equal(await new Api('/api/auth').post('logout.php'), null);
});

test('serveur injoignable : ErreurApi de statut 0', async () => {
  fauxFetch(() => new TypeError('fetch failed'));
  const e = await erreurDe(new Api('/api/auth').get('me.php'));
  assert.equal(e.statut, 0);
  assert.equal(e.message, 'Connexion au serveur impossible.');
});

test('réponse qui n’est pas du JSON : ErreurApi avec le code HTTP', async () => {
  fauxFetch(() => ({ statut: 502, texte: '<html>Bad Gateway</html>' }));
  const e = await erreurDe(new Api('/api/carte').get('count.php'));
  assert.equal(e.statut, 502);
  assert.match(e.message, /HTTP 502/);
});

test('code HTTP d’erreur : le message du serveur est repris', async () => {
  fauxFetch(() => ({ statut: 401, corps: { error: 'Connexion requise.' } }));
  const e = await erreurDe(new Api('/api/auth').get('leaderboard.php'));
  assert.equal(e.statut, 401);
  assert.equal(e.message, 'Connexion requise.');
  assert.deepEqual(e.donnees, { error: 'Connexion requise.' });
});

test('code 200 avec « error » : c’est une erreur quand même', async () => {
  fauxFetch(() => ({ corps: { error: 'db' } }));
  const e = await erreurDe(new Api('/api/auth').get('leaderboard.php'));
  assert.equal(e.statut, 200);
  assert.equal(e.message, 'db');
});

test('code 200 avec ok:false et sans message : erreur avec un message par défaut', async () => {
  fauxFetch(() => ({ corps: { ok: false } }));
  const e = await erreurDe(new Api('/api/auth').post('resend.php'));
  assert.match(e.message, /refusé/);
});

test('une liste JSON est renvoyée telle quelle', async () => {
  fauxFetch(() => ({ corps: [1, 2] }));
  assert.deepEqual(await new Api('/api/x').get('liste.php'), [1, 2]);
});

test('texteErreur : phrase du serveur reprise, code ou erreur de programme remplacés', () => {
  assert.equal(texteErreur(new ErreurApi('Connexion requise.')), 'Connexion requise.');
  assert.equal(texteErreur(new ErreurApi('Action inconnue')), 'Action inconnue');
  assert.equal(texteErreur(new ErreurApi("Nom d'utilisateur : lettres, chiffres, _ - . uniquement")), "Nom d'utilisateur : lettres, chiffres, _ - . uniquement");
  assert.equal(texteErreur(new TypeError('x is not a function'), 'Indisponible.'), 'Indisponible.');
  // Les codes que renvoient réellement les API du site.
  for (const code of ['db', 'DB error', 'bad_request', 'method', 'forbidden', 'user_not_found', 'session_perdue', 'not_logged_in']) {
    assert.equal(texteErreur(new ErreurApi(code)), "Ce contenu n'a pas pu être chargé.", code);
  }
});

test('une instance par service, sur les préfixes de l’Ingress', async () => {
  const { appels } = fauxFetch(() => ({ corps: {} }));
  await api.auth.get('a.php');
  await api.cours.get('a.php');
  await api.contact.get('a.php');
  await api.admin.get('a.php');
  await api.carte.get('a.php');
  await api.jeux.get('a.php');
  await api.evenements.get('a.php');
  assert.deepEqual(appels.map((a) => a.adresse), [
    '/api/auth/a.php', '/api/cours/a.php', '/api/contact/a.php', '/api/admin/a.php',
    '/api/carte/a.php', '/api/jeux/a.php', '/api/evenements/a.php',
  ]);
});

// ── telecharger : un fichier à enregistrer, pas des données à afficher ──────

test('telecharger rend le contenu et le nom proposé par le serveur', async () => {
  const { appels } = fauxFetch(() => ({ texte: '{"pseudo":"lea"}', entetes: { 'Content-Disposition': 'attachment; filename="composmart-mes-donnees-2026-11-16.json"' } }));
  const fichier = await new Api('/api/auth').telecharger('export.php', { format: 'json' });
  assert.equal(appels[0].adresse, '/api/auth/export.php?format=json');
  assert.equal(appels[0].options.method, 'GET');
  assert.equal(fichier.nom, 'composmart-mes-donnees-2026-11-16.json');
  assert.equal(await fichier.contenu.text(), '{"pseudo":"lea"}');
});

test('telecharger : sans nom proposé, le nom est laissé à l’appelant', async () => {
  fauxFetch(() => ({ texte: 'abc' }));
  assert.equal((await new Api('/api/auth').telecharger('export.php')).nom, null);
});

test('telecharger : un refus arrive en ErreurApi avec la phrase du serveur, pas en fichier', async () => {
  fauxFetch(() => ({ statut: 429, corps: { error: 'Trop de demandes. Réessaie dans une heure.' } }));
  const refus = await erreurDe(new Api('/api/auth').telecharger('export.php'));
  assert.equal(refus.message, 'Trop de demandes. Réessaie dans une heure.');
  assert.equal(refus.statut, 429);

  fauxFetch(() => ({ statut: 502, texte: '<html>Bad Gateway</html>' }));
  const panne = await erreurDe(new Api('/api/auth').telecharger('export.php'));
  assert.equal(panne.message, 'Le serveur a refusé la demande (HTTP 502).');

  fauxFetch(() => new TypeError('fetch failed'));
  const reseau = await erreurDe(new Api('/api/auth').telecharger('export.php'));
  assert.equal(reseau.message, 'Connexion au serveur impossible.');
  assert.equal(reseau.statut, 0);
});
