/* ============================================================================
   mot-de-passe-oublie.js — <cs-mot-de-passe-oublie> : la page « Mot de passe
   oublié » (/mot-de-passe-oublie).

   On donne son pseudo ou son email ; un lien pour choisir un nouveau mot de
   passe part par email. La réponse du serveur est la même, que le compte
   existe ou non : personne ne doit pouvoir deviner quels comptes sont
   inscrits. Cette page ne la nuance donc jamais.

   Usage :
     <cs-mot-de-passe-oublie></cs-mot-de-passe-oublie>
     <script type="module" src="/ui/pages/auth/mot-de-passe-oublie.js"></script>
   ============================================================================ */
import { ErreurApi, api, texteErreur } from '../../socle/api.js';
import { html } from '../../socle/outils.js';
import { CarteAuth } from './carte-auth.js';

const BOUTON = 'Envoyer le lien';

export class MotDePasseOublie extends CarteAuth {
  static balise = 'cs-mot-de-passe-oublie';

  demarrer() {
    this.poserCarte({ titre: 'Mot de passe oublié' }, this.gabarit());
    this.ecouter('submit', 'form', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#envoyer();
    });
  }

  async #envoyer() {
    const bouton = this.trouver('[type="submit"]', HTMLButtonElement);
    if (bouton.disabled) return;
    this.effacerMessage();
    this.occuper(bouton, 'Envoi…');
    try {
      /** @type {{ message?: string }} */
      const d = await api.auth.post('forgot.php', { identifiant: this.valeur('oubli-identifiant').trim() });
      this.message(d.message || "Si un compte correspond, un email vient d'être envoyé.", 'ok');
      this.trouver('form').hidden = true;
    } catch (erreur) {
      console.error('<cs-mot-de-passe-oublie>', erreur);
      const reseau = erreur instanceof ErreurApi && erreur.statut === 0;
      this.message(reseau ? 'Erreur réseau. Réessaie dans un instant.' : texteErreur(erreur, 'Envoi impossible. Réessaie dans un instant.'), 'ko');
      this.liberer(bouton, BOUTON);
    }
  }

  gabarit() {
    return html`
      <div class="avis" role="status" hidden></div>
      <p class="intro">Indique ton nom d'utilisateur ou ton adresse email : nous t'enverrons un lien pour choisir un nouveau mot de passe.</p>
      <form>
        <div class="field">
          <label for="oubli-identifiant">Nom d'utilisateur ou email</label>
          <input type="text" id="oubli-identifiant" name="identifiant" placeholder="composteur42 ou nom@exemple.fr" autocomplete="username" required>
        </div>
        <button type="submit" class="btn-submit">${BOUTON}</button>
      </form>
      <div class="auth-footer"><a href="/login">Retour à la connexion</a></div>`;
  }
}

MotDePasseOublie.definir();
