/* ============================================================================
   connexion.js — <cs-connexion> : la page « Se connecter » (/login).

   Pseudo ou email, mot de passe. Une fois connecté, on arrive sur sa page de
   compte. Les refus (identifiants faux, trop de tentatives) sont ceux du
   serveur, affichés tels quels.

   Usage :
     <cs-connexion></cs-connexion>
     <script type="module" src="/ui/pages/auth/connexion.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { html } from '../../socle/outils.js';
import { CarteAuth } from './carte-auth.js';

const BOUTON = 'Se connecter';

export class Connexion extends CarteAuth {
  static balise = 'cs-connexion';

  demarrer() {
    this.poserCarte({ titre: 'Se connecter' }, this.gabarit());
    this.ecouter('submit', 'form', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#envoyer();
    });
  }

  async #envoyer() {
    const bouton = this.trouver('[type="submit"]', HTMLButtonElement);
    if (bouton.disabled) return;
    this.effacerMessage();
    this.occuper(bouton, 'Connexion…');
    try {
      await api.auth.post('login.php', { username: this.valeur('connexion-identifiant').trim(), password: this.valeur('connexion-mdp') });
      location.assign('/compte');
    } catch (erreur) {
      console.error('<cs-connexion>', erreur);
      this.message(texteErreur(erreur, 'Erreur réseau, réessaie.'), 'ko');
      this.liberer(bouton, BOUTON);
    }
  }

  gabarit() {
    return html`
      <div class="avis" role="alert" hidden></div>
      <form>
        <div class="field">
          <label for="connexion-identifiant">Pseudo ou email</label>
          <input type="text" id="connexion-identifiant" name="username" placeholder="Ton pseudo ou ton adresse email" autocomplete="username" required>
        </div>
        ${this.gabaritMotDePasse({ id: 'connexion-mdp', libelle: 'Mot de passe', indication: 'Ton mot de passe', autocomplete: 'current-password' })}
        <button type="submit" class="btn-submit">${BOUTON}</button>
      </form>
      <div class="auth-footer serre"><a href="/mot-de-passe-oublie">Mot de passe oublié ?</a></div>
      <div class="auth-footer">Pas encore de compte ? <a href="/signin">Créer un compte</a></div>`;
  }
}

Connexion.definir();
