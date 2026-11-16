/* ============================================================================
   Le panneau d'administration (/admin/panel-v2) : son cadre, ses onglets, la
   vue d'ensemble et ses graphiques — gabarits, puis montage dans le faux DOM
   avec un faux serveur et un faux Chart.js.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { AdminPanel } = await import('../../services/web/front/ui/admin/panel/panel.js');
const { AdminVueEnsemble, chiffres } = await import('../../services/web/front/ui/admin/panel/vue-ensemble.js');
const { descriptionGraphique } = await import('../../services/web/front/ui/admin/panel/graphe-periode.js');

/** Faux Chart.js : retient les graphiques créés et ce qu'on leur a demandé. */
class FauxChart {
  /** @type {FauxChart[]} */
  static crees = [];
  /** @param {unknown} canvas @param {any} description */
  constructor(canvas, description) {
    this.canvas = canvas;
    this.type = description.type;
    this.data = description.data;
    this.options = description.options;
    this.misesAJour = 0;
    this.detruit = false;
    FauxChart.crees.push(this);
  }
  update() { this.misesAJour++; }
  destroy() { this.detruit = true; }
}
/** @type {any} */ (globalThis).Chart = FauxChart;

const COMPTES = { me: 1, stats: { users: 42, admins: 2, cours: 6, completions: 130, composts: null, parties: null, signalements: null }, users: [] };
const CARTE = { composts: 5812, en_attente: 3, signalements: 1 };

/**
 * Un serveur d'essai : une réponse par endpoint, les autres échouent.
 * @param {Record<string, { statut?: number, corps?: unknown } | Error | ((adresse: string) => any)>} routes
 */
function serveur(routes) {
  return fauxFetch((adresse) => {
    const route = routes[adresse.split('?')[0]];
    if (!route) return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
    return typeof route === 'function' ? route(adresse) : route;
  });
}

/** Les réponses d'un panneau qui fonctionne. */
const TOUT_VA_BIEN = {
  '/api/admin/stats.php': { corps: COMPTES },
  '/api/carte/count.php': { corps: CARTE },
  '/api/jeux/count.php': { corps: { parties: 77 } },
  '/api/admin/tickets.php': { corps: { a_traiter: 0 } },
  '/api/admin/evolution.php': (/** @type {string} */ adresse) => ({ corps: { labels: ['lun', 'mar'], inscrits: [1, 2], connexions: adresse.includes('period=7d') ? null : [5, 8] } }),
  '/api/carte/evolution.php': { corps: { labels: ['lun', 'mar'], totaux: [5800, 5812], periode: '30d' } },
};

/** Fait taire console.error pendant une action qui provoque une erreur attendue. @param {() => Promise<void>} action */
async function enSilence(action) {
  const origine = console.error;
  console.error = () => {};
  try {
    await action();
  } finally {
    console.error = origine;
  }
}

afterEach(async () => {
  dom.vider();
  FauxChart.crees = [];
  await dom.stabiliser();
});

// ── Gabarits et calculs ─────────────────────────────────────────────────────

test('chiffres : les sept cases, dans l’ordre, avec les alertes', () => {
  assert.deepEqual(chiffres(COMPTES.stats, CARTE, { parties: 77 }), [
    { n: 42, libelle: 'Utilisateurs' },
    { n: 5812, libelle: 'Composteurs' },
    { n: 130, libelle: 'Cours validés' },
    { n: 77, libelle: 'Parties jouées' },
    { n: 2, libelle: 'Admins' },
    { n: 3, libelle: 'Ajouts en attente', alerte: true },
    { n: 1, libelle: 'Signalements', alerte: true },
  ]);
});

test('chiffres : une source absente donne des chiffres indisponibles, pas des zéros', () => {
  const sansCarte = chiffres(COMPTES.stats, null, null);
  assert.deepEqual(sansCarte.filter((c) => c.n === null).map((c) => c.libelle), ['Composteurs', 'Parties jouées', 'Ajouts en attente', 'Signalements']);
  assert.ok(sansCarte.every((c) => !c.alerte), 'aucune alerte sur un chiffre inconnu');
  assert.equal(chiffres(COMPTES.stats, { composts: 10, en_attente: 0, signalements: 0 }, null)[5].alerte, false);
});

