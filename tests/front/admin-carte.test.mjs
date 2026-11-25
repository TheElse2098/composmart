/* ============================================================================
   Les onglets du panneau qui traitent la carte : signalements
   (<cs-admin-signalements>), demandes d'ajout (<cs-admin-ajouts>) et la
   fenêtre de correction d'une demande (<cs-admin-ajout-edition>).
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
/** @type {any} */ (globalThis).Chart = class { update() {} destroy() {} };
const { AdminSignalements } = await import('../../services/web/front/ui/admin/panel/signalements.js');
const { AdminAjouts, lienCarte } = await import('../../services/web/front/ui/admin/panel/ajouts.js');
const { AdminAjoutEdition } = await import('../../services/web/front/ui/admin/panel/ajout-edition.js');
const { gabaritPages } = await import('../../services/web/front/ui/admin/panel/communs.js');
const { libelleMotif } = await import('../../services/web/front/ui/pages/carte/carte-libelles.js');
await import('../../services/web/front/ui/admin/panel/panel.js');

const SIGNALEMENTS = [
  { id: 4, compost_id: 88, motif: 'position', commentaire: 'Il est <en face>', date: '2026-11-12 10:00:00', lat: 48.1, lon: 2.3, type: 'Conteneur', par: 'lea' },
  { id: 3, compost_id: 12, motif: 'inexistant', commentaire: '', date: '2026-11-10 08:30:00', lat: 48.2, lon: 2.4, type: 'Compost bois', par: 'Anonyme' },
];

const DECHETS = ['coquilles', 'marc de café', 'viande', 'épluchures'];

const DEMANDES = [
  { id: 31, lat: 48.123456789, lon: 2.5, type: 'Compost bois', acces: 'privé', gestion: 'Mairie', info_gestion: '01 02 03', propose_par: 'lea', date: '2026-11-14T09:15:00', mettre: ['épluchures'], pas_mettre: ['viande'] },
  { id: 32, lat: 45, lon: 4.8, type: null, acces: null, gestion: null, info_gestion: null, propose_par: 'Anonyme', date: '2026-11-13 18:00:00', mettre: [], pas_mettre: [] },
];

/** @param {{ demandes?: any[], pages?: number, total?: number }} [options] */
function demandes({ demandes: liste = DEMANDES, pages = 1, total = liste.length } = {}) {
  return (/** @type {string} */ adresse, /** @type {any} */ options) => {
    if (options.method === 'POST') return { corps: { ok: true, traites: 1 } };
    const page = Number(new URL(adresse, 'https://composmart.test').searchParams.get('page') || 1);
    return { corps: { demandes: liste, elements: DECHETS, page: Math.min(page, pages), pages, total } };
  };
}

/** @param {Record<string, { statut?: number, corps?: unknown } | Error | ((adresse: string, options: any) => any)>} routes */
function serveur(routes) {
  return fauxFetch((adresse, options) => {
    const route = routes[adresse.split('?')[0]];
    if (!route) return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
    return typeof route === 'function' ? route(adresse, options) : route;
  });
}

/** @param {{ adresse: string, options: any }[]} appels  les envois (POST) reçus */
const envois = (appels) => appels.filter((a) => a.options.method === 'POST');
/** @param {{ adresse: string, options: any }[]} appels  les adresses lues (GET) */
const lectures = (appels) => appels.filter((a) => a.options.method === 'GET').map((a) => a.adresse);

/** @param {() => Promise<void>} action */
async function enSilence(action) {
  const origine = console.error;
  console.error = () => {};
  try {
    await action();
  } finally {
    console.error = origine;
  }
}

/** @param {string} source @returns {Promise<any>} */
async function monter(source) {
  const element = dom.monter(source);
  await dom.stabiliser();
  return element;
}

/** Les signaux « donnees-modifiees » émis sous un élément. @param {any} element */
function signaux(element) {
  /** @type {string[]} */
  const recus = [];
  element.addEventListener('donnees-modifiees', () => recus.push('donnees-modifiees'));
  return recus;
}

/** La boîte de confirmation ou de message la plus récente. */
const boite = () => dom.document.querySelectorAll('cs-dialogue').at(-1);

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

