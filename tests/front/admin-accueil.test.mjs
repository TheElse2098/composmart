/* États des tuiles de /admin, sur des réponses d'exemple des cinq endpoints. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installerFauxDom } from './faux-dom.mjs';

installerFauxDom();
const { AdminAccueil, etatEvenements, etatPanel, etatPublication } = await import('../../services/web/front/ui/admin/accueil/accueil.js');

/** @param {string[]} statuts */
const avec = (...statuts) => statuts.map((statut) => ({ statut }));

test('panel : ce qui attend une action, en alerte', () => {
  assert.deepEqual(etatPanel({ signalements: 2, en_attente: 1 }, { a_traiter: 3 }), [
    { texte: '2 signalements', sorte: 'alerte' },
    { texte: '1 ajout à valider', sorte: 'alerte' },
    { texte: '3 messages', sorte: 'alerte' },
  ]);
});

test('panel : « Rien à traiter » seulement si les deux sources ont répondu', () => {
  assert.deepEqual(etatPanel({ signalements: 0, en_attente: 0 }, { a_traiter: 0 }), [{ texte: 'Rien à traiter ✓', sorte: 'calme' }]);
  assert.deepEqual(etatPanel(null, { a_traiter: 0 }), [{ texte: 'Carte injoignable', sorte: 'calme' }]);
  assert.deepEqual(etatPanel({ signalements: 0, en_attente: 0 }, null), [{ texte: 'Messages injoignables', sorte: 'calme' }]);
});

test('panel : une source en panne n’efface pas ce que dit l’autre', () => {
  assert.deepEqual(etatPanel(null, { a_traiter: 1 }), [
    { texte: '1 message', sorte: 'alerte' },
    { texte: 'Carte injoignable', sorte: 'calme' },
  ]);
});

test('cours et jeux : publiés toujours affichés, brouillons en alerte s’il y en a', () => {
  assert.deepEqual(etatPublication(avec('publie', 'publie', 'brouillon'), ['cours publié', 'cours publiés']), [
    { texte: '2 cours publiés' },
    { texte: '1 brouillon', sorte: 'alerte' },
  ]);
  assert.deepEqual(etatPublication(avec('publie'), ['jeu publié', 'jeux publiés']), [{ texte: '1 jeu publié' }]);
  assert.deepEqual(etatPublication([], ['jeu publié', 'jeux publiés']), [{ texte: '0 jeu publié' }]);
});

test('événements : en cours en alerte, ouverts et prévus ensuite', () => {
  assert.deepEqual(etatEvenements(avec('en_cours', 'ouvert', 'ouvert', 'prevu', 'termine')), [
    { texte: '1 en cours', sorte: 'alerte' },
    { texte: '2 ouverts' },
    { texte: '1 prévu' },
  ]);
  assert.deepEqual(etatEvenements(avec('termine', 'annule')), [{ texte: 'Aucun événement à venir', sorte: 'calme' }]);
});

test('quatre tuiles, chacune avec sa zone d’état', () => {
  const page = String(new AdminAccueil().gabarit());
  assert.deepEqual([...page.matchAll(/class="tuile" href="([^"]+)"/g)].map((m) => m[1]),
    ['/admin/panel', '/admin/themes', '/jeux-admin', '/evenements-admin']);
  assert.deepEqual([...page.matchAll(/data-etat="(\w+)"/g)].map((m) => m[1]), ['panel', 'cours', 'jeux', 'evenements']);
});

test('puces : la sorte devient une classe, le texte est échappé', () => {
  const puces = String(new AdminAccueil().gabaritPuces([
    { texte: '2 signalements', sorte: 'alerte' },
    { texte: '<b>3</b> publiés' },
    { texte: 'Rien à traiter ✓', sorte: 'calme' },
  ]));
  assert.equal(puces,
    '<span class="puce alerte">2 signalements</span>'
    + '<span class="puce">&lt;b&gt;3&lt;/b&gt; publiés</span>'
    + '<span class="puce calme">Rien à traiter ✓</span>');
});