test('gabaritChiffres : un tiret pour un chiffre indisponible, la classe alert pour une alerte', () => {
  const sortie = String(new AdminVueEnsemble().gabaritChiffres([
    { n: 0, libelle: 'Admins' },
    { n: null, libelle: 'Composteurs' },
    { n: 3, libelle: 'Signalements', alerte: true },
  ]));
  assert.match(sortie, /<div class="stat-card">\s*<div class="stat-num">0<\/div>/);
  assert.match(sortie, /<div class="stat-num">—<\/div>\s*<div class="stat-lbl">Composteurs/);
  assert.match(sortie, /<div class="stat-card alert">\s*<div class="stat-num">3</);
});

test('descriptionGraphique : séries, couleurs du thème, origine de l’axe', () => {
  const donnees = { labels: ['a', 'b'], series: [
    { nom: 'Inscriptions', valeurs: [1, 2], couleur: /** @type {const} */ ('vert') },
    { nom: 'Connexions', valeurs: [3, 4], couleur: /** @type {const} */ ('orange') },
  ] };
  const clair = descriptionGraphique(donnees, false, true);
  assert.equal(clair.type, 'bar');
  assert.deepEqual(clair.data.labels, ['a', 'b']);
  assert.deepEqual(clair.data.datasets.map((d) => [d.label, d.data, d.borderColor]), [['Inscriptions', [1, 2], '#2d9959'], ['Connexions', [3, 4], '#f9a825']]);
  assert.equal(clair.options.scales.y.beginAtZero, true);
  assert.equal(clair.options.scales.x.ticks.color, '#4a7a5a');
  assert.equal(clair.options.scales.x.ticks.maxTicksLimit, 15);
  assert.equal(clair.options.scales.y.ticks.precision, 0);

  const sombre = descriptionGraphique(donnees, true, false);
  assert.equal(sombre.options.scales.y.beginAtZero, false);
  assert.equal(sombre.options.scales.x.ticks.color, '#7aaa8a');
  assert.equal(sombre.options.plugins.legend.labels.color, '#7aaa8a');
  assert.equal(sombre.options.scales.y.grid.color, 'rgba(255,255,255,0.07)');
});

test('panneau : six onglets, le premier actif, trois avec une pastille', () => {
  const cadre = String(new AdminPanel().gabarit('ensemble'));
  assert.deepEqual([...cadre.matchAll(/data-onglet="(\w+)"/g)].map((m) => m[1]), ['ensemble', 'signalements', 'ajouts', 'messages', 'utilisateurs', 'journal']);
  assert.match(cadre, /class="tab active" role="tab" aria-selected="true" data-onglet="ensemble"/);
  assert.equal((cadre.match(/aria-selected="false"/g) || []).length, 5);
  assert.equal((cadre.match(/class="tab-count" hidden/g) || []).length, 3);
  assert.deepEqual([...cadre.matchAll(/data-contenu="(\w+)" hidden/g)].length, 6);
});

// ── Montage ─────────────────────────────────────────────────────────────────

test('panneau : la vue d’ensemble s’ouvre d’emblée, chiffres et deux graphiques', async () => {
  const { appels } = serveur(TOUT_VA_BIEN);
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();

  assert.equal(panneau.querySelector('h1').textContent, 'Admin panel');
  assert.equal(panneau.querySelector('[data-contenu="ensemble"]').hidden, false);
  assert.deepEqual(panneau.querySelectorAll('.stat-num').map((e) => e.textContent), ['42', '5812', '130', '77', '2', '3', '1']);
  assert.deepEqual(panneau.querySelectorAll('.stat-card.alert .stat-lbl').map((e) => e.textContent), ['Ajouts en attente', 'Signalements']);

  // Deux graphiques, chacun sur 30 jours, dessinés dans leur <canvas>.
  assert.equal(FauxChart.crees.length, 2);
  assert.deepEqual(FauxChart.crees.map((g) => g.data.datasets.map((/** @type {any} */ d) => d.label)), [['Inscriptions', 'Connexions'], ['Composteurs sur la carte']]);
  assert.deepEqual(FauxChart.crees.map((g) => g.options.scales.y.beginAtZero), [true, false]);
  assert.ok(FauxChart.crees.every((g) => /** @type {any} */ (g.canvas).localName === 'canvas'));
  assert.ok(appels.some((a) => a.adresse === '/api/admin/evolution.php?period=30d'));
  assert.ok(appels.some((a) => a.adresse === '/api/carte/evolution.php?periode=30d'));
  assert.ok(dom.bibliothequesDemandees.some((b) => b.endsWith('/assets/vendor/chartjs-4.6.1/chart.umd.min.js')), 'Chart.js est chargé par le composant lui-même');
});

