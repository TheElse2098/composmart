/* ============================================================================
   L'administration des ateliers (/evenements-admin) : la liste des
   événements, la banque d'anecdotes, la banque d'images et ses outils.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FauxEvenement, fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const UI = '../../services/web/front/ui/admin/ateliers/';
const { ADRESSES } = await import(UI + 'adresses.js');
const { poids, motsDeSaisie, dateVersServeur, TAILLE_MAX_IMAGE } = await import(UI + 'outils-ateliers.js');
const { ACTIONS_PAR_STATUT, CONFIRMATIONS } = await import(UI + 'evenements.js');
await import(UI + 'anecdotes.js');
await import(UI + 'images.js');

const g = /** @type {any} */ (globalThis);

/** La boîte de confirmation la plus récente. */
const boite = () => dom.document.querySelectorAll('cs-dialogue').at(-1);

async function stabiliser() {
  for (let i = 0; i < 5; i++) await dom.stabiliser();
}

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

/** Corps d'un envoi en formulaire, en objet. @param {any} options */
const corpsDe = (options) => Object.fromEntries(new URLSearchParams(String(options.body)));

/** @param {any} formulaire */
const soumettre = (formulaire) => formulaire.dispatchEvent(new FauxEvenement('submit'));

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

// ── Outils ──────────────────────────────────────────────────────────────────

test('outils : poids lisible, mots-clés comme le serveur les enregistre, date au format serveur', () => {
  assert.deepEqual([poids(512), poids(34 * 1024), poids(2.5 * 1048576)], ['512 o', '34 Ko', '2.5 Mo']);
  assert.deepEqual(motsDeSaisie(' Chiffre-choc,  eau ;EAU,, Grand   Froid '), ['chiffre-choc', 'eau', 'grand froid']);
  assert.equal(motsDeSaisie(Array.from({ length: 20 }, (_, i) => 'm' + i).join(',')).length, 12);
  assert.deepEqual(motsDeSaisie(''), []);
  assert.equal(dateVersServeur('2026-03-12T14:00'), '2026-03-12 14:00');
  assert.equal(TAILLE_MAX_IMAGE, 8 * 1024 * 1024);
});

test('adresses : pages migrées sous /evenements-admin/v2, parcours et suivi encore en service', () => {
  assert.equal(ADRESSES.liste, '/evenements-admin/v2');
  assert.equal(ADRESSES.anecdotes, '/evenements-admin/v2/anecdotes');
  assert.equal(ADRESSES.images, '/evenements-admin/v2/images');
  assert.equal(ADRESSES.parcours, '/evenements-admin/parcours');
  assert.equal(ADRESSES.suivi(12), '/evenements-admin/12');
});

// ── Événements ──────────────────────────────────────────────────────────────

const EVENEMENTS = [
  { id: 1, titre: 'Atelier <b>A</b>', lieu: 'Salle 3', date_debut: '2026-03-12 14:00:00', code: 'ABC123', statut: 'prevu', nb_participants: 0, supprime: 0 },
  { id: 2, titre: 'Atelier B', lieu: '', date_debut: '2026-03-13 09:30:00', code: 'XYZ789', statut: 'ouvert', nb_participants: 4, supprime: 0 },
  { id: 3, titre: 'Atelier C', lieu: null, date_debut: '2026-03-14 10:00:00', code: 'QQQ111', statut: 'annule', nb_participants: 2, supprime: 0 },
];

