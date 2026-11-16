/* ============================================================================
   <cs-courbe-xp> : la courbe d'XP cumulée, sur la page de compte et sur la
   fiche joueur du panneau d'administration.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { gabaritCourbe, pointsXp } = await import('../../services/web/front/ui/composants/courbe-xp/courbe-xp.js');

const HISTORIQUE = [
  { delta: 10, created_at: '2026-11-10 09:00:00' },
  { delta: 5, created_at: '2026-11-10 18:30:00' },
  { delta: 20, created_at: '2026-11-13 12:00:00' },
];

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

test('pointsXp : cumul par jour, jours sans gain comblés', () => {
  assert.deepEqual(pointsXp(HISTORIQUE).map((p) => [p.n, p.xp, p.date.getDate()]), [[0, 15, 10], [1, 15, 11], [2, 15, 12], [3, 35, 13]]);
  assert.deepEqual(pointsXp([]), []);
  assert.deepEqual(pointsXp([{ delta: 7, created_at: '2026-11-10 09:00:00' }]).map((p) => [p.n, p.xp]), [[0, 7]]);
});

test('pointsXp : un changement d’heure dans la période ne décale ni ne double aucun jour', () => {
  // Passage à l'heure d'hiver le 25 octobre 2026 : une journée de 25 heures.
  const points = pointsXp([{ delta: 1, created_at: '2026-10-24 10:00:00' }, { delta: 1, created_at: '2026-10-27 10:00:00' }]);
  assert.equal(points.at(-1)?.xp, 2, 'le dernier gain est compté');
  assert.deepEqual(points.map((p) => p.date.getDate()), [24, 25, 26, 27]);

  // Passage à l'heure d'été le 29 mars 2026 : une journée de 23 heures.
  const printemps = pointsXp([{ delta: 1, created_at: '2026-03-28 10:00:00' }, { delta: 1, created_at: '2026-03-30 10:00:00' }]);
  assert.deepEqual(printemps.map((p) => [p.date.getDate(), p.xp]), [[28, 1], [29, 1], [30, 2]]);
});

test('gabaritCourbe : sans gain, le message donné (ou celui par défaut)', () => {
  assert.equal(String(gabaritCourbe([], 'Aucun gain <encore>.')), '<div class="courbe-vide">Aucun gain &lt;encore&gt;.</div>');
  assert.match(String(gabaritCourbe([])), /Pas encore assez de données pour tracer une courbe\./);
});

test('gabaritCourbe : total, tracé du premier au dernier jour, dates extrêmes, survol de chaque jour', () => {
  const sortie = String(gabaritCourbe(HISTORIQUE));
  assert.match(sortie, /<div class="courbe-total">35 XP <span>au total<\/span><\/div>/);
  assert.match(sortie, /<svg class="courbe-dessin" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="Courbe d'XP cumulée du 10 nov\. au 13 nov\., de 0 à 35 XP">/);
  // 15 XP sur 35 pendant trois jours, puis 35 : la courbe reste plate avant de monter.
  assert.match(sortie, /<path class="courbe-trait" vector-effect="non-scaling-stroke" d="M4\.0,58\.3 L101\.3,58\.3 L198\.7,58\.3 L296\.0,8\.0"><\/path>/);
  assert.match(sortie, /<path class="courbe-aire" d="M4\.0,58\.3 L101\.3,58\.3 L198\.7,58\.3 L296\.0,8\.0 L296\.0,96 L4\.0,96 Z"><\/path>/);
  assert.match(sortie, /<line class="courbe-sol" vector-effect="non-scaling-stroke" x1="4" y1="96" x2="296" y2="96"><\/line>/);
  assert.equal(sortie.split('<circle').length - 1, 4);
  assert.match(sortie, /<circle cx="296\.0" cy="8\.0" r="7" fill="transparent"><title>13 nov\. — 35 XP<\/title><\/circle>/);
  assert.match(sortie, /<div class="courbe-dates"><span>10 nov\.<\/span><span>13 nov\.<\/span><\/div>/);
});

test('gabaritCourbe : un seul jour de gains, pas de division par zéro', () => {
  const sortie = String(gabaritCourbe([{ delta: 12, created_at: '2026-11-10 09:00:00' }]));
  assert.match(sortie, /d="M4\.0,8\.0"/);
  assert.ok(!sortie.includes('NaN') && !sortie.includes('Infinity'));
});

test('composant : la courbe est tracée une fois la feuille de style arrivée, puis à chaque montrer()', async () => {
  const courbe = /** @type {any} */ (dom.monter('<cs-courbe-xp></cs-courbe-xp>'));
  courbe.montrer(HISTORIQUE);
  assert.equal(courbe.querySelector('svg'), null, 'rien avant la feuille : l’aire serait noire');
  await dom.stabiliser();
  assert.equal(courbe.querySelector('.courbe-total').textContent, '35 XP au total');

  courbe.montrer([], 'Rien pour l’instant.');
  assert.equal(courbe.querySelector('svg'), null);
  assert.equal(courbe.querySelector('.courbe-vide').textContent, 'Rien pour l’instant.');
});
