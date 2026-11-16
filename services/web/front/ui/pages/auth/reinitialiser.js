/* ============================================================================
   reinitialiser.js — <cs-reinitialiser> : la page « Nouveau mot de passe »
   (/reinitialiser?token=…), ouverte depuis le lien du mail « mot de passe
   oublié ».

   Le jeton de l'adresse désigne le compte ; sans lui, il n'y a rien à
   modifier et le formulaire n'est pas proposé. C'est le serveur qui décide
   si le jeton est encore valable.

   Usage :
     <cs-reinitialiser></cs-reinitialiser>
     <script type="module" src="/ui/pages/auth/reinitialiser.js"></script>
   ============================================================================ */
import { ErreurApi, api, texteErreur } from '../../socle/api.js';
import { html } from '../../socle/outils.js';
import { CarteAuth } from './carte-auth.js';

const BOUTON = 'Enregistrer';

export class Reinitialiser extends CarteAuth {
  static balise = 'cs-reinitialiser';

  /** Le jeton reçu par email. */
  #jeton = '';

  demarrer() {
    this.#jeton = new URLSearchParams(location.search).get('token') || '';
    this.poserCarte({ titre: 'Nouveau mot de passe' }, this.gabarit());
    if (!this.#jeton) {
      this.trouver('form').hidden = true;
      this.message('Lien incomplet. Refais une demande depuis « Mot de passe oublié ».', 'ko');
      return;
    }
    this.ecouter('submit', 'form', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#envoyer();
    });
  }

  async #envoyer() {
    const bouton = this.trouver('[type="submit"]', HTMLButtonElement);
    if (bouton.disabled) return;
    this.effacerMessage();
    const motDePasse = this.valeur('reinit-mdp');
    if (motDePasse !== this.valeur('reinit-mdp2')) {
      this.message('Les mots de passe ne correspondent pas.', 'ko');
      return;
    }
    this.occuper(bouton, 'Enregistrement…');
    try {
      await api.auth.post('reset.php', { token: this.#jeton, password: motDePasse });
      this.trouver('form').hidden = true;
      this.rendre(html`<a href="/login" class="btn-submit">Se connecter</a>`, this.trouver('.auth-footer'));
      this.message('Mot de passe modifié. Tu peux maintenant te connecter.', 'ok');
    } catch (erreur) {
      console.error('<cs-reinitialiser>', erreur);
      const reseau = erreur instanceof ErreurApi && erreur.statut === 0;
      this.message(reseau ? 'Erreur réseau. Réessaie dans un instant.' : texteErreur(erreur, 'Modification impossible.'), 'ko');
      this.liberer(bouton, BOUTON);
    }
  }

  gabarit() {
    return html`
      <div class="avis" role="status" hidden></div>
      <form>
        ${this.gabaritMotDePasse({ id: 'reinit-mdp', libelle: 'Nouveau mot de passe', indication: '8 caractères, lettres + chiffres', autocomplete: 'new-password' })}
        ${this.gabaritMotDePasse({ id: 'reinit-mdp2', libelle: 'Confirmer le mot de passe', indication: 'Retape le mot de passe', autocomplete: 'new-password' })}
        <button type="submit" class="btn-submit">${BOUTON}</button>
      </form>
      <div class="auth-footer"><a href="/login">Retour à la connexion</a></div>`;
  }
}

Reinitialiser.definir();