test('panneau : les pastilles des onglets viennent des compteurs', async () => {
  serveur({ ...TOUT_VA_BIEN, '/api/admin/tickets.php': { corps: { a_traiter: 4 } } });
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();

  /** @param {string} cle */
  const pastille = (cle) => panneau.querySelector('[data-onglet="' + cle + '"] .tab-count');
  assert.deepEqual(['signalements', 'ajouts', 'messages'].map((c) => [pastille(c).textContent, pastille(c).hidden]), [['1', false], ['3', false], ['4', false]]);
  assert.ok(panneau.querySelectorAll('.tab.alert').length === 3);
  assert.equal(panneau.querySelector('[data-onglet="journal"] .tab-count'), null);
});

test('panneau : rien à traiter, pastilles masquées et onglets sans alerte', async () => {
  serveur({ ...TOUT_VA_BIEN, '/api/carte/count.php': { corps: { composts: 10, en_attente: 0, signalements: 0 } } });
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();
  assert.ok(panneau.querySelectorAll('.tab-count').every((p) => p.hidden));
  assert.equal(panneau.querySelectorAll('.tab.alert').length, 0);
});

test('panneau : changer d’onglet, puis revenir recharge la vue d’ensemble sans la recréer', async () => {
  const { appels } = serveur(TOUT_VA_BIEN);
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();
  const vue = panneau.querySelector('cs-admin-vue-ensemble');
  const avant = appels.filter((a) => a.adresse === '/api/admin/stats.php').length;

  panneau.querySelector('[data-onglet="utilisateurs"]').click();
  assert.equal(panneau.querySelector('[data-contenu="ensemble"]').hidden, true);
  assert.equal(panneau.querySelector('[data-contenu="utilisateurs"]').hidden, false);
  assert.equal(panneau.querySelector('[data-onglet="utilisateurs"]').classList.contains('active'), true);
  assert.equal(panneau.querySelector('[data-onglet="utilisateurs"]').getAttribute('aria-selected'), 'true');
  assert.match(panneau.querySelector('[data-contenu="utilisateurs"] .en-attente').textContent, /pas encore reconstruit/);
  assert.equal(panneau.querySelector('[data-contenu="utilisateurs"] a').getAttribute('href'), '/admin/panel');

  panneau.querySelector('[data-onglet="ensemble"]').click();
  await dom.stabiliser();
  assert.equal(panneau.querySelector('cs-admin-vue-ensemble'), vue, 'le même composant, pas un nouveau');
  assert.equal(appels.filter((a) => a.adresse === '/api/admin/stats.php').length, avant + 1, 'ses chiffres sont redemandés');
  assert.equal(FauxChart.crees.length, 2, 'les graphiques sont mis à jour, pas recréés');
  assert.ok(FauxChart.crees.every((g) => g.misesAJour === 1));
});

