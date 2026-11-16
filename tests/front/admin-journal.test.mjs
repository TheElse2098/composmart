/* ============================================================================
   L'onglet Journal du panneau d'administration : la liste et ses filtres
   (<cs-admin-journal>), la fenêtre de détail et l'annulation d'une action
   (<cs-admin-journal-detail>) — gabarits, puis montage avec un faux serveur.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
/** @type {any} */ (globalThis).Chart = class { update() {} destroy() {} };
const { AdminJournal, actionsDe, categoriesPresentes } = await import('../../services/web/front/ui/admin/panel/journal.js');
const { gabaritContenuCours, gabaritDetail, lignesPropres } = await import('../../services/web/front/ui/admin/panel/journal-detail.js');
await import('../../services/web/front/ui/admin/panel/panel.js');

const TYPES = ['compost_modifie', 'compost_valide', 'cours_modifie', 'mail_envoye', 'truc_futur'];

const ENTREES = [
  { id: 7, username: 'eliott', action: 'compost_modifie', details: 'Compost <du> parc', target_type: 'compost', target_id: 12, date: '2026-11-10 14:03:12', annule: false },
  { id: 6, username: 'camille', action: 'cours_modifie', details: null, target_type: 'cours', target_id: 3, date: '2026-11-09 09:00:00', annule: true },
  { id: 5, username: 'eliott', action: 'mail_envoye', details: null, target_type: 'mail', target_id: null, date: '2026-11-08 08:00:00', annule: false },
];

/** Les entrées complètes, telles que le serveur les donne une par une. @type {Record<string, any>} */
const DETAILS = {
  7: { ...ENTREES[0], snapshot: { id: 12, type: 'collectif', changements: { acces: ['public', 'prive'] } }, annule_at: null, annule_par: null },
  6: { ...ENTREES[1], snapshot: { version_id: 40, contenu_modifie: ['texte', 'quiz'], changements: { titre: ['Avant', 'Après'] } }, annule_at: '2026-11-09 10:30:00', annule_par: 'eliott' },
  5: { ...ENTREES[2], snapshot: { to: 'a@exemple.fr', sujet: 'Bienvenue', ok: true }, annule_at: null, annule_par: null },
};

/**
 * Le journal côté serveur : la liste, ou une entrée quand `id` est donné.
 * @param {{ pages?: number, total?: number, entrees?: any[], types?: string[] }} [options]
 */
function journal({ pages = 1, total = 3, entrees = ENTREES, types = TYPES } = {}) {
  return (/** @type {string} */ adresse) => {
    const parametres = new URL(adresse, 'https://composmart.test').searchParams;
    const id = parametres.get('id');
    if (id !== null) {
      return DETAILS[id] ? { corps: { entry: DETAILS[id] } } : { statut: 404, corps: { error: 'Entrée introuvable.' } };
    }
    return { corps: { entries: entrees, types, page: Math.min(Number(parametres.get('page') || 1), pages), pages, total } };
  };
}

/**
 * @param {Record<string, { statut?: number, corps?: unknown } | Error | ((adresse: string, options: any) => any)>} routes
 */
function serveur(routes) {
  return fauxFetch((adresse, options) => {
    const route = routes[adresse.split('?')[0]];
    if (!route) return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
    return typeof route === 'function' ? route(adresse, options) : route;
  });
}

/** Les demandes de liste reçues (pas celles d'une entrée). @param {{ adresse: string }[]} appels */
const listes = (appels) => appels.map((a) => a.adresse).filter((a) => a.startsWith('/api/admin/audit.php') && !/[?&]id=/.test(a));

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

/** Monte le journal seul et attend sa première page. */
async function monterJournal() {
  const element = dom.monter('<cs-admin-journal></cs-admin-journal>');
  await dom.stabiliser();
  return element;
}

/** Ce que fait quelqu'un qui saisit une date. @param {any} champ @param {string} valeur */
function saisir(champ, valeur) {
  champ.value = valeur;
  champ.dispatchEvent(new CustomEvent('change'));
}

/** Des lignes de détail mises bout à bout. @param {unknown[]} lignes */
const assembler = (lignes) => lignes.join('');

/** @param {string} touche */
const taper =(touche) => dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: touche }));

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

// ── Menus et gabarits de la liste ───────────────────────────────────────────

test('categoriesPresentes : seulement celles qui ont une action en base, dans l’ordre du filtre', () => {
  assert.deepEqual(categoriesPresentes(TYPES).map((c) => c.id), ['carte', 'cours', 'emails', 'autres']);
  assert.deepEqual(categoriesPresentes([]), []);
});

