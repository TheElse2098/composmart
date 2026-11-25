/* ============================================================================
   carte-libelles.js — le vocabulaire de la carte : la page /carte et les
   onglets du panneau d'administration qui en parlent (signalements, ajouts,
   journal) lisent les mêmes listes.

   Les valeurs sont celles que map-api accepte : les changer ici ne suffit
   pas, le serveur refuse ce qu'il ne connaît pas (carte/pending.php,
   carte/signalement.php).
   ============================================================================ */

/** Motifs d'un signalement. @type {Record<string, string>} */
export const MOTIFS = {
  position: '📍 Mauvaise position',
  type_acces: '🏷️ Mauvais type ou accès',
  regles: '📋 Règles incorrectes',
  inexistant: "❌ N'existe plus",
  autre: '💬 Autre',
};

/** Types de composteur (TYPES_VALIDES de carte/pending.php). */
export const TYPES_COMPOSTEUR = ['Conteneur', 'Compost bois', 'Compost plastique'];

/** Accès d'un composteur (ACCES_VALIDES de carte/pending.php). */
export const ACCES_COMPOSTEUR = ['public', 'privé', 'institution'];

/**
 * @param {string} motif
 * @returns {string} un motif inconnu garde son code
 */
export function libelleMotif(motif) {
  return MOTIFS[motif] || motif;
}
