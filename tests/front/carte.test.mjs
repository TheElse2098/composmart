/* ============================================================================
   La carte (/carte) : fonctions pures, puis <cs-carte> et <cs-carte-fiche>
   montés avec une imitation de FondCarte (Leaflet n'existe pas sous Node).
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FauxEvenement, fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const outils = await import('../../services/web/front/ui/pages/carte/carte-outils.js');
const { Carte, champsZone } = await import('../../services/web/front/ui/pages/carte/carte.js');

const g = /** @type {any} */ (globalThis);

// ── Imitation de FondCarte ──────────────────────────────────────────────────

/** @type {FauxFond | null} */
let fond = null;

class FauxFond {
  /** @param {any} element @param {any} vue @param {{ allerAuDefaut: () => void }} reglages */
  constructor(element, vue, reglages) {
    this.element = element;
    this.vue = vue;
    this.reglages = reglages;
    /** @type {[string, ...any[]][]} */
    this.appels = [];
    /** @type {Map<number, { point: any, clic: (p: any) => void }>} */
    this.points = new Map();
    this.zoom = vue.zoom;
    /** @type {[number, number]} */
    this.centre = vue.centre;
    this.bornes = { nord: 49, sud: 47, est: 3, ouest: 1 };
    this.pleinEcran = false;
    /** @type {() => void} */ this.deplacement = () => {};
    /** @type {(lat: number, lon: number) => void} */ this.clic = () => {};
    fond = this;
  }

  /** @param {() => void} f */ surDeplacement(f) { this.deplacement = f; }
  /** @param {(lat: number, lon: number) => void} f */ surClic(f) { this.clic = f; }
  get nombre() { return this.points.size; }
  /** @param {any[]} points @param {(p: any) => void} clic */
  ajouter(points, clic) {
    let n = 0;
    for (const p of points) if (!this.points.has(p.id)) { this.points.set(p.id, { point: p, clic }); n++; }
    this.appels.push(['ajouter', points.length]);
    return n;
  }
  /** Le clic d'un visiteur sur le marqueur d'un point. @param {number} id */
  cliquerPoint(id) { const m = this.points.get(id); if (m) m.clic(m.point); }
  purger() { this.appels.push(['purger']); }
  /** @param {any[]} a */ placer(...a) { this.appels.push(['placer', ...a]); }
  /** @param {any[]} a */ voler(...a) { this.appels.push(['voler', ...a]); }
  quitterPleinEcran() { this.appels.push(['quitterPleinEcran']); }
  /** @param {any[]} a */ poserClic(...a) { this.appels.push(['poserClic', ...a]); }
  retirerClic() { this.appels.push(['retirerClic']); }
  /** @param {any[]} a */ poserPosition(...a) { this.appels.push(['poserPosition', ...a]); }
  /** @param {[number, number]} origine @param {any} cible @param {() => void} clic */
  montrerProche(origine, cible, clic) { this.appels.push(['montrerProche', origine, cible.id]); this.clicProche = clic; }
  effacerProche() { this.appels.push(['effacerProche']); }
  /** @param {string} nom */ a(nom) { return this.appels.filter((x) => x[0] === nom); }
}

Carte.fabriquerFond = (element, vue, reglages) => /** @type {any} */ (new FauxFond(element, vue, reglages));

// ── Serveur ─────────────────────────────────────────────────────────────────

const POINTS = [
  { id: 1, lat: 48.1, lon: 2.1, t: 'C' },
  { id: 2, lat: 48.2, lon: 2.2, t: 'X' },
];

const DETAIL = [{
  autor: ['marc de café', '<b>os</b>'],
  inter: '',
  donnees: { type: 'Compost bois', acces: 'public', gestion: 'Mairie de Rennes', info_gestion: 'Voir https://www.rennes.fr/compost ou la mairie' },
}];

/**
 * @param {{ sites?: (corps: URLSearchParams) => any, total?: any, reverse?: any, recherche?: any, signalement?: (corps: URLSearchParams) => any }} [options]
 */