// ── Communs ─────────────────────────────────────────────────────────────────

test('gabaritPages : rien pour une seule page, boutons bornés aux extrémités', () => {
  assert.equal(gabaritPages({ page: 1, pages: 1, total: 4 }, 'demande', 'demandes'), null);
  const milieu = String(gabaritPages({ page: 2, pages: 3, total: 61 }, 'action', 'actions'));
  assert.match(milieu, /<div class="pages">\s*<button type="button" data-page="1">← Précédent<\/button>/);
  assert.match(milieu, /<span class="pages-info">Page 2 \/ 3 · 61 actions<\/span>/);
  assert.match(milieu, /<button type="button" data-page="3">Suivant →<\/button>/);
  assert.match(String(gabaritPages({ page: 1, pages: 2, total: 21 }, 'demande', 'demandes')), /data-page="0" disabled>← Précédent/);
  assert.match(String(gabaritPages({ page: 2, pages: 2, total: 21 }, 'demande', 'demandes')), /data-page="3" disabled>Suivant →/);
});

test('libelleMotif : un motif connu a son libellé, un inconnu garde son code', () => {
  assert.equal(libelleMotif('regles'), '📋 Règles incorrectes');
  assert.equal(libelleMotif('nouveau_motif'), 'nouveau_motif');
});

// ── Signalements ────────────────────────────────────────────────────────────

