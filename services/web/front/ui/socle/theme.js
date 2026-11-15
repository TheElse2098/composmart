/* ============================================================================
   theme.js — thème clair ou sombre.

   Le thème est la classe `dark` sur <html>, lue par styles/jetons.css. Le
   choix est gardé dans localStorage (`theme` = `dark` ou `light`) et posé
   avant le premier affichage par socle/amorce.js.

   Même clé, mêmes valeurs et même évènement `themechange` que l'ancien
   assets/js/theme.js : les pages pas encore migrées (la carte et son fond de
   tuiles) continuent de réagir à une bascule faite depuis le nouveau bandeau.
   ============================================================================ */

class Theme {
  /** @returns {boolean} */
  get sombre() {
    return document.documentElement.classList.contains('dark');
  }

  /**
   * Passe d'un thème à l'autre et prévient la page.
   * @returns {boolean} vrai si le thème est maintenant sombre
   */
  basculer() {
    const sombre = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem('theme', sombre ? 'dark' : 'light');
    } catch {
      // Stockage refusé (navigation privée stricte) : le thème vaut pour cette page.
    }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: sombre } }));
    return sombre;
  }
}

export const theme = new Theme();
