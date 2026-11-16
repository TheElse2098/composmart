/* La classe de base des composants : cycle de vie, rendu, écoutes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { Composant, chargerStyle } = await import('../../services/web/front/ui/socle/composant.js');
const { ErreurApi } = await import('../../services/web/front/ui/socle/api.js');
const { html } = await import('../../services/web/front/ui/socle/outils.js');

/** Composant d'essai : note ce qui lui arrive. */
class Essai extends Composant {
  static balise = 'cs-essai';
  static styles = ['/ui/essai.css'];
  /** @type {string[]} */
  journal = [];
  /** @type {((soi: Essai) => void | Promise<void>) | null} */
  auMontage = null;

  async monter() {
    this.journal.push('monter');
    if (this.auMontage) await this.auMontage(this);
  }

  demonter() {
    this.journal.push('demonter');
  }
}

/** Composant enfant : un bouton qui porte le même sélecteur que celui de son parent. */
class EssaiEnfant extends Composant {
  static balise = 'cs-essai-enfant';
  clics = 0;

  monter() {
    this.rendre(html`<button data-action="fermer">fermer l'enfant</button>`);
    this.ecouter('click', '[data-action="fermer"]', () => { this.clics++; });
  }
}

/** @returns {Essai} */
const creer = () => dom.document.createElement('cs-essai');

/** Fait taire console.error le temps d'un test qui provoque une erreur. @param {() => Promise<void>} action */
async function enSilence(action) {
  const origine = console.error;
  /** @type {string[]} */
  const vues = [];
  console.error = (...morceaux) => { vues.push(morceaux.join(' ')); };
  try {
    await action();
  } finally {
    console.error = origine;
  }
  return vues;
}

test('definir() refuse une balise qui ne commence pas par cs-', () => {
  class Mauvais extends Composant { static balise = 'classement'; }
  class Vide extends Composant {}
  assert.throws(() => Mauvais.definir(), /balise « classement » invalide/);
  assert.throws(() => Vide.definir(), /invalide/);
});

test('definir() enregistre la balise une seule fois', () => {
  Essai.definir();
  Essai.definir();
  EssaiEnfant.definir();
  assert.equal(customElements.get('cs-essai'), Essai);
  assert.ok(creer() instanceof Essai);
});

test('rendre() refuse une chaîne brute et écrit un gabarit échappé', () => {
  const c = creer();
  assert.throws(() => c.rendre(/** @type {any} */ ('<b>x</b>')), /gabarit html/);
  c.rendre(html`<b>${'<x>'}</b>`);
  assert.equal(c.innerHTML, '<b>&lt;x&gt;</b>');
  assert.equal(c.trouver('b').textContent, '<x>');
});

test('rendre() peut viser une zone du composant', () => {
  const c = creer();
  c.rendre(html`<h2>titre</h2><div class="zone"></div>`);
  c.rendre(html`<i>dedans</i>`, c.trouver('.zone'));
  assert.equal(c.trouver('.zone i').textContent, 'dedans');
  assert.equal(c.trouver('h2').textContent, 'titre', 'le reste du composant n’a pas bougé');
});

test('rendreSiChange() ne réécrit pas un contenu identique', () => {
  const c = creer();
  assert.equal(c.rendreSiChange(html`<p>1</p>`), true);
  const paragraphe = c.trouver('p');
  assert.equal(c.rendreSiChange(html`<p>1</p>`), false);
  assert.equal(c.trouver('p'), paragraphe, 'l’élément affiché est resté le même');
  assert.equal(c.rendreSiChange(html`<p>2</p>`), true);
  assert.equal(c.trouver('p').textContent, '2');
});

test('rendreSiChange() ne redessine pas pendant une saisie dans la zone', () => {
  const c = creer();
  c.rendreSiChange(html`<input value="serveur">`);
  dom.document.activeElement = c.trouver('input');
  assert.equal(c.rendreSiChange(html`<input value="autre">`), false);
  assert.equal(c.trouver('input').getAttribute('value'), 'serveur');

  dom.document.activeElement = null;
  assert.equal(c.rendreSiChange(html`<input value="autre">`), true);
  assert.equal(c.trouver('input').getAttribute('value'), 'autre');
});

test('rendreSiChange() redessine si le focus est sur un bouton, ou hors de la zone', () => {
  const c = creer();
  c.rendreSiChange(html`<button>a</button>`);
  dom.document.activeElement = c.trouver('button');
  assert.equal(c.rendreSiChange(html`<button>b</button>`), true);

  const ailleurs = dom.monter('<input>');
  dom.document.activeElement = ailleurs;
  assert.equal(c.rendreSiChange(html`<button>c</button>`), true);
  dom.vider();
});

