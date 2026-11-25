/* ============================================================================
   carte-outils.js — ce que la carte calcule sans toucher ni à Leaflet ni au
   réseau : le cadrage mémorisé, les textes du compteur et des distances,
   l'adresse lisible, les liens de contact, d'itinéraire et de Waze.

   Fonctions pures, testées sous Node (tests/front/carte.test.mjs).
   ============================================================================ */
import { Html, html } from '../../socle/outils.js';

/** @typedef {{ centre: [number, number], zoom: number }} Vue */

/** France entière. @type {Vue} */
export const VUE_DEFAUT = { centre: [46.785016, 7.670405], zoom: 6 };

/** Clé du dernier cadrage, d'une visite à l'autre (localStorage). */
export const CLE_VUE = 'carte:vue';

/** Texte affiché quand une donnée manque dans la fiche d'un composteur. */
export const SANS_DONNEES = 'Pas de données';

/**
 * Le cadrage enregistré, s'il est utilisable. Une valeur corrompue ou hors
 * bornes donne `null` (la vue par défaut prend le relais) plutôt que de
 * laisser Leaflet planter sur un centre invalide.
 * @param {string | null} texte  contenu de localStorage
 * @returns {Vue | null}
 */
export function lireVue(texte) {
  let v;
  try {
    v = JSON.parse(texte || 'null');
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const lat = Number(v.lat);
  const lon = Number(v.lon);
  const z = Number(v.z);
  if (!isFinite(lat) || !isFinite(lon) || !isFinite(z)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (z < 2 || z > 20) return null;
  return { centre: [lat, lon], zoom: z };
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {number} zoom
 */
export function ecrireVue(lat, lon, zoom) {
  return JSON.stringify({ lat, lon, z: zoom });
}

/**
 * Le total en base ne bouge pas quand on déplace la carte, le nombre de points
 * chargés si : les deux sont affichés séparément, sinon « 11 407 recensés »
 * sur un écran qui en montre 300 ressemble à un bug.
 * @param {number | null} total  null tant que count.php n'a pas répondu
 * @param {number} affiches
 */
export function texteCompteur(total, affiches) {
  const vus = affiches.toLocaleString('fr-FR');
  return total === null
    ? vus + ' composteurs affichés'
    : total.toLocaleString('fr-FR') + ' bacs à biodéchets et composteurs recensés · ' + vus + ' affichés';
}

/** @param {number} metres */
export function distanceLisible(metres) {
  return metres < 1000 ? Math.round(metres) + ' m' : (metres / 1000).toFixed(1) + ' km';
}

/**
 * « 12 rue des Lilas, 35000 Rennes » à partir d'une réponse de Nominatim
 * (`address`) ; vide si rien d'utile.
 * @param {Record<string, string> | null | undefined} a
 */
export function adresseLisible(a) {
  const d = a || {};
  const rue = d.road || d.pedestrian || d.path || d.cycleway || '';
  const ville = d.city || d.town || d.village || d.municipality || '';
  const cp = d.postcode || '';
  return [rue, cp + ' ' + ville].filter((s) => s.trim()).join(', ');
}

/**
 * Le contact d'un gestionnaire, avec ses liens rendus cliquables : chaque
 * adresse web devient un lien (affiché par son nom de domaine), un numéro
 * seul devient un lien d'appel. Tout le reste est du texte échappé.
 * @param {string | null | undefined} texte
 * @returns {Html}
 */
export function contactEnLiens(texte) {
  const brut = texte || '';
  if (!brut || brut === SANS_DONNEES) return html`${brut || SANS_DONNEES}`;
  if (/https?:\/\//.test(brut)) {
    const morceaux = brut.split(/(https?:\/\/[^\s]+)/g);
    return html`${morceaux.map((m, i) => {
      if (i % 2 === 0) return m;
      try {
        const domaine = new URL(m).hostname.replace(/^www\./, '');
        return html`<a href="${m}" target="_blank" rel="noopener">🔗 ${domaine}</a>`;
      } catch {
        return m;
      }
    })}`;
  }
  if (/^[\d\s+.\-()]{7,}$/.test(brut.trim())) {
    return html`<a href="tel:${brut.replace(/[^\d+]/g, '')}">📞 ${brut}</a>`;
  }
  return html`${brut}`;
}

/**
 * @param {number} lat
 * @param {number} lon
 */
export function lienWaze(lat, lon) {
  return 'https://www.waze.com/ul?ll=' + lat + '%2C' + lon + '&navigate=yes&zoom=17';
}

/**
 * Itinéraire OpenStreetMap, à pied ou en voiture.
 * @param {'foot' | 'car'} mode
 * @param {[number, number]} depart
 * @param {[number, number]} arrivee
 */
export function lienItineraire(mode, depart, arrivee) {
  return 'https://www.openstreetmap.org/directions?engine=fossgis_osrm_' + mode
    + '&route=' + depart[0] + '%2C' + depart[1] + '%3B' + arrivee[0] + '%2C' + arrivee[1] + '#';
}
