/* ============================================================================
   La page de compte : <cs-compte> et ses trois parties — signalements
   (<cs-compte-tickets>), réglages (<cs-compte-reglages>), sortie
   (<cs-compte-sortie>).
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { Compte, ordinal, tousLesBadges } = await import('../../services/web/front/ui/pages/compte/compte.js');
const { VUE_TITULAIRE, resume } = await import('../../services/web/front/ui/pages/compte/compte-tickets.js');
await import('../../services/web/front/ui/pages/compte/compte-reglages.js');
await import('../../services/web/front/ui/pages/compte/compte-sortie.js');

const BADGES = [
  { emoji: '🌱', label: 'Première pousse', desc: 'Valider un premier cours', unlocked: true },
  { emoji: '🎓', label: 'Expert compost', desc: 'Terminer tous les cours', unlocked: false },
  { emoji: '⭐', label: 'Niveau 5', desc: 'Atteindre le niveau 5', unlocked: false },
  { emoji: '🔥', label: 'Niveau 10', desc: 'Atteindre le niveau 10', unlocked: false },
];

const PROFIL = {
  logged_in: true, username: 'lea', email: 'lea@exemple.fr', email_verifie: false,
  xp: 235, niveau: 3, isAdmin: false, membre_depuis: '2026-03-12 08:00:00', rank: 4,
  cours: { done: 1, total: 6, liste: [{ slug: 'sols', titre: 'Les sols <vivants>', emoji: '🪱', completed_at: '2026-11-13 12:00:00' }] },
  badges: BADGES,
  xp_history: [{ delta: 200, source: 'cours', label: 'x', created_at: '2026-11-10 09:00:00' }, { delta: 35, source: 'jeu', label: 'y', created_at: '2026-11-13 12:00:00' }],
};

const JEUX = { records: [
  { slug: 'tri', nom: 'Le bon bac', emoji: '🗑️', max: 100, best: 80, parties: 3 },
  { slug: 'memo', nom: 'Mémo <compost>', emoji: '🧠', max: 50, best: null, parties: 0 },
], parties: 3 };

const TICKETS = [
  { id: 12, sujet: 'La carte <plante>', categorie: 'bug', statut: 'ouvert', date: '2026-11-14 09:15:00', activite: '2026-11-15 18:30:00', non_lu: true },
  { id: 9, sujet: 'Une idée', categorie: 'inconnue', statut: 'ouvert', date: '2026-11-01 08:00:00', activite: '2026-11-02 10:00:00', non_lu: false },
  { id: 4, sujet: 'Merci', categorie: 'autre', statut: 'clos', date: '2026-10-01 08:00:00', activite: '2026-10-02 10:00:00', non_lu: false },
  { id: 2, sujet: 'Ancien', categorie: 'question', statut: 'clos_definitif', date: '2026-09-01 08:00:00', activite: '2026-09-02 10:00:00', non_lu: false },
];

const FIL = {
  ticket: { id: 12, sujet: 'La carte <plante>', categorie: 'bug', statut: 'ouvert', date: '2026-11-14 09:15:00' },
  messages: [
    { auteur: 'lea', est_admin: false, corps: 'Elle ne charge plus.', created_at: '2026-11-14 09:15:00' },
    { auteur: 'eliott', est_admin: true, corps: 'On regarde.', created_at: '2026-11-15 18:30:00' },
  ],
};

/** Les tickets du membre côté serveur. @param {any[]} [liste] */
function tickets(liste = TICKETS) {
  return (/** @type {string} */ adresse, /** @type {any} */ options) => {
    if (options.method === 'POST') return { corps: { ok: true } };
    return adresse.includes('id=') ? { corps: FIL } : { corps: { tickets: liste } };
  };
}

/** @param {Record<string, { statut?: number, corps?: unknown, texte?: string, entetes?: Record<string, string> } | Error | ((adresse: string, options: any) => any)>} routes */
function serveur(routes) {
  return fauxFetch((adresse, options) => {
    const route = routes[adresse.split('?')[0]];
    if (!route) return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
    return typeof route === 'function' ? route(adresse, options) : route;
  });
}

/** Un compte en ordre : profil, jeux, signalements. */
const TOUT = { '/api/auth/profile.php': { corps: PROFIL }, '/api/jeux/score.php': { corps: JEUX }, '/api/contact/tickets.php': tickets() };

/** @param {{ adresse: string, options: any }[]} appels */
const envois = (appels) => appels.filter((a) => a.options && a.options.method === 'POST');

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

/** Laisse aboutir les réponses en attente sans faire avancer les minuteries (pour les tests qui les figent). */
async function laisserRepondre() {
  for (let i = 0; i < 12; i++) await new Promise((resoudre) => setImmediate(resoudre));
}

