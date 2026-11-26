/* ============================================================================
   L'administration des jeux (/jeux-admin) : règles et contenu de chaque jeu
   (fonctions pures), la liste, l'éditeur, et le sélecteur d'emojis.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FauxEvenement, fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { REGLES, scoreMax, avisConversion, SEUIL_COURT_DEFAUT } = await import('../../services/web/front/ui/admin/jeux/regles-jeux.js');
const contenu = await import('../../services/web/front/ui/admin/jeux/contenu-jeux.js');
const { ADRESSE_JEUX } = await import('../../services/web/front/ui/admin/jeux/adresses.js');
await import('../../services/web/front/ui/admin/jeux/jeux.js');
const { slugDe, messagesDe } = await import('../../services/web/front/ui/admin/jeux/jeu.js');
await import('../../services/web/front/ui/composants/choix-emoji/choix-emoji.js');

const g = /** @type {any} */ (globalThis);

const CATEGORIES = { oui: 'Au compost', attention: 'Avec prudence', non: 'Poubelle' };

const JEU = {
  slug: 'compost-ou-pas', nom: 'Compost ou pas', emoji: '🌱', description: 'Classe les déchets', statut: 'publie', xp_reserve: 30,
  regles: { nb_items: 5 },
  messages: [{ min: 0, emoji: '💪', texte: 'Courage' }, { min: 0.8, emoji: '🏆', texte: 'Bravo' }],
  items: [
    { emoji: '🍌', nom: 'Peau de banane', cat: 'oui', info: 'Oui' },
    { emoji: '🥩', nom: 'Viande', cat: 'non', info: 'Non', vieux: 'ignoré' },
  ],
  score_max: 5, maj_at: '2026-11-20 10:00:00', maj_par: 'lea',
};
const VERSIONS = [{ id: 3, auteur: 'lea', date: '2026-11-19 09:00:00', nb_items: 2, score_max: 5, statut: 'publie' }];

const TEMPS = {
  slug: 'temps-decompo', nom: 'Combien de temps ?', emoji: '⏳', description: 'Estime', statut: 'publie', xp_reserve: 40,
  regles: { nb_courts: 1, nb_longs: 2, seuil_court: 365, seuils: [{ d: 0.05, pts: 3, label: 'Pile' }, { d: 0.1, pts: 2, label: 'Proche' }, { d: 0.2, pts: 1, label: 'Bof' }] },
  messages: [{ min: 0, emoji: '', texte: 'A' }, { min: 0.5, emoji: '', texte: 'B' }],
  items: [{ emoji: '🍎', nom: 'un trognon', jours: 60, info: '' }, { emoji: '🧴', nom: 'une bouteille', jours: 160000, info: '' }],
  score_max: 9, maj_at: null, maj_par: null,
};

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

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

// ── Règles ──────────────────────────────────────────────────────────────────

test('scoreMax : même calcul que jeux_score_max (games-api/jeux/_jeux.php), jeu par jeu', () => {
  assert.equal(scoreMax('mot-mystere', { nb_mots: 8, points: [5, 3, 1] }), 40);
  assert.equal(scoreMax('compost-ou-pas', { nb_items: 12 }), 12);
  assert.equal(scoreMax('temps-decompo', { nb_courts: 2, nb_longs: 3, seuils: [{ pts: 3 }] }), 15);
  assert.equal(scoreMax('tri-eclair', { nb_items: 20 }), 20);
  assert.ok(Number.isNaN(scoreMax('compost-ou-pas', { nb_items: NaN })));
  assert.ok(Number.isNaN(scoreMax('inconnu', {})));
});

