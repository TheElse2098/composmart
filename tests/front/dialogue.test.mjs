/* ============================================================================
   <cs-dialogue> : confirmer() et informer(), qui remplacent confirm() et
   alert() du navigateur.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { Dialogue, confirmer, informer } = await import('../../services/web/front/ui/composants/dialogue/dialogue.js');

/** La boîte ouverte, une fois affichée. */
async function boiteOuverte() {
  await dom.stabiliser();
  const boite = dom.document.querySelector('cs-dialogue');
  assert.ok(boite, 'une boîte est ouverte');
  return boite;
}

/** @param {string} touche */
const taper = (touche) => dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: touche }));

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

test('gabarit : titre, texte, deux boutons ; tout est échappé', () => {
  const sortie = String(new Dialogue().gabarit({ titre: 'Supprimer <b> ?', texte: 'Définitif & irréversible.', valider: 'Supprimer', annuler: 'Garder', danger: true }));
  assert.match(sortie, /<div class="dialogue__boite" role="dialog" aria-modal="true">/);
  assert.match(sortie, /<div class="dialogue__titre">Supprimer &lt;b&gt; \?<\/div>/);
  assert.match(sortie, /<div class="dialogue__texte">Définitif &amp; irréversible\.<\/div>/);
  assert.match(sortie, /<button type="button" class="dialogue__non" data-reponse="non">Garder<\/button>/);
  assert.match(sortie, /<button type="button" class="dialogue__oui danger" data-reponse="oui">Supprimer<\/button>/);
});

test('gabarit : libellés par défaut, pas de texte, un seul bouton pour un message', () => {
  const simple = String(new Dialogue().gabarit({}));
  assert.match(simple, />Confirmer \?</);
  assert.match(simple, /data-reponse="non">Annuler</);
  assert.match(simple, /class="dialogue__oui" data-reponse="oui">Confirmer</);
  assert.ok(!simple.includes('dialogue__texte'));

  const message = String(new Dialogue().gabarit({ titre: 'Fait', seul: true, valider: 'OK' }));
  assert.ok(!message.includes('data-reponse="non"'));
});

test('confirmer : le bouton qui confirme répond vrai et a le focus', async () => {
  const reponse = confirmer({ titre: 'Continuer ?' });
  const boite = await boiteOuverte();
  assert.equal(dom.document.activeElement, boite.querySelector('[data-reponse="oui"]'));
  boite.querySelector('[data-reponse="oui"]').click();
  assert.equal(await reponse, true);
  assert.ok(boite.classList.contains('ferme'));
});

test('confirmer : le bouton qui renonce répond faux', async () => {
  const reponse = confirmer({ titre: 'Continuer ?' });
  (await boiteOuverte()).querySelector('[data-reponse="non"]').click();
  assert.equal(await reponse, false);
});

test('confirmer : Échap et un clic hors de la boîte valent non, un clic dans la boîte ne répond pas', async () => {
  const parEchap = confirmer({});
  await boiteOuverte();
  taper('Escape');
  assert.equal(await parEchap, false);
  dom.vider();

  const parClic = confirmer({});
  const boite = await boiteOuverte();
  let repondu = false;
  parClic.then(() => { repondu = true; });
  boite.querySelector('.dialogue__titre').click();
  await dom.stabiliser();
  assert.equal(repondu, false, 'un clic dans la boîte ne ferme rien');
  boite.querySelector('.dialogue__fond').click();
  assert.equal(await parClic, false);
});

test('confirmer : Entrée vaut oui, sauf quand le focus est sur le bouton qui renonce', async () => {
  const parEntree = confirmer({});
  await boiteOuverte();
  dom.document.activeElement = null; // focus ailleurs dans la page
  taper('Enter');
  assert.equal(await parEntree, true);
  dom.vider();

  const surNon = confirmer({});
  const boite = await boiteOuverte();
  let reponse = null;
  surNon.then((r) => { reponse = r; });
  boite.querySelector('[data-reponse="non"]').focus();
  taper('Enter'); // le navigateur actionne lui-même le bouton qui a le focus
  await dom.stabiliser();
  assert.equal(reponse, null, 'la touche seule ne répond pas oui');
  boite.querySelector('[data-reponse="non"]').click();
  assert.equal(await surNon, false);
});

test('confirmer : une seule réponse, puis la boîte quitte la page', async () => {
  const reponse = confirmer({});
  const boite = await boiteOuverte();
  boite.querySelector('[data-reponse="oui"]').click();
  boite.querySelector('[data-reponse="non"]').click();
  taper('Escape');
  assert.equal(await reponse, true, 'la première réponse est la bonne');

  await new Promise((resoudre) => setTimeout(resoudre, 220));
  await dom.stabiliser();
  assert.equal(dom.document.querySelector('cs-dialogue'), null);
});

test('informer : un seul bouton, la promesse se résout à la fermeture', async () => {
  const lu = informer({ titre: 'Action impossible', texte: 'Le composteur a été modifié depuis.' });
  const boite = await boiteOuverte();
  assert.equal(boite.querySelector('.dialogue__titre').textContent, 'Action impossible');
  assert.equal(boite.querySelector('.dialogue__texte').textContent, 'Le composteur a été modifié depuis.');
  assert.equal(boite.querySelectorAll('button').length, 1);
  assert.equal(boite.querySelector('button').textContent, 'OK');
  boite.querySelector('button').click();
  assert.equal(await lu, true);
});

test('deux boîtes à la suite : chacune sa réponse', async () => {
  const premiere = confirmer({ titre: 'Un' });
  const deuxieme = confirmer({ titre: 'Deux' });
  await dom.stabiliser();
  const boites = dom.document.querySelectorAll('cs-dialogue');
  assert.deepEqual(boites.map((/** @type {any} */ b) => b.querySelector('.dialogue__titre').textContent), ['Un', 'Deux']);
  boites[1].querySelector('[data-reponse="oui"]').click();
  boites[0].querySelector('[data-reponse="non"]').click();
  assert.equal(await deuxieme, true);
  assert.equal(await premiere, false);
});
