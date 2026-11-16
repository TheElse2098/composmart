/* ============================================================================
   L'onglet Messages du panneau d'administration (<cs-admin-messages>) : la
   liste des tickets, ses filtres, et la discussion vue par un administrateur.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
/** @type {any} */ (globalThis).Chart = class { update() {} destroy() {} };
const { AdminMessages, VUE_ADMIN } = await import('../../services/web/front/ui/admin/panel/messages.js');
await import('../../services/web/front/ui/admin/panel/panel.js');

const TICKETS = [
  { id: 12, username: 'lea', categorie: 'bug', sujet: 'La carte <plante>', statut: 'ouvert', date: '2026-11-14 09:15:00', activite: '2026-11-15T18:30:00', nb_messages: 3, non_lu: true },
  { id: 9, username: 'Compte supprimé', categorie: 'inconnue', sujet: 'Merci', statut: 'clos', date: '2026-11-01 08:00:00', activite: '2026-11-02 10:00:00', nb_messages: 1, non_lu: false },
];

/** Le ticket 12 tel que le serveur le donne en entier. */
const fil = () => ({
  ticket: { id: 12, username: 'lea', compte_supprime: false, categorie: 'bug', sujet: 'La carte <plante>', statut: 'ouvert', date: '2026-11-14 09:15:00' },
  messages: [
    { auteur: 'lea', est_admin: false, corps: 'Elle ne charge plus.', created_at: '2026-11-14 09:15:00' },
    { auteur: 'eliott', est_admin: true, corps: 'On regarde.', created_at: '2026-11-14 10:00:00' },
  ],
});

/**
 * Les tickets côté serveur : liste, compteur seul, fil d'un ticket, actions.
 * @param {{ pages?: number, total?: number, aTraiter?: number, tickets?: any[] }} [options]
 */