test('règles : formulaire décrit, relu tel qu’envoyé au serveur', () => {
  const blocs = REGLES['temps-decompo'].blocs(TEMPS.regles);
  const champs = blocs.flat();
  assert.deepEqual(champs.map((c) => c.id), ['courts', 'longs', 'seuil', 'd0', 'pts0', 'label0', 'd1', 'pts1', 'label1', 'd2', 'pts2', 'label2']);
  assert.equal(champs.find((c) => c.id === 'd1')?.valeur, 10, 'tolérance en %');
  assert.equal(REGLES['temps-decompo'].blocs({ ...TEMPS.regles, seuil_court: undefined }).flat().find((c) => c.id === 'seuil')?.valeur, SEUIL_COURT_DEFAUT);
  /** @type {Record<string, string>} */
  const saisie = { courts: '1', longs: '2', seuil: '', d0: '5', pts0: '3', label0: 'Pile', d1: '10', pts1: '2', label1: 'Proche', d2: '20', pts2: '1', label2: 'Bof' };
  const lu = REGLES['temps-decompo'].lire({ nombre: (id) => (saisie[id] === '' ? NaN : Number(saisie[id])), texte: (id) => saisie[id] });
  assert.equal(lu.nb_longs, 2);
  assert.ok(Number.isNaN(lu.seuil_court), 'une case vide part telle quelle : le serveur la refuse nommément');
  assert.deepEqual(lu.seuils[1], { d: 0.1, pts: 2, label: 'Proche' });
});

test('avisConversion : seulement si le score max change et que des parties existent', () => {
  assert.equal(avisConversion(5, 6, 12), 'Il passera de 5 à 6 : les 12 parties déjà jouées seront converties à la nouvelle échelle (5/5 → 6/6).');
  assert.equal(avisConversion(5, 6, 1), 'Il passera de 5 à 6 : les 1 partie déjà jouée sera convertie à la nouvelle échelle (5/5 → 6/6).');
  assert.equal(avisConversion(5, 5, 12), '');
  assert.equal(avisConversion(5, 6, 0), '');
  assert.equal(avisConversion(5, NaN, 12), '');
});

// ── Contenu ─────────────────────────────────────────────────────────────────

test('contenu : résumé, avec ce qui manque aux règles', () => {
  assert.deepEqual(contenu.resumeContenu('compost-ou-pas', JEU.items, { nb_items: 5 }, CATEGORIES), [
    { texte: '2 éléments (5 par partie)', ko: true },
    { texte: ' — 1 au compost · 0 avec prudence · 1 poubelle', ko: false },
  ]);
  assert.deepEqual(contenu.resumeContenu('mot-mystere', [{ mot: 'ver' }], { nb_mots: 1 }, undefined), [{ texte: '1 mot (1 par partie)', ko: false }]);
  const temps = contenu.resumeContenu('temps-decompo', TEMPS.items, TEMPS.regles, undefined);
  assert.equal(temps.map((m) => m.texte).join(''), '1 déchet court (1 par partie) · 1 déchet long (2 par partie)');
  assert.deepEqual(temps.map((m) => m.ko), [false, false, true]);
});

test('contenu : filtre sans accents (catégorie par son libellé), durée lisible, date', () => {
  assert.ok(contenu.correspond(JEU.items[0], 'BANANE', CATEGORIES));
  assert.ok(contenu.correspond(JEU.items[1], 'poubelle', CATEGORIES));
  assert.ok(contenu.correspond({ nom: 'Épluchure' }, 'epluch', CATEGORIES));
  assert.ok(!contenu.correspond(JEU.items[0], 'viande', CATEGORIES));
  assert.ok(contenu.correspond(JEU.items[0], '  ', CATEGORIES));
  assert.equal(contenu.aideJours(60, 365), '≈ 2 mois · court');
  assert.equal(contenu.aideJours(800, 365), '≈ 2 ans · long');
  assert.equal(contenu.aideJours('', 365), '');
  assert.equal(contenu.seuilCourt({ seuil_court: NaN }), 365);
  assert.equal(contenu.dateFr('2026-11-20 10:05:00'), '20/11/2026 à 10:05');
});

