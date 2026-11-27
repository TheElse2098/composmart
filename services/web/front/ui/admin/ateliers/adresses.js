/* ============================================================================
   adresses.js — les adresses des pages d'administration des ateliers.

   Les pages migrées vivent provisoirement sous /evenements-admin/v2, à côté
   des anciennes, jusqu'à la bascule (phase 10e) : ADRESSE_ATELIERS redevient
   alors '/evenements-admin', et c'est la seule ligne à changer. Le parcours
   et la console de suivi ne sont pas encore migrés : leurs liens visent les
   pages en service.
   ============================================================================ */

/** Racine des pages migrées. */
export const ADRESSE_ATELIERS = '/evenements-admin/v2';

/** Racine des pages en service. */
const ADRESSE_EN_SERVICE = '/evenements-admin';

export const ADRESSES = Object.freeze({
  liste: ADRESSE_ATELIERS,
  anecdotes: ADRESSE_ATELIERS + '/anecdotes',
  images: ADRESSE_ATELIERS + '/images',
  parcours: ADRESSE_EN_SERVICE + '/parcours',
  /** La console de suivi d'un événement. @param {number | string} id */
  suivi: (id) => ADRESSE_EN_SERVICE + '/' + encodeURIComponent(String(id)),
});
