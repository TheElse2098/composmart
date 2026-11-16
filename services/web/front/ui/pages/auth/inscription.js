/* ============================================================================
   inscription.js — <cs-inscription> : la page « Créer un compte » (/signin).

   Pseudo, email, mot de passe deux fois, acceptation des conditions
   d'utilisation. Une fois le compte créé, on arrive sur la page qui demande
   de confirmer son adresse (/verifier).

   Les règles (longueur du pseudo, force du mot de passe, adresse déjà prise)
   sont vérifiées par le serveur ; ici, seulement que les deux mots de passe
   sont identiques. Les textes sur l'usage de l'email et des données font
   partie de l'information RGPD : les tenir d'accord avec la politique de
   confidentialité.

   Usage :
     <cs-inscription></cs-inscription>
     <script type="module" src="/ui/pages/auth/inscription.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { html } from '../../socle/outils.js';
import { CarteAuth } from './carte-auth.js';

const BOUTON = 'Créer mon compte';

export class Inscription extends CarteAuth {
  static balise = 'cs-inscription';

  demarrer() {
    this.poserCarte({ titre: 'Créer un compte' }, this.gabarit());
    this.ecouter('submit', 'form', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#envoyer();
    });
  }

  async #envoyer() {
    const bouton = this.trouver('[type="submit"]', HTMLButtonElement);
    if (bouton.disabled) return;
    this.effacerMessage();
    const motDePasse = this.valeur('inscription-mdp');
    if (motDePasse !== this.valeur('inscription-mdp2')) {
      this.message('Les mots de passe ne correspondent pas.', 'ko');
      return;
    }
    this.occuper(bouton, 'Création…');
    try {
      await api.auth.post('register.php', {
        username: this.valeur('inscription-pseudo').trim(),
        email: this.valeur('inscription-email').trim(),
        password: motDePasse,
        cgu: this.trouver('#inscription-cgu', HTMLInputElement).checked ? '1' : '',
      });
      // Vers la page qui demande de confirmer l'adresse, plutôt que le compte.
      location.assign('/verifier');
    } catch (erreur) {
      console.error('<cs-inscription>', erreur);
      this.message(texteErreur(erreur, 'Erreur réseau, réessaie.'), 'ko');
      this.liberer(bouton, BOUTON);
    }
  }

  gabarit() {
    return html`
      <div class="avis" role="alert" hidden></div>
      <form>
        <div class="field">
          <label for="inscription-pseudo">Nom d'utilisateur</label>
          <input type="text" id="inscription-pseudo" name="username" placeholder="ex : composteur42" autocomplete="username" required>
          <div class="field-aide">Visible de tous dans les classements : évite ton vrai nom.</div>
        </div>
        <div class="field">
          <label for="inscription-email">Adresse email</label>
          <input type="email" id="inscription-email" name="email" placeholder="ex : nom@exemple.fr" autocomplete="email" required>
          <div class="field-aide">Un lien de confirmation y sera envoyé : sans confirmation, le compte est supprimé au bout de 30 jours.</div>
        </div>
        ${this.gabaritMotDePasse({ id: 'inscription-mdp', libelle: 'Mot de passe', indication: '8 caractères, lettres + chiffres', autocomplete: 'new-password' })}
        ${this.gabaritMotDePasse({ id: 'inscription-mdp2', libelle: 'Confirmer le mot de passe', indication: 'Retape le mot de passe', autocomplete: 'new-password' })}
        <label class="cgu-check">
          <input type="checkbox" id="inscription-cgu" required>
          <span>J'accepte les <a href="/cgu" target="_blank" rel="noopener">conditions d'utilisation</a>. Si j'ai moins de 15 ans, un parent est d'accord.</span>
        </label>
        <button type="submit" class="btn-submit">${BOUTON}</button>
        <p class="rgpd-info">Ton email sert uniquement à confirmer ton compte et à réinitialiser ton mot de passe : jamais de publicité, jamais de revente. Tu peux supprimer ton compte à tout moment. <a href="/confidentialite" target="_blank" rel="noopener">Tes données et tes droits</a></p>
      </form>
      <div class="auth-footer">Déjà inscrit ? <a href="/login">Se connecter</a></div>`;
  }
}

Inscription.definir();