test('événements : liste, actions proposées selon le statut, texte échappé', async () => {
  const reseau = fauxFetch(() => ({ corps: { evenements: structuredClone(EVENEMENTS) } }));
  const page = dom.monter('<cs-admin-evenements></cs-admin-evenements>');
  await stabiliser();

  assert.equal(reseau.appels[0].adresse, '/api/evenements/admin.php?action=liste');
  const lignes = page.querySelectorAll('.evt-item');
  assert.equal(lignes.length, 3);
  assert.equal(lignes[0].querySelector('.evt-titre').textContent, 'Atelier <b>A</b>');
  assert.equal(lignes[0].querySelector('.evt-titre b'), null, 'texte échappé');
  assert.ok(lignes[0].querySelector('.evt-meta').textContent.includes(' · Salle 3 · code '));
  assert.ok(!lignes[1].querySelector('.evt-meta').textContent.includes(' ·  · '), 'lieu vide : pas de séparateur orphelin');
  assert.equal(lignes[0].querySelector('a.suivi').getAttribute('href'), '/evenements-admin/1');
  const actions = (/** @type {any} */ l) => l.querySelectorAll('[data-action]').map((/** @type {any} */ b) => b.dataset.action);
  assert.deepEqual(actions(lignes[0]), ['ouvrir', 'annuler', 'supprimer']);
  assert.deepEqual(actions(lignes[1]), ['reprevoir', 'demarrer', 'annuler', 'supprimer']);
  assert.deepEqual(actions(lignes[2]), ['supprimer'], 'un événement annulé ne s’annule pas deux fois');
  assert.equal(page.querySelectorAll('.evt-statut.supprime').length, 0, 'supprime: 0 ne s’affiche pas');
  // Chaque action proposée a sa question.
  for (const liste of Object.values(ACTIONS_PAR_STATUT)) for (const a of liste) assert.ok(a.action in CONFIRMATIONS);
  // Les liens vers les bibliothèques.
  assert.deepEqual(page.querySelectorAll('.hero-lien').map((/** @type {any} */ a) => a.getAttribute('href')),
    ['/evenements-admin/parcours', '/evenements-admin/v2/anecdotes', '/evenements-admin/v2/images']);
});

test('événements : les onglets filtrent, celui des supprimés ne propose que la restauration', async () => {
  const reseau = fauxFetch((adresse) => ({
    corps: { evenements: adresse.includes('supprimes=1') ? [{ ...EVENEMENTS[0], supprime: 1 }] : [] },
  }));
  const page = dom.monter('<cs-admin-evenements></cs-admin-evenements>');
  await stabiliser();
  assert.equal(page.querySelector('.evt-liste').textContent.trim(), 'Aucun événement dans cette catégorie.');

  page.querySelector('[data-onglet="en_cours"]').click();
  await stabiliser();
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/admin.php?action=liste&statut=en_cours');
  assert.equal(page.querySelector('[data-onglet="en_cours"]').classList.contains('actif'), true);
  assert.equal(page.querySelector('[data-onglet=""]').classList.contains('actif'), false);

  page.querySelector('[data-onglet="supprimes"]').click();
  await stabiliser();
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/admin.php?action=liste&supprimes=1');
  const ligne = page.querySelector('.evt-item');
  assert.deepEqual(ligne.querySelectorAll('[data-action]').map((/** @type {any} */ b) => b.dataset.action), ['restaurer']);
  assert.ok(ligne.querySelector('.evt-statut.supprime'), 'un supprimé garde son statut et le dit');
  assert.ok(ligne.querySelector('.evt-statut.prevu'));
});