/** Note les rechargements et les redirections que la page demande. */
function surveillerNavigation() {
  /** @type {string[]} */
  const vus = [];
  const lieu = /** @type {any} */ (globalThis).location;
  lieu.reload = () => { vus.push('rechargement'); };
  lieu.assign = (/** @type {string} */ adresse) => { vus.push('vers ' + adresse); };
  return vus;
}

afterEach(async () => {
  mock.timers.reset();
  dom.vider();
  await dom.stabiliser();
});

// ── Fonctions ───────────────────────────────────────────────────────────────

test('ordinal : 1er, puis 2e, 3e…', () => {
  assert.deepEqual([1, 2, 3, 21].map(ordinal), ['1er', '2e', '3e', '21e']);
});

test('tousLesBadges : les deux badges de jeu prennent place après ceux des cours', () => {
  const badges = tousLesBadges(BADGES, JEUX);
  assert.deepEqual(badges.map((b) => b.label), ['Première pousse', 'Expert compost', 'Joueur', 'Touche-à-tout', 'Niveau 5', 'Niveau 10']);
  assert.deepEqual(badges.map((b) => b.unlocked), [true, false, true, false, false, false]);
  assert.equal(BADGES.length, 4, 'la liste du profil n’est pas modifiée');

  const tout = tousLesBadges(BADGES, { records: JEUX.records.map((r) => ({ ...r, best: 10 })), parties: 5 });
  assert.equal(tout[3].unlocked, true, 'tous les jeux essayés');
  assert.deepEqual(tousLesBadges(BADGES, { records: [], parties: 0 }).slice(2, 4).map((b) => b.unlocked), [false, false], 'aucun jeu au catalogue : pas de « Touche-à-tout » gratuit');
  assert.deepEqual(tousLesBadges(BADGES, null).slice(2, 4).map((b) => b.unlocked), [false, false], 'service des jeux muet : verrouillés');
});

test('resume des signalements : les réponses à lire d’abord, sinon les ouverts', () => {
  assert.equal(resume(TICKETS), '1 réponse non lue');
  assert.equal(resume(TICKETS.map((t) => ({ ...t, non_lu: true }))), '4 réponses non lues');
  assert.equal(resume(TICKETS.map((t) => ({ ...t, non_lu: false }))), '2 ouverts');
  assert.equal(resume([TICKETS[2]]), '0 ouvert');
});

test('vue du titulaire : « Moi », ses mots, ses deux actions — jamais la fermeture définitive', () => {
  assert.equal(VUE_TITULAIRE.admin, false);
  assert.equal(VUE_TITULAIRE.titre({ id: 12, sujet: 'Bug', statut: 'ouvert' }), '#12 · Bug');
  assert.equal(VUE_TITULAIRE.auteur({ auteur: 'lea', est_admin: false, corps: '', created_at: '' }), 'Moi');
  assert.equal(VUE_TITULAIRE.auteur({ auteur: 'eliott', est_admin: true, corps: '', created_at: '' }), 'eliott · ADMIN');
  assert.equal(VUE_TITULAIRE.statuts.clos_definitif, 'Fermé');
  assert.equal(VUE_TITULAIRE.lectureSeule('clos'), 'Signalement clos — rouvre-le pour répondre.');
  assert.equal(VUE_TITULAIRE.lectureSeule('clos_definitif'), 'Signalement définitivement clos : il reste lisible, mais plus modifiable.');
  assert.deepEqual(VUE_TITULAIRE.actions('ouvert'), [{ action: 'clore', libelle: '✓ Marquer comme résolu' }]);
  assert.deepEqual(VUE_TITULAIRE.actions('clos'), [{ action: 'rouvrir', libelle: '↺ Rouvrir ce signalement' }]);
  assert.deepEqual(VUE_TITULAIRE.actions('clos_definitif'), []);
});

test('vue du titulaire : lire, répondre et agir parlent à l’endpoint du membre, en formulaire', async () => {
  const { appels } = serveur({ '/api/contact/tickets.php': tickets() });
  await VUE_TITULAIRE.lire(12);
  await VUE_TITULAIRE.repondre(12, 'Merci & bravo');
  await VUE_TITULAIRE.agir(12, 'clore');
  assert.equal(appels[0].adresse, '/api/contact/tickets.php?id=12');
  assert.deepEqual(envois(appels).map((a) => [a.adresse, String(a.options.body)]), [
    ['/api/contact/tickets.php', 'action=repondre&id=12&corps=Merci+%26+bravo'],
    ['/api/contact/tickets.php', 'action=clore&id=12'],
  ]);
});

// ── Visiteur ────────────────────────────────────────────────────────────────

