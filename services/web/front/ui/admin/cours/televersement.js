/* ============================================================================
   televersement.js — envoyer une image ou un fichier audio d'un cours.

   Un seul endpoint pour les deux : même stockage, mêmes contrôles ; seuls le
   plafond de taille et la validation du format diffèrent, côté serveur
   (admin/media_upload.php), qui dit lui-même sa limite si le fichier est
   refusé. Utilisé par l'onglet des médias (podcast) et par la fiche (images).
   ============================================================================ */
import { api } from '../../socle/api.js';

/**
 * Réponse de /api/admin/media_upload.php.
 * @typedef {{ id: number, type: 'image' | 'audio', url: string, nom: string }} Media
 */

/**
 * @param {File} fichier
 * @param {'image' | 'audio'} type
 * @param {number} coursId  0 tant que le cours n'est pas encore créé
 * @returns {Promise<Media>}
 */
export function televerser(fichier, type, coursId) {
  const corps = new FormData();
  corps.append('media', fichier);
  corps.append('type', type);
  if (coursId) corps.append('cours_id', String(coursId));
  return api.admin.post('media_upload.php', corps);
}