test('graphique : changer de période redemande et garde le choix au retour sur l’onglet', async () => {
  const { appels } = serveur(TOUT_VA_BIEN);
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();
  const activite = panneau.querySelector('[data-graphe="activite"]');

  activite.querySelector('[data-periode="7d"]').click();
  await dom.stabiliser();
  assert.ok(appels.some((a) => a.adresse === '/api/admin/evolution.php?period=7d'));
  assert.deepEqual(activite.querySelectorAll('.evo-btn.active').map((b) => b.dataset.periode), ['7d']);
  assert.deepEqual(FauxChart.crees[0].data.datasets.map((/** @type {any} */ d) => d.label), ['Inscriptions'], 'sans connexions, une seule série');
  assert.deepEqual(panneau.querySelector('[data-graphe="parc"]').querySelectorAll('.evo-btn.active').map((b) => b.dataset.periode), ['30d'], 'l’autre graphique n’a pas bougé');

  panneau.querySelector('[data-onglet="utilisateurs"]').click();
  panneau.querySelector('[data-onglet="ensemble"]').click();
  await dom.stabiliser();
  assert.equal(appels.filter((a) => a.adresse === '/api/admin/evolution.php?period=7d').length, 2, 'la période choisie est conservée');
});

test('graphique : un changement de thème redessine avec les couleurs du thème', async () => {
  serveur(TOUT_VA_BIEN);
  dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();
  assert.equal(FauxChart.crees[0].options.scales.x.ticks.color, '#4a7a5a');

  dom.document.documentElement.classList.add('dark');
  dom.document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: true } }));
  assert.equal(FauxChart.crees[0].options.scales.x.ticks.color, '#7aaa8a');
  assert.equal(FauxChart.crees[0].misesAJour, 1);
});

test('vue d’ensemble : la carte en panne laisse des tirets, les autres chiffres s’affichent', async () => {
  await enSilence(async () => {
    serveur({ ...TOUT_VA_BIEN, '/api/carte/count.php': { statut: 500, corps: { error: 'db' } }, '/api/carte/evolution.php': new TypeError('fetch failed') });
    const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
    await dom.stabiliser();

    assert.deepEqual(panneau.querySelectorAll('.stat-num').map((e) => e.textContent), ['42', '—', '130', '77', '2', '—', '—']);
    const message = panneau.querySelector('[data-graphe="parc"] .graphe-message');
    assert.equal(message.hidden, false);
    assert.equal(message.textContent, 'Connexion au serveur impossible.');
    assert.equal(panneau.querySelector('[data-graphe="activite"] .graphe-message').hidden, true);
    assert.equal(FauxChart.crees.length, 1, 'le graphique d’activité est dessiné quand même');
  });
});

test('vue d’ensemble : sans les chiffres des comptes, un message d’erreur à leur place', async () => {
  await enSilence(async () => {
    serveur({ ...TOUT_VA_BIEN, '/api/admin/stats.php': { statut: 500, corps: { error: 'DB error' } } });
    const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
    await dom.stabiliser();
    assert.equal(panneau.querySelector('.stats-grid .cs-etat--erreur').textContent, "⚠️ Les chiffres n'ont pas pu être chargés.");
    assert.equal(panneau.querySelectorAll('.stat-card').length, 0);
  });
});

test('panneau : droits retirés (403), retour à l’accueil du site', async () => {
  /** @type {string[]} */
  const redirections = [];
  /** @type {any} */ (globalThis).location.replace = (/** @type {string} */ adresse) => { redirections.push(adresse); };
  await enSilence(async () => {
    const refus = { statut: 403, corps: { error: 'Accès réservé aux administrateurs.' } };
    serveur({ ...TOUT_VA_BIEN, '/api/admin/tickets.php': refus, '/api/admin/stats.php': refus });
    dom.monter('<cs-admin-panel></cs-admin-panel>');
    await dom.stabiliser();
  });
  assert.deepEqual(redirections, ['/']);
});

test('panneau : un onglet qui modifie des données fait recompter les pastilles', async () => {
  const { appels } = serveur(TOUT_VA_BIEN);
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();
  const avant = appels.filter((a) => a.adresse === '/api/carte/count.php').length;

  panneau.querySelector('cs-admin-vue-ensemble').emettre('donnees-modifiees');
  await dom.stabiliser();
  assert.equal(appels.filter((a) => a.adresse === '/api/carte/count.php').length, avant + 1);
});

test('panneau retiré de la page : ses graphiques sont détruits', async () => {
  serveur(TOUT_VA_BIEN);
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();
  const graphiques = [...FauxChart.crees];
  panneau.remove();
  await dom.stabiliser();
  assert.ok(graphiques.every((g) => g.detruit));
});
