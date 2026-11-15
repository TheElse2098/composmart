/* Gabarits de la page /classement, sur des réponses d'exemple de
   /api/auth/leaderboard.php. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installerFauxDom } from './faux-dom.mjs';

installerFauxDom();
const { Classement } = await import('../../services/web/front/ui/pages/classement/classement.js');

/** @param {number} id @param {string} username @param {number} xp */
const joueur = (id, username, xp, niveau = 1) => ({ id, username, xp, niveau });

/** Texte des éléments d'une classe, dans l'ordre. @param {string} sortie @param {string} classe */
const textes = (sortie, classe) => [...sortie.matchAll(new RegExp('class="' + classe + '">([^<]*)<', 'g'))].map((m) => m[1]);

const cinq = [joueur(1, 'ana', 500, 5), joueur(2, 'bob', 400, 4), joueur(3, 'cy', 300, 3), joueur(4, 'dee', 200, 2), joueur(5, 'eli', 100, 1)];

test('cadre : trois périodes, « Général » active par défaut', () => {
  const cadre = String(new Classement().gabaritCadre('total'));
  assert.deepEqual([...cadre.matchAll(/data-periode="(\w+)"/g)].map((m) => m[1]), ['total', 'semaine', 'jour']);
  assert.match(cadre, /class="per-btn active" data-periode="total"/);
  assert.equal((cadre.match(/per-btn active/g) || []).length, 1);
  assert.match(cadre, /<p class="hero-sub">Les meilleurs composteurs de la communauté<\/p>/);
  assert.match(cadre, /<main class="board"><\/main>/);
});

test('podium : deuxième à gauche, premier au centre, troisième à droite', () => {
  const sortie = String(new Classement().gabaritTableau({ top: cinq, me: null }, 'total'));
  assert.deepEqual(textes(sortie, 'pod-name'), ['bob', 'ana', 'cy']);
  assert.deepEqual(textes(sortie, 'pod-medal'), ['🥈', '🥇', '🥉']);
  assert.deepEqual([...sortie.matchAll(/class="pod (pod-\d)/g)].map((m) => m[1]), ['pod-2', 'pod-1', 'pod-3']);
  assert.deepEqual(textes(sortie, 'pod-xp'), ['400 XP', '500 XP', '300 XP']);
});

test('liste : les suivants à partir du rang 4', () => {
  const sortie = String(new Classement().gabaritTableau({ top: cinq, me: null }, 'total'));
  assert.deepEqual(textes(sortie, 'lb-rank'), ['#4', '#5']);
  assert.deepEqual(textes(sortie, 'lb-xp'), ['200 XP', '100 XP']);
  assert.deepEqual(textes(sortie, 'lb-lvl'), ['Niveau 2', 'Niveau 1']);
  assert.doesNotMatch(sortie, /lb-sep/);
});

test('moins de trois joueurs : pas de podium, liste à partir du rang 1', () => {
  const sortie = String(new Classement().gabaritTableau({ top: cinq.slice(0, 2), me: null }, 'total'));
  assert.doesNotMatch(sortie, /class="podium"/);
  assert.deepEqual(textes(sortie, 'lb-rank'), ['#1', '#2']);
});

test('exactement trois joueurs : un podium et aucune liste vide', () => {
  const sortie = String(new Classement().gabaritTableau({ top: cinq.slice(0, 3), me: null }, 'total'));
  assert.match(sortie, /class="podium"/);
  assert.doesNotMatch(sortie, /lb-list/);
});

test('moi sur le podium : ma carte est marquée, pas de ligne en double', () => {
  const sortie = String(new Classement().gabaritTableau({ top: cinq, me: { ...cinq[0], rank: 1 } }, 'total'));
  assert.match(sortie, /class="pod pod-1 is-me"/);
  assert.equal((sortie.match(/is-me/g) || []).length, 1);
  assert.doesNotMatch(sortie, /lb-sep/);
  assert.doesNotMatch(sortie, /lb-me/);
});

test('moi dans la liste : ma ligne est marquée et étiquetée', () => {
  const sortie = String(new Classement().gabaritTableau({ top: cinq, me: { ...cinq[3], rank: 4 } }, 'total'));
  assert.match(sortie, /class="lb-row lb-me"/);
  assert.match(sortie, /dee<span class="lb-me-tag">moi<\/span>/);
  assert.equal((sortie.match(/lb-me-tag/g) || []).length, 1);
  assert.doesNotMatch(sortie, /lb-sep/);
});

test('moi hors du tableau : séparateur puis ma ligne, à mon rang', () => {
  const moi = { ...joueur(9, 'zoe', 12, 1), rank: 27 };
  const sortie = String(new Classement().gabaritTableau({ top: cinq, me: moi }, 'total'));
  assert.match(sortie, /class="lb-sep">···</);
  assert.deepEqual(textes(sortie, 'lb-rank'), ['#4', '#5', '#27']);
  assert.ok(sortie.indexOf('lb-sep') < sortie.indexOf('#27'));
});

test('sur une période, le suffixe dit « gagnés »', () => {
  const sortie = String(new Classement().gabaritTableau({ top: cinq, me: null }, 'semaine'));
  assert.deepEqual(textes(sortie, 'lb-xp'), ['200 XP gagnés', '100 XP gagnés']);
});

test('classement vide : message propre à la période', () => {
  const c = new Classement();
  assert.match(String(c.gabaritTableau({ top: [], me: null }, 'total')), /Aucun joueur classé pour l&#39;instant\./);
  assert.match(String(c.gabaritTableau({ top: [], me: null }, 'semaine')), /cette semaine/);
  assert.match(String(c.gabaritTableau({ top: [], me: null }, 'jour')), /aujourd&#39;hui/);
});

test('classement par période pas encore en service : le dire', () => {
  const sortie = String(new Classement().gabaritTableau({ top: [], me: null, indisponible: true }, 'jour'));
  assert.match(sortie, /n'est pas encore disponible/);
});

test('un pseudo n’est jamais interprété comme du HTML', () => {
  const pirate = joueur(1, '<img src=x onerror=alert(1)>', 500);
  const sortie = String(new Classement().gabaritTableau({ top: [pirate, cinq[1]], me: null }, 'total'));
  assert.doesNotMatch(sortie, /<img/);
  assert.ok(sortie.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(sortie, /class="lb-ava">&lt;</, 'l’initiale « < » est échappée elle aussi');
});

test('invitation : liens vers la connexion et l’inscription', () => {
  const sortie = String(new Classement().gabaritInvitation());
  assert.match(sortie, /href="\/login"/);
  assert.match(sortie, /href="\/signin"/);
});