test('actionsDe : les actions d’une catégorie, triées par libellé', () => {
  assert.deepEqual(actionsDe(TYPES, 'carte'), [
    { action: 'compost_modifie', icone: '✏️', texte: 'Composteur modifié' },
    { action: 'compost_valide', icone: '✅', texte: 'Demande validée' },
  ]);
  assert.deepEqual(actionsDe(TYPES, 'tous'), []);
  assert.deepEqual(actionsDe(TYPES, 'autres'), [{ action: 'truc_futur', icone: '❔', texte: 'truc_futur' }]);
});

test('gabaritLigne : libellé, objet échappé, auteur, date à la minute, marque « annulée »', () => {
  const journal = new AdminJournal();
  const ligne = String(journal.gabaritLigne(ENTREES[0]));
  assert.match(ligne, /<div class="audit-head" role="button" tabindex="0" data-id="7">/);
  assert.match(ligne, /<span class="audit-action">Composteur modifié<\/span> <span class="audit-meta">\(Compost &lt;du&gt; parc\)<\/span>/);
  assert.match(ligne, /<div class="audit-meta">par eliott<\/div>/);
  assert.match(ligne, /<div class="audit-date">2026-11-10 14:03<\/div>/);
  assert.ok(!ligne.includes('audit-badge-annule'));

  const annulee = String(journal.gabaritLigne(ENTREES[1]));
  assert.match(annulee, /Cours modifié<\/span><span class="audit-badge-annule">↩️ annulée<\/span>/);
  assert.ok(!annulee.includes('('), 'pas de parenthèses sans objet');
});

test('gabaritListe : message quand rien ne passe le filtre, pagination seulement s’il y a plusieurs pages', () => {
  const journal = new AdminJournal();
  assert.match(String(journal.gabaritListe({ entries: [], types: [], page: 1, pages: 1, total: 0 })), /class="empty-msg">Aucune action enregistrée pour ce filtre\./);
  assert.ok(!String(journal.gabaritListe({ entries: ENTREES, types: TYPES, page: 1, pages: 1, total: 3 })).includes('class="pages"'));

  const milieu = String(journal.gabaritListe({ entries: ENTREES, types: TYPES, page: 2, pages: 3, total: 61 }));
  assert.match(milieu, /<button type="button" data-page="1">← Précédent<\/button>/);
  assert.match(milieu, /Page 2 \/ 3 · 61 actions/);
  assert.match(milieu, /<button type="button" data-page="3">Suivant →<\/button>/);

  const debut = String(journal.gabaritListe({ entries: ENTREES, types: TYPES, page: 1, pages: 2, total: 31 }));
  assert.match(debut, /data-page="0" disabled>← Précédent/);
  const fin = String(journal.gabaritListe({ entries: ENTREES, types: TYPES, page: 2, pages: 2, total: 31 }));
  assert.match(fin, /data-page="3" disabled>Suivant →/);
});

// ── Gabarits du détail ──────────────────────────────────────────────────────

