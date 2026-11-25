/* ============================================================================
   La carte, ce qui écrit en base : proposer un composteur (compte connecté),
   le modifier ou le supprimer (administrateur), traiter les signalements.
   Les droits sont vérifiés par map-api ; ici, on vérifie que la page propose
   les bons boutons et envoie exactement ce que le serveur attend.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxFetch, installerFauxDom } from './faux-dom.mjs';
import { FauxFond } from './faux-fond-carte.mjs';

const dom = installerFauxDom();
const { session } = await import('../../services/web/front/ui/socle/session.js');
const { Carte } = await import('../../services/web/front/ui/pages/carte/carte.js');
const { corpsFormulaire } = await import('../../services/web/front/ui/pages/carte/carte-fiche.js');
const { ELEMENTS_REGLES } = await import('../../services/web/front/ui/pages/carte/carte-libelles.js');

/** @type {FauxFond | null} */
let fond = null;
Carte.fabriquerFond = (element, vue, reglages) => {
  fond = new FauxFond(element, vue, reglages);
  return /** @type {any} */ (fond);
};

const VISITEUR = { logged_in: false };
const MEMBRE = { logged_in: true, id: 7, username: 'lea', email: 'lea@exemple.fr', xp: 0, niveau: 1, isAdmin: false, email_verifie: true };
const ADMIN = { ...MEMBRE, isAdmin: true };

const POINTS = [{ id: 2, lat: 48.2, lon: 2.2, t: 'X' }];
const DETAIL = [{
  autor: ['marc de café'],
  inter: ['viande'],
  donnees: { type: 'Compost bois', acces: 'public', gestion: 'Mairie de Rennes', info_gestion: null },
}];
const SIGNALEMENTS = [
  { id: 31, compost_id: 2, motif: 'position', commentaire: 'Il est <en face>', date: '2026-11-20 10:00:00', par: 'lea', lat: 48.2, lon: 2.2 },
];

/**
 * @param {{ moi?: any, enregistrer?: (c: URLSearchParams) => any, verifier?: any, supprimer?: any, signalements?: (c: URLSearchParams | null) => any }} [options]
 */
function serveur({
  moi = MEMBRE,
  enregistrer = (c) => ({ corps: c.get('id') ? 'Modification enregistrée.' : 42 }),
  verifier = { corps: { ok: true } },
  supprimer = { corps: 'Compost supprimé.' },
  signalements = () => ({ corps: { signalements: SIGNALEMENTS } }),
} = {}) {
  /** @type {URLSearchParams[]} */
  const ecritures = [];
  const reseau = fauxFetch((adresse, options) => {
    const chemin = adresse.split('?')[0];
    if (chemin === '/api/auth/me.php') return { corps: moi };
    if (chemin === '/api/carte/count.php') return { corps: { composts: 1 } };
    if (chemin === '/api/carte/signalement.php') return signalements(options.method === 'POST' ? options.body : null);
    if (chemin.startsWith('https://nominatim')) return { corps: { address: {} } };
    if (chemin === '/api/carte/sites.php') {
      /** @type {URLSearchParams} */
      const c = options.body;
      if (c.get('autorinter')) return { corps: DETAIL };
      if (c.get('lat_click')) return verifier;
      if (c.get('supprimer')) { ecritures.push(c); return supprimer; }
      if (c.get('type')) { ecritures.push(c); return enregistrer(c); }
      return { corps: POINTS };
    }
    return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
  });
  return Object.assign(reseau, { ecritures });
}

async function stabiliser() {
  for (let i = 0; i < 5; i++) await dom.stabiliser();
}

/** @param {ReturnType<typeof serveur>} [reseau] */
async function monter(reseau = serveur()) {
  const carte = dom.monter('<cs-carte></cs-carte>');
  await stabiliser();
  return { carte, reseau, fond: /** @type {FauxFond} */ (fond) };
}

/** La boîte de dialogue la plus récente. */
const boite = () => dom.document.querySelectorAll('cs-dialogue').at(-1);

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
  session.oublier();
  dom.vider();
  fond = null;
  await dom.stabiliser();
});

// ── Corps de la requête ─────────────────────────────────────────────────────

test('corpsFormulaire : position pour une création, id pour une modification, règles en tableaux', () => {
  const f = { type: 'Compost bois', acces: 'privé', mettre: ['os', 'huile'], pas_mettre: ['viande'], gestion: 'Mairie', info_gestion: '' };
  assert.deepEqual([...corpsFormulaire(f, { id: 0, lat: 48.1, lon: 2.2 })], [
    ['type', 'Compost bois'], ['acces', 'privé'], ['mettre[]', 'os'], ['mettre[]', 'huile'], ['pas_mettre[]', 'viande'],
    ['gestion', 'Mairie'], ['info_gestion', ''], ['lat', '48.1'], ['lon', '2.2'],
  ]);
  const modification = corpsFormulaire(f, { id: 9, lat: 48.1, lon: 2.2 });
  assert.equal(modification.get('id'), '9');
  assert.equal(modification.get('lat'), null, 'pas de position : c’est l’id qui désigne le point');
});

