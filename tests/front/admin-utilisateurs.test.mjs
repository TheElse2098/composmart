/* ============================================================================
   L'onglet Utilisateurs du panneau d'administration
   (<cs-admin-utilisateurs>) et la fiche d'un joueur (<cs-admin-fiche-joueur>).
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
/** @type {any} */ (globalThis).Chart = class { update() {} destroy() {} };
const { AdminUtilisateurs, compteUtilisateurs, question } = await import('../../services/web/front/ui/admin/panel/utilisateurs.js');
const { AdminFicheJoueur, jourFr } = await import('../../services/web/front/ui/admin/panel/fiche-joueur.js');
await import('../../services/web/front/ui/admin/panel/panel.js');

const UTILISATEURS = [
  { id: 1, username: 'eliott', xp: 520, niveau: 6, isAdmin: true, date: '2026-01-05 10:00:00' },
  { id: 2, username: 'camille', xp: 80, niveau: 2, isAdmin: true, date: '2026-03-12 08:00:00' },
  { id: 3, username: 'lea <3', xp: 0, niveau: 1, isAdmin: false, date: '2026-11-14 19:45:00' },
];

const JOUEUR = {
  ok: true, username: 'lea <3', niveau: 4, xp: 35,
  xp_history: [{ delta: 15, created_at: '2026-11-10 09:00:00' }, { delta: 20, created_at: '2026-11-13 12:00:00' }],
  cours: [{ slug: 'sols', titre: 'Les sols <vivants>', emoji: '🪱', completed_at: '2026-11-13 12:00:00' }],
};
const JEUX = { records: [
  { slug: 'tri', nom: 'Le bon bac', emoji: '🗑️', max: 100, best: 80 },
  { slug: 'memo', nom: null, emoji: null, max: 50, best: null },
], parties: 3 };

