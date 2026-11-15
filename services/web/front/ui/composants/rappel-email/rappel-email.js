/* ============================================================================
   rappel-email.js — <cs-rappel-email> : « confirme ton adresse email ».

   Bandeau orange affiché à un compte connecté dont l'adresse n'est pas encore
   confirmée, avec un bouton pour renvoyer le lien. Rien ne s'affiche pour un
   visiteur non connecté ni pour un compte confirmé.

   C'est un rappel, pas une fonction vitale : si le serveur ne répond pas, la
   page s'affiche simplement sans lui (session.moi() ne lève jamais).

   Usage, sous le bandeau des pages qui le veulent :
     <cs-rappel-email></cs-rappel-email>
     <script type="module" src="/ui/composants/rappel-email/rappel-email.js"></script>
   ============================================================================ */
import { api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { session } from '../../socle/session.js';

export class RappelEmail extends Composant {
  static balise = 'cs-rappel-email';
  static styles = [new URL('./rappel-email.css', import.meta.url)];

  async monter() {
    this.ecouter('click', '[data-action="renvoyer"]', (bouton) => this.#renvoyer(bouton));

    const moi = await session.moi();
    if (!moi.logged_in || moi.email_verifie) return;
    this.rendre(this.gabarit(moi.email));
  }

  /** @param {string} email */
  gabarit(email) {
    return html`
      <div class="rappel-email__barre">
        <span>✉️</span>
        <span class="rappel-email__texte">Confirme ton adresse <strong>${email}</strong> : c'est elle qui te permettra de récupérer ton compte.</span>
        <button type="button" data-action="renvoyer">Renvoyer le lien</button>
        <a href="/verifier">En savoir plus</a>
      </div>`;
  }

  /**
   * Le serveur limite le nombre d'envois par heure : un refus rend la main
   * pour un nouvel essai, un succès laisse le bouton éteint.
   * @param {HTMLElement} bouton
   */
  async #renvoyer(bouton) {
    if (!(bouton instanceof HTMLButtonElement)) return;
    bouton.disabled = true;
    bouton.textContent = 'Envoi…';
    try {
      await api.auth.post('resend.php');
      bouton.textContent = 'Email envoyé ✓';
    } catch (erreur) {
      console.error('<cs-rappel-email>', erreur);
      bouton.textContent = 'Échec';
      bouton.disabled = false;
    }
  }
}

RappelEmail.definir();
