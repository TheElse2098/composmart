/* ============================================================================
   outils-ateliers.js — les calculs des pages d'administration des ateliers,
   sans affichage : testables sous Node.
   ============================================================================ */
import { normaliserTag } from '../../composants/choix-tags/choix-tags.js';
import { dateSql } from '../../socle/outils.js';

/** Poids maximal d'une image. Doit rester aligné sur IMG_TAILLE_MAX côté
 *  serveur : le contrôle fait ici n'est qu'une politesse, qui évite un envoi
 *  de plusieurs mégaoctets voué au refus. C'est le serveur qui tranche. */
export const TAILLE_MAX_IMAGE = 8 * 1024 * 1024;

/** Nombre maximal de mots-clés d'une anecdote (anec_mots_parser côté PHP). */
export const MOTS_MAX = 12;

/**
 * « 512 o », « 34 Ko », « 2.4 Mo ».
 * @param {number} octets
 * @returns {string}
 */
export function poids(octets) {
  if (octets < 1024) return octets + ' o';
  if (octets < 1024 * 1024) return Math.round(octets / 1024) + ' Ko';
  return (octets / 1048576).toFixed(1) + ' Mo';
}

/**
 * Les mots-clés tels que le serveur les enregistrera, à partir de la saisie
 * « Chiffre-choc, eau ; EAU » : minuscules, espaces resserrés, doublons
 * écartés, douze au plus. Les montrer avant l'envoi évite de découvrir après
 * coup que « Compost » et « compost » n'ont fait qu'un.
 * @param {string} saisie
 * @returns {string[]}
 */
export function motsDeSaisie(saisie) {
  /** @type {string[]} */
  const mots = [];
  for (const brut of String(saisie || '').split(/[,;]+/)) {
    const mot = normaliserTag(brut);
    if (mot && !mots.includes(mot) && mots.length < MOTS_MAX) mots.push(mot);
  }
  return mots;
}

/**
 * Date d'un événement, « 12 mars à 14:00 » selon le navigateur.
 * @param {string} sql  « 2026-03-12 14:00:00 »
 * @returns {string}
 */
export function dateEvenement(sql) {
  return dateSql(sql).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/**
 * La valeur d'un champ datetime-local (« 2026-03-12T14:00 ») au format
 * attendu par le serveur (« 2026-03-12 14:00 »).
 * @param {string} valeur
 * @returns {string}
 */
export function dateVersServeur(valeur) {
  return String(valeur || '').replace('T', ' ');
}