function serveur({
  sites = (c) => {
    if (c.get('autorinter')) return { corps: DETAIL };
    if (c.get('plus_proche')) return { corps: { id: 7, lat: 48.11, lon: 2.11, t: 'X', distance_m: 120.4 } };
    return { corps: POINTS };
  },
  total = { corps: { composts: 11407 } },
  reverse = { corps: { address: { road: 'Rue des Lilas', postcode: '35000', city: 'Rennes' } } },
  recherche = { corps: [{ lat: '48.117', lon: '-1.677' }] },
  signalement = () => ({ corps: { ok: true } }),
} = {}) {
  return fauxFetch((adresse, options) => {
    const chemin = adresse.split('?')[0];
    if (chemin === '/api/carte/sites.php') return sites(options.body);
    if (chemin === '/api/carte/count.php') return total;
    if (chemin === '/api/carte/signalement.php') return signalement(options.body);
    if (chemin === 'https://nominatim.openstreetmap.org/reverse') return reverse;
    if (chemin === 'https://nominatim.openstreetmap.org/search') return recherche;
    return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
  });
}

async function stabiliser() {
  for (let i = 0; i < 4; i++) await dom.stabiliser();
}

/** @param {ReturnType<typeof serveur>} [reseau] */
async function monter(reseau = serveur()) {
  const carte = dom.monter('<cs-carte></cs-carte>');
  await stabiliser();
  return { carte, reseau, fond: /** @type {FauxFond} */ (fond) };
}

/** @param {ReturnType<typeof serveur>} reseau @param {string} fin */
const envois = (reseau, fin) => reseau.appels.filter((a) => a.adresse.split('?')[0].endsWith(fin));

/** La boîte de message la plus récente. */
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
  dom.vider();
  fond = null;
  await dom.stabiliser();
});

// ── Fonctions pures ─────────────────────────────────────────────────────────

test('lireVue : cadrage mémorisé utilisable, sinon null', () => {
  assert.deepEqual(outils.lireVue('{"lat":48.1,"lon":-1.6,"z":12}'), { centre: [48.1, -1.6], zoom: 12 });
  assert.equal(outils.lireVue(null), null);
  assert.equal(outils.lireVue('pas du json'), null);
  assert.equal(outils.lireVue('{"lat":95,"lon":0,"z":5}'), null);
  assert.equal(outils.lireVue('{"lat":48,"lon":0,"z":25}'), null);
  assert.equal(outils.lireVue('{"lat":"x","lon":0,"z":5}'), null);
  assert.deepEqual(outils.lireVue(outils.ecrireVue(45, 4, 9)), { centre: [45, 4], zoom: 9 });
});

test('texteCompteur, distanceLisible, adresseLisible', () => {
  assert.equal(outils.texteCompteur(null, 300), '300 composteurs affichés');
  assert.equal(outils.texteCompteur(11407, 300), (11407).toLocaleString('fr-FR') + ' bacs à biodéchets et composteurs recensés · 300 affichés');
  assert.equal(outils.distanceLisible(120.4), '120 m');
  assert.equal(outils.distanceLisible(2345), '2.3 km');
  assert.equal(outils.adresseLisible({ road: 'Rue des Lilas', postcode: '35000', city: 'Rennes' }), 'Rue des Lilas, 35000 Rennes');
  assert.equal(outils.adresseLisible({ village: 'Gévezé' }), ' Gévezé');
  assert.equal(outils.adresseLisible(null), '');
});