test('visiteur : une invitation à se connecter, ni chiffres, ni colonnes, ni demande de signalements', async () => {
  const { appels } = serveur({ ...TOUT, '/api/auth/profile.php': { corps: { logged_in: false } } });
  const page = await monter('<cs-compte></cs-compte>');

  assert.equal(page.querySelector('.avatar').textContent, '🌱');
  assert.equal(page.querySelector('h1').textContent, 'Mon compte');
  assert.equal(page.querySelector('.hero-sub').textContent, 'Rejoins la communauté Composmart');
  assert.equal(page.querySelector('.stats').hidden, true);
  assert.equal(page.querySelector('.col-side').hidden, true);
  assert.equal(page.querySelector('.profil-layout').classList.contains('guest'), true);
  assert.deepEqual(page.querySelectorAll('.col-main a').map((/** @type {any} */ a) => [a.getAttribute('href'), a.textContent]), [['/signin', 'Créer un compte'], ['/login', 'Se connecter']]);
  assert.equal(page.querySelector('cs-compte-sortie'), null);
  assert.ok(!appels.some((a) => a.adresse.startsWith('/api/contact/')));
});

// ── Membre : en-tête, chiffres, colonnes ────────────────────────────────────

test('membre : en-tête à son nom, barre de niveau, place au classement', async () => {
  serveur(TOUT);
  const page = await monter('<cs-compte></cs-compte>');

  assert.equal(page.querySelector('.avatar').textContent, 'L');
  assert.equal(page.querySelector('h1').textContent, 'Bonjour, lea !');
  assert.equal(page.querySelector('.hero-sub').textContent, 'Niveau 3 · membre depuis mars 2026');
  assert.equal(page.querySelector('.hero-xp-label').textContent, '35 / 100 XP pour le niveau 4');
  assert.equal(page.querySelector('.hero-xp-fill').style.width, '35%');
  const place = page.querySelector('.hero-chip');
  assert.equal(place.getAttribute('href'), '/classement');
  assert.equal(place.textContent, '🏆 4e au classement général');
});

test('membre : un administrateur n’a pas de place au classement', async () => {
  serveur({ ...TOUT, '/api/auth/profile.php': { corps: { ...PROFIL, isAdmin: true } } });
  const page = await monter('<cs-compte></cs-compte>');
  assert.equal(page.querySelector('.hero-chip'), null);
  assert.ok(page.querySelector('.hero-xp'));
});

test('membre : les quatre chiffres, le niveau n’y est pas répété', async () => {
  serveur(TOUT);
  const page = await monter('<cs-compte></cs-compte>');
  assert.equal(page.querySelector('.stats').hidden, false);
  assert.deepEqual(page.querySelectorAll('.stat').map((/** @type {any} */ s) => [s.querySelector('.stat-num').textContent, s.querySelector('.stat-label').textContent]),
    [['235', 'XP total'], ['1', 'Cours terminés'], ['3', 'Parties jouées'], ['2', 'Badges obtenus']]);
});

test('membre : progression — courbe d’XP, cours terminés avec leur lien', async () => {
  serveur(TOUT);
  const page = await monter('<cs-compte></cs-compte>');
  assert.equal(page.querySelector('.col-main cs-courbe-xp .courbe-total').textContent, '235 XP au total');
  const cours = page.querySelector('.history-row');
  assert.equal(cours.getAttribute('href'), '/cours/sols');
  assert.equal(cours.querySelector('.history-title').textContent, 'Les sols <vivants>');
  assert.equal(cours.querySelector('.history-date').textContent, '13 nov.');
  assert.equal(page.querySelector('.col-main .panel-count').textContent, '1 / 6');
});

test('membre sans cours ni XP : une invitation à commencer, un mot à la place de la courbe', async () => {
  serveur({ ...TOUT, '/api/auth/profile.php': { corps: { ...PROFIL, xp: 0, xp_history: [], cours: { done: 0, total: 6, liste: [] } } } });
  const page = await monter('<cs-compte></cs-compte>');
  assert.match(page.querySelector('.courbe-vide').textContent, /Termine un cours ou joue à un mini-jeu !/);
  assert.equal(page.querySelector('.course-empty').textContent, "Aucun cours terminé pour l'instant. Commence ici !");
  assert.equal(page.querySelector('.course-empty a').getAttribute('href'), '/cours');
  assert.equal(page.querySelector('.hero-xp-fill').style.width, '0%');
});

test('membre : badges (les six, verrouillés ou non) et records de jeux', async () => {
  serveur(TOUT);
  const page = await monter('<cs-compte></cs-compte>');
  const badges = page.querySelectorAll('.badge');
  assert.deepEqual(badges.map((/** @type {any} */ b) => [b.querySelector('.badge-label').textContent, b.classList.contains('locked')]),
    [['Première pousse', false], ['Expert compost', true], ['Joueur', false], ['Touche-à-tout', true], ['Niveau 5', true], ['Niveau 10', true]]);
  assert.equal(badges[0].getAttribute('title'), 'Valider un premier cours');
  assert.equal(page.querySelectorAll('.col-side .panel-count').at(-1).textContent, '2 / 6');

  assert.deepEqual(page.querySelectorAll('.game-row').map((/** @type {any} */ r) => [r.getAttribute('href'), r.querySelector('.game-row-name').textContent, r.querySelector('.game-row-sub').textContent, r.querySelector('.game-row-best').textContent]), [
    ['/jeu-tri', 'Le bon bac', '3 parties jouées', '🏆 80 / 100'],
    ['/jeu-memo', 'Mémo <compost>', 'Pas encore joué', 'Jouer →'],
  ]);
});