test('montage : styles chargés puis monter(), une seule fois, même après un déplacement', async () => {
  const c = creer();
  dom.document.body.append(c);
  assert.deepEqual(c.journal, [], 'monter() attend les feuilles de style');
  await dom.stabiliser();
  assert.deepEqual(c.journal, ['monter']);

  const hrefs = dom.liensAjoutes.map((l) => l.getAttribute('href'));
  assert.ok(hrefs.some((h) => String(h).endsWith('/ui/styles/jetons.css')), 'les jetons sont chargés d’office');
  assert.ok(hrefs.includes('https://composmart.test/ui/essai.css'));

  // Déplacé ailleurs dans la page : il sort et rentre, sans se remonter.
  const ailleurs = dom.monter('<section></section>');
  ailleurs.append(c);
  await dom.stabiliser();
  assert.deepEqual(c.journal, ['monter']);
  dom.vider();
  await dom.stabiliser();
});

test('chargerStyle() : une feuille n’est ajoutée qu’une fois, une feuille du <head> pas du tout', async () => {
  const avant = dom.liensAjoutes.length;
  await Promise.all([chargerStyle('/ui/unique.css'), chargerStyle('/ui/unique.css')]);
  assert.equal(dom.liensAjoutes.length, avant + 1);

  // Une feuille que la page cite déjà dans son <head>.
  const statique = dom.document.createElement('link');
  statique.rel = 'stylesheet';
  statique.href = 'https://composmart.test/ui/deja-la.css';
  dom.document.head.append(statique);
  const apres = dom.liensAjoutes.length;
  await chargerStyle('/ui/deja-la.css');
  assert.equal(dom.liensAjoutes.length, apres, 'aucune seconde balise <link>');
});

test('chargerStyle() : une feuille citée par la page et déjà appliquée ne fait rien attendre', async () => {
  const appliquee = dom.document.createElement('link');
  appliquee.rel = 'stylesheet';
  appliquee.href = 'https://composmart.test/ui/appliquee.css';
  dom.document.head.append(appliquee);
  await dom.stabiliser(); // la feuille est chargée, comme celles du <head> à l'exécution des modules
  assert.ok(appliquee.sheet);
  const avant = dom.liensAjoutes.length;
  await chargerStyle('/ui/appliquee.css');
  assert.equal(dom.liensAjoutes.length, avant);
});

test('chargerStyle() : une feuille qui ne répond jamais finit par laisser passer le composant', async (t) => {
  // Une balise posée hors du <head> du faux navigateur : elle ne se charge jamais.
  const muette = dom.document.createElement('link');
  muette.rel = 'stylesheet';
  muette.href = 'https://composmart.test/ui/muette.css';
  dom.document.body.append(muette);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  let passe = false;
  const vues = await enSilence(async () => {
    const demande = chargerStyle('/ui/muette.css').then(() => { passe = true; });
    await Promise.resolve();
    assert.equal(passe, false, 'tant que le délai n’est pas écoulé, le composant attend');
    t.mock.timers.tick(4000);
    await demande;
  });
  t.mock.timers.reset();

  assert.equal(passe, true);
  assert.match(vues[0], /toujours en attente/);
  muette.remove();
});

test('chargerStyle() : une feuille introuvable ne bloque pas le composant', async () => {
  const vues = await enSilence(async () => { await chargerStyle('/ui/introuvable.css'); });
  assert.match(vues[0], /feuille de style introuvable/);
});

test('une erreur dans monter() s’affiche à la place du composant', async () => {
  await enSilence(async () => {
    const c = creer();
    c.auMontage = () => { throw new ErreurApi('Le classement est fermé ce soir.', { statut: 503 }); };
    dom.document.body.append(c);
    await dom.stabiliser();
    assert.equal(c.trouver('.cs-etat--erreur').textContent, '⚠️ Le classement est fermé ce soir.');

    const d = creer();
    d.auMontage = () => { throw new TypeError('x is not a function'); };
    dom.document.body.append(d);
    await dom.stabiliser();
    assert.equal(d.trouver('.cs-etat--erreur').textContent, "⚠️ Ce contenu n'a pas pu être chargé.", 'le détail technique reste dans la console');
  });
  dom.vider();
  await dom.stabiliser();
});

test('retrait de la page : écoutes et minuteries retirées, demonter() appelé', async () => {
  const c = creer();
  let tics = 0;
  let touches = 0;
  c.auMontage = (soi) => {
    soi.ecouter('click', '[data-action]', () => {});
    soi.ecouterSur(dom.document, 'keydown', () => { touches++; });
    soi.minuterie(1, () => { tics++; });
  };
  dom.document.body.append(c);
  await dom.stabiliser();
  assert.equal(c.nombreEcoutes, 1);
  dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  assert.equal(touches, 1);

  c.remove();
  await dom.stabiliser();
  assert.equal(c.nombreEcoutes, 0);
  assert.deepEqual(c.journal, ['monter', 'demonter']);
  dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  assert.equal(touches, 1, 'l’écoute posée sur le document est retirée elle aussi');
  const aLArret = tics;
  await new Promise((resoudre) => setTimeout(resoudre, 15));
  assert.equal(tics, aLArret, 'la minuterie est arrêtée');

  // Remis dans la page : il se remonte. (Sans minuterie cette fois : rien ne
  // l'arrêterait, et un intervalle en cours empêche Node de rendre la main.)
  c.auMontage = null;
  dom.document.body.append(c);
  await dom.stabiliser();
  assert.deepEqual(c.journal, ['monter', 'demonter', 'monter']);
  dom.vider();
  await dom.stabiliser();
});

