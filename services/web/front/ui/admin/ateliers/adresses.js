/* ============================================================================
   adresses.js — les adresses des pages d'administration des ateliers.

   Les pages migrées vivent provisoirement sous /evenements-admin/v2, à côté
   des anciennes, jusqu'à la bascule (phase 10e) : ADRESSE_ATELIERS redevient
   alors '/evenements-admin', et c'est la seule ligne à changer. La console
   de suivi n'est pas encore migrée (phase 10c) : ses liens visent la page en
   service.
   ============================================================================ */

/** Racine des pages migrées. */
export const ADRESSE_ATELIERS = '/evenements-admin/v2';

/** Racine des pages en service. */
const ADRESSE_EN_SERVICE = '/evenements-admin';

export const ADRESSES = Object.freeze({
  liste: ADRESSE_ATELIERS,
  anecdotes: ADRESSE_ATELIERS + '/anecdotes',
  images: ADRESSE_ATELIERS + '/images',
  /** La bibliothèque de parcours. */
  parcours: ADRESSE_ATELIERS + '/parcours',
  /** L'éditeur d'un parcours. @param {number | string} id */
  parcoursEdition: (id) => ADRESSE_ATELIERS + '/parcours/' + encodeURIComponent(String(id)),
  /** Le déroulé propre à un événement, dans le même éditeur. @param {number | string} id */
  deroule: (id) => ADRESSE_ATELIERS + '/' + encodeURIComponent(String(id)) + '/deroule',
  /** La console de suivi d'un événement. @param {number | string} id */
  suivi: (id) => ADRESSE_EN_SERVICE + '/' + encodeURIComponent(String(id)),
});