test('service des jeux en panne : le compte s’affiche, sans faux zéro', async () => {
  await enSilence(async () => {
    serveur({ ...TOUT, '/api/jeux/score.php': new TypeError('fetch failed') });
    const page = await monter('<cs-compte></cs-compte>');
    assert.equal(page.querySelector('h1').textContent, 'Bonjour, lea !');
    assert.deepEqual(page.querySelectorAll('.stat-num').map((/** @type {any} */ n) => n.textContent), ['235', '1', '—', '1']);
    assert.equal(page.querySelectorAll('.game-row').length, 0);
    assert.match(page.querySelector('.col-side').textContent, /Records indisponibles pour le moment\./);
  });
});

test('profil injoignable : un message d’erreur, pas une invitation à créer un compte', async () => {
  await enSilence(async () => {
    serveur({ ...TOUT, '/api/auth/profile.php': new TypeError('fetch failed') });
    const page = await monter('<cs-compte></cs-compte>');
    assert.equal(page.querySelector('.col-main .cs-etat--erreur').textContent, '⚠️ Connexion au serveur impossible.');
    assert.equal(page.querySelector('.guest-title'), null);
    assert.equal(page.querySelector('h1').textContent, 'Mon compte');
  });
});

test('gabarits : rien de ce qui vient du serveur n’est lu comme du HTML', () => {
  const page = new Compte();
  const mechant = '<img src=x onerror=alert(1)>';
  const sortie = String(page.gabaritProgression({ ...PROFIL, cours: { done: 1, total: 1, liste: [{ slug: 'a', titre: mechant, emoji: mechant, completed_at: '2026-11-13 12:00:00' }] } }))
    + String(page.gabaritIdentite([{ emoji: mechant, label: mechant, desc: mechant + '"', unlocked: true }], { records: [{ slug: 'x', nom: mechant, emoji: mechant, max: 1, best: null, parties: 0 }], parties: 0 }));
  assert.ok(!sortie.includes('<img'));
  assert.ok(!sortie.includes('"">'), 'un guillemet ne referme pas l’attribut title');
});

// ── Mes signalements ────────────────────────────────────────────────────────

test('signalements : aucun envoyé, le panneau n’existe pas', async () => {
  serveur({ '/api/contact/tickets.php': tickets([]) });
  const panneau = await monter('<cs-compte-tickets></cs-compte-tickets>');
  assert.equal(panneau.hidden, true);
});

test('signalements : les ouverts, puis les clos repliés derrière un bouton', async () => {
  const { appels } = serveur({ '/api/contact/tickets.php': tickets() });
  const panneau = await monter('<cs-compte-tickets></cs-compte-tickets>');
  assert.equal(appels[0].adresse, '/api/contact/tickets.php');
  assert.equal(panneau.hidden, false);
  assert.equal(panneau.querySelector('.panel-count').textContent, '1 réponse non lue');

  const lignes = panneau.querySelectorAll('.ticket-row');
  assert.deepEqual(lignes.map((/** @type {any} */ l) => [l.dataset.ticket, l.querySelector('.fil-discussion-statut').textContent, l.querySelector('.ticket-sujet').textContent, l.querySelector('.ticket-date').textContent, !!l.querySelector('.ticket-reponse')]), [
    ['12', 'Ouvert', '🐛 #12 · La carte <plante>', '15 nov.', true],
    ['9', 'Ouvert', '✉️ #9 · Une idée', '2 nov.', false],
    ['4', 'Clos', '✉️ #4 · Merci', '2 oct.', false],
    ['2', 'Fermé', '❓ #2 · Ancien', '2 sept.', false],
  ]);

  const clos = panneau.querySelector('[data-zone="clos"]');
  const bouton = panneau.querySelector('[data-action="voir-clos"]');
  assert.equal(clos.hidden, true);
  assert.equal(bouton.textContent, 'Voir les signalements clos (2)');
  bouton.click();
  assert.equal(clos.hidden, false);
  assert.equal(bouton.textContent, 'Masquer les signalements clos (2)');
});

test('signalements : tous clos, un mot à la place des ouverts ; aucun clos, pas de bouton', async () => {
  serveur({ '/api/contact/tickets.php': tickets(TICKETS.slice(2)) });
  const clos = await monter('<cs-compte-tickets></cs-compte-tickets>');
  assert.equal(clos.querySelector('.tickets-vide').textContent, 'Aucun signalement ouvert.');
  assert.equal(clos.querySelector('.panel-count').textContent, '0 ouvert');
  dom.vider();

  serveur({ '/api/contact/tickets.php': tickets(TICKETS.slice(0, 2)) });
  const ouverts = await monter('<cs-compte-tickets></cs-compte-tickets>');
  assert.equal(ouverts.querySelector('[data-action="voir-clos"]'), null);
});

