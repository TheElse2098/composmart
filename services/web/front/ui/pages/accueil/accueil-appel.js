/* ============================================================================
   accueil-appel.js — <cs-accueil-appel> : le bouton de l'encadré final de
   l'accueil.

   Écrit dans la page pour un visiteur (« Créer mon compte ») ; ce composant
   le change pour un membre connecté, qu'il invite à continuer ses cours.

   Usage, dans index.html :
     <cs-accueil-appel><a href="/signin" class="btn btn-primary">🌱 Créer mon compte</a></cs-accueil-appel>
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { session } from '../../socle/session.js';

export class AccueilAppel extends Composant {
  static balise = 'cs-accueil-appel';

  async monter() {
    const moi = await session.moi();
    if (!moi.logged_in) return;
    const lien = this.trouver('a');
    lien.textContent = '📚 Continuer mes cours';
    lien.setAttribute('href', '/cours');
  }
}

AccueilAppel.definir();