test('contactEnLiens : sites et téléphones cliquables, le reste échappé', () => {
  assert.equal(String(outils.contactEnLiens('Voir https://www.rennes.fr/compost <ici>')),
    'Voir <a href="https://www.rennes.fr/compost" target="_blank" rel="noopener">🔗 rennes.fr</a> &lt;ici&gt;');
  assert.equal(String(outils.contactEnLiens('02 99 00 00 00')), '<a href="tel:0299000000">📞 02 99 00 00 00</a>');
  assert.equal(String(outils.contactEnLiens('<script>alert(1)</script>')), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(String(outils.contactEnLiens('javascript:alert(1)')), 'javascript:alert(1)');
  assert.equal(String(outils.contactEnLiens(null)), 'Pas de données');
});

test('liens d’itinéraire et de Waze, champs de zone', () => {
  assert.equal(outils.lienWaze(48.1, 2.2), 'https://www.waze.com/ul?ll=48.1%2C2.2&navigate=yes&zoom=17');
  assert.equal(outils.lienItineraire('foot', [48, 2], [48.1, 2.2]), 'https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=48%2C2%3B48.1%2C2.2#');
  assert.deepEqual(champsZone({ nord: 49, sud: 47, est: 3, ouest: 1 }), { france: 'france', north: 49, south: 47, east: 3, west: 1 });
});

// ── La carte ────────────────────────────────────────────────────────────────

test('ouverture : vue mémorisée, points de la zone visible, compteur', async () => {
  dom.stockage.set('carte:vue', '{"lat":48.1,"lon":-1.6,"z":12}');
  const { carte, reseau, fond } = await monter();
  assert.deepEqual(fond.vue, { centre: [48.1, -1.6], zoom: 12 });
  const [zone] = envois(reseau, 'sites.php');
  assert.deepEqual(Object.fromEntries(zone.options.body), { france: 'france', north: '49', south: '47', east: '3', west: '1' });
  assert.equal(fond.nombre, 2);
  assert.equal(carte.querySelector('.compteur').textContent, outils.texteCompteur(11407, 2));
  assert.equal(carte.querySelector('cs-carte-fiche .tabl').hidden, true);
});

test('ouverture : sans vue mémorisée, la France entière ; « ↺ » y ramène', async () => {
  const { fond } = await monter();
  assert.deepEqual(fond.vue, outils.VUE_DEFAUT);
  fond.reglages.allerAuDefaut();
  assert.deepEqual(fond.a('placer'), [['placer', outils.VUE_DEFAUT.centre, outils.VUE_DEFAUT.zoom]]);
});

test('panne au chargement des points : dite dans le compteur', async () => {
  await enSilence(async () => {
    const { carte } = await monter(serveur({ sites: () => ({ statut: 503, corps: { error: 'Service indisponible.' } }) }));
    assert.equal(carte.querySelector('.compteur').textContent, 'Service indisponible.');
  });
});

test('déplacement : la vue est retenue, la zone rechargée après un temps, pas en vue « monde »', async () => {
  const { reseau, fond } = await monter();
  fond.zoom = 3;
  fond.centre = [10, 20];
  fond.deplacement();
  assert.equal(dom.stockage.get('carte:vue'), outils.ecrireVue(10, 20, 3));
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(envois(reseau, 'sites.php').length, 1, 'vue « monde » : pas de rechargement');

  fond.zoom = 12;
  fond.deplacement();
  fond.deplacement();
  await new Promise((r) => setTimeout(r, 450));
  await stabiliser();
  assert.equal(fond.a('purger').length, 1, 'une seule purge pour deux déplacements rapprochés');
  assert.equal(envois(reseau, 'sites.php').length, 2);
});

test('plein écran : le burger du bandeau en fait sortir', async () => {
  const { fond } = await monter();
  const burger = dom.monter('<button id="burgerBtn"></button>');
  const clic = new FauxEvenement('click');
  clic.target = burger;
  dom.document.dispatchEvent(clic);
  assert.equal(fond.a('quitterPleinEcran').length, 0);
  fond.pleinEcran = true;
  const second = new FauxEvenement('click');
  second.target = burger;
  dom.document.dispatchEvent(second);
  assert.equal(fond.a('quitterPleinEcran').length, 1);
});

// ── La fiche ────────────────────────────────────────────────────────────────

test('fiche : un clic sur un point l’ouvre, règles échappées, contact et Waze', async () => {
  const { carte, reseau, fond } = await monter();
  fond.cliquerPoint(2);
  await stabiliser();
  const [detail] = envois(reseau, 'sites.php').filter((a) => a.options.body.get('autorinter'));
  assert.equal(detail.options.body.get('autorinter'), '2');
  const fiche = carte.querySelector('cs-carte-fiche');
  assert.equal(fiche.querySelector('.tabl').hidden, false);
  assert.equal(fiche.querySelector('.badge-type').textContent, 'Compost bois');
  assert.equal(fiche.querySelector('.badge-acces').textContent, 'public');
  assert.equal(fiche.querySelector('.tabl-adresse').textContent, '📍 Rue des Lilas, 35000 Rennes');
  const chips = fiche.querySelectorAll('.chip-ok');
  assert.deepEqual(chips.map((/** @type {any} */ c) => c.textContent), ['marc de café', '<b>os</b>']);
  assert.equal(fiche.querySelector('.chip-ok b'), null, 'une règle est du texte, jamais du HTML');
  assert.equal(fiche.querySelectorAll('.tabl-rules .no-data').length, 1);
  assert.equal(fiche.querySelector('.info-val a').getAttribute('href'), 'https://www.rennes.fr/compost');
  assert.equal(fiche.querySelector('.lien-waze').getAttribute('href'), outils.lienWaze(48.2, 2.2));
  const reverse = envois(reseau, 'reverse')[0].adresse;
  assert.match(reverse, /lat=48\.2&lon=2\.2&format=json&accept-language=fr/);
});

test('fiche : point disparu, adresse introuvable', async () => {
  const { carte, fond } = await monter(serveur({ sites: (c) => ({ corps: c.get('autorinter') ? [] : POINTS }), reverse: { corps: { error: 'Unable to geocode' } } }));
  fond.cliquerPoint(1);
  await stabiliser();
  assert.match(carte.querySelector('cs-carte-fiche .tabl-corps').textContent, /n'existe plus/);
  assert.equal(carte.querySelector('cs-carte-fiche .tabl-adresse').textContent, '');
});

test('fiche : itinéraire à pied depuis la position du visiteur', async () => {
  const { carte, fond } = await monter();
  /** @type {string[]} */
  const ouvertes = [];
  g.open = (/** @type {string} */ adresse) => { ouvertes.push(adresse); };
  Object.defineProperty(g.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (/** @type {any} */ ok) => ok({ coords: { latitude: 48, longitude: 2 } }) },
  });
  fond.cliquerPoint(2);
  await stabiliser();
  carte.querySelector('[data-trajet="foot"]').click();
  assert.deepEqual(ouvertes, [outils.lienItineraire('foot', [48, 2], [48.2, 2.2])]);
});