function tickets({ pages = 1, total = 2, aTraiter = 1, tickets: liste = TICKETS } = {}) {
  return (/** @type {string} */ adresse, /** @type {any} */ options) => {
    if (options.method === 'POST') return { corps: { ok: true } };
    const parametres = new URL(adresse, 'https://composmart.test').searchParams;
    if (parametres.has('id')) return { corps: fil() };
    if (parametres.has('count')) return { corps: { a_traiter: aTraiter } };
    return { corps: { a_traiter: aTraiter, tickets: liste, filtre: parametres.get('statut'), page: Math.min(Number(parametres.get('page') || 1), pages), pages, total } };
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

/** @param {{ adresse: string, options: any }[]} appels */
const envois = (appels) => appels.filter((a) => a.options.method === 'POST');
/** @param {{ adresse: string, options: any }[]} appels  les demandes de liste (ni fil, ni compteur) */
const listes = (appels) => appels.filter((a) => a.options.method === 'GET' && a.adresse.includes('statut=')).map((a) => a.adresse);

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

/** @returns {Promise<any>} */
async function monterMessages() {
  const element = dom.monter('<cs-admin-messages></cs-admin-messages>');
  await dom.stabiliser();
  return element;
}

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

// ── La discussion vue par un administrateur ─────────────────────────────────

test('vue admin : titre avec l’auteur du ticket, mention ADMIN, explications de lecture seule', () => {
  assert.equal(VUE_ADMIN.admin, true);
  assert.equal(VUE_ADMIN.titre({ id: 12, sujet: 'Bug', statut: 'ouvert', username: 'lea' }), '#12 · Bug — lea');
  assert.equal(VUE_ADMIN.auteur({ auteur: 'eliott', est_admin: true, corps: '', created_at: '' }), 'eliott · ADMIN');
  assert.equal(VUE_ADMIN.auteur({ auteur: 'lea', est_admin: false, corps: '', created_at: '' }), 'lea');
  assert.equal(VUE_ADMIN.lectureSeule('clos'), 'Ticket clos — rouvre-le pour répondre.');
  assert.equal(VUE_ADMIN.lectureSeule('clos_definitif'), 'Ticket définitivement fermé : lecture seule.');
  assert.equal(VUE_ADMIN.statuts.clos_definitif, 'Fermé déf.');
});

test('vue admin : les actions selon l’état ; fermer définitivement se confirme', () => {
  assert.deepEqual(VUE_ADMIN.actions('ouvert').map((a) => [a.action, a.libelle, !!a.danger, !!a.confirmation]), [['clore', '✓ Clore', false, false], ['fermer_definitif', '⛔ Fermer définitivement', true, true]]);
  assert.deepEqual(VUE_ADMIN.actions('clos').map((a) => a.action), ['rouvrir', 'fermer_definitif']);
  assert.deepEqual(VUE_ADMIN.actions('clos_definitif'), []);
  assert.match(VUE_ADMIN.actions('ouvert')[1].confirmation?.texte ?? '', /pas même un admin/);
});

test('vue admin : lire, répondre et agir parlent à l’endpoint des tickets, en JSON', async () => {
  const { appels } = serveur({ '/api/admin/tickets.php': tickets() });
  await VUE_ADMIN.lire(12);
  await VUE_ADMIN.repondre(12, 'Corrigé.');
  await VUE_ADMIN.agir(12, 'clore');

  assert.equal(appels[0].adresse, '/api/admin/tickets.php?id=12');
  assert.deepEqual(envois(appels).map((a) => [a.adresse, a.options.headers['Content-Type'], JSON.parse(a.options.body)]), [
    ['/api/admin/tickets.php', 'application/json', { action: 'repondre', id: 12, corps: 'Corrigé.' }],
    ['/api/admin/tickets.php', 'application/json', { action: 'clore', id: 12 }],
  ]);
});

// ── Gabarits ────────────────────────────────────────────────────────────────

test('gabarit d’un ticket : état, sujet échappé, « à répondre », auteur, catégorie, messages, activité', () => {
  const onglet = new AdminMessages();
  const aRepondre = String(onglet.gabaritTicket(TICKETS[0]));
  assert.match(aRepondre, /<button type="button" class="ticket non-lu" data-ticket="12">/);
  assert.match(aRepondre, /<span class="fil-discussion-statut ouvert">Ouvert<\/span> #12 · La carte &lt;plante&gt;<span class="ticket-arepondre">à répondre<\/span>/);
  assert.match(aRepondre, /<span class="ticket-meta">par lea · 🐛 Bug · 3 messages · dernière activité 2026-11-15 18:30<\/span>/);

  const lu = String(onglet.gabaritTicket(TICKETS[1]));
  assert.match(lu, /<button type="button" class="ticket" data-ticket="9">/);
  assert.ok(!lu.includes('ticket-arepondre'));
  assert.match(lu, /par Compte supprimé · inconnue · 1 message · dernière activité 2026-11-02 10:00/);
});

test('gabarit de la liste : rien dans le filtre, ou tickets et pagination', () => {
  const onglet = new AdminMessages();
  assert.match(String(onglet.gabaritListe({ tickets: [], a_traiter: 0, page: 1, pages: 1, total: 0 })), /class="empty-msg">Aucun ticket dans ce filtre 📭/);
  assert.match(String(onglet.gabaritListe({ tickets: TICKETS, a_traiter: 1, page: 2, pages: 3, total: 45 })), /Page 2 \/ 3 · 45 tickets/);
});

// ── La liste, montée ────────────────────────────────────────────────────────

test('messages : tickets ouverts d’abord, compteur « à traiter », filtre actif', async () => {
  const { appels } = serveur({ '/api/admin/tickets.php': tickets() });
  const onglet = await monterMessages();
  assert.deepEqual(listes(appels), ['/api/admin/tickets.php?statut=ouvert&page=1']);
  assert.equal(onglet.querySelector('.section-compte').textContent, '(1 à traiter)');
  assert.deepEqual(onglet.querySelectorAll('.contact-filter').map((/** @type {any} */ b) => [b.textContent, b.classList.contains('active')]), [['Ouverts', true], ['Clos', false], ['Fermés définitivement', false], ['Tous', false]]);
  assert.equal(onglet.querySelectorAll('.ticket').length, 2);
  assert.equal(onglet.querySelectorAll('.ticket.non-lu').length, 1);
});

test('messages : rien à traiter, pas de compteur', async () => {
  serveur({ '/api/admin/tickets.php': tickets({ aTraiter: 0 }) });
  const onglet = await monterMessages();
  assert.equal(onglet.querySelector('.section-compte').textContent, '');
});

test('messages : changer de filtre redemande à la première page ; la page suit le filtre', async () => {
  const { appels } = serveur({ '/api/admin/tickets.php': tickets({ pages: 3, total: 45 }) });
  const onglet = await monterMessages();
  onglet.querySelector('[data-page="2"]').click();
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/tickets.php?statut=ouvert&page=2');

  onglet.querySelector('[data-filtre="clos_definitif"]').click();
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/tickets.php?statut=clos_definitif&page=1');
  assert.deepEqual(onglet.querySelectorAll('.contact-filter.active').map((/** @type {any} */ b) => b.textContent), ['Fermés définitivement']);

  await onglet.rafraichir();
  assert.equal(listes(appels).at(-1), '/api/admin/tickets.php?statut=clos_definitif&page=1', 'rafraichir() garde le filtre');
});

test('messages : serveur en panne, un message à la place de la liste, les filtres restent', async () => {
  await enSilence(async () => {
    serveur({ '/api/admin/tickets.php': { statut: 500, corps: { error: 'DB error' } } });
    const onglet = await monterMessages();
    assert.equal(onglet.querySelector('.cs-etat--erreur').textContent, "⚠️ Les messages n'ont pas pu être chargés.");
    assert.equal(onglet.querySelectorAll('.contact-filter').length, 4);
  });
});

// ── La discussion, depuis la liste ──────────────────────────────────────────

test('messages : un clic sur un ticket ouvre sa discussion, vue du côté administrateur', async () => {
  const { appels } = serveur({ '/api/admin/tickets.php': tickets() });
  const onglet = await monterMessages();
  onglet.querySelector('[data-ticket="12"]').click();
  await dom.stabiliser();

  const fenetre = onglet.querySelector('cs-fil-discussion');
  assert.equal(fenetre.ouverte, true);
  assert.ok(appels.some((a) => a.adresse === '/api/admin/tickets.php?id=12'));
  assert.equal(fenetre.querySelector('.fil-titre').textContent, '#12 · La carte <plante> — lea');
  assert.deepEqual(fenetre.querySelectorAll('.bulle').map((/** @type {any} */ b) => [b.classList.contains('moi'), b.children[0].textContent]), [[false, 'lea · 2026-11-14 09:15'], [true, 'eliott · ADMIN · 2026-11-14 10:00']]);
  assert.equal(fenetre.querySelector('textarea').placeholder, 'Répondre… (Ctrl+Entrée pour envoyer)');
  assert.deepEqual(fenetre.querySelectorAll('.fil-action').map((/** @type {any} */ b) => b.textContent), ['✓ Clore', '⛔ Fermer définitivement']);
});

test('messages : répondre envoie le message ; refermer recharge la liste et prévient le panneau', async () => {
  const { appels } = serveur({ '/api/admin/tickets.php': tickets() });
  const onglet = await monterMessages();
  /** @type {string[]} */
  const signaux = [];
  onglet.addEventListener('donnees-modifiees', () => signaux.push('donnees-modifiees'));
  onglet.querySelector('[data-ticket="12"]').click();
  await dom.stabiliser();
  const fenetre = onglet.querySelector('cs-fil-discussion');

  fenetre.querySelector('textarea').saisir('Corrigé, merci !');
  fenetre.querySelector('[data-action="envoyer"]').click();
  await dom.stabiliser();
  assert.deepEqual(JSON.parse(envois(appels)[0].options.body), { action: 'repondre', id: 12, corps: 'Corrigé, merci !' });
  assert.deepEqual(signaux, [], 'rien n’est rechargé tant que la discussion est ouverte');

  const avant = listes(appels).length;
  fenetre.querySelector('.fil-fermer').click();
  await dom.stabiliser();
  assert.deepEqual(signaux, ['donnees-modifiees']);
  assert.equal(listes(appels).length, avant + 1, 'le ticket vient d’être lu : la liste est relue');
});

test('messages : fermer définitivement depuis la discussion se confirme, puis part', async () => {
  const { appels } = serveur({ '/api/admin/tickets.php': tickets() });
  const onglet = await monterMessages();
  onglet.querySelector('[data-ticket="12"]').click();
  await dom.stabiliser();
  onglet.querySelector('[data-agir="fermer_definitif"]').click();
  await dom.stabiliser();
  assert.equal(dom.document.querySelector('cs-dialogue .dialogue__titre').textContent, 'Fermer définitivement ce ticket ?');
  assert.equal(envois(appels).length, 0);
  dom.document.querySelector('cs-dialogue [data-reponse="oui"]').click();
  await dom.stabiliser();
  assert.deepEqual(JSON.parse(envois(appels)[0].options.body), { action: 'fermer_definitif', id: 12 });
});

// ── Dans le panneau ─────────────────────────────────────────────────────────

test('panneau : l’onglet Messages monte la liste ; refermer une discussion fait recompter la pastille', async () => {
  const { appels } = serveur({
    '/api/admin/stats.php': { corps: { stats: { users: 1, admins: 1, completions: 0 } } },
    '/api/carte/count.php': { corps: { composts: 1, en_attente: 0, signalements: 0 } },
    '/api/jeux/count.php': { corps: { parties: 0 } },
    '/api/admin/evolution.php': { corps: { labels: [], inscrits: [], connexions: null } },
    '/api/carte/evolution.php': { corps: { labels: [], totaux: [] } },
    '/api/admin/tickets.php': tickets({ aTraiter: 4 }),
  });
  const panneau = /** @type {any} */ (dom.monter('<cs-admin-panel></cs-admin-panel>'));
  await dom.stabiliser();
  assert.equal(panneau.querySelector('[data-onglet="messages"] .tab-count').textContent, '4');
  assert.equal(listes(appels).length, 0, 'la liste n’est demandée qu’à l’ouverture de l’onglet');

  panneau.querySelector('[data-onglet="messages"]').click();
  await dom.stabiliser();
  assert.equal(panneau.querySelectorAll('[data-contenu="messages"] .ticket').length, 2);

  /** Les demandes du compteur seul. */
  const comptages = () => appels.filter((a) => a.adresse === '/api/admin/tickets.php?count=1').length;
  const avant = comptages();
  panneau.querySelector('[data-ticket="12"]').click();
  await dom.stabiliser();
  panneau.querySelector('cs-fil-discussion .fil-fermer').click();
  await dom.stabiliser();
  assert.equal(comptages(), avant + 1);
});