/** Les comptes côté serveur : recherche par pseudo, actions acceptées. */
function comptes({ total = 3 } = {}) {
  return (/** @type {string} */ adresse, /** @type {any} */ options) => {
    if (options.method === 'POST') return { corps: { ok: true } };
    const q = new URL(adresse, 'https://composmart.test').searchParams.get('q') || '';
    return { corps: { users: UTILISATEURS.filter((u) => u.username.includes(q)), me: 1, total } };
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

const TOUT = { '/api/admin/users.php': comptes(), '/api/auth/fiche_joueur.php': { corps: JOUEUR }, '/api/jeux/score.php': { corps: JEUX } };

/** @param {{ adresse: string, options: any }[]} appels */
const envois = (appels) => appels.filter((a) => a.options.method === 'POST');
/** @param {{ adresse: string, options: any }[]} appels */
const recherches = (appels) => appels.filter((a) => a.options.method === 'GET' && a.adresse.startsWith('/api/admin/users.php')).map((a) => a.adresse);

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
async function monterUtilisateurs() {
  const element = dom.monter('<cs-admin-utilisateurs></cs-admin-utilisateurs>');
  await dom.stabiliser();
  return element;
}

/** Le temps que la recherche parte (elle attend la fin de la frappe). */
const apresLaFrappe = () => new Promise((resoudre) => setTimeout(resoudre, 320)).then(() => dom.stabiliser());

const boite = () => dom.document.querySelectorAll('cs-dialogue').at(-1);

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

// ── Fonctions et gabarits ───────────────────────────────────────────────────

test('compteUtilisateurs : le nombre affiché, et le total quand la liste est tronquée', () => {
  assert.equal(compteUtilisateurs(12, 12), '(12)');
  assert.equal(compteUtilisateurs(50, 3204), '(50 affichés sur 3204)');
  assert.equal(compteUtilisateurs(0, 0), '(0)');
  assert.equal(compteUtilisateurs(2, 40), '(2 affichés sur 40)');
});

test('question : chaque action a sa confirmation ; retirer des droits et supprimer sont en rouge', () => {
  assert.deepEqual(question('promouvoir', 'lea'), { titre: 'Promouvoir « lea » administrateur ?', valider: 'Promouvoir' });
  assert.deepEqual(question('retrograder', 'lea'), { titre: 'Retirer les droits admin à « lea » ?', valider: 'Retirer', danger: true });
  assert.deepEqual(question('supprimer', 'lea'), { titre: 'Supprimer définitivement « lea » ?', texte: 'Sa progression et ses scores seront perdus.', valider: 'Supprimer', danger: true });
});

test('gabarit des lignes : pseudo échappé, niveau, inscription, rôle, actions selon le rôle', () => {
  const onglet = new AdminUtilisateurs();
  assert.match(String(onglet.gabaritLignes([], 1)), /<td colspan="6" class="user-empty">Aucun utilisateur trouvé\.<\/td>/);

  const lignes = String(onglet.gabaritLignes(UTILISATEURS, 1)).split('<tr>').slice(1);
  assert.equal(lignes.length, 3);
  // Soi-même : aucune action.
  assert.match(lignes[0], /data-fiche="1"><b>eliott<\/b>/);
  assert.match(lignes[0], /<span class="badge-admin">ADMIN<\/span>/);
  assert.match(lignes[0], /<td class="act-cell"><span class="act-self">moi<\/span><\/td>/);
  assert.ok(!lignes[0].includes('data-agir'));
  // Un autre administrateur : rétrograder ou supprimer.
  assert.match(lignes[1], /class="act-btn act-demote" data-agir="retrograder" data-id="2">Rétrograder<\/button> <button type="button" class="act-btn act-delete" data-agir="supprimer" data-id="2"/);
  // Un joueur : promouvoir ou supprimer.
  assert.match(lignes[2], /data-fiche="3"><b>lea &lt;3<\/b>/);
  assert.match(lignes[2], /<span class="lvl-pill">Niv\. 1<\/span><\/td>\s*<td>0<\/td>\s*<td>2026-11-14<\/td>\s*<td>—<\/td>/);
  assert.match(lignes[2], /data-agir="promouvoir" data-id="3">Promouvoir<\/button>/);
  assert.match(lignes[2], /aria-label="Supprimer lea &lt;3">🗑<\/button>/);
});

test('jourFr : la date d’un cours terminé, à la française', () => {
  assert.equal(jourFr('2026-11-13 12:00:00'), '13/11/2026');
  assert.equal(jourFr(null), '');
});

test('gabarit de la fiche : niveau, XP, cours, jeux — et rien d’autre sur la personne', () => {
  const fiche = new AdminFicheJoueur();
  const sortie = String(fiche.gabaritFiche(JOUEUR, JEUX.records));
  assert.match(sortie, /<div class="fiche-nombre">Niv\. 4<\/div><div class="fiche-libelle">Niveau<\/div>/);
  assert.match(sortie, /<div class="fiche-nombre">35<\/div><div class="fiche-libelle">XP total<\/div>/);
  assert.match(sortie, /<cs-courbe-xp><\/cs-courbe-xp>/);
  assert.match(sortie, /<span class="fiche-emoji">🪱<\/span><span class="fiche-nom">Les sols &lt;vivants&gt;<\/span><span class="fiche-date">13\/11\/2026<\/span>/);
  assert.match(sortie, /<span class="fiche-nom">Le bon bac<\/span><span class="fiche-score">80 \/ 100<\/span>/);
  assert.match(sortie, /<span class="fiche-emoji">🎮<\/span><span class="fiche-nom">memo<\/span><span class="fiche-score vide">Jamais joué<\/span>/);

  const vide = String(fiche.gabaritFiche({ ...JOUEUR, cours: [] }, []));
  assert.match(vide, /Aucun cours terminé\./);
  assert.match(vide, /Aucun jeu disponible\./);
  assert.match(String(fiche.gabaritJeux(null)), /Scores indisponibles pour le moment\./);
});

// ── La liste, montée ────────────────────────────────────────────────────────

test('utilisateurs : les derniers inscrits au montage, leur nombre à côté du titre', async () => {
  const { appels } = serveur(TOUT);
  const onglet = await monterUtilisateurs();
  assert.deepEqual(recherches(appels), ['/api/admin/users.php?q=']);
  assert.equal(onglet.querySelector('.section-compte').textContent, '(3)');
  assert.deepEqual(onglet.querySelectorAll('tbody tr').map((/** @type {any} */ l) => l.querySelector('b').textContent), ['eliott', 'camille', 'lea <3']);
  assert.equal(onglet.querySelector('.user-search').getAttribute('type'), 'search');
});

test('utilisateurs : la liste tronquée dit sur combien', async () => {
  serveur({ ...TOUT, '/api/admin/users.php': comptes({ total: 3204 }) });
  const onglet = await monterUtilisateurs();
  assert.equal(onglet.querySelector('.section-compte').textContent, '(3 affichés sur 3204)');
});

test('utilisateurs : la recherche part une fois la frappe arrêtée, et survit à un aller-retour', async () => {
  const { appels } = serveur(TOUT);
  const onglet = await monterUtilisateurs();
  const champ = onglet.querySelector('.user-search');

  champ.saisir('l');
  champ.saisir('le');
  champ.saisir('lea');
  assert.equal(recherches(appels).length, 1, 'rien ne part pendant la frappe');
  await apresLaFrappe();
  assert.deepEqual(recherches(appels).slice(1), ['/api/admin/users.php?q=lea'], 'une seule demande, pour le texte final');
  assert.deepEqual(onglet.querySelectorAll('tbody b').map((/** @type {any} */ b) => b.textContent), ['lea <3']);
  assert.equal(onglet.querySelector('.section-compte').textContent, '(1 affichés sur 3)');

  await onglet.rafraichir();
  assert.equal(recherches(appels).at(-1), '/api/admin/users.php?q=lea');

  champ.saisir('zzz');
  await apresLaFrappe();
  assert.match(onglet.querySelector('tbody').textContent, /Aucun utilisateur trouvé\./);
});

test('utilisateurs : serveur en panne, un message dans le tableau, le champ de recherche reste', async () => {
  await enSilence(async () => {
    serveur({ '/api/admin/users.php': { statut: 500, corps: { error: 'DB error' } } });
    const onglet = await monterUtilisateurs();
    assert.equal(onglet.querySelector('tbody .user-empty').textContent, "⚠️ Les utilisateurs n'ont pas pu être chargés.");
    assert.equal(onglet.querySelector('.section-compte').textContent, '');
    assert.ok(onglet.querySelector('.user-search'));
  });
});

// ── Agir sur un compte ──────────────────────────────────────────────────────

test('promouvoir : confirmation, puis la demande part, le panneau est prévenu, la liste rechargée', async () => {
  const { appels } = serveur(TOUT);
  const onglet = await monterUtilisateurs();
  /** @type {string[]} */
  const signaux = [];
  onglet.addEventListener('donnees-modifiees', () => signaux.push('donnees-modifiees'));

  onglet.querySelector('[data-agir="promouvoir"][data-id="3"]').click();
  await dom.stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Promouvoir « lea <3 » administrateur ?');
  assert.equal(boite().querySelector('[data-reponse="oui"]').classList.contains('danger'), false);
  assert.equal(envois(appels).length, 0);

  boite().querySelector('[data-reponse="oui"]').click();
  await dom.stabiliser();
  assert.equal(envois(appels)[0].adresse, '/api/admin/users.php');
  assert.equal(String(envois(appels)[0].options.body), 'action=set_admin&user_id=3&value=1');
  assert.deepEqual(signaux, ['donnees-modifiees']);
  assert.equal(recherches(appels).length, 2);
});

test('rétrograder et supprimer : en rouge, avec la bonne demande', async () => {
  const { appels } = serveur(TOUT);
  const onglet = await monterUtilisateurs();

  onglet.querySelector('[data-agir="retrograder"][data-id="2"]').click();
  await dom.stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Retirer les droits admin à « camille » ?');
  assert.equal(boite().querySelector('[data-reponse="oui"]').classList.contains('danger'), true);
  boite().querySelector('[data-reponse="oui"]').click();
  await dom.stabiliser();
  assert.equal(String(envois(appels)[0].options.body), 'action=set_admin&user_id=2&value=0');

  onglet.querySelector('[data-agir="supprimer"][data-id="3"]').click();
  await dom.stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Supprimer définitivement « lea <3 » ?');
  assert.equal(boite().querySelector('.dialogue__texte').textContent, 'Sa progression et ses scores seront perdus.');
  boite().querySelector('[data-reponse="oui"]').click();
  await dom.stabiliser();
  assert.equal(String(envois(appels)[1].options.body), 'action=delete&user_id=3');
});

test('renoncer n’envoie rien', async () => {
  const { appels } = serveur(TOUT);
  const onglet = await monterUtilisateurs();
  onglet.querySelector('[data-agir="supprimer"][data-id="3"]').click();
  await dom.stabiliser();
  boite().querySelector('[data-reponse="non"]').click();
  await dom.stabiliser();
  assert.equal(envois(appels).length, 0);
  assert.equal(recherches(appels).length, 1);
});

test('action refusée par le serveur : sa règle est affichée, rien n’est rechargé', async () => {
  await enSilence(async () => {
    const { appels } = serveur({ ...TOUT, '/api/admin/users.php': (adresse, options) => (options.method === 'POST' ? { corps: { error: 'Impossible : il doit rester au moins un administrateur.' } } : comptes()(adresse, options)) });
    const onglet = await monterUtilisateurs();
    onglet.querySelector('[data-agir="retrograder"][data-id="2"]').click();
    await dom.stabiliser();
    boite().querySelector('[data-reponse="oui"]').click();
    await dom.stabiliser();
    assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Action impossible');
    assert.equal(boite().querySelector('.dialogue__texte').textContent, 'Impossible : il doit rester au moins un administrateur.');
    assert.equal(recherches(appels).length, 1);
  });
});

// ── La fiche joueur ─────────────────────────────────────────────────────────

test('fiche : un clic sur le pseudo l’ouvre, à son nom, et demande les deux services', async () => {
  const { appels } = serveur(TOUT);
  const onglet = await monterUtilisateurs();
  const fiche = onglet.querySelector('cs-admin-fiche-joueur');

  onglet.querySelector('[data-fiche="3"]').click();
  assert.equal(fiche.ouverte, true);
  assert.equal(fiche.querySelector('.fenetre__titre').textContent, '👤 lea <3');
  assert.equal(fiche.querySelector('.fiche-corps').textContent, 'Chargement…');

  await dom.stabiliser();
  assert.ok(appels.some((a) => a.adresse === '/api/auth/fiche_joueur.php?user_id=3'));
  assert.ok(appels.some((a) => a.adresse === '/api/jeux/score.php?action=profile&user_id=3'));
  assert.deepEqual(fiche.querySelectorAll('.fiche-nombre').map((/** @type {any} */ e) => e.textContent), ['Niv. 4', '35']);
  assert.equal(fiche.querySelector('cs-courbe-xp .courbe-total').textContent, '35 XP au total');
  assert.deepEqual(fiche.querySelectorAll('.fiche-nom').map((/** @type {any} */ e) => e.textContent), ['Les sols <vivants>', 'Le bon bac', 'memo']);
  assert.equal(fiche.querySelector('.fenetre__boite').classList.contains('fenetre__boite--colonne'), true);
});

test('fiche : sans gain d’XP, un mot à la place de la courbe', async () => {
  serveur({ ...TOUT, '/api/auth/fiche_joueur.php': { corps: { ...JOUEUR, xp: 0, xp_history: [] } } });
  const onglet = await monterUtilisateurs();
  onglet.querySelector('[data-fiche="3"]').click();
  await dom.stabiliser();
  assert.equal(onglet.querySelector('cs-courbe-xp .courbe-vide').textContent, "Aucun gain d'XP enregistré pour l'instant.");
});

test('fiche : le service des jeux en panne n’empêche pas d’afficher le reste', async () => {
  await enSilence(async () => {
    serveur({ ...TOUT, '/api/jeux/score.php': new TypeError('fetch failed') });
    const onglet = await monterUtilisateurs();
    onglet.querySelector('[data-fiche="3"]').click();
    await dom.stabiliser();
    const fiche = onglet.querySelector('cs-admin-fiche-joueur');
    assert.deepEqual(fiche.querySelectorAll('.fiche-nombre').map((/** @type {any} */ e) => e.textContent), ['Niv. 4', '35']);
    assert.match(fiche.querySelector('.fiche-corps').textContent, /Scores indisponibles pour le moment\./);
  });
});

test('fiche : joueur introuvable, le message du serveur', async () => {
  await enSilence(async () => {
    serveur({ ...TOUT, '/api/auth/fiche_joueur.php': { statut: 404, corps: { error: 'Utilisateur introuvable.' } } });
    const onglet = await monterUtilisateurs();
    onglet.querySelector('[data-fiche="3"]').click();
    await dom.stabiliser();
    assert.equal(onglet.querySelector('.fiche-corps').textContent, 'Utilisateur introuvable.');
  });
});

test('fiche : fermée avant la réponse, puis rouverte sur un autre joueur — pas de mélange', async () => {
  /** @type {Record<string, (reponse: unknown) => void>} */
  const enAttente = {};
  /** @type {any} */ (globalThis).fetch = async (/** @type {string} */ adresse) => {
    if (adresse.startsWith('/api/admin/users.php')) return new Response(JSON.stringify({ users: UTILISATEURS, me: 1, total: 3 }));
    if (adresse.startsWith('/api/jeux/')) return new Response(JSON.stringify({ records: [] }));
    const id = /** @type {string} */ (new URL(adresse, 'https://composmart.test').searchParams.get('user_id'));
    await new Promise((resoudre) => { enAttente[id] = resoudre; });
    return new Response(JSON.stringify({ ...JOUEUR, niveau: Number(id) * 10 }));
  };
  const onglet = await monterUtilisateurs();
  const fiche = onglet.querySelector('cs-admin-fiche-joueur');

  onglet.querySelector('[data-fiche="3"]').click();
  await dom.stabiliser();
  fiche.querySelector('.fenetre__fermer').click();
  onglet.querySelector('[data-fiche="2"]').click();
  await dom.stabiliser();
  enAttente[2](null);
  await dom.stabiliser();
  enAttente[3](null); // la réponse du premier joueur arrive en retard
  await dom.stabiliser();

  assert.equal(fiche.querySelector('.fenetre__titre').textContent, '👤 camille');
  assert.equal(fiche.querySelector('.fiche-nombre').textContent, 'Niv. 20');
});

// ── Dans le panneau ─────────────────────────────────────────────────────────

test('panneau : l’onglet Utilisateurs monte la liste ; plus aucun onglet « pas encore reconstruit »', async () => {
  serveur({
    ...TOUT,
    '/api/admin/stats.php': { corps: { stats: { users: 3, admins: 2, completions: 0 } } },
    '/api/carte/count.php': { corps: { composts: 1, en_attente: 0, signalements: 0 } },
    '/api/jeux/count.php': { corps: { parties: 0 } },
    '/api/admin/tickets.php': { corps: { a_traiter: 0 } },
    '/api/admin/evolution.php': { corps: { labels: [], inscrits: [], connexions: null } },
    '/api/carte/evolution.php': { corps: { labels: [], totaux: [] } },
  });
  const panneau = /** @type {any} */ (dom.monter('<cs-admin-panel></cs-admin-panel>'));
  await dom.stabiliser();
  panneau.querySelector('[data-onglet="utilisateurs"]').click();
  await dom.stabiliser();
  assert.equal(panneau.querySelectorAll('[data-contenu="utilisateurs"] tbody tr').length, 3);
  assert.equal(panneau.querySelector('.en-attente'), null);
  assert.ok(!panneau.textContent.includes('pas encore reconstruit'));
});