test('fiche : signalement envoyé, puis refusé avec la phrase du serveur', async () => {
  /** @type {URLSearchParams[]} */
  const recus = [];
  let refuser = false;
  const { carte, fond } = await monter(serveur({ signalement: (c) => { recus.push(c); return refuser ? { corps: { error: 'Trop de signalements, réessaie plus tard.' } } : { corps: { ok: true } }; } }));
  fond.cliquerPoint(2);
  await stabiliser();
  const fiche = carte.querySelector('cs-carte-fiche');
  fiche.querySelector('[data-action="signaler"]').click();
  assert.equal(fiche.querySelector('.signal-zone').hidden, false);
  fiche.querySelector('[data-champ="motif"]').choisir('inexistant');
  fiche.querySelector('[data-champ="commentaire"]').saisir('Retiré en 2025');
  fiche.querySelector('[data-action="envoyer-signalement"]').click();
  await stabiliser();
  assert.deepEqual(Object.fromEntries(recus[0]), { action: 'creer', compost_id: '2', motif: 'inexistant', commentaire: 'Retiré en 2025' });
  assert.equal(fiche.querySelector('.signal-msg').textContent, '✓ Merci, ton signalement a bien été envoyé !');
  assert.equal(fiche.querySelector('[data-champ="commentaire"]').value, '');

  await enSilence(async () => {
    refuser = true;
    fiche.querySelector('[data-action="envoyer-signalement"]').click();
    await stabiliser();
    assert.equal(fiche.querySelector('.signal-msg').textContent, 'Trop de signalements, réessaie plus tard.');
    assert.equal(fiche.querySelector('.signal-msg').className, 'signal-msg err');
  });
});