test('événements : une action est confirmée, envoyée, et un refus du serveur s’affiche', async () => {
  let refus = false;
  const reseau = fauxFetch((_adresse, options) => {
    if (options.method === 'POST') return refus ? { statut: 409, corps: { ok: false, error: 'Statut déjà changé.' } } : { corps: { ok: true } };
    return { corps: { evenements: structuredClone(EVENEMENTS) } };
  });
  const page = dom.monter('<cs-admin-evenements></cs-admin-evenements>');
  await stabiliser();

  // Refusée dans la boîte : rien ne part.
  page.querySelector('[data-action="ouvrir"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Ouvrir les inscriptions ?');
  boite().querySelector('[data-reponse="non"]').click();
  await stabiliser();
  assert.equal(reseau.appels.filter((a) => a.options.method === 'POST').length, 0);

  page.querySelector('[data-action="ouvrir"]').click();
  await stabiliser();
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  const envoi = reseau.appels.find((a) => a.options.method === 'POST');
  assert.equal(envoi.adresse, '/api/evenements/admin.php?action=ouvrir');
  assert.deepEqual(corpsDe(envoi.options), { id: '1' });
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/admin.php?action=liste', 'la liste est rechargée');

  // L'ancienne page avalait ce refus (fonction afficher() inexistante).
  refus = true;
  await enSilence(async () => {
    page.querySelector('[data-action="demarrer"]').click();
    await stabiliser();
    boite().querySelector('[data-reponse="oui"]').click();
    await stabiliser();
  });
  const msg = page.querySelector('.msg-page');
  assert.equal(msg.hidden, false);
  assert.equal(msg.textContent, 'Statut déjà changé.');
  assert.ok(msg.classList.contains('error'));
});

test('événements : création, formulaire vidé, erreur du serveur affichée sous le formulaire', async () => {
  let refus = false;
  const reseau = fauxFetch((_adresse, options) => {
    if (options.method === 'POST') return refus ? { statut: 400, corps: { error: 'Date invalide.' } } : { corps: { ok: true, id: 9 } };
    return { corps: { evenements: [] } };
  });
  const page = dom.monter('<cs-admin-evenements></cs-admin-evenements>');
  await stabiliser();

  page.querySelector('[name="titre"]').value = '  Atelier D ';
  page.querySelector('[name="lieu"]').value = 'Mairie';
  page.querySelector('[name="date_debut"]').value = '2026-04-01T18:30';
  soumettre(page.querySelector('.evt-creation'));
  assert.deepEqual([page.querySelector('.evt-creation [type="submit"]').disabled, page.querySelector('.evt-creation [type="submit"]').textContent], [true, 'Création…']);
  await stabiliser();
  const envoi = reseau.appels.find((a) => a.options.method === 'POST');
  assert.equal(envoi.adresse, '/api/evenements/admin.php?action=creer');
  assert.deepEqual(corpsDe(envoi.options), { titre: 'Atelier D', lieu: 'Mairie', date_debut: '2026-04-01 18:30' });
  assert.equal(page.querySelector('[name="titre"]').value, '', 'formulaire vidé');
  assert.deepEqual([page.querySelector('.evt-creation [type="submit"]').disabled, page.querySelector('.evt-creation [type="submit"]').textContent], [false, 'Créer']);

  refus = true;
  page.querySelector('[name="titre"]').value = 'Atelier E';
  await enSilence(async () => {
    soumettre(page.querySelector('.evt-creation'));
    await stabiliser();
  });
  const erreur = page.querySelector('.evt-creation .msg');
  assert.deepEqual([erreur.hidden, erreur.textContent], [false, 'Date invalide.']);
  assert.equal(page.querySelector('[name="titre"]').value, 'Atelier E', 'la saisie reste en cas de refus');
});

test('événements : une liste illisible s’affiche comme une erreur, pas comme une page vide', async () => {
  fauxFetch(() => ({ statut: 500, texte: '<html>Erreur</html>' }));
  await enSilence(async () => {
    dom.monter('<cs-admin-evenements></cs-admin-evenements>');
    await stabiliser();
  });
  assert.ok(dom.document.querySelector('.evt-liste .cs-etat--erreur'));
});

// ── Anecdotes ───────────────────────────────────────────────────────────────

const ANECDOTES = {
  themes: ['eau', 'tri'],
  mots: [{ mot: 'chiffre-choc', n: 2 }, { mot: 'démarrage', n: 1 }],
  anecdotes: [
    { id: 4, texte: 'Un mégot pollue 500 L d’eau.', emoji: '🚬', theme: 'eau', mots: ['chiffre-choc'] },
    { id: 5, texte: 'Trier <vraiment>', emoji: null, theme: null, mots: [] },
  ],
};