test('signalements : la discussion s’ouvre du côté du membre ; la refermer relit la liste, clos toujours dépliés', async () => {
  const { appels } = serveur({ '/api/contact/tickets.php': tickets() });
  const panneau = await monter('<cs-compte-tickets></cs-compte-tickets>');
  panneau.querySelector('[data-action="voir-clos"]').click();
  panneau.querySelector('[data-ticket="12"]').click();
  await dom.stabiliser();

  const fil = panneau.querySelector('cs-fil-discussion');
  assert.equal(fil.ouverte, true);
  assert.equal(fil.querySelector('.fenetre__titre').textContent, '#12 · La carte <plante>');
  assert.deepEqual(fil.querySelectorAll('.bulle').map((/** @type {any} */ b) => [b.classList.contains('moi'), b.children[0].textContent]), [[true, 'Moi · 2026-11-14 09:15'], [false, 'eliott · ADMIN · 2026-11-15 18:30']]);
  assert.equal(fil.querySelector('textarea').placeholder, 'Écrire un message…');
  assert.deepEqual(fil.querySelectorAll('.fil-action').map((/** @type {any} */ b) => b.textContent), ['✓ Marquer comme résolu']);

  fil.querySelector('textarea').saisir('Merci !');
  fil.querySelector('[data-action="envoyer"]').click();
  await dom.stabiliser();
  assert.equal(String(envois(appels)[0].options.body), 'action=repondre&id=12&corps=Merci+%21');

  const avant = appels.filter((a) => a.adresse === '/api/contact/tickets.php' && a.options.method === 'GET').length;
  fil.querySelector('.fenetre__fermer').click();
  await dom.stabiliser();
  assert.equal(appels.filter((a) => a.adresse === '/api/contact/tickets.php' && a.options.method === 'GET').length, avant + 1);
  assert.equal(panneau.querySelector('[data-zone="clos"]').hidden, false, 'le choix « voir les clos » survit au rechargement');
});

test('signalements : liste injoignable, le panneau le dit au lieu de disparaître', async () => {
  await enSilence(async () => {
    serveur({ '/api/contact/tickets.php': { statut: 500, corps: { error: 'DB error' } } });
    const panneau = await monter('<cs-compte-tickets></cs-compte-tickets>');
    assert.equal(panneau.hidden, false);
    assert.equal(panneau.querySelector('.cs-etat--erreur').textContent, "⚠️ Tes signalements n'ont pas pu être chargés.");
  });
});

// ── Réglages du compte ──────────────────────────────────────────────────────

/** @param {object} [profil] @returns {Promise<any>} */
async function monterReglages(profil = PROFIL) {
  const panneau = /** @type {any} */ (dom.monter('<cs-compte-reglages></cs-compte-reglages>'));
  panneau.configurer(profil); // avant même que le composant soit monté, comme le fait la page
  await dom.stabiliser();
  return panneau;
}

test('réglages : pseudo, adresse, statut, ancienneté ; les trois actions', async () => {
  const panneau = await monterReglages();
  assert.deepEqual(panneau.querySelectorAll('.info-row').map((/** @type {any} */ l) => [l.querySelector('.info-key').textContent, l.querySelector('.info-value').textContent]), [
    ["Nom d'utilisateur", 'lea'], ['Adresse email', 'lea@exemple.fr'], ['Statut', '⏳ En attente de confirmation'], ['Membre depuis', 'mars 2026'],
  ]);
  assert.equal(panneau.querySelector('.info-links a').getAttribute('href'), '/mot-de-passe-oublie');
  assert.deepEqual(panneau.querySelectorAll('.info-links button').map((/** @type {any} */ b) => b.textContent), ["Changer d'adresse email", 'Télécharger mes données']);
  assert.equal(panneau.querySelector('.email-form').hidden, true);
  assert.equal(panneau.querySelector('.email-aide a').getAttribute('href'), '/contact');
});

test('réglages : adresse confirmée, pas de bouton de renvoi ; adresse absente, un tiret', async () => {
  const panneau = await monterReglages({ ...PROFIL, email_verifie: true, email: null });
  assert.equal(panneau.querySelector('.info-tag').textContent, '✓ Adresse confirmée');
  assert.equal(panneau.querySelector('.info-tag').classList.contains('ok'), true);
  assert.equal(panneau.querySelector('[data-action="renvoyer"]'), null);
  assert.equal(panneau.querySelectorAll('.info-value')[1].textContent, '—');
});