// ── Proposer un composteur ──────────────────────────────────────────────────

test('visiteur : un clic sur la carte invite à se connecter, aucun outil d’administration', async () => {
  const { carte, fond } = await monter(serveur({ moi: VISITEUR }));
  fond.clic(48.3, 2.4);
  await stabiliser();
  const zone = carte.querySelector('.rajouter');
  assert.equal(zone.hidden, false);
  assert.match(zone.textContent, /Connecte-toi pour proposer un composteur ici/);
  assert.equal(zone.querySelector('a').getAttribute('href'), '/login');
  assert.equal(carte.querySelector('.signal-bouton').hidden, true);
  fond.cliquerPoint(2);
  await stabiliser();
  assert.equal(carte.querySelector('[data-action="modifier"]'), null);
  assert.equal(carte.querySelector('[data-action="supprimer"]'), null);
  assert.equal(zone.hidden, true, 'ouvrir une fiche referme le panneau d’ajout');
});

test('membre : proposer un composteur, de la vérification de position à l’envoi de la demande', async () => {
  const reseau = serveur();
  const { carte, fond } = await monter(reseau);
  fond.clic(48.3, 2.4);
  await stabiliser();
  carte.querySelector('[data-action="rajouter"]').click();
  await stabiliser();
  const verification = reseau.appels.find((a) => a.options.body instanceof URLSearchParams && a.options.body.get('lat_click'));
  assert.deepEqual(Object.fromEntries(verification.options.body), { lat_click: '48.3', lon_click: '2.4' });
  assert.equal(reseau.ecritures.length, 0, 'rien n’est écrit avant l’envoi du formulaire');
  assert.equal(carte.querySelector('.rajouter').hidden, true);

  const fiche = carte.querySelector('cs-carte-fiche');
  assert.equal(fiche.querySelector('.tabl').hidden, false);
  assert.equal(fiche.querySelectorAll('[data-regle="mettre"]').length, ELEMENTS_REGLES.length);
  assert.equal(fiche.querySelector('[data-action="enregistrer"]').textContent, '📤 Envoyer la demande');
  assert.equal(fiche.querySelector('[data-action="supprimer"]'), null);
  assert.equal(fiche.querySelector('[data-action="signaler"]'), null, 'on ne signale pas ce qu’on propose');

  fiche.querySelector('[data-champ="type"]').choisir('Compost bois');
  fiche.querySelector('[data-champ="acces"]').choisir('privé');
  fiche.querySelector('[data-regle="mettre"][value="os"]').cocher(true);
  fiche.querySelector('[data-regle="pas_mettre"][value="viande"]').cocher(true);
  fiche.querySelector('[data-champ="gestion"]').saisir('Association du quartier');
  fiche.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();

  assert.deepEqual([...reseau.ecritures[0]], [
    ['type', 'Compost bois'], ['acces', 'privé'], ['mettre[]', 'os'], ['pas_mettre[]', 'viande'],
    ['gestion', 'Association du quartier'], ['info_gestion', ''], ['lat', '48.3'], ['lon', '2.4'],
  ]);
  assert.equal(fiche.querySelector('.tabl').hidden, true);
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Merci ! Ta demande a été envoyée.');
  assert.ok(fond.a('retirerClic').length >= 1);
});

test('membre : un point existe déjà à cet endroit, on le dit sans ouvrir le formulaire', async () => {
  await enSilence(async () => {
    const { carte, fond } = await monter(serveur({ verifier: { corps: { error: 'Un point identique existe déjà à moins de 5 m.' } } }));
    fond.clic(48.3, 2.4);
    await stabiliser();
    carte.querySelector('[data-action="rajouter"]').click();
    await stabiliser();
    assert.equal(carte.querySelector('.rajouter').textContent, '⚠️ Un point identique existe déjà à moins de 5 m.');
    assert.equal(carte.querySelector('cs-carte-fiche .tabl').hidden, true);
  });
});

test('membre : demande refusée par le serveur, la phrase dans la fiche, le formulaire reste', async () => {
  await enSilence(async () => {
    const { carte, fond } = await monter(serveur({ enregistrer: () => ({ corps: { error: "Trop d'ajouts récents. Réessaie plus tard." } }) }));
    fond.clic(48.3, 2.4);
    await stabiliser();
    carte.querySelector('[data-action="rajouter"]').click();
    await stabiliser();
    const fiche = carte.querySelector('cs-carte-fiche');
    fiche.querySelector('[data-action="enregistrer"]').click();
    await stabiliser();
    assert.equal(fiche.querySelector('.fiche-erreur').textContent, "⚠️ Trop d'ajouts récents. Réessaie plus tard.");
    assert.equal(fiche.querySelector('.tabl').hidden, false);
    assert.equal(fiche.querySelector('[data-action="enregistrer"]').disabled, false);
  });
});

// ── Administrateur : modifier, supprimer ────────────────────────────────────

