/* ============================================================================
   fichier.js — faire enregistrer un fichier par le navigateur.

   Le contenu vient de `api.<service>.telecharger()`. Passer par là plutôt que
   par un lien direct vers l'endpoint : une erreur (session expirée, trop de
   demandes) s'affiche dans la page au lieu de faire télécharger un fichier
   qui contient le message d'erreur.
   ============================================================================ */

/**
 * Propose l'enregistrement d'un contenu, sous un nom donné.
 * @param {string} nom
 * @param {Blob} contenu
 */
export function enregistrer(nom, contenu) {
  const lien = document.createElement('a');
  const adresse = URL.createObjectURL(contenu);
  lien.href = adresse;
  lien.download = nom;
  // Le lien doit être dans la page pour que son clic compte, dans certains navigateurs.
  document.body.append(lien);
  lien.click();
  lien.remove();
  // L'adresse garde le contenu en mémoire : on la rend une fois l'enregistrement lancé.
  setTimeout(() => URL.revokeObjectURL(adresse), 1000);
}