// ── Clic sur la carte, recherche ────────────────────────────────────────────

test('clic sur la carte : repère posé, fiche fermée, « plus proche d’ici » calculé par le serveur', async () => {
  const { carte, reseau, fond } = await monter();
  fond.cliquerPoint(2);
  await stabiliser();
  fond.clic(48.3, 2.4);
  assert.equal(carte.querySelector('cs-carte-fiche .tabl').hidden, true);
  assert.deepEqual(fond.a('poserClic'), [['poserClic', 48.3, 2.4]]);
  const bouton = carte.querySelector('[data-action="proche-clic"]');
  assert.equal(bouton.hidden, false);

  bouton.click();
  await stabiliser();
  const demande = envois(reseau, 'sites.php').find((a) => a.options.body.get('plus_proche'));
  assert.deepEqual(Object.fromEntries(demande.options.body), { plus_proche: '1', lat: '48.3', lon: '2.4' });
  assert.deepEqual(fond.a('montrerProche'), [['montrerProche', [48.3, 2.4], 7]]);
  assert.equal(carte.querySelector('.compteur').textContent, 'Composteur le plus proche : 120 m.');
  assert.equal(bouton.hidden, true);
  fond.clicProche();
  await stabiliser();
  assert.equal(carte.querySelector('cs-carte-fiche .tabl').hidden, false);
});

test('clic sur la carte : recherche impossible, dite dans une boîte de message', async () => {
  await enSilence(async () => {
    const { carte, fond } = await monter(serveur({ sites: (c) => (c.get('plus_proche') ? { corps: { error: 'Aucun composteur recensé à proximité.' } } : { corps: POINTS }) }));
    fond.clic(10, 10);
    carte.querySelector('[data-action="proche-clic"]').click();
    await stabiliser();
    assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Recherche impossible');
    assert.equal(boite().querySelector('.dialogue__texte').textContent, 'Aucun composteur recensé à proximité.');
    assert.equal(carte.querySelector('[data-action="proche-clic"]').disabled, false);
  });
});

test('recherche d’une ville : géocodage, puis le plus proche calculé par le serveur', async () => {
  const { carte, reseau, fond } = await monter();
  carte.querySelector('[data-action="chercher"]').click();
  const formulaire = carte.querySelector('.recherche');
  assert.equal(formulaire.hidden, false);
  formulaire.querySelector('input').saisir('Rennes');
  formulaire.dispatchEvent(new FauxEvenement('submit'));
  await stabiliser();
  assert.match(envois(reseau, 'search')[0].adresse, /q=Rennes&format=json&limit=1&accept-language=fr/);
  const demande = envois(reseau, 'sites.php').find((a) => a.options.body.get('plus_proche'));
  assert.deepEqual(Object.fromEntries(demande.options.body), { plus_proche: '1', lat: '48.117', lon: '-1.677' });
  assert.deepEqual(fond.a('poserPosition'), [['poserPosition', 48.117, -1.677]]);
  assert.deepEqual(fond.a('voler'), [['voler', 48.11, 2.11, 15]]);
  assert.equal(carte.querySelector('.compteur').textContent, 'Le compost le plus proche est à 120 m.');
  assert.equal(formulaire.hidden, true);
  assert.equal(carte.querySelector('cs-carte-fiche .tabl').hidden, false);
  assert.equal(envois(reseau, 'sites.php').filter((a) => a.options.body.get('france') && !a.options.body.get('north')).length, 0,
    'plus aucun téléchargement de la liste entière');
});

test('recherche d’une ville introuvable : on le dit et le champ revient', async () => {
  const { carte } = await monter(serveur({ recherche: { corps: [] } }));
  carte.querySelector('[data-action="chercher"]').click();
  const formulaire = carte.querySelector('.recherche');
  formulaire.querySelector('input').saisir('Xyzzy');
  formulaire.dispatchEvent(new FauxEvenement('submit'));
  await stabiliser();
  assert.equal(carte.querySelector('.compteur').textContent, 'Ville introuvable, réessaie.');
  assert.equal(formulaire.hidden, false);
});