test('slugDe, messagesDe', () => {
  assert.equal(slugDe('/jeux-admin/mot-mystere'), 'mot-mystere');
  assert.equal(slugDe('/jeux-admin/v2/mot-mystere'), '', 'l’adresse provisoire n’existe plus');
  assert.equal(slugDe('/jeux-admin/tri-eclair'), 'tri-eclair');
  assert.equal(slugDe('/jeux-admin'), '');
  assert.deepEqual(messagesDe([{ min: '80', emoji: '🏆', texte: 'Bravo' }, { min: '', emoji: '', texte: '' }]),
    [{ min: 0.8, emoji: '🏆', texte: 'Bravo' }, { min: '', emoji: '', texte: '' }]);
});

// ── La liste ────────────────────────────────────────────────────────────────

const LISTE = [
  { slug: 'mot-mystere', nom: 'Mot <mystère>', emoji: '🔤', description: 'Devine', statut: 'publie', nb_items: 30, score_max: 40, parties: 1, joueurs: 1, maj_at: '2026-11-20 10:00:00', maj_par: 'lea' },
  { slug: 'tri-eclair', nom: 'Tri éclair', emoji: '⚡', description: 'Vite', statut: 'brouillon', nb_items: 1, score_max: 20, parties: 0, joueurs: 0, maj_at: null, maj_par: null },
];

test('liste : un jeu par carte, liens vers l’éditeur, ordre changé puis enregistré', async () => {
  /** @type {any[]} */
  const ordres = [];
  const reseau = fauxFetch((adresse, options) => {
    if (options.method === 'POST') { ordres.push(JSON.parse(options.body)); return { corps: { ok: true } }; }
    return { corps: { jeux: structuredClone(LISTE) } };
  });
  const page = dom.monter('<cs-admin-jeux></cs-admin-jeux>');
  await stabiliser();
  assert.equal(reseau.appels[0].adresse, '/api/jeux/admin.php?action=liste');
  const cartes = page.querySelectorAll('.carte');
  assert.equal(cartes.length, 2);
  assert.equal(cartes[0].querySelector('.carte-nom').textContent, 'Mot <mystère>');
  assert.equal(cartes[0].querySelector('.carte-nom').getAttribute('href'), ADRESSE_JEUX + '/mot-mystere');
  assert.equal(cartes[0].querySelector('.carte-maj').textContent, 'Modifié le 20/11/2026 à 10:00 par lea');
  assert.equal(cartes[1].querySelector('.puce.brouillon').textContent, 'Brouillon');
  assert.equal(cartes[1].querySelector('.carte-maj'), null);
  assert.match(cartes[0].querySelectorAll('.puce')[3].textContent, /1 partie · 1 joueur/);
  assert.equal(cartes[0].querySelector('[data-sens="haut"]').disabled, true);

  cartes[0].querySelector('[data-sens="bas"]').click();
  await stabiliser();
  assert.equal(page.querySelectorAll('.carte')[0].querySelector('.carte-nom').textContent, 'Tri éclair');
  assert.deepEqual(ordres, [{ slugs: ['tri-eclair', 'mot-mystere'] }]);
  assert.equal(reseau.appels[1].adresse, '/api/jeux/admin.php?action=ordre');
  assert.equal(page.querySelector('.msg').textContent, 'Ordre enregistré.');
});

test('liste : ordre refusé, la phrase du serveur en rouge', async () => {
  await enSilence(async () => {
    fauxFetch((adresse, options) => (options.method === 'POST' ? { corps: { error: 'Ordre invalide.' } } : { corps: { jeux: structuredClone(LISTE) } }));
    const page = dom.monter('<cs-admin-jeux></cs-admin-jeux>');
    await stabiliser();
    page.querySelector('[data-sens="bas"]').click();
    await stabiliser();
    assert.equal(page.querySelector('.msg').textContent, 'Ordre invalide.');
    assert.equal(page.querySelector('.msg').className, 'msg ko');
  });
});

// ── L'éditeur ───────────────────────────────────────────────────────────────

