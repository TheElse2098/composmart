/* ============================================================================
   lancement.js — <cs-lancement> : la création du compte administrateur
   initial (/launchpad).

   Sur un site neuf, sans aucun administrateur, cette page crée le premier.
   Dès qu'un administrateur existe, elle ne fait plus que renvoyer vers
   /compte. C'est le serveur qui le sait et qui refuse un second compte
   fondateur : cette page ne fait que suivre sa réponse.

   Le compte fondateur est créé sans lien de confirmation (personne ne pourrait
   le lui envoyer) : le serveur le marque vérifié d'office. L'email reste
   demandé, pour « mot de passe oublié ».

   Usage :
     <cs-lancement></cs-lancement>
     <script type="module" src="/ui/pages/auth/lancement.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { html } from '../../socle/outils.js';
import { CarteAuth } from './carte-auth.js';

const BOUTON = '🚀 Créer le compte admin';

/** Le temps de lire « Admin déjà configuré », puis de voir « Compte créé ». */
const AVANT_COMPTE_DEJA = 1800;
const AVANT_COMPTE_CREE = 1000;

export class Lancement extends CarteAuth {
  static balise = 'cs-lancement';

  async demarrer() {
    this.poserCarte({ titre: 'Configuration', sansTitre: true, centre: true }, html`
      <div class="etat-icone"><span class="etat-tourne">🚀</span></div>
      <div class="etat-texte">Vérification en cours…</div>`);

    let dejaFait = false;
    try {
      /** @type {{ has_admin: boolean }} */
      const d = await api.auth.get('launchpad.php');
      dejaFait = d.has_admin;
    } catch (erreur) {
      // Le serveur ne répond pas : le formulaire est proposé, c'est lui qui refusera s'il le faut.
      console.error('<cs-lancement>', erreur);
    }
    if (dejaFait) this.#dejaFait();
    else this.#formulaire();
  }

  #dejaFait() {
    this.poserCarte({ titre: 'Admin déjà configuré', sansTitre: true, centre: true }, html`
      <div class="etat-icone">🔐</div>
      <div class="etat-titre">Admin déjà configuré</div>
      <div class="etat-texte">Redirection vers ton compte…</div>`);
    this.#allerAuCompte(AVANT_COMPTE_DEJA);
  }

  #formulaire() {
    this.poserCarte({ titre: 'Créer le compte admin', pastille: '🛠️ Configuration initiale', sousTitre: 'Ce compte aura tous les droits.' }, this.gabaritFormulaire());
    this.ecouter('submit', 'form', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#envoyer();
    });
  }

  /** @param {number} delai */
  #allerAuCompte(delai) {
    const attente = setTimeout(() => location.assign('/compte'), delai);
    this.aLaFin(() => clearTimeout(attente));
  }

  async #envoyer() {
    const bouton = this.trouver('[type="submit"]', HTMLButtonElement);
    if (bouton.disabled) return;
    this.effacerMessage();
    const motDePasse = this.valeur('lancement-mdp');
    if (motDePasse !== this.valeur('lancement-mdp2')) {
      this.message('Les mots de passe ne correspondent pas.', 'ko');
      return;
    }
    this.occuper(bouton, 'Création…');
    try {
      await api.auth.post('launchpad.php', {
        username: this.valeur('lancement-pseudo').trim(),
        email: this.valeur('lancement-email').trim(),
        password: motDePasse,
      });
      bouton.textContent = '✓ Compte créé, redirection…';
      this.#allerAuCompte(AVANT_COMPTE_CREE);
    } catch (erreur) {
      console.error('<cs-lancement>', erreur);
      this.message(texteErreur(erreur, 'Erreur réseau, réessaie.'), 'ko');
      this.liberer(bouton, BOUTON);
    }
  }

  gabaritFormulaire() {
    return html`
      <div class="warn-box">⚠️ Aucun administrateur n'est enregistré. Ce formulaire ne s'affiche qu'une seule fois — une fois un admin créé, cette page redirige vers /compte.</div>
      <div class="avis" role="alert" hidden></div>
      <form>
        <div class="field">
          <label for="lancement-pseudo">Nom d'utilisateur</label>
          <input type="text" id="lancement-pseudo" name="username" placeholder="ex : admin" autocomplete="username" required>
        </div>
        <div class="field">
          <label for="lancement-email">Adresse email</label>
          <input type="email" id="lancement-email" name="email" placeholder="ex : admin@composmart.fr" autocomplete="email" required>
        </div>
        ${this.gabaritMotDePasse({ id: 'lancement-mdp', libelle: 'Mot de passe', indication: '8 caractères, lettres + chiffres', autocomplete: 'new-password' })}
        ${this.gabaritMotDePasse({ id: 'lancement-mdp2', libelle: 'Confirmer le mot de passe', indication: 'Retape le mot de passe', autocomplete: 'new-password' })}
        <button type="submit" class="btn-submit">${BOUTON}</button>
      </form>`;
  }
}

Lancement.definir();