test('signalements, gabarit : motif, composteur, auteur, jour ; commentaire seulement s’il y en a un', () => {
  const onglet = new AdminSignalements();
  assert.match(String(onglet.gabaritListe([])), /class="empty-msg">Aucun signalement ouvert 🎉/);

  const sortie = String(onglet.gabaritListe([...SIGNALEMENTS, { ...SIGNALEMENTS[0], id: 9, motif: '<nouveau>', commentaire: null }]));
  assert.equal(sortie.split('class="signal-item"').length - 1, 3);
  assert.match(sortie, /<div class="signal-item-motif">📍 Mauvaise position<\/div>\s*<div class="signal-item-meta">Composteur #88 · par lea · 2026-11-12<\/div>\s*<div class="signal-item-comment">« Il est &lt;en face&gt; »<\/div>/);
  assert.equal(sortie.split('signal-item-comment').length - 1, 1, 'un commentaire vide ou absent ne laisse pas de guillemets');
  assert.match(sortie, /<div class="signal-item-motif">&lt;nouveau&gt;<\/div>/);
  assert.match(sortie, /<button type="button" class="action-oui" data-statut="resolu" data-id="4">✓ Résolu<\/button>/);
  assert.match(sortie, /<button type="button" class="action-non" data-statut="rejete" data-id="3">✗ Rejeter<\/button>/);
});

test('signalements : la liste des signalements ouverts est demandée au montage', async () => {
  const { appels } = serveur({ '/api/carte/signalement.php': { corps: { signalements: SIGNALEMENTS } } });
  const onglet = await monter('<cs-admin-signalements></cs-admin-signalements>');
  assert.deepEqual(lectures(appels), ['/api/carte/signalement.php?action=liste']);
  assert.deepEqual(onglet.querySelectorAll('.signal-item-motif').map((/** @type {any} */ e) => e.textContent), ['📍 Mauvaise position', "❌ N'existe plus"]);
});

test('signalements : « Résolu » enregistre la décision, prévient le panneau et recharge', async () => {
  const { appels } = serveur({ '/api/carte/signalement.php': (_adresse, options) => (options.method === 'POST' ? { corps: { ok: true } } : { corps: { signalements: SIGNALEMENTS } }) });
  const onglet = await monter('<cs-admin-signalements></cs-admin-signalements>');
  const recus = signaux(onglet);

  onglet.querySelector('[data-statut="resolu"][data-id="4"]').click();
  assert.equal(onglet.querySelector('[data-statut="rejete"][data-id="4"]').disabled, true, 'pas de seconde décision pendant l’envoi');
  await dom.stabiliser();

  assert.equal(envois(appels).length, 1);
  assert.equal(envois(appels)[0].adresse, '/api/carte/signalement.php');
  assert.equal(String(envois(appels)[0].options.body), 'action=traiter&id=4&statut=resolu');
  assert.deepEqual(recus, ['donnees-modifiees']);
  assert.equal(lectures(appels).length, 2, 'la liste est rechargée');
});

test('signalements : « Rejeter » envoie le statut rejeté', async () => {
  const { appels } = serveur({ '/api/carte/signalement.php': (_adresse, options) => (options.method === 'POST' ? { corps: { ok: true } } : { corps: { signalements: SIGNALEMENTS } }) });
  const onglet = await monter('<cs-admin-signalements></cs-admin-signalements>');
  onglet.querySelector('[data-statut="rejete"][data-id="3"]').click();
  await dom.stabiliser();
  assert.equal(String(envois(appels)[0].options.body), 'action=traiter&id=3&statut=rejete');
});

test('signalements : décision refusée par le serveur, sa raison est affichée et rien n’est rechargé', async () => {
  await enSilence(async () => {
    const { appels } = serveur({ '/api/carte/signalement.php': (_adresse, options) => (options.method === 'POST' ? { statut: 403, corps: { error: 'Action réservée aux administrateurs.' } } : { corps: { signalements: SIGNALEMENTS } }) });
    const onglet = await monter('<cs-admin-signalements></cs-admin-signalements>');
    const recus = signaux(onglet);
    onglet.querySelector('[data-statut="resolu"][data-id="4"]').click();
    await dom.stabiliser();

    assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Action impossible');
    assert.equal(boite().querySelector('.dialogue__texte').textContent, 'Action réservée aux administrateurs.');
    assert.deepEqual(recus, []);
    assert.equal(lectures(appels).length, 1);
    assert.equal(onglet.querySelector('[data-statut="resolu"][data-id="4"]').disabled, false);
  });
});

test('signalements : carte injoignable, un message à la place de la liste', async () => {
  await enSilence(async () => {
    serveur({ '/api/carte/signalement.php': new TypeError('fetch failed') });
    const onglet = await monter('<cs-admin-signalements></cs-admin-signalements>');
    assert.equal(onglet.querySelector('.cs-etat--erreur').textContent, '⚠️ Connexion au serveur impossible.');
    assert.equal(onglet.querySelector('.section-title').textContent, '🚩 Signalements ouverts');
  });
});

// ── Ajouts : gabarits ───────────────────────────────────────────────────────

test('lienCarte : le point, centré et zoomé, sur OpenStreetMap', () => {
  assert.equal(lienCarte(48.5, 2.25), 'https://www.openstreetmap.org/?mlat=48.5&mlon=2.25#map=19/48.5/2.25');
});

test('ajouts, gabarit d’une demande : pastilles, position, auteur, règles, actions', () => {
  const onglet = new AdminAjouts();
  const complete = String(onglet.gabaritDemande(DEMANDES[0]));
  assert.match(complete, /<div class="pending-item" data-id="31">/);
  assert.match(complete, /<span class="pending-id">#31<\/span>\s*<span class="pending-badge">Compost bois<\/span>\s*<span class="pending-badge">privé<\/span>/);
  assert.match(complete, /<div class="pending-meta">📍 48\.12346, 2\.50000 · par lea · 2026-11-14 09:15 · Mairie<\/div>/);
  assert.match(complete, /<div class="pending-rules"><span class="regle">épluchures<\/span><span class="regle nok">viande<\/span><\/div>/);
  assert.match(complete, /<a class="action-voir" href="https:\/\/www\.openstreetmap\.org\/\?mlat=48\.123456789&amp;mlon=2\.5#map=19\/48\.123456789\/2\.5" target="_blank" rel="noopener">/);
  assert.match(complete, /data-action="modifier" data-id="31">✏️ Modifier/);
  assert.match(complete, /class="action-oui" data-decision="valider" data-id="31"/);
  assert.match(complete, /class="action-non" data-decision="refuser" data-id="31"/);

  const vide = String(onglet.gabaritDemande(DEMANDES[1]));
  assert.match(vide, /<span class="pending-badge vide">type manquant<\/span>\s*<span class="pending-badge vide">accès manquant<\/span>/);
  assert.match(vide, /· par Anonyme · 2026-11-13 18:00<\/div>/);
  assert.ok(!vide.includes('pending-rules'));
});

test('ajouts, gabarit de la liste : rien à traiter, ou barre d’actions groupées et pagination', () => {
  const onglet = new AdminAjouts();
  assert.match(String(onglet.gabaritListe({ demandes: [], elements: [], page: 1, pages: 1, total: 0 })), /class="empty-msg">Aucune demande en attente 🎉/);
  const liste = String(onglet.gabaritListe({ demandes: DEMANDES, elements: DECHETS, page: 1, pages: 2, total: 22 }));
  assert.match(liste, /<button type="button" class="bulk-btn action-oui" data-decision="valider" disabled>✓ Valider<\/button>/);
  assert.match(liste, /Page 1 \/ 2 · 22 demandes/);
});

test('correction, gabarit des déchets : chaque déchet du référentiel dans l’état de la demande', () => {
  const sortie = String(new AdminAjoutEdition().gabaritDechets(DEMANDES[0], DECHETS));
  assert.deepEqual([...sortie.matchAll(/data-etat="(\d)" data-nom="([^"]+)"/g)].map((m) => [m[2], m[1]]), [['coquilles', '0'], ['marc de café', '0'], ['viande', '2'], ['épluchures', '1']]);
});

// ── Ajouts : la liste, montée ───────────────────────────────────────────────

test('ajouts : première page, total à côté du titre, rien de coché', async () => {
  const { appels } = serveur({ '/api/carte/pending.php': demandes() });
  const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
  assert.deepEqual(lectures(appels), ['/api/carte/pending.php?action=liste&page=1']);
  assert.equal(onglet.querySelector('.section-compte').textContent, '(2)');
  assert.deepEqual(onglet.querySelectorAll('.pending-id').map((/** @type {any} */ e) => e.textContent), ['#31', '#32']);
  assert.ok(onglet.querySelectorAll('.bulk-btn').every((/** @type {any} */ b) => b.disabled));
  assert.equal(onglet.querySelector('.bulk-count').textContent, '');
});

test('ajouts : cocher des demandes met la barre à jour, « tout sélectionner » aussi', async () => {
  serveur({ '/api/carte/pending.php': demandes() });
  const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
  const tout = onglet.querySelector('[data-action="tout-cocher"]');
  /** @param {number} id */
  const caseDe = (id) => onglet.querySelector('.pending-cb[data-id="' + id + '"]');
  /** @param {number} id */
  const ligne = (id) => onglet.querySelector('.pending-item[data-id="' + id + '"]');

  caseDe(31).cocher(true);
  assert.equal(ligne(31).classList.contains('sel'), true);
  assert.equal(onglet.querySelector('.bulk-count').textContent, '1 sélectionné');
  assert.ok(onglet.querySelectorAll('.bulk-btn').every((/** @type {any} */ b) => !b.disabled));
  assert.deepEqual([tout.checked, tout.indeterminate], [false, true]);

  caseDe(32).cocher(true);
  assert.equal(onglet.querySelector('.bulk-count').textContent, '2 sélectionnés');
  assert.deepEqual([tout.checked, tout.indeterminate], [true, false]);

  tout.cocher(false);
  assert.deepEqual([caseDe(31).checked, caseDe(32).checked, ligne(31).classList.contains('sel')], [false, false, false]);
  assert.equal(onglet.querySelector('.bulk-count').textContent, '');
  assert.ok(onglet.querySelectorAll('.bulk-btn').every((/** @type {any} */ b) => b.disabled));

  tout.cocher(true);
  assert.deepEqual([caseDe(31).checked, caseDe(32).checked, ligne(32).classList.contains('sel')], [true, true, true]);
  assert.equal(onglet.querySelector('.bulk-count').textContent, '2 sélectionnés');
});

test('ajouts : valider une demande l’envoie sans confirmation, prévient le panneau, recharge', async () => {
  const { appels } = serveur({ '/api/carte/pending.php': demandes() });
  const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
  const recus = signaux(onglet);
  onglet.querySelector('.pending-cb[data-id="32"]').cocher(true);

  onglet.querySelector('.pending-actions [data-decision="valider"][data-id="31"]').click();
  await dom.stabiliser();
  assert.equal(dom.document.querySelector('cs-dialogue'), null);
  assert.equal(envois(appels)[0].adresse, '/api/carte/pending.php');
  assert.equal(envois(appels)[0].options.body.get('action'), 'valider');
  assert.deepEqual(envois(appels)[0].options.body.getAll('ids[]'), ['31'], 'le bouton d’une ligne ne vaut que pour elle, pas pour la sélection');
  assert.deepEqual(recus, ['donnees-modifiees']);
  assert.equal(lectures(appels).length, 2);
  assert.equal(onglet.querySelector('.bulk-count').textContent, '', 'la sélection ne survit pas au rechargement');
});

test('ajouts : refuser la sélection se confirme, puis part en une seule demande', async () => {
  const { appels } = serveur({ '/api/carte/pending.php': demandes() });
  const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
  onglet.querySelector('[data-action="tout-cocher"]').cocher(true);

  onglet.querySelector('.bulk-btn[data-decision="refuser"]').click();
  await dom.stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Refuser ces 2 demandes ?');
  assert.equal(boite().querySelector('[data-reponse="oui"]').textContent, 'Refuser');
  assert.equal(envois(appels).length, 0);

  boite().querySelector('[data-reponse="oui"]').click();
  await dom.stabiliser();
  assert.equal(envois(appels).length, 1);
  assert.equal(envois(appels)[0].options.body.get('action'), 'refuser');
  assert.deepEqual(envois(appels)[0].options.body.getAll('ids[]'), ['31', '32']);
});

test('ajouts : renoncer à un refus n’envoie rien et garde la sélection', async () => {
  const { appels } = serveur({ '/api/carte/pending.php': demandes() });
  const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
  onglet.querySelector('.pending-cb[data-id="31"]').cocher(true);
  onglet.querySelector('.pending-actions [data-decision="refuser"][data-id="32"]').click();
  await dom.stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Refuser cette demande ?');
  boite().querySelector('[data-reponse="non"]').click();
  await dom.stabiliser();
  assert.equal(envois(appels).length, 0);
  assert.equal(onglet.querySelector('.bulk-count').textContent, '1 sélectionné');
});

test('ajouts : décision refusée par le serveur, sa raison est affichée', async () => {
  await enSilence(async () => {
    serveur({ '/api/carte/pending.php': (adresse, options) => (options.method === 'POST' ? { corps: { error: 'Aucun composteur sélectionné.' } } : demandes()(adresse, options)) });
    const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
    const recus = signaux(onglet);
    onglet.querySelector('.pending-actions [data-decision="valider"][data-id="31"]').click();
    await dom.stabiliser();
    assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Action impossible');
    assert.equal(boite().querySelector('.dialogue__texte').textContent, 'Aucun composteur sélectionné.');
    assert.deepEqual(recus, []);
  });
});

test('ajouts : changer de page ; le serveur peut ramener à une page plus proche', async () => {
  let pages = 2;
  const { appels } = serveur({ '/api/carte/pending.php': (adresse, options) => demandes({ pages, total: 22 })(adresse, options) });
  const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
  onglet.querySelector('[data-page="2"]').click();
  await dom.stabiliser();
  assert.equal(lectures(appels).at(-1), '/api/carte/pending.php?action=liste&page=2');
  assert.equal(onglet.querySelector('.pages-info').textContent, 'Page 2 / 2 · 22 demandes');

  pages = 1; // la dernière demande de la page 2 vient d'être traitée
  await onglet.rafraichir();
  assert.equal(lectures(appels).at(-1), '/api/carte/pending.php?action=liste&page=2');
  await onglet.rafraichir();
  assert.equal(lectures(appels).at(-1), '/api/carte/pending.php?action=liste&page=1', 'calé sur la page servie');
});

test('ajouts : serveur en panne, un message à la place de la liste', async () => {
  await enSilence(async () => {
    serveur({ '/api/carte/pending.php': { statut: 500, corps: { error: 'DB error' } } });
    const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
    assert.equal(onglet.querySelector('.cs-etat--erreur').textContent, "⚠️ Les demandes n'ont pas pu être chargées.");
  });
});

// ── Ajouts : corriger une demande ───────────────────────────────────────────

/** Monte l'onglet et ouvre la correction de la demande 31. */
async function ouvrirCorrection() {
  const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
  onglet.querySelector('[data-action="modifier"][data-id="31"]').click();
  const fenetre = onglet.querySelector('cs-admin-ajout-edition');
  /** @param {string} nom */
  const champ = (nom) => fenetre.querySelector('[data-champ="' + nom + '"]');
  /** @param {string} nom */
  const pastille = (nom) => fenetre.querySelector('.elt-chip[data-nom="' + nom + '"]');
  return { onglet, fenetre, champ, pastille };
}

test('correction : la fenêtre s’ouvre remplie avec la demande', async () => {
  serveur({ '/api/carte/pending.php': demandes() });
  const { fenetre, champ, pastille } = await ouvrirCorrection();
  assert.equal(fenetre.ouverte, true);
  assert.equal(fenetre.querySelector('.fenetre__titre').textContent, 'Modifier la demande #31');
  assert.deepEqual(['type', 'acces', 'gestion', 'info_gestion'].map((n) => champ(n).value), ['Compost bois', 'privé', 'Mairie', '01 02 03']);
  assert.deepEqual(DECHETS.map((d) => pastille(d).dataset.etat), ['0', '0', '2', '1']);
  assert.equal(fenetre.querySelector('.fenetre__erreur').hidden, true);
  assert.deepEqual(champ('type').querySelectorAll('option').map((/** @type {any} */ o) => o.getAttribute('value')), ['Conteneur', 'Compost bois', 'Compost plastique']);
});

test('correction : une demande sans type ni accès reçoit les valeurs par défaut', async () => {
  serveur({ '/api/carte/pending.php': demandes() });
  const onglet = await monter('<cs-admin-ajouts></cs-admin-ajouts>');
  onglet.querySelector('[data-action="modifier"][data-id="32"]').click();
  const fenetre = onglet.querySelector('cs-admin-ajout-edition');
  assert.deepEqual(['type', 'acces', 'gestion'].map((n) => fenetre.querySelector('[data-champ="' + n + '"]').value), ['Conteneur', 'public', '']);
});

test('correction : une pastille passe de neutre à autorisé, interdit, puis neutre', async () => {
  serveur({ '/api/carte/pending.php': demandes() });
  const { pastille } = await ouvrirCorrection();
  const etats = [];
  for (let i = 0; i < 3; i++) {
    pastille('coquilles').click();
    etats.push(pastille('coquilles').dataset.etat);
  }
  assert.deepEqual(etats, ['1', '2', '0']);
});

test('correction : enregistrer envoie les champs et les déchets, ferme, recharge la liste', async () => {
  const { appels } = serveur({ '/api/carte/pending.php': demandes() });
  const { onglet, fenetre, champ, pastille } = await ouvrirCorrection();
  const recus = signaux(onglet);

  champ('type').choisir('Conteneur');
  champ('gestion').saisir('Association du quartier');
  pastille('coquilles').click();      // neutre → autorisé
  pastille('épluchures').click();     // autorisé → interdit
  pastille('viande').click();         // interdit → neutre
  fenetre.querySelector('[data-action="enregistrer"]').click();
  await dom.stabiliser();

  const corps = envois(appels)[0].options.body;
  assert.equal(envois(appels)[0].adresse, '/api/carte/pending.php');
  assert.deepEqual(['action', 'id', 'type', 'acces', 'gestion', 'info_gestion'].map((n) => corps.get(n)), ['modifier', '31', 'Conteneur', 'privé', 'Association du quartier', '01 02 03']);
  assert.deepEqual(corps.getAll('mettre[]'), ['coquilles']);
  assert.deepEqual(corps.getAll('pas_mettre[]'), ['épluchures']);
  assert.equal(fenetre.ouverte, false);
  assert.deepEqual(recus, ['donnees-modifiees']);
  assert.equal(lectures(appels).length, 2, 'la liste montre les nouvelles valeurs');
});

test('correction : refusée par le serveur, sa raison s’affiche dans la fenêtre qui reste ouverte', async () => {
  await enSilence(async () => {
    const { appels } = serveur({ '/api/carte/pending.php': (adresse, options) => (options.method === 'POST' ? { corps: { error: '« viande » ne peut pas être à la fois autorisé et interdit.' } } : demandes()(adresse, options)) });
    const { fenetre } = await ouvrirCorrection();
    const bouton = fenetre.querySelector('[data-action="enregistrer"]');
    bouton.click();
    assert.equal(bouton.disabled, true, 'pas de double envoi');
    await dom.stabiliser();

    const erreur = fenetre.querySelector('.fenetre__erreur');
    assert.equal(erreur.hidden, false);
    assert.equal(erreur.textContent, '« viande » ne peut pas être à la fois autorisé et interdit.');
    assert.equal(fenetre.ouverte, true);
    assert.equal(bouton.disabled, false);
    assert.equal(lectures(appels).length, 1);
  });
});

test('correction : « Annuler » ferme sans rien envoyer ; rouvrir efface l’erreur précédente', async () => {
  await enSilence(async () => {
    const { appels } = serveur({ '/api/carte/pending.php': (adresse, options) => (options.method === 'POST' ? { corps: { error: 'Type ou accès invalide.' } } : demandes()(adresse, options)) });
    const { onglet, fenetre } = await ouvrirCorrection();
    fenetre.querySelector('[data-action="enregistrer"]').click();
    await dom.stabiliser();
    assert.equal(fenetre.querySelector('.fenetre__erreur').hidden, false);

    fenetre.querySelector('.fenetre__annuler').click();
    assert.equal(fenetre.ouverte, false);
    assert.equal(envois(appels).length, 1);

    onglet.querySelector('[data-action="modifier"][data-id="32"]').click();
    assert.equal(fenetre.querySelector('.fenetre__titre').textContent, 'Modifier la demande #32');
    assert.equal(fenetre.querySelector('.fenetre__erreur').hidden, true);
  });
});

// ── Dans le panneau ─────────────────────────────────────────────────────────

test('panneau : les onglets Signalements et Ajouts montent leur composant ; une validation fait recompter', async () => {
  const { appels } = serveur({
    '/api/admin/stats.php': { corps: { stats: { users: 1, admins: 1, completions: 0 } } },
    '/api/carte/count.php': { corps: { composts: 1, en_attente: 2, signalements: 2 } },
    '/api/jeux/count.php': { corps: { parties: 0 } },
    '/api/admin/tickets.php': { corps: { a_traiter: 0 } },
    '/api/admin/evolution.php': { corps: { labels: [], inscrits: [], connexions: null } },
    '/api/carte/evolution.php': { corps: { labels: [], totaux: [] } },
    '/api/carte/signalement.php': { corps: { signalements: SIGNALEMENTS } },
    '/api/carte/pending.php': demandes(),
  });
  const panneau = await monter('<cs-admin-panel></cs-admin-panel>');
  assert.equal(panneau.querySelector('cs-admin-signalements'), null, 'rien n’est chargé avant l’ouverture de l’onglet');

  panneau.querySelector('[data-onglet="signalements"]').click();
  await dom.stabiliser();
  assert.equal(panneau.querySelectorAll('[data-contenu="signalements"] .signal-item').length, 2);

  panneau.querySelector('[data-onglet="ajouts"]').click();
  await dom.stabiliser();
  assert.equal(panneau.querySelectorAll('[data-contenu="ajouts"] .pending-item').length, 2);

  const avant = appels.filter((a) => a.adresse === '/api/carte/count.php').length;
  panneau.querySelector('.pending-actions [data-decision="valider"][data-id="31"]').click();
  await dom.stabiliser();
  assert.equal(appels.filter((a) => a.adresse === '/api/carte/count.php').length, avant + 1);
});