/**
 * @param {{ jeu?: any, parties?: number, sauver?: (corps: any, action: string) => any }} [options]
 */
function serveur({ jeu = JEU, parties = 12, sauver = () => ({ corps: { ok: true } }) } = {}) {
  /** @type {{ action: string, corps: any }[]} */
  const envois = [];
  const reseau = fauxFetch((adresse, options) => {
    const action = new URL(adresse, 'https://composmart.test').searchParams.get('action') || '';
    if (options.method === 'POST') {
      const corps = JSON.parse(options.body);
      envois.push({ action, corps });
      return sauver(corps, action);
    }
    return { corps: {
      jeu: structuredClone(jeu),
      moteur: jeu.slug === 'compost-ou-pas' ? { categories: CATEGORIES } : {},
      versions: structuredClone(VERSIONS), parties, joueurs: 4,
    } };
  });
  return Object.assign(reseau, { envois });
}

/** @param {string} slug @param {ReturnType<typeof serveur>} [reseau] */
async function ouvrir(slug = 'compost-ou-pas', reseau = serveur()) {
  dom.aller(ADRESSE_JEUX + '/' + slug);
  const editeur = dom.monter('<cs-admin-jeu></cs-admin-jeu>');
  await stabiliser();
  return { editeur, reseau };
}

test('éditeur : le jeu ouvert remplit présentation, règles, contenu, paliers, historique', async () => {
  const { editeur, reseau } = await ouvrir();
  assert.equal(reseau.appels[0].adresse, '/api/jeux/admin.php?action=jeu&slug=compost-ou-pas');
  assert.equal(editeur.querySelector('h1').textContent, 'Compost ou pas');
  assert.equal(editeur.querySelector('.tete-stats').textContent, 'Publié · 12 parties jouées · 4 joueurs · modifié le 20/11/2026 à 10:00 par lea');
  assert.equal(editeur.querySelector('.tete a').getAttribute('href'), '/jeu-compost-ou-pas');
  assert.equal(editeur.querySelector('[data-champ="nom"]').value, 'Compost ou pas');
  assert.equal(editeur.querySelector('cs-choix-emoji').value, '🌱');
  assert.equal(editeur.querySelector('[data-champ="xp"]').value, '30');
  assert.equal(editeur.querySelector('[data-regle="nb"]').value, '5');
  assert.equal(editeur.querySelector('.score-max').textContent, "Score max d'une partie : 5");
  assert.equal(editeur.querySelectorAll('cs-admin-jeu-contenu .ligne').length, 2);
  assert.equal(editeur.querySelector('[data-i="1"][data-k="cat"]').value, 'non');
  assert.match(editeur.querySelector('cs-admin-jeu-contenu .resume').textContent, /2 éléments \(5 par partie\)/);
  assert.equal(editeur.querySelectorAll('.palier').length, 2);
  assert.equal(editeur.querySelector('[data-palier="1"][data-p="min"]').value, '80');
  assert.equal(editeur.querySelector('.version-date').textContent, '19/11/2026 à 09:00 · lea');
  assert.equal(editeur.querySelector('.barre-etat').textContent, 'Aucune modification.');
  assert.equal(editeur.querySelectorAll('.liens a')[1].getAttribute('href'), ADRESSE_JEUX);
});

test('éditeur : enregistrer sans rien toucher renvoie le jeu tel qu’il a été lu (colonnes du jeu seulement)', async () => {
  const { editeur, reseau } = await ouvrir();
  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.deepEqual(reseau.envois, [{ action: 'sauver', corps: {
    slug: 'compost-ou-pas', nom: 'Compost ou pas', emoji: '🌱', description: 'Classe les déchets', statut: 'publie', xp_reserve: 30,
    regles: { nb_items: 5 },
    messages: [{ min: 0, emoji: '💪', texte: 'Courage' }, { min: 0.8, emoji: '🏆', texte: 'Bravo' }],
    items: [{ emoji: '🍌', nom: 'Peau de banane', cat: 'oui', info: 'Oui' }, { emoji: '🥩', nom: 'Viande', cat: 'non', info: 'Non' }],
  } }]);
  assert.equal(editeur.querySelector('.barre-etat').textContent, 'Enregistré ✓');
});