test('anecdotes : liste, filtres par thème et par mot-clé, compteurs', async () => {
  const reseau = fauxFetch(() => ({ corps: structuredClone(ANECDOTES) }));
  const page = dom.monter('<cs-admin-anecdotes></cs-admin-anecdotes>');
  await stabiliser();

  assert.equal(reseau.appels[0].adresse, '/api/evenements/anecdotes.php?action=liste');
  assert.equal(page.querySelector('.anec-nb').textContent, '(2)');
  const cartes = page.querySelectorAll('.anec');
  assert.equal(cartes[1].querySelector('.anec-emoji').textContent, '💡', 'emoji par défaut');
  assert.equal(cartes[1].querySelector('.anec-texte').textContent, 'Trier <vraiment>');
  assert.equal(cartes[1].querySelector('vraiment'), null, 'texte échappé');
  assert.deepEqual(page.querySelectorAll('.anec-filtres-themes .filtre').map((/** @type {any} */ b) => b.textContent), ['Toutes', 'eau', 'tri']);
  assert.equal(page.querySelector('.anec-filtres-mots [data-mot="chiffre-choc"] .n').textContent, '2');
  assert.equal(page.querySelector('.anec-ligne-mots').hidden, false);
  assert.deepEqual(page.querySelectorAll('#anec-themes option').map((/** @type {any} */ o) => o.getAttribute('value')), ['eau', 'tri']);

  page.querySelector('.anec-filtres-themes [data-theme="eau"]').click();
  await stabiliser();
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/anecdotes.php?action=liste&theme=eau');
  assert.ok(page.querySelector('.anec-filtres-themes [data-theme="eau"]').classList.contains('actif'));

  // Cliquer un mot-clé sous une anecdote filtre dessus et remonte en haut.
  const avant = dom.defilements.length;
  page.querySelector('.anec .pastille[data-mot="chiffre-choc"]').click();
  await stabiliser();
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/anecdotes.php?action=liste&theme=eau&mot=chiffre-choc');
  assert.equal(dom.defilements.length, avant + 1);
});

test('anecdotes : pas de ligne de mots-clés quand la banque n’en a aucun', async () => {
  fauxFetch(() => ({ corps: { themes: [], mots: [], anecdotes: [] } }));
  const page = dom.monter('<cs-admin-anecdotes></cs-admin-anecdotes>');
  await stabiliser();
  assert.equal(page.querySelector('.anec-ligne-mots').hidden, true);
  assert.equal(page.querySelector('.anec-liste').textContent.trim(), 'Aucune anecdote. Ajoute la première ci-dessus.');
});

