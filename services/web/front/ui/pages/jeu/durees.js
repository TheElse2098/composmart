/* ============================================================================
   durees.js — une durée de décomposition telle qu'on la dit.

   Partagé par le jeu « Combien de temps ? » (temps-decompo.js) et par son
   éditeur d'administration (ui/admin/jeux/), qui montre la même chose à côté
   de chaque durée saisie : deux copies finiraient par se contredire.
   ============================================================================ */
import { pluriel } from '../../socle/outils.js';

/**
 * Jours, semaines, mois, puis années.
 * @param {number} jours
 */
export function duree(jours) {
  if (jours < 14) return pluriel(Math.round(jours), 'jour', 'jours');
  if (jours < 60) return pluriel(Math.round(jours / 7), 'semaine', 'semaines');
  if (jours < 350) return Math.round(jours / 30) + ' mois';
  return pluriel(Math.round(jours / 365), 'an', 'ans');
}