test('éditeur : règles modifiées, score max en direct, conversion confirmée avant d’enregistrer', async () => {
  const { editeur, reseau } = await ouvrir();
  editeur.querySelector('[data-regle="nb"]').saisir('6');
  assert.equal(editeur.querySelector('.barre-etat').textContent, 'Modifications non enregistrées.');
  assert.match(editeur.querySelector('.score-max').textContent, /Score max d'une partie : 6Il passera de 5 à 6 : les 12 parties/);
  assert.match(editeur.querySelector('cs-admin-jeu-contenu .resume').textContent, /\(6 par partie\)/);

  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Le score maximum change : 5 → 6');
  boite().querySelector('[data-reponse="non"]').click();
  await stabiliser();
  assert.equal(reseau.envois.length, 0);

  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  assert.deepEqual(reseau.envois[0].corps.regles, { nb_items: 6 });
});

test('éditeur : repasser en brouillon se confirme', async () => {
  const { editeur, reseau } = await ouvrir();
  editeur.querySelector('[data-champ="statut"]').choisir('brouillon');
  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Repasser ce jeu en brouillon ?');
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  assert.equal(reseau.envois[0].corps.statut, 'brouillon');
});

test('éditeur : contenu filtré, ligne ajoutée en tête, ligne retirée', async () => {
  const { editeur, reseau } = await ouvrir();
  const bloc = editeur.querySelector('cs-admin-jeu-contenu');
  bloc.querySelector('.recherche').saisir('viande');
  assert.deepEqual(bloc.querySelectorAll('.ligne').map((/** @type {any} */ l) => l.hidden), [true, false]);

  bloc.querySelector('[data-action="ajouter"]').click();
  assert.equal(bloc.querySelector('.recherche').value, '', 'le filtre s’efface pour montrer la ligne neuve');
  const lignes = bloc.querySelectorAll('.ligne');
  assert.equal(lignes.length, 3);
  assert.ok(lignes[0].classList.contains('neuve'));
  assert.equal(lignes[0].querySelector('.ligne-n').textContent, '1');
  assert.equal(dom.document.activeElement, lignes[0].querySelector('[data-k]'));
  assert.equal(lignes[0].querySelector('[data-k="cat"]').value, 'oui');
  lignes[0].querySelector('[data-k="nom"]').saisir('Marc de café');
  assert.match(bloc.querySelector('.resume').textContent, /3 éléments/);

  bloc.querySelector('[data-retirer="2"]').click();
  assert.equal(bloc.querySelectorAll('.ligne').length, 2);
  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.deepEqual(reseau.envois[0].corps.items.map((/** @type {any} */ i) => i.nom), ['Marc de café', 'Peau de banane']);
});

test('éditeur : paliers, au moins deux et au plus six', async () => {
  const { editeur } = await ouvrir();
  editeur.querySelector('[data-retirer-palier="0"]').click();
  assert.equal(editeur.querySelector('.barre-etat').textContent, 'Il faut au moins deux paliers.');
  for (let i = 0; i < 4; i++) editeur.querySelector('[data-action="ajouter-palier"]').click();
  assert.equal(editeur.querySelectorAll('.palier').length, 6);
  editeur.querySelector('[data-action="ajouter-palier"]').click();
  assert.equal(editeur.querySelector('.barre-etat').textContent, 'Six paliers au maximum.');
  assert.equal(editeur.querySelectorAll('.palier').length, 6);
});

test('éditeur : emoji choisi dans la grille, la page le compte comme une modification', async () => {
  const { editeur, reseau } = await ouvrir();
  const choix = editeur.querySelector('cs-choix-emoji');
  choix.querySelector('.choix-emoji__bouton').click();
  assert.equal(choix.querySelector('.choix-emoji__grille').hidden, false);
  choix.querySelector('[data-emoji="🪱"]').click();
  assert.equal(choix.value, '🪱');
  assert.equal(choix.querySelector('.choix-emoji__grille').hidden, true);
  assert.equal(editeur.querySelector('.barre-etat').textContent, 'Modifications non enregistrées.');
  const avant = /** @type {any} */ (new FauxEvenement('beforeunload'));
  g.dispatchEvent(avant);
  assert.equal(avant.returnValue, '');
  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.equal(reseau.envois[0].corps.emoji, '🪱');
});

test('éditeur : restaurer une version après confirmation', async () => {
  const { editeur, reseau } = await ouvrir();
  editeur.querySelector('[data-restaurer="3"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Restaurer la version du 19/11/2026 à 09:00 ?');
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  assert.deepEqual(reseau.envois, [{ action: 'restaurer', corps: { slug: 'compost-ou-pas', version_id: 3 } }]);
  assert.equal(editeur.querySelector('.barre-etat').textContent, 'Version restaurée ✓');
});

test('éditeur : refus du serveur, l’erreur nommée dans la barre', async () => {
  await enSilence(async () => {
    const { editeur } = await ouvrir('compost-ou-pas', serveur({ sauver: () => ({ corps: { error: 'Ligne 2 : le nom est obligatoire.' } }) }));
    editeur.querySelector('[data-action="enregistrer"]').click();
    await stabiliser();
    assert.equal(editeur.querySelector('.barre-etat').textContent, 'Ligne 2 : le nom est obligatoire.');
    assert.equal(editeur.querySelector('.barre-etat').className, 'barre-etat ko');
    assert.equal(editeur.querySelector('[data-action="enregistrer"]').disabled, false);
  });
});

test('éditeur « Combien de temps ? » : la limite court / long reclasse les durées', async () => {
  const { editeur } = await ouvrir('temps-decompo', serveur({ jeu: TEMPS }));
  const aides = () => editeur.querySelectorAll('cs-admin-jeu-contenu .ch-jours .aide').map((/** @type {any} */ a) => a.textContent);
  assert.deepEqual(aides(), ['≈ 2 mois · court', '≈ 438 ans · long']);
  editeur.querySelector('[data-regle="seuil"]').saisir('30');
  assert.deepEqual(aides(), ['≈ 2 mois · long', '≈ 438 ans · long']);
  assert.match(editeur.querySelector('cs-admin-jeu-contenu .resume').textContent, /0 déchet court \(1 par partie\) · 2 déchets longs/);
  editeur.querySelector('[data-i="0"][data-k="jours"]').saisir('10');
  assert.equal(aides()[0], '≈ 10 jours · court');
});

test('choix d’emoji seul : valeur posée avant montage, un clic ailleurs referme la grille', async () => {
  const choix = dom.monter('<cs-choix-emoji libelle="Emoji du palier"></cs-choix-emoji>');
  choix.value = '🌻';
  await stabiliser();
  assert.equal(choix.querySelector('.choix-emoji__champ').value, '🌻');
  assert.equal(choix.querySelector('.choix-emoji__champ').getAttribute('aria-label'), 'Emoji du palier');
  assert.equal(choix.querySelector('.choix-emoji__bouton').textContent, '🌻');
  choix.querySelector('.choix-emoji__bouton').click();
  const ailleurs = dom.monter('<p>ailleurs</p>');
  const clic = new FauxEvenement('click');
  clic.target = ailleurs;
  dom.document.dispatchEvent(clic);
  assert.equal(choix.querySelector('.choix-emoji__grille').hidden, true);
  choix.querySelector('.choix-emoji__bouton').click();
  choix.querySelector('.choix-emoji__aucun').click();
  assert.equal(choix.value, '');
  assert.equal(choix.querySelector('.choix-emoji__bouton').textContent, '😀');
});