test('anecdotes : ajout, aperçu des mots-clés, modification puis annulation', async () => {
  const reseau = fauxFetch((_adresse, options) => (options.method === 'POST' ? { corps: { ok: true } } : { corps: structuredClone(ANECDOTES) }));
  const page = dom.monter('<cs-admin-anecdotes></cs-admin-anecdotes>');
  await stabiliser();

  page.querySelector('[name="mots"]').saisir('Eau, eau ; Grand  Froid');
  assert.deepEqual(page.querySelectorAll('.anec-apercu-mots .pastille').map((/** @type {any} */ p) => p.textContent), ['eau', 'grand froid']);

  page.querySelector('[name="texte"]').value = ' Le compost chauffe à 70 °C. ';
  page.querySelector('cs-choix-emoji').value = '🔥';
  page.querySelector('[name="theme"]').value = 'compost';
  soumettre(page.querySelector('.anec-form'));
  await stabiliser();
  let envoi = reseau.appels.find((a) => a.options.method === 'POST');
  assert.equal(envoi.adresse, '/api/evenements/anecdotes.php?action=creer');
  assert.deepEqual(corpsDe(envoi.options), { texte: 'Le compost chauffe à 70 °C.', emoji: '🔥', theme: 'compost', mots: 'Eau, eau ; Grand  Froid' });
  assert.equal(page.querySelector('.msg-page').textContent, 'Anecdote ajoutée.');
  assert.equal(page.querySelector('[name="texte"]').value, '', 'formulaire vidé');
  assert.equal(page.querySelectorAll('.anec-apercu-mots .pastille').length, 0, 'aperçu vidé');

  // Modifier : le formulaire se remplit et change de titre.
  page.querySelector('[data-modifier="4"]').click();
  assert.equal(page.querySelector('[name="texte"]').value, 'Un mégot pollue 500 L d’eau.');
  assert.equal(page.querySelector('cs-choix-emoji').value, '🚬');
  assert.equal(page.querySelector('[name="mots"]').value, 'chiffre-choc');
  assert.equal(page.querySelector('.anec-titre-form').textContent, '✏️ Modifier l’anecdote');
  assert.equal(page.querySelector('[data-action="annuler-edition"]').hidden, false);
  soumettre(page.querySelector('.anec-form'));
  await stabiliser();
  envoi = reseau.appels.filter((a) => a.options.method === 'POST').at(-1);
  assert.equal(envoi.adresse, '/api/evenements/anecdotes.php?action=modifier');
  assert.equal(corpsDe(envoi.options).id, '4');
  assert.equal(page.querySelector('.anec-titre-form').textContent, '➕ Nouvelle anecdote', 'retour au mode ajout');

  // Annuler une modification ne garde rien de l'anecdote.
  page.querySelector('[data-modifier="4"]').click();
  page.querySelector('[data-action="annuler-edition"]').click();
  assert.equal(page.querySelector('[name="texte"]').value, '');
  assert.equal(page.querySelector('cs-choix-emoji').value, '');
  assert.equal(page.querySelector('[data-action="annuler-edition"]').hidden, true);
  assert.equal(page.querySelector('.anec-form [type="submit"]').textContent, 'Ajouter');
});

test('anecdotes : suppression confirmée ; un refus s’affiche et la saisie reste', async () => {
  let refus = false;
  const reseau = fauxFetch((_adresse, options) => {
    if (options.method === 'POST') return refus ? { corps: { ok: false, error: 'Texte trop long.' } } : { corps: { ok: true } };
    return { corps: structuredClone(ANECDOTES) };
  });
  const page = dom.monter('<cs-admin-anecdotes></cs-admin-anecdotes>');
  await stabiliser();

  page.querySelector('[data-supprimer="5"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Supprimer cette anecdote ?');
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  const envoi = reseau.appels.find((a) => a.options.method === 'POST');
  assert.equal(envoi.adresse, '/api/evenements/anecdotes.php?action=supprimer');
  assert.deepEqual(corpsDe(envoi.options), { id: '5' });

  refus = true;
  page.querySelector('[name="texte"]').value = 'Très long';
  await enSilence(async () => {
    soumettre(page.querySelector('.anec-form'));
    await stabiliser();
  });
  assert.equal(page.querySelector('.msg-page').textContent, 'Texte trop long.');
  assert.equal(page.querySelector('[name="texte"]').value, 'Très long');
});

// ── Images ──────────────────────────────────────────────────────────────────

const IMAGES = {
  tags: [{ tag: 'nature', n: 2 }, { tag: 'hiver', n: 1 }],
  images: [
    { id: 7, url: '/api/evenements/image.php?id=7', nom: 'Ver <de terre>', taille: 34 * 1024, largeur: 400, hauteur: 300, tags: ['nature'] },
    { id: 8, url: '/api/evenements/image.php?id=8', nom: 'Flocon', taille: 900, largeur: null, hauteur: null, tags: [] },
  ],
};

