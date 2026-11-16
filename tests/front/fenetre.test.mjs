/* ============================================================================
   Fenetre (socle/fenetre.js) : la classe de base des fenêtres, essayée avec
   une fenêtre minimale.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { Fenetre } = await import('../../services/web/front/ui/socle/fenetre.js');
const { html } = await import('../../services/web/front/ui/socle/outils.js');
const { confirmer } = await import('../../services/web/front/ui/composants/dialogue/dialogue.js');

class FenetreEssai extends Fenetre {
  static balise = 'cs-fenetre-essai';
  fermetures = 0;

  monter() {
    this.poserFenetre(html`
      <div class="fenetre__titre"></div>
      <p class="dedans">Contenu</p>
      <button type="button" data-action="fermer">Fermer</button>`);
  }

  /** @param {string} titre */
  ouvrir(titre) {
    this.desQuePosee(() => {
      this.trouver('.fenetre__titre').textContent = titre;
      this.montrer();
    });
  }

  aLaFermeture() {
    this.fermetures++;
  }
}
FenetreEssai.definir();

/** @returns {Promise<any>} une fenêtre posée, fermée */
async function monterFenetre() {
  const fenetre = dom.monter('<cs-fenetre-essai></cs-fenetre-essai>');
  await dom.stabiliser();
  return fenetre;
}

/** @param {string} touche */
const taper = (touche) => dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: touche }));

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

test('fenêtre : posée fermée, dans son cadre, avec la feuille commune', async () => {
  const fenetre = await monterFenetre();
  assert.equal(fenetre.posee, true);
  assert.equal(fenetre.ouverte, false);
  assert.equal(fenetre.querySelector('.fenetre__fond .fenetre__boite').getAttribute('role'), 'dialog');
  assert.equal(fenetre.querySelector('.fenetre__boite').getAttribute('aria-modal'), 'true');
  assert.equal(fenetre.querySelector('.fenetre__boite .dedans').textContent, 'Contenu');
  assert.ok(dom.liensAjoutes.some((l) => String(l.getAttribute('href')).endsWith('/ui/styles/fenetre.css')));
});

test('fenêtre : ouverte, la page derrière est figée ; fermée, elle défile à nouveau', async () => {
  const fenetre = await monterFenetre();
  fenetre.ouvrir('Bonjour');
  assert.equal(fenetre.ouverte, true);
  assert.equal(fenetre.querySelector('.fenetre__fond').classList.contains('ouverte'), true);
  assert.equal(fenetre.querySelector('.fenetre__titre').textContent, 'Bonjour');
  assert.equal(dom.document.body.style.overflow, 'hidden');

  fenetre.fermer();
  assert.equal(fenetre.ouverte, false);
  assert.equal(dom.document.body.style.overflow, '');
  assert.equal(fenetre.fermetures, 1);

  fenetre.fermer();
  assert.equal(fenetre.fermetures, 1, 'fermer une fenêtre fermée ne fait rien');
});

test('fenêtre : se ferme par son bouton, par un clic à côté, par Échap — pas par un clic dedans', async () => {
  const fenetre = await monterFenetre();

  fenetre.ouvrir('a');
  fenetre.querySelector('.dedans').click();
  assert.equal(fenetre.ouverte, true);
  fenetre.querySelector('[data-action="fermer"]').click();
  assert.equal(fenetre.ouverte, false);

  fenetre.ouvrir('b');
  fenetre.querySelector('.fenetre__fond').click();
  assert.equal(fenetre.ouverte, false);

  fenetre.ouvrir('c');
  taper('Enter');
  assert.equal(fenetre.ouverte, true);
  taper('Escape');
  assert.equal(fenetre.ouverte, false);
  assert.equal(fenetre.fermetures, 3);

  taper('Escape');
  assert.equal(fenetre.fermetures, 3, 'Échap sur une fenêtre fermée ne fait rien');
});

test('fenêtre : Échap ferme la confirmation ouverte par-dessus, pas la fenêtre', async () => {
  const fenetre = await monterFenetre();
  fenetre.ouvrir('a');
  const reponse = confirmer({ titre: 'Sûr ?' });
  await dom.stabiliser();

  taper('Escape');
  assert.equal(await reponse, false);
  assert.equal(fenetre.ouverte, true);
});

test('fenêtre : une ouverture demandée avant l’arrivée de la feuille de style est servie ensuite', async () => {
  const fenetre = /** @type {any} */ (dom.monter('<cs-fenetre-essai></cs-fenetre-essai>'));
  assert.equal(fenetre.posee, false);
  fenetre.ouvrir('premier');
  fenetre.ouvrir('dernier');
  assert.equal(fenetre.ouverte, false);

  await dom.stabiliser();
  assert.equal(fenetre.ouverte, true);
  assert.equal(fenetre.querySelector('.fenetre__titre').textContent, 'dernier', 'la dernière demande l’emporte');
});

test('fenêtre retirée de la page encore ouverte : la page n’est pas laissée figée', async () => {
  const fenetre = await monterFenetre();
  fenetre.ouvrir('a');
  assert.equal(dom.document.body.style.overflow, 'hidden');
  fenetre.remove();
  await dom.stabiliser();
  assert.equal(dom.document.body.style.overflow, '');

  taper('Escape'); // l'écoute du clavier est retirée : rien ne casse
});