test('admin : modifier un composteur, formulaire prérempli, l’icône suit le nouveau type', async () => {
  const reseau = serveur({ moi: ADMIN });
  const { carte, fond } = await monter(reseau);
  fond.cliquerPoint(2);
  await stabiliser();
  const fiche = carte.querySelector('cs-carte-fiche');
  assert.ok(fiche.querySelector('[data-action="supprimer"]'));
  fiche.querySelector('[data-action="modifier"]').click();

  assert.equal(fiche.querySelector('[data-champ="type"]').value, 'Compost bois');
  assert.equal(fiche.querySelector('[data-champ="acces"]').value, 'public');
  assert.equal(fiche.querySelector('[data-regle="mettre"][value="marc de café"]').checked, true);
  assert.equal(fiche.querySelector('[data-regle="pas_mettre"][value="viande"]').checked, true);
  assert.equal(fiche.querySelector('[data-regle="mettre"][value="os"]').checked, false);
  assert.equal(fiche.querySelector('[data-champ="gestion"]').value, 'Mairie de Rennes');
  assert.equal(fiche.querySelector('[data-champ="info_gestion"]').value, '', '« Pas de données » n’est pas une valeur');
  assert.equal(fiche.querySelector('[data-action="enregistrer"]').textContent, '💾 Enregistrer');

  fiche.querySelector('[data-champ="type"]').choisir('Conteneur');
  fiche.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  const envoi = reseau.ecritures[0];
  assert.equal(envoi.get('id'), '2');
  assert.equal(envoi.get('type'), 'Conteneur');
  assert.deepEqual(envoi.getAll('mettre[]'), ['marc de café']);
  assert.equal(envoi.get('lat'), null);
  assert.deepEqual(fond.a('changerType'), [['changerType', 2, true]]);
  assert.equal(fiche.querySelector('.badge-type').textContent, 'Compost bois', 'fiche relue après enregistrement');
});

test('admin : supprimer après confirmation, le point disparaît sans recharger la page', async () => {
  const reseau = serveur({ moi: ADMIN });
  const { carte, fond } = await monter(reseau);
  fond.cliquerPoint(2);
  await stabiliser();
  const fiche = carte.querySelector('cs-carte-fiche');
  fiche.querySelector('[data-action="supprimer"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Supprimer ce composteur ?');
  boite().querySelector('[data-reponse="non"]').click();
  await stabiliser();
  assert.equal(reseau.ecritures.length, 0, 'renoncer n’envoie rien');

  fiche.querySelector('[data-action="supprimer"]').click();
  await stabiliser();
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  assert.deepEqual(Object.fromEntries(reseau.ecritures[0]), { supprimer: '2' });
  assert.deepEqual(fond.a('retirer'), [['retirer', 2]]);
  assert.equal(fiche.querySelector('.tabl').hidden, true);
});

test('admin : suppression refusée, la phrase du serveur dans la fiche', async () => {
  await enSilence(async () => {
    const { carte, fond } = await monter(serveur({ moi: ADMIN, supprimer: { statut: 403, corps: { error: 'Action réservée aux administrateurs.' } } }));
    fond.cliquerPoint(2);
    await stabiliser();
    const fiche = carte.querySelector('cs-carte-fiche');
    fiche.querySelector('[data-action="supprimer"]').click();
    await stabiliser();
    boite().querySelector('[data-reponse="oui"]').click();
    await stabiliser();
    assert.equal(fiche.querySelector('.fiche-erreur').textContent, '⚠️ Action réservée aux administrateurs.');
    assert.equal(fond.a('retirer').length, 0);
  });
});

// ── Administrateur : signalements ───────────────────────────────────────────

test('admin : signalements ouverts, voir le point, marquer résolu', async () => {
  /** @type {URLSearchParams[]} */
  const traitements = [];
  const reseau = serveur({ moi: ADMIN, signalements: (c) => {
    if (c) { traitements.push(c); return { corps: { ok: true } }; }
    return { corps: { signalements: traitements.length ? [] : SIGNALEMENTS } };
  } });
  const { carte, fond } = await monter(reseau);
  const panneau = carte.querySelector('cs-carte-signalements');
  assert.equal(panneau.querySelector('.signal-bouton').hidden, false);
  assert.equal(panneau.querySelector('.signal-nombre').textContent, '1');
  panneau.querySelector('[data-action="basculer"]').click();
  assert.equal(panneau.querySelector('.signal-panneau').hidden, false);
  assert.equal(panneau.querySelector('.signal-commentaire').textContent, '« Il est <en face> »');
  assert.match(panneau.querySelector('.signal-meta').textContent, /Compost #2 · par lea · 2026-11-20/);

  panneau.querySelector('[data-voir="31"]').click();
  await stabiliser();
  assert.deepEqual(fond.a('voler'), [['voler', 48.2, 2.2, 17]]);
  assert.equal(carte.querySelector('cs-carte-fiche .tabl').hidden, false);

  panneau.querySelector('[data-traiter="31"][data-statut="resolu"]').click();
  await stabiliser();
  assert.deepEqual(Object.fromEntries(traitements[0]), { action: 'traiter', id: '31', statut: 'resolu' });
  assert.equal(panneau.querySelector('.signal-nombre').textContent, '0');
  assert.equal(panneau.querySelector('.signal-vide').textContent, 'Aucun signalement ouvert 🎉');
});