test('renvoi du lien : envoyé, le bouton le dit et ne se reclique pas', async () => {
  const { appels } = serveur({ '/api/auth/resend.php': { corps: { ok: true } } });
  const panneau = await monterReglages();
  const bouton = panneau.querySelector('[data-action="renvoyer"]');
  bouton.click();
  assert.deepEqual([bouton.disabled, bouton.textContent], [true, 'Envoi…']);
  await dom.stabiliser();

  assert.equal(envois(appels)[0].adresse, '/api/auth/resend.php');
  assert.deepEqual([bouton.disabled, bouton.textContent], [true, 'Lien envoyé ✓']);
  const message = panneau.querySelector('[data-message="renvoi"]');
  assert.deepEqual([message.hidden, message.textContent], [false, 'Lien envoyé, regarde ta boîte mail.']);
});

test('renvoi du lien : limite atteinte, la phrase du serveur et un bouton « Réessayer »', async () => {
  await enSilence(async () => {
    serveur({ '/api/auth/resend.php': { statut: 429, corps: { error: 'Trop de demandes. Réessaie dans une heure.' } } });
    const panneau = await monterReglages();
    const bouton = panneau.querySelector('[data-action="renvoyer"]');
    bouton.click();
    await dom.stabiliser();
    assert.deepEqual([bouton.disabled, bouton.textContent], [false, 'Réessayer']);
    assert.equal(panneau.querySelector('[data-message="renvoi"]').textContent, 'Trop de demandes. Réessaie dans une heure.');
  });
});

test('changer d’adresse : le formulaire se déplie, le champ prend le focus, se replie', async () => {
  const panneau = await monterReglages();
  const formulaire = panneau.querySelector('.email-form');
  panneau.querySelector('[data-action="ouvrir-email"]').click();
  assert.equal(formulaire.hidden, false);
  assert.equal(dom.document.activeElement, panneau.querySelector('[name="email"]'));
  assert.equal(panneau.querySelector('[name="password"]').getAttribute('type'), 'password');
  panneau.querySelector('[data-action="ouvrir-email"]').click();
  assert.equal(formulaire.hidden, true);
});

test('changer d’adresse : accepté, le message puis le rechargement de la page', async () => {
  const navigation = surveillerNavigation();
  const { appels } = serveur({ '/api/auth/change_email.php': { corps: { ok: true, mail_envoye: true } } });
  const panneau = await monterReglages();
  panneau.querySelector('[data-action="ouvrir-email"]').click();
  panneau.querySelector('[name="email"]').value = '  nouvelle@exemple.fr ';
  panneau.querySelector('[name="password"]').value = ' secret avec espaces ';

  mock.timers.enable({ apis: ['setTimeout'] });
  const soumission = new CustomEvent('submit');
  let empeche = false;
  soumission.preventDefault = () => { empeche = true; };
  panneau.querySelector('.email-form').dispatchEvent(soumission);
  assert.equal(empeche, true, 'le navigateur ne recharge pas la page à la soumission');
  await laisserRepondre();

  assert.equal(envois(appels)[0].adresse, '/api/auth/change_email.php');
  assert.deepEqual([...envois(appels)[0].options.body.entries()], [['email', 'nouvelle@exemple.fr'], ['password', ' secret avec espaces ']], 'l’adresse est nettoyée, le mot de passe jamais');
  assert.equal(panneau.querySelector('[data-message="email"]').textContent, 'Adresse changée. Ouvre le lien reçu sur la nouvelle adresse pour la confirmer.');
  assert.deepEqual(navigation, [], 'le temps de lire le message');
  mock.timers.tick(2500);
  assert.deepEqual(navigation, ['rechargement']);
});