test('détail d’un signalement : qui, pourquoi, sur quel composteur', () => {
  const lignes = String(gabaritDetail({ id: 1, username: 'a', action: 'signalement_resolu', details: null, target_type: 'signalement', target_id: 4, date: '', annule_at: null, annule_par: null,
    snapshot: { reporter: null, motif: 'position', commentaire: 'Il est <en face>', compost_id: 88, changements: { statut: ['en_attente', 'resolu'] } } }));
  assert.match(lignes, />Signalé par<\/span><span class="audit-val">Anonyme</);
  assert.match(lignes, />Motif<\/span><span class="audit-val">📍 Mauvaise position</);
  assert.match(lignes, />Commentaire<\/span><span class="audit-val">« Il est &lt;en face&gt; »</);
  assert.match(lignes, />Composteur<\/span><span class="audit-val">#88</);
  assert.match(lignes, /<div class="fenetre__label">Modifications<\/div><div class="audit-chg">/);
  assert.match(lignes, /<div class="val-avant">En attente<\/div><div class="val-apres">Résolu<\/div>/);
});

test('détail d’un composteur : seul, ou traité par lot', () => {
  const seul = String(assembler(lignesPropres({ id: 1, username: 'a', action: 'compost_valide', details: 'Parc', target_type: 'compost', target_id: 12, date: '', annule_at: null, annule_par: null,
    snapshot: { propose_par: 'lea', type: 'collectif', lat: 48.123456789, lon: 2.5, mettre: ['épluchures'], pas_mettre: ['viande'] } })));
  assert.match(seul, />Objet<\/span><span class="audit-val">Parc</);
  assert.match(seul, />Composteur<\/span><span class="audit-val">#12</);
  assert.match(seul, />Proposé par<\/span><span class="audit-val">lea</);
  assert.match(seul, />Position<\/span><span class="audit-val">48\.12346, 2\.50000</);
  assert.match(seul, />Autorisé<\/span><span class="audit-val"><span class="audit-chip">épluchures</);
  assert.match(seul, />Interdit<\/span><span class="audit-val"><span class="audit-chip nok">viande</);

  const lot = String(assembler(lignesPropres({ id: 1, username: 'a', action: 'compost_valide', details: null, target_type: 'compost', target_id: null, date: '', annule_at: null, annule_par: null,
    snapshot: { ids: [3, 4, 5], traites: 2 } })));
  assert.match(lot, />Composteurs<\/span><span class="audit-val"><span class="audit-chip">#3<\/span><span class="audit-chip">#4<\/span><span class="audit-chip">#5</);
  assert.match(lot, />Traités<\/span><span class="audit-val">2 \/ 3</);
});

test('détail d’un compte : promu, ou effacé sans laisser de nom', () => {
  const promu = String(assembler(lignesPropres({ id: 1, username: 'a', action: 'user_promu', details: null, target_type: 'user', target_id: 9, date: '', annule_at: null, annule_par: null, snapshot: { username: 'lea', admin: 1 } })));
  assert.match(promu, />Utilisateur<\/span><span class="audit-val">lea</);
  assert.match(promu, />Nouveau rôle<\/span><span class="audit-val">Administrateur</);

  const efface = String(assembler(lignesPropres({ id: 1, username: 'a', action: 'compte_purge', details: null, target_type: 'user', target_id: null, date: '', annule_at: null, annule_par: null, snapshot: { etait_admin: false } })));
  assert.match(efface, />Utilisateur<\/span><span class="audit-val empty">compte effacé</);
  assert.match(efface, />Était admin<\/span><span class="audit-val">non</);
});

test('détail d’un email : destinataire, sujet, statut, raison de l’échec', () => {
  const echec = String(assembler(lignesPropres({ id: 1, username: 'a', action: 'mail_envoye', details: null, target_type: 'mail', target_id: null, date: '', annule_at: null, annule_par: null,
    snapshot: { to: 'a@exemple.fr', sujet: 'Bonjour', ok: false, erreur: 'SMTP 550', nb: 3 } })));
  assert.match(echec, />Destinataire<\/span><span class="audit-val">a@exemple\.fr</);
  assert.match(echec, />Statut<\/span><span class="audit-val">❌ Échec d&#39;envoi</);
  assert.match(echec, />Raison<\/span><span class="audit-val">SMTP 550</);
  assert.match(echec, />Éléments groupés<\/span><span class="audit-val">3</);
});

test('détail : bandeau « annulée », élément créé ou supprimé, entrée ancienne, entrée vide', () => {
  const annulee = String(gabaritDetail(DETAILS[6]));
  assert.match(annulee, /<div class="audit-annule-banniere">↩️ Annulée le 2026-11-09 10:30 par eliott<\/div>/);
  assert.match(annulee, /<div class="fenetre__label">Contenu du cours<\/div><div data-zone="contenu-cours">/);

  const base = { id: 1, username: 'a', details: null, target_type: 'theme', target_id: 2, date: '', annule_at: null, annule_par: null };
  assert.match(String(gabaritDetail({ ...base, action: 'theme_cree', snapshot: { etat: { nom: 'Sols' } } })), /<div class="fenetre__label">Élément créé<\/div>/);
  assert.match(String(gabaritDetail({ ...base, action: 'theme_supprime', snapshot: { etat: { nom: 'Sols' } } })), /Élément tel qu&#39;il était avant suppression/);
  assert.match(String(gabaritDetail({ ...base, action: 'theme_modifie', snapshot: null })), /Avant \/ après non disponible : entrée écrite avant le 26\/10\/2026/);
  assert.match(String(gabaritDetail({ ...base, action: 'theme_cree', snapshot: null })), /^<div class="audit-note">Aucun détail enregistré pour cette action\.<\/div>$/);
  assert.match(String(gabaritDetail({ ...base, action: 'ticket_repondu', target_type: 'ticket', snapshot: { sujet: 'Bug', message: 'Corrigé <ici>' } })),
    />Ticket<\/span><span class="audit-val">« Bug »<\/span><\/div><\/div><div class="audit-sec"><div class="fenetre__label">Message envoyé<\/div><div class="val-apres">Corrigé &lt;ici&gt;<\/div>/);
});

test('gabaritContenuCours : seulement les parties modifiées', () => {
  const sortie = String(gabaritContenuCours(['texte', 'video'], { texte: '## Un\na', quiz: [], video: { url: 'a' } }, { texte: '## Un\nb', quiz: [{ question: 'Q' }], video: { url: 'b' } }));
  assert.match(sortie, /<div class="fenetre__label">Texte<\/div><div class="diff-panneau">/);
  assert.match(sortie, /<div class="fenetre__label">Vidéo<\/div><div class="audit-chg">/);
  assert.ok(!sortie.includes('>Quiz<') && !sortie.includes('>Podcast<'));
});

// ── La liste, montée ────────────────────────────────────────────────────────

test('journal : première page, total, menus tirés des actions présentes en base', async () => {
  const { appels } = serveur({ '/api/admin/audit.php': journal() });
  const element = await monterJournal();

  assert.deepEqual(listes(appels), ['/api/admin/audit.php?page=1']);
  assert.equal(element.querySelector('.section-compte').textContent, '(3)');
  assert.deepEqual(element.querySelectorAll('.audit-action').map((e) => e.textContent), ['Composteur modifié', 'Cours modifié', 'Email envoyé']);
  assert.equal(element.querySelectorAll('.audit-badge-annule').length, 1);

  const categories = element.querySelector('[data-filtre="categorie"]');
  assert.deepEqual(categories.querySelectorAll('option').map((o) => [o.getAttribute('value'), o.textContent]), [
    ['tous', 'Toutes les catégories'], ['carte', '🗺️ Carte'], ['cours', '📚 Cours'], ['emails', '📧 Emails'], ['autres', '❔ Autres'],
  ]);
  assert.equal(categories.value, 'tous');
  assert.equal(element.querySelector('[data-filtre="action"]').hidden, true);
  assert.equal(element.querySelector('[data-action="effacer-dates"]').hidden, true);
});

test('journal : choisir une catégorie demande ses actions, puis une action précise', async () => {
  const { appels } = serveur({ '/api/admin/audit.php': journal() });
  const element = await monterJournal();
  const categories = element.querySelector('[data-filtre="categorie"]');
  const actions = element.querySelector('[data-filtre="action"]');

  categories.choisir('carte');
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=1&actions=compost_modifie%2Ccompost_valide');
  assert.equal(actions.hidden, false);
  assert.deepEqual(actions.querySelectorAll('option').map((o) => [o.getAttribute('value'), o.textContent]), [
    ['tous', 'Toutes ses actions'], ['compost_modifie', '✏️ Composteur modifié'], ['compost_valide', '✅ Demande validée'],
  ]);

  actions.choisir('compost_valide');
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=1&actions=compost_valide');

  // Autre catégorie : l'action choisie ne vaut plus, et une seule action ne fait pas un menu.
  categories.choisir('cours');
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=1&actions=cours_modifie');
  assert.equal(actions.hidden, true);

  categories.choisir('tous');
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=1');
});

test('journal : plage de dates, bornes croisées, bouton pour l’effacer', async () => {
  const { appels } = serveur({ '/api/admin/audit.php': journal() });
  const element = await monterJournal();
  const debut = element.querySelector('[data-filtre="depuis"]');
  const fin = element.querySelector('[data-filtre="jusqu"]');
  const effacer = element.querySelector('[data-action="effacer-dates"]');

  saisir(debut, '2026-11-01');
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=1&depuis=2026-11-01');
  assert.equal(fin.min, '2026-11-01', 'la fin ne peut pas précéder le début');
  assert.equal(effacer.hidden, false);

  saisir(fin, '2026-11-15');
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=1&depuis=2026-11-01&jusqu=2026-11-15');
  assert.equal(debut.max, '2026-11-15');

  effacer.click();
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=1');
  assert.deepEqual([debut.value, fin.value, debut.max, fin.min, effacer.hidden], ['', '', '', '', true]);
});

test('journal : changer de page garde les filtres, changer de filtre revient à la première page', async () => {
  const { appels } = serveur({ '/api/admin/audit.php': journal({ pages: 3, total: 61 }) });
  const element = await monterJournal();
  assert.equal(element.querySelector('.pages-info').textContent, 'Page 1 / 3 · 61 actions');

  element.querySelector('[data-filtre="categorie"]').choisir('cours');
  await dom.stabiliser();
  element.querySelector('[data-page="2"]').click();
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=2&actions=cours_modifie');
  assert.equal(element.querySelector('.pages-info').textContent, 'Page 2 / 3 · 61 actions');

  await element.rafraichir();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=2&actions=cours_modifie', 'rafraichir() recharge la page affichée');

  element.querySelector('[data-filtre="categorie"]').choisir('emails');
  await dom.stabiliser();
  assert.equal(listes(appels).at(-1), '/api/admin/audit.php?page=1&actions=mail_envoye');
});

test('journal : un type apparu en cours de session entre dans les menus sans faire perdre le choix', async () => {
  let types = TYPES;
  const { appels } = serveur({ '/api/admin/audit.php': (/** @type {string} */ adresse) => journal({ types })(adresse) });
  const element = await monterJournal();
  const categories = element.querySelector('[data-filtre="categorie"]');
  categories.choisir('carte');
  await dom.stabiliser();

  types = [...TYPES, 'compost_supprime', 'jeu_modifie'];
  await element.rafraichir();
  assert.equal(categories.value, 'carte', 'la catégorie choisie reste choisie');
  assert.ok(categories.querySelectorAll('option').some((o) => o.getAttribute('value') === 'jeux'));
  assert.equal(element.querySelector('[data-filtre="action"]').querySelectorAll('option').length, 4);
  assert.ok(listes(appels).length >= 3);
});

test('journal : serveur en panne, un message à la place de la liste, les menus restent', async () => {
  await enSilence(async () => {
    let panne = false;
    serveur({ '/api/admin/audit.php': (/** @type {string} */ adresse) => (panne ? { statut: 500, corps: { error: 'DB error' } } : journal()(adresse)) });
    const element = await monterJournal();
    panne = true;
    await element.rafraichir();

    assert.equal(element.querySelector('[data-zone="liste"] .cs-etat--erreur').textContent, "⚠️ Le journal n'a pas pu être chargé.");
    assert.equal(element.querySelectorAll('.audit-item').length, 0);
    assert.equal(element.querySelector('[data-filtre="categorie"]').querySelectorAll('option').length, 5);
  });
});

test('journal : le message du serveur est montré quand c’est une phrase', async () => {
  await enSilence(async () => {
    serveur({ '/api/admin/audit.php': { statut: 500, corps: { error: 'Journal pas à jour : migration-2026-10-journal-detail.sql non appliquée.' } } });
    const element = await monterJournal();
    assert.match(element.querySelector('.cs-etat--erreur').textContent, /Journal pas à jour : migration/);
  });
});

// ── La fenêtre de détail ────────────────────────────────────────────────────

test('détail : un clic sur une ligne ouvre la fenêtre et demande l’entrée complète', async () => {
  const { appels } = serveur({ '/api/admin/audit.php': journal() });
  const element = await monterJournal();
  const detail = element.querySelector('cs-admin-journal-detail');
  assert.equal(detail.querySelector('.fenetre__fond').classList.contains('ouverte'), false);

  element.querySelector('.audit-head[data-id="7"]').click();
  assert.equal(detail.querySelector('.fenetre__fond').classList.contains('ouverte'), true);
  assert.equal(detail.querySelector('.fenetre__titre').textContent, 'Composteur modifié');
  assert.equal(detail.querySelector('.audit-meta').textContent, 'par eliott · 2026-11-10 14:03');
  assert.equal(detail.querySelector('.audit-modal-body').textContent, 'Chargement…');
  assert.deepEqual(detail.querySelectorAll('.fenetre__actions button').map((b) => b.textContent), ['Fermer']);

  await dom.stabiliser();
  assert.ok(appels.some((a) => a.adresse === '/api/admin/audit.php?id=7'));
  assert.match(detail.querySelector('.audit-modal-body').textContent, /Compost <du> parc/);
  assert.deepEqual(detail.querySelectorAll('.audit-chg-cle').map((e) => e.textContent), ['Accès']);
  assert.deepEqual(detail.querySelectorAll('.fenetre__actions button').map((b) => b.textContent), ['↩️ Annuler cette action', 'Fermer']);
});

test('détail : pas de bouton d’annulation pour une action déjà annulée ou non annulable', async () => {
  serveur({ '/api/admin/audit.php': journal(), '/api/admin/cours_versions.php': { corps: { avant: { texte: '' }, apres: { texte: '' } } } });
  const element = await monterJournal();
  const detail = element.querySelector('cs-admin-journal-detail');

  element.querySelector('.audit-head[data-id="6"]').click();
  await dom.stabiliser();
  assert.match(detail.querySelector('.audit-annule-banniere').textContent, /Annulée le 2026-11-09 10:30 par eliott/);
  assert.equal(detail.querySelector('[data-action="annuler"]'), null);

  element.querySelector('.audit-head[data-id="5"]').click();
  await dom.stabiliser();
  assert.equal(detail.querySelector('.fenetre__titre').textContent, 'Email envoyé');
  assert.equal(detail.querySelector('[data-action="annuler"]'), null);
});

test('détail : au clavier — Entrée ou Espace ouvre, Échap ferme', async () => {
  serveur({ '/api/admin/audit.php': journal() });
  const element = await monterJournal();
  const fond = element.querySelector('cs-admin-journal-detail .fenetre__fond');
  const ligne = element.querySelector('.audit-head[data-id="5"]');

  ligne.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  assert.equal(fond.classList.contains('ouverte'), false);
  ligne.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(fond.classList.contains('ouverte'), true);
  taper('Escape');
  assert.equal(fond.classList.contains('ouverte'), false);
  ligne.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  assert.equal(fond.classList.contains('ouverte'), true);
});

test('détail : la croix, « Fermer » et un clic à côté ferment ; un clic dedans non', async () => {
  serveur({ '/api/admin/audit.php': journal() });
  const element = await monterJournal();
  const detail = element.querySelector('cs-admin-journal-detail');
  const fond = detail.querySelector('.fenetre__fond');
  const ouvrir = async () => { element.querySelector('.audit-head[data-id="7"]').click(); await dom.stabiliser(); };

  await ouvrir();
  detail.querySelector('.audit-modal-body').click();
  assert.equal(fond.classList.contains('ouverte'), true);
  fond.click();
  assert.equal(fond.classList.contains('ouverte'), false);

  await ouvrir();
  detail.querySelector('.audit-modal-close').click();
  assert.equal(fond.classList.contains('ouverte'), false);

  await ouvrir();
  detail.querySelector('.fenetre__annuler').click();
  assert.equal(fond.classList.contains('ouverte'), false);
});

test('détail : entrée introuvable, le message du serveur dans la fenêtre', async () => {
  await enSilence(async () => {
    serveur({ '/api/admin/audit.php': journal({ entrees: [{ ...ENTREES[0], id: 99 }] }) });
    const element = await monterJournal();
    element.querySelector('.audit-head[data-id="99"]').click();
    await dom.stabiliser();
    assert.equal(element.querySelector('cs-admin-journal-detail .audit-modal-body').textContent, 'Entrée introuvable.');
  });
});

test('détail : une réponse arrivée après qu’on a ouvert une autre entrée est ignorée', async () => {
  /** @type {((reponse: any) => void)[]} */
  const enAttente = [];
  /** @type {any} */ (globalThis).fetch = async (/** @type {string} */ adresse) => {
    if (!adresse.includes('id=')) return new Response(JSON.stringify({ entries: ENTREES, types: TYPES, page: 1, pages: 1, total: 3 }));
    const id = /** @type {string} */ (new URL(adresse, 'https://composmart.test').searchParams.get('id'));
    await new Promise((resoudre) => { enAttente.push(resoudre); });
    return new Response(JSON.stringify({ entry: DETAILS[id] }));
  };
  const element = await monterJournal();
  const detail = element.querySelector('cs-admin-journal-detail');

  element.querySelector('.audit-head[data-id="7"]').click();
  element.querySelector('.audit-head[data-id="5"]').click();
  await dom.stabiliser();
  enAttente[1](null); // la seconde répond d'abord
  await dom.stabiliser();
  enAttente[0](null); // puis la première, en retard
  await dom.stabiliser();

  assert.equal(detail.querySelector('.fenetre__titre').textContent, 'Email envoyé');
  assert.match(detail.querySelector('.audit-modal-body').textContent, /a@exemple\.fr/);
  assert.equal(detail.querySelector('[data-action="annuler"]'), null, 'le bouton de l’autre entrée n’apparaît pas');
});

test('détail : le contenu d’un cours est relu dans l’historique des versions', async () => {
  const { appels } = serveur({
    '/api/admin/audit.php': journal(),
    '/api/admin/cours_versions.php': { corps: { avant: { texte: '## Un\nle chat', quiz: [] }, apres: { texte: '## Un\nle chien', quiz: [{ question: 'Q1', options: ['a'], correct: 0 }] } } },
  });
  const element = await monterJournal();
  element.querySelector('.audit-head[data-id="6"]').click();
  await dom.stabiliser();

  assert.ok(appels.some((a) => a.adresse === '/api/admin/cours_versions.php?id=40'));
  const zone = element.querySelector('[data-zone="contenu-cours"]');
  assert.deepEqual(zone.querySelectorAll('.fenetre__label').map((e) => e.textContent), ['Texte', 'Quiz']);
  assert.deepEqual(zone.querySelectorAll('.diff-panneau-titre').map((e) => e.textContent), ['✏️ Panneau modifié — « Un »', '➕ Question ajoutée — « Q1 »']);
  assert.deepEqual(zone.querySelectorAll('ins').map((e) => e.textContent), ['chien']);
});

test('détail : version d’un cours purgée, un mot à la place du comparatif', async () => {
  serveur({ '/api/admin/audit.php': journal(), '/api/admin/cours_versions.php': { corps: { avant: { texte: 'a' }, apres: null } } });
  const element = await monterJournal();
  element.querySelector('.audit-head[data-id="6"]').click();
  await dom.stabiliser();
  assert.equal(element.querySelector('[data-zone="contenu-cours"]').textContent, "Le contenu d'après n'est plus disponible.");
});

// ── Annuler une action ──────────────────────────────────────────────────────

/** Ouvre le détail de l'entrée 7 et clique « Annuler cette action » : la confirmation est à l'écran. */
async function demanderAnnulation() {
  const element = await monterJournal();
  element.querySelector('.audit-head[data-id="7"]').click();
  await dom.stabiliser();
  element.querySelector('[data-action="annuler"]').click();
  await dom.stabiliser();
  const confirmation = dom.document.querySelector('cs-dialogue');
  assert.ok(confirmation, 'une confirmation est demandée');
  return { element, confirmation };
}

test('annulation : confirmée, la demande part au service de la carte et tout se recharge', async () => {
  const { appels } = serveur({ '/api/admin/audit.php': journal(), '/api/carte/pending.php': { corps: { ok: true } } });
  const { element, confirmation } = await demanderAnnulation();
  assert.equal(confirmation.querySelector('.dialogue__titre').textContent, 'Annuler « Composteur modifié » ?');
  assert.match(confirmation.querySelector('.dialogue__texte').textContent, /Si l'élément a été modifié depuis, l'annulation est refusée\./);
  assert.equal(confirmation.querySelector('[data-reponse="oui"]').classList.contains('danger'), true);
  assert.ok(!appels.some((a) => a.adresse.startsWith('/api/carte/')), 'rien n’est envoyé avant la confirmation');

  /** @type {string[]} */
  const signaux = [];
  element.addEventListener('donnees-modifiees', () => signaux.push('donnees-modifiees'));
  const avant = { listes: listes(appels).length, details: appels.filter((a) => a.adresse === '/api/admin/audit.php?id=7').length };
  confirmation.querySelector('[data-reponse="oui"]').click();
  await dom.stabiliser();

  const envoi = appels.find((a) => a.adresse.startsWith('/api/carte/'));
  assert.equal(envoi?.adresse, '/api/carte/pending.php?action=annuler&audit_id=7');
  assert.equal(envoi?.options.method, 'POST');
  assert.equal(String(envoi?.options.body), 'action=annuler&audit_id=7');
  assert.deepEqual(signaux, ['donnees-modifiees'], 'le panneau est prévenu');
  assert.equal(listes(appels).length, avant.listes + 1, 'la liste est rechargée');
  assert.equal(appels.filter((a) => a.adresse === '/api/admin/audit.php?id=7').length, avant.details + 1, 'le détail est rouvert');
  assert.equal(element.querySelector('cs-admin-journal-detail .fenetre__fond').classList.contains('ouverte'), true);
});

test('annulation : la précision propre à l’action est donnée avant la règle commune', async () => {
  serveur({ '/api/admin/audit.php': journal({ entrees: [{ ...ENTREES[0], id: 8, action: 'compost_supprime' }] }) });
  DETAILS[8] = { ...DETAILS[7], id: 8, action: 'compost_supprime', snapshot: { etat: { id: 12 } } };
  const element = await monterJournal();
  element.querySelector('.audit-head[data-id="8"]').click();
  await dom.stabiliser();
  element.querySelector('[data-action="annuler"]').click();
  await dom.stabiliser();
  assert.match(dom.document.querySelector('cs-dialogue .dialogue__texte').textContent, /^Le composteur revient avec son numéro, sa position et ses règles\. L'état d'avant/);
  delete DETAILS[8];
});

test('annulation : renoncer n’envoie rien', async () => {
  const { appels } = serveur({ '/api/admin/audit.php': journal(), '/api/carte/pending.php': { corps: { ok: true } } });
  const { element, confirmation } = await demanderAnnulation();
  confirmation.querySelector('[data-reponse="non"]').click();
  await dom.stabiliser();
  assert.ok(!appels.some((a) => a.adresse.startsWith('/api/carte/')));
  assert.equal(element.querySelector('[data-action="annuler"]').disabled, false);
});

test('annulation : Échap sur la confirmation ferme la confirmation, pas le détail', async () => {
  serveur({ '/api/admin/audit.php': journal() });
  const { element } = await demanderAnnulation();
  taper('Escape');
  await dom.stabiliser();
  assert.equal(element.querySelector('cs-admin-journal-detail .fenetre__fond').classList.contains('ouverte'), true);
});

test('annulation : refusée par le serveur, sa raison est affichée et le bouton redevient utilisable', async () => {
  await enSilence(async () => {
    const { appels } = serveur({ '/api/admin/audit.php': journal(), '/api/carte/pending.php': { statut: 409, corps: { error: 'Le composteur a été modifié depuis cette action.' } } });
    const { element, confirmation } = await demanderAnnulation();
    const avant = listes(appels).length;
    confirmation.querySelector('[data-reponse="oui"]').click();
    await dom.stabiliser();

    const message = dom.document.querySelectorAll('cs-dialogue').at(-1);
    assert.equal(message.querySelector('.dialogue__titre').textContent, 'Annulation impossible');
    assert.equal(message.querySelector('.dialogue__texte').textContent, 'Le composteur a été modifié depuis cette action.');
    assert.equal(message.querySelectorAll('button').length, 1);
    assert.equal(element.querySelector('[data-action="annuler"]').disabled, false);
    assert.equal(listes(appels).length, avant, 'rien n’a changé : la liste n’est pas rechargée');
  });
});

test('annulation : serveur injoignable, « Erreur réseau »', async () => {
  await enSilence(async () => {
    serveur({ '/api/admin/audit.php': journal(), '/api/carte/pending.php': new TypeError('fetch failed') });
    const { confirmation } = await demanderAnnulation();
    confirmation.querySelector('[data-reponse="oui"]').click();
    await dom.stabiliser();
    const message = dom.document.querySelectorAll('cs-dialogue').at(-1);
    assert.equal(message.querySelector('.dialogue__titre').textContent, 'Erreur réseau');
    assert.equal(message.querySelector('.dialogue__texte').textContent, "L'annulation n'a pas pu être envoyée.");
  });
});

test('annulation : un parcours rétabli en partie le dit', async () => {
  serveur({ '/api/admin/audit.php': journal(), '/api/carte/pending.php': { corps: { ok: true, slides_non_retablies: ['Slide 3', 'Slide 5'] } } });
  const { confirmation } = await demanderAnnulation();
  confirmation.querySelector('[data-reponse="oui"]').click();
  await dom.stabiliser();
  const message = dom.document.querySelectorAll('cs-dialogue').at(-1);
  assert.equal(message.querySelector('.dialogue__titre').textContent, 'Parcours rétabli en partie');
  assert.equal(message.querySelector('.dialogue__texte').textContent, 'Slides qui ne passent plus la validation : Slide 3 ; Slide 5');
});

// ── Dans le panneau ─────────────────────────────────────────────────────────

const PANNEAU = {
  '/api/admin/stats.php': { corps: { stats: { users: 1, admins: 1, completions: 0 } } },
  '/api/carte/count.php': { corps: { composts: 1, en_attente: 0, signalements: 0 } },
  '/api/jeux/count.php': { corps: { parties: 0 } },
  '/api/admin/tickets.php': { corps: { a_traiter: 0 } },
  '/api/admin/evolution.php': { corps: { labels: [], inscrits: [], connexions: null } },
  '/api/carte/evolution.php': { corps: { labels: [], totaux: [] } },
};

test('panneau : l’onglet Journal monte le journal, y revenir le recharge sans le recréer', async () => {
  const { appels } = serveur({ ...PANNEAU, '/api/admin/audit.php': journal() });
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();
  assert.equal(listes(appels).length, 0, 'le journal n’est demandé qu’à l’ouverture de son onglet');

  panneau.querySelector('[data-onglet="journal"]').click();
  await dom.stabiliser();
  const element = panneau.querySelector('[data-contenu="journal"] cs-admin-journal');
  assert.equal(element.querySelectorAll('.audit-item').length, 3);
  element.querySelector('[data-filtre="categorie"]').choisir('emails');
  await dom.stabiliser();

  panneau.querySelector('[data-onglet="ensemble"]').click();
  panneau.querySelector('[data-onglet="journal"]').click();
  await dom.stabiliser();
  assert.equal(panneau.querySelector('cs-admin-journal'), element);
  assert.deepEqual(listes(appels).slice(-2), ['/api/admin/audit.php?page=1&actions=mail_envoye', '/api/admin/audit.php?page=1&actions=mail_envoye'], 'le filtre a survécu à l’aller-retour');
});

test('panneau : une annulation depuis le journal fait recompter les pastilles des onglets', async () => {
  const { appels } = serveur({ ...PANNEAU, '/api/admin/audit.php': journal(), '/api/carte/pending.php': { corps: { ok: true } } });
  const panneau = dom.monter('<cs-admin-panel></cs-admin-panel>');
  await dom.stabiliser();
  panneau.querySelector('[data-onglet="journal"]').click();
  await dom.stabiliser();
  panneau.querySelector('.audit-head[data-id="7"]').click();
  await dom.stabiliser();
  const avant = appels.filter((a) => a.adresse === '/api/carte/count.php').length;

  panneau.querySelector('[data-action="annuler"]').click();
  await dom.stabiliser();
  dom.document.querySelector('cs-dialogue [data-reponse="oui"]').click();
  await dom.stabiliser();
  assert.equal(appels.filter((a) => a.adresse === '/api/carte/count.php').length, avant + 1);
});