test('images : grille, filtres, un tag cliqué sous une vignette filtre dessus', async () => {
  const reseau = fauxFetch(() => ({ corps: structuredClone(IMAGES) }));
  const page = dom.monter('<cs-admin-images></cs-admin-images>');
  await stabiliser();

  assert.equal(reseau.appels[0].adresse, '/api/evenements/images.php?action=liste');
  assert.equal(page.querySelector('.img-nb').textContent, '(2)');
  const cartes = page.querySelectorAll('.img-carte');
  assert.equal(cartes[0].querySelector('.img-meta').textContent, '400×300 · 34 Ko');
  assert.equal(cartes[1].querySelector('.img-meta').textContent, '900 o');
  assert.equal(cartes[0].querySelector('.img-nom').textContent, 'Ver <de terre>');
  assert.equal(cartes[0].querySelector('.img-vue').getAttribute('alt'), 'Ver <de terre>');
  // Le vocabulaire arrive aux deux sélecteurs de tags.
  assert.deepEqual(page.querySelectorAll('.img-form cs-choix-tags .tgp-chip').map((/** @type {any} */ b) => b.dataset.tag), ['nature', 'hiver']);
  assert.deepEqual(page.querySelectorAll('cs-admin-image-edition cs-choix-tags .tgp-chip').map((/** @type {any} */ b) => b.dataset.tag), ['nature', 'hiver']);

  // Cocher un tag du formulaire ne filtre pas la grille (écoute du composant enfant).
  page.querySelector('.img-form cs-choix-tags [data-tag="hiver"]').click();
  await stabiliser();
  assert.equal(reseau.appels.length, 1);

  cartes[0].querySelector('.pastille[data-tag="nature"]').click();
  await stabiliser();
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/images.php?action=liste&tag=nature');
  assert.ok(page.querySelector('.img-filtres [data-tag="nature"]').classList.contains('actif'));
  // Le rechargement garde ce qui était coché dans le formulaire.
  assert.deepEqual(page.querySelector('.img-form cs-choix-tags').valeur(), ['hiver']);
});

test('images : aperçu du fichier, limite de poids, téléversement avec ses tags', async () => {
  const reseau = fauxFetch((_adresse, options) => (options.method === 'POST' ? { corps: { ok: true, id: 9 } } : { corps: structuredClone(IMAGES) }));
  const page = dom.monter('<cs-admin-images></cs-admin-images>');
  await stabiliser();

  // Sans fichier.
  soumettre(page.querySelector('.img-form'));
  assert.equal(page.querySelector('.msg-page').textContent, 'Choisis un fichier.');

  // Trop lourd : refusé avant tout envoi.
  const champ = page.querySelector('[name="fichier"]');
  const lourd = new File([new Uint8Array(1)], 'gros.png', { type: 'image/png' });
  Object.defineProperty(lourd, 'size', { value: TAILLE_MAX_IMAGE + 1 });
  champ.files = [lourd];
  champ.dispatchEvent(new FauxEvenement('change'));
  assert.equal(page.querySelector('.img-apercu').hidden, false);
  const vue = page.querySelector('.img-apercu img');
  assert.match(vue.getAttribute('src'), /^blob:/);
  vue.naturalWidth = 1200;
  vue.naturalHeight = 800;
  vue.dispatchEvent(new FauxEvenement('load', { bubbles: false }));
  assert.equal(page.querySelector('.img-apercu .img-meta').textContent, '1200×800 · 8.0 Mo · trop lourde (8 Mo maximum)');
  soumettre(page.querySelector('.img-form'));
  assert.equal(page.querySelector('.msg-page').textContent, 'Image trop lourde (8 Mo maximum).');
  assert.equal(reseau.appels.filter((a) => a.options.method === 'POST').length, 0);

  const bon = new File([new Uint8Array(10)], 'ver.png', { type: 'image/png' });
  champ.files = [bon];
  champ.dispatchEvent(new FauxEvenement('change'));
  page.querySelector('[name="nom"]').value = ' Ver ';
  page.querySelector('.img-form cs-choix-tags [data-tag="nature"]').click();
  soumettre(page.querySelector('.img-form'));
  await stabiliser();
  const envoi = reseau.appels.find((a) => a.options.method === 'POST');
  assert.equal(envoi.adresse, '/api/evenements/images.php?action=televerser');
  assert.ok(envoi.options.body instanceof FormData);
  assert.equal(envoi.options.body.get('fichier').name, 'ver.png');
  assert.equal(envoi.options.body.get('nom'), 'Ver');
  assert.equal(envoi.options.body.get('tags'), 'nature');
  assert.equal(page.querySelector('.msg-page').textContent, 'Image ajoutée.');
  assert.equal(page.querySelector('.img-apercu').hidden, true, 'l’aperçu de l’image envoyée disparaît');
  assert.deepEqual(page.querySelector('.img-form cs-choix-tags').valeur(), []);
});