test('changer d’adresse : accepté mais le mail n’est pas parti, le message le dit', async () => {
  surveillerNavigation();
  serveur({ '/api/auth/change_email.php': { corps: { ok: true, mail_envoye: false } } });
  const panneau = await monterReglages();
  panneau.querySelector('.email-form').dispatchEvent(new CustomEvent('submit'));
  await dom.stabiliser();
  assert.match(panneau.querySelector('[data-message="email"]').textContent, /le mail de confirmation n'est pas parti : utilise « Renvoyer le lien »\./);
});

test('changer d’adresse : refusé, la raison s’affiche, on peut corriger et renvoyer, rien n’est rechargé', async () => {
  await enSilence(async () => {
    const navigation = surveillerNavigation();
    const { appels } = serveur({ '/api/auth/change_email.php': { corps: { error: 'Mot de passe incorrect.' } } });
    const panneau = await monterReglages();
    const formulaire = panneau.querySelector('.email-form');
    formulaire.dispatchEvent(new CustomEvent('submit'));
    formulaire.dispatchEvent(new CustomEvent('submit')); // double clic : un seul envoi
    await dom.stabiliser();

    assert.equal(envois(appels).length, 1);
    assert.equal(panneau.querySelector('[data-message="email"]').textContent, 'Mot de passe incorrect.');
    assert.equal(panneau.querySelector('.email-form [type="submit"]').disabled, false);
    await new Promise((resoudre) => setTimeout(resoudre, 30));
    assert.deepEqual(navigation, []);
  });
});

test('export des données : le fichier est proposé sous le nom donné par le serveur', async () => {
  const { appels } = serveur({ '/api/auth/export.php': { texte: '{"pseudo":"lea"}', entetes: { 'Content-Disposition': 'attachment; filename="composmart-mes-donnees-2026-11-16.json"' } } });
  const panneau = await monterReglages();
  /** @type {any[]} */
  const enregistrements = [];
  /** @param {any} evenement */
  const noter = (evenement) => { if (evenement.target.localName === 'a') enregistrements.push(evenement.target); };
  dom.document.body.addEventListener('click', noter);

  const bouton = panneau.querySelector('[data-action="exporter"]');
  bouton.click();
  assert.equal(bouton.disabled, true);
  await dom.stabiliser();
  dom.document.body.removeEventListener('click', noter);

  assert.equal(appels.at(-1)?.adresse, '/api/auth/export.php');
  assert.equal(enregistrements.length, 1);
  assert.equal(enregistrements[0].download, 'composmart-mes-donnees-2026-11-16.json');
  assert.match(enregistrements[0].href, /^blob:/);
  assert.equal(dom.document.body.querySelector('a[download]'), null, 'le lien d’enregistrement ne reste pas dans la page');
  assert.equal(bouton.disabled, false);
  assert.equal(panneau.querySelector('[data-message="export"]').hidden, true);
});

test('export des données : refusé, la phrase du serveur à l’écran et aucun fichier d’erreur téléchargé', async () => {
  await enSilence(async () => {
    serveur({ '/api/auth/export.php': { statut: 429, corps: { error: 'Trop de demandes. Réessaie plus tard.' } } });
    const panneau = await monterReglages();
    let clics = 0;
    const noter = () => { clics++; };
    dom.document.body.addEventListener('click', noter);
    panneau.querySelector('[data-action="exporter"]').click();
    await dom.stabiliser();
    dom.document.body.removeEventListener('click', noter);

    const message = panneau.querySelector('[data-message="export"]');
    assert.deepEqual([message.hidden, message.textContent], [false, 'Trop de demandes. Réessaie plus tard.']);
    assert.equal(clics, 1, 'seul le clic sur le bouton : aucun lien d’enregistrement actionné');
    assert.equal(panneau.querySelector('[data-action="exporter"]').disabled, false);
  });
});

// ── Déconnexion, suppression du compte ──────────────────────────────────────

/** @returns {Promise<any>} */
async function monterSortie() {
  const sortie = /** @type {any} */ (dom.monter('<cs-compte-sortie></cs-compte-sortie>'));
  sortie.configurer('lea');
  await dom.stabiliser();
  return sortie;
}

test('déconnexion : la demande part, puis la page est rechargée', async () => {
  const navigation = surveillerNavigation();
  const { appels } = serveur({ '/api/auth/logout.php': { corps: { ok: true } } });
  const sortie = await monterSortie();
  sortie.querySelector('[data-action="deconnecter"]').click();
  assert.deepEqual(navigation, [], 'pas avant la réponse du serveur');
  await dom.stabiliser();
  assert.equal(envois(appels)[0].adresse, '/api/auth/logout.php');
  assert.deepEqual(navigation, ['rechargement']);
});

test('suppression : repliée par défaut ; le bouton ne s’active qu’au pseudo exact', async () => {
  const sortie = await monterSortie();
  const panneau = sortie.querySelector('.danger-panel');
  const ouvrir = sortie.querySelector('[data-action="ouvrir-suppression"]');
  const champ = sortie.querySelector('.danger-input');
  const bouton = sortie.querySelector('[data-action="supprimer"]');
  assert.equal(panneau.hidden, true);

  ouvrir.click();
  assert.deepEqual([panneau.hidden, ouvrir.hidden], [false, true]);
  assert.equal(dom.document.activeElement, champ);
  assert.equal(sortie.querySelector('.danger-label b').textContent, 'lea');
  assert.equal(bouton.disabled, true);

  for (const [saisie, inactif] of /** @type {[string, boolean][]} */ ([['le', true], ['Lea', true], ['lea ', true], ['lea', false]])) {
    champ.saisir(saisie);
    assert.equal(bouton.disabled, inactif, 'saisie « ' + saisie + ' »');
  }
});

test('suppression : « Annuler » replie et oublie ce qui était saisi', async () => {
  const sortie = await monterSortie();
  const champ = sortie.querySelector('.danger-input');
  sortie.querySelector('[data-action="ouvrir-suppression"]').click();
  champ.saisir('lea');
  sortie.querySelector('[data-action="annuler-suppression"]').click();

  assert.equal(sortie.querySelector('.danger-panel').hidden, true);
  assert.equal(sortie.querySelector('[data-action="ouvrir-suppression"]').hidden, false);
  assert.equal(champ.value, '');
  assert.equal(sortie.querySelector('[data-action="supprimer"]').disabled, true);
});

test('suppression : rien ne part tant que le bouton est inactif', async () => {
  const { appels } = serveur({ '/api/auth/delete_account.php': { corps: { ok: true } } });
  const sortie = await monterSortie();
  sortie.querySelector('[data-action="ouvrir-suppression"]').click();
  sortie.querySelector('.danger-input').saisir('le');
  sortie.querySelector('[data-action="supprimer"]').click(); // un clic forcé sur un bouton inactif
  await dom.stabiliser();
  assert.equal(envois(appels).length, 0);
});

test('suppression : confirmée, le pseudo part au serveur, un adieu s’affiche, puis retour à l’accueil', async () => {
  const navigation = surveillerNavigation();
  const { appels } = serveur({ '/api/auth/delete_account.php': { corps: { ok: true, purges: {} } } });
  const sortie = await monterSortie();
  sortie.querySelector('[data-action="ouvrir-suppression"]').click();
  sortie.querySelector('.danger-input').saisir('lea');
  const bouton = sortie.querySelector('[data-action="supprimer"]');

  mock.timers.enable({ apis: ['setTimeout'] });
  bouton.click();
  bouton.click(); // double clic : une seule demande
  assert.deepEqual([bouton.disabled, bouton.textContent], [true, 'Suppression…']);
  await laisserRepondre();

  assert.equal(envois(appels).length, 1);
  assert.equal(envois(appels)[0].adresse, '/api/auth/delete_account.php');
  assert.equal(String(envois(appels)[0].options.body), 'confirmation=lea');
  assert.equal(sortie.querySelector('.danger-title').textContent, 'Compte supprimé');
  assert.match(sortie.querySelector('.danger-text').textContent, /Tes données personnelles ont été effacées\./);
  assert.equal(sortie.querySelector('.danger-input'), null);
  assert.deepEqual(navigation, [], 'le temps de lire');
  mock.timers.tick(3000);
  assert.deepEqual(navigation, ['vers /']);
});

test('suppression : refusée, la raison s’affiche, le bouton revient, personne n’est redirigé', async () => {
  await enSilence(async () => {
    const navigation = surveillerNavigation();
    serveur({ '/api/auth/delete_account.php': { corps: { error: 'Impossible : ce compte est le dernier administrateur du site.' } } });
    const sortie = await monterSortie();
    sortie.querySelector('[data-action="ouvrir-suppression"]').click();
    sortie.querySelector('.danger-input').saisir('lea');
    const bouton = sortie.querySelector('[data-action="supprimer"]');
    bouton.click();
    await dom.stabiliser();

    const message = sortie.querySelector('.danger-msg');
    assert.deepEqual([message.hidden, message.textContent], [false, 'Impossible : ce compte est le dernier administrateur du site.']);
    assert.deepEqual([bouton.disabled, bouton.textContent], [false, 'Supprimer']);
    assert.ok(sortie.querySelector('.danger-input'), 'le panneau est toujours là');
    await new Promise((resoudre) => setTimeout(resoudre, 30));
    assert.deepEqual(navigation, []);
  });
});

test('suppression : serveur injoignable, on peut réessayer', async () => {
  await enSilence(async () => {
    surveillerNavigation();
    serveur({ '/api/auth/delete_account.php': new TypeError('fetch failed') });
    const sortie = await monterSortie();
    sortie.querySelector('[data-action="ouvrir-suppression"]').click();
    sortie.querySelector('.danger-input').saisir('lea');
    sortie.querySelector('[data-action="supprimer"]').click();
    await dom.stabiliser();
    assert.equal(sortie.querySelector('.danger-msg').textContent, 'Connexion au serveur impossible.');
    assert.equal(sortie.querySelector('[data-action="supprimer"]').disabled, false);
  });
});

// ── La page entière ─────────────────────────────────────────────────────────

test('page : chaque partie reçoit ce qui la concerne', async () => {
  serveur(TOUT);
  const page = await monter('<cs-compte></cs-compte>');
  assert.equal(page.querySelector('.col-side cs-compte-reglages .info-value').textContent, 'lea');
  assert.ok(page.querySelector('cs-compte-reglages [data-action="renvoyer"]'), 'adresse non confirmée : le renvoi est proposé');
  assert.equal(page.querySelector('.col-main cs-compte-tickets').hidden, false);
  assert.equal(page.querySelectorAll('.col-main cs-compte-tickets .ticket-row').length, 4);
  assert.equal(page.querySelector('.logout-wrap cs-compte-sortie .danger-label b').textContent, 'lea');
  assert.equal(page.querySelector('.logout-wrap cs-compte-sortie .danger-panel').hidden, true);
});

test('page : sans signalement, la colonne ne garde pas de panneau vide', async () => {
  serveur({ ...TOUT, '/api/contact/tickets.php': tickets([]) });
  const page = await monter('<cs-compte></cs-compte>');
  assert.equal(page.querySelector('cs-compte-tickets').hidden, true);
});