test('ecouter() : seuls comptent les éléments affichés par ce composant', async () => {
  const parent = creer();
  /** @type {string[]} */
  const recus = [];
  parent.auMontage = (soi) => {
    soi.rendre(html`
      <button data-action="fermer"><span class="icone">✕</span> fermer le parent</button>
      <cs-essai-enfant></cs-essai-enfant>`);
    soi.ecouter('click', '[data-action="fermer"]', (bouton) => { recus.push(bouton.textContent.trim()); });
  };
  dom.document.body.append(parent);
  await dom.stabiliser();

  // Le clic sur l'icône du bouton compte : c'est le bouton qui est rendu à la réaction.
  parent.trouver('.icone').click();
  assert.deepEqual(recus, ['✕ fermer le parent']);

  // Le même sélecteur à l'intérieur du composant enfant : ce n'est pas l'affaire du parent.
  const enfant = /** @type {EssaiEnfant} */ (parent.trouver('cs-essai-enfant'));
  enfant.trouver('button').click();
  assert.deepEqual(recus, ['✕ fermer le parent']);
  assert.equal(enfant.clics, 1, 'l’enfant, lui, a bien reçu son clic');
  dom.vider();
  await dom.stabiliser();
});

test('emettre() : le parent reçoit l’évènement d’un enfant sur sa balise', async () => {
  const parent = creer();
  /** @type {unknown[]} */
  const recus = [];
  parent.auMontage = (soi) => {
    soi.rendre(html`<cs-essai-enfant></cs-essai-enfant>`);
    soi.ecouter('choisi', 'cs-essai-enfant', (_enfant, evenement) => {
      recus.push(/** @type {CustomEvent} */ (evenement).detail);
    });
  };
  dom.document.body.append(parent);
  await dom.stabiliser();

  /** @type {EssaiEnfant} */ (parent.trouver('cs-essai-enfant')).emettre('choisi', { id: 3 });
  assert.deepEqual(recus, [{ id: 3 }]);
  dom.vider();
  await dom.stabiliser();
});

test('trouver() dit ce qui manque au lieu de renvoyer null ; tous() rend une liste', () => {
  const c = creer();
  c.rendre(html`<li>a</li><li>b</li>`);
  assert.throws(() => c.trouver('.absent'), /<cs-essai> : aucun élément « \.absent »/);
  assert.deepEqual(c.tous('li').map((li) => li.textContent), ['a', 'b']);
  assert.deepEqual(c.tous('.absent'), []);
});

// ── apresMontage : régler un enfant qui n'a pas fini de se monter ───────────

test('apresMontage : avant la fin de monter(), l’action attend ; après, elle part tout de suite', async () => {
  const c = creer();
  /** @type {string[]} */
  const ordre = [];
  c.auMontage = () => { ordre.push('monter'); };
  dom.document.body.append(c);
  c.apresMontage(() => ordre.push('première'));
  c.apresMontage(() => ordre.push('seconde'));
  assert.deepEqual(ordre, [], 'rien tant que la feuille de style n’est pas arrivée');

  await dom.stabiliser();
  assert.deepEqual(ordre, ['monter', 'première', 'seconde'], 'dans l’ordre des appels, une fois monter() terminé');

  c.apresMontage(() => ordre.push('immédiate'));
  assert.deepEqual(ordre.at(-1), 'immédiate');
  c.remove();
  await dom.stabiliser();
});

test('apresMontage : un monter() asynchrone est attendu jusqu’au bout', async () => {
  const c = creer();
  /** @type {() => void} */
  let finir = () => {};
  c.auMontage = () => new Promise((resoudre) => { finir = () => resoudre(); });
  dom.document.body.append(c);
  let faite = false;
  c.apresMontage(() => { faite = true; });
  await dom.stabiliser();
  assert.equal(faite, false, 'monter() attend encore ses données');
  finir();
  await dom.stabiliser();
  assert.equal(faite, true);
  c.remove();
  await dom.stabiliser();
});

test('apresMontage : un composant retiré avant d’être monté n’exécute rien', async () => {
  const c = creer();
  dom.document.body.append(c);
  let faite = false;
  c.apresMontage(() => { faite = true; });
  c.remove();
  await dom.stabiliser();
  assert.equal(faite, false);
});