test('images : fenêtre de modification — nom obligatoire, envoi, fermeture, rechargement', async () => {
  let refus = false;
  const reseau = fauxFetch((_adresse, options) => {
    if (options.method === 'POST') return refus ? { corps: { ok: false, error: 'Image introuvable.' } } : { corps: { ok: true } };
    return { corps: structuredClone(IMAGES) };
  });
  const page = dom.monter('<cs-admin-images></cs-admin-images>');
  await stabiliser();

  page.querySelector('[data-modifier="7"]').click();
  const fenetre = page.querySelector('cs-admin-image-edition');
  assert.equal(fenetre.ouverte, true);
  assert.equal(fenetre.querySelector('.image-edition__vue').getAttribute('src'), '/api/evenements/image.php?id=7');
  assert.equal(fenetre.querySelector('.fenetre__champ').value, 'Ver <de terre>');
  assert.deepEqual(fenetre.querySelector('cs-choix-tags').valeur(), ['nature']);

  fenetre.querySelector('.fenetre__champ').value = '   ';
  fenetre.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.equal(fenetre.querySelector('.fenetre__erreur').textContent, 'Donne un nom à l’image.');
  assert.equal(reseau.appels.filter((a) => a.options.method === 'POST').length, 0);

  fenetre.querySelector('.fenetre__champ').value = 'Ver de terre';
  fenetre.querySelector('cs-choix-tags [data-tag="hiver"]').click();
  refus = true;
  await enSilence(async () => {
    fenetre.querySelector('[data-action="enregistrer"]').click();
    await stabiliser();
  });
  assert.equal(fenetre.querySelector('.fenetre__erreur').textContent, 'Image introuvable.');
  assert.equal(fenetre.ouverte, true, 'un refus laisse la fenêtre ouverte');

  refus = false;
  fenetre.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  const envoi = reseau.appels.filter((a) => a.options.method === 'POST').at(-1);
  assert.equal(envoi.adresse, '/api/evenements/images.php?action=modifier');
  assert.deepEqual(corpsDe(envoi.options), { id: '7', nom: 'Ver de terre', tags: 'nature,hiver' });
  assert.equal(fenetre.ouverte, false);
  assert.equal(page.querySelector('.msg-page').textContent, 'Image modifiée.');
  assert.equal(reseau.appels.at(-1).adresse, '/api/evenements/images.php?action=liste');
});

test('images : suppression confirmée', async () => {
  const reseau = fauxFetch((_adresse, options) => (options.method === 'POST' ? { corps: { ok: true } } : { corps: structuredClone(IMAGES) }));
  const page = dom.monter('<cs-admin-images></cs-admin-images>');
  await stabiliser();
  page.querySelector('[data-supprimer="8"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Supprimer cette image ?');
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  const envoi = reseau.appels.find((a) => a.options.method === 'POST');
  assert.equal(envoi.adresse, '/api/evenements/images.php?action=supprimer');
  assert.deepEqual(corpsDe(envoi.options), { id: '8' });
});

void g;
