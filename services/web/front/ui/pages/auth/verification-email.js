/* ============================================================================
   verification-email.js — <cs-verification-email> : la page de confirmation
   de l'adresse email (/verifier).

   Deux façons d'y arriver :
     - depuis le lien du mail (/verifier?token=…) : le jeton est envoyé au
       serveur, qui confirme l'adresse ou dit que le lien a expiré ;
     - juste après l'inscription (/verifier) : la page dit d'aller ouvrir le
       mail, et permet de le renvoyer.

   Le jeton part en POST, jamais dans une requête GET : un antivirus ou un
   client mail qui précharge les liens consommerait sinon le lien avant le
   clic de la personne.

   Usage :
     <cs-verification-email></cs-verification-email>
     <script type="module" src="/ui/pages/auth/verification-email.js"></script>
   ============================================================================ */
import { ErreurApi, api, texteErreur } from '../../socle/api.js';
import { Html, html } from '../../socle/outils.js';
import { session } from '../../socle/session.js';
import { CarteAuth } from './carte-auth.js';

/**
 * @typedef {object} Etat  ce que la carte montre
 * @property {string} icone
 * @property {string} titre
 * @property {Html | string} texte
 * @property {Html} [actions]  boutons et liens sous le texte
 */

const RENVOYER = 'Renvoyer le lien';

export class VerificationEmail extends CarteAuth {
  static balise = 'cs-verification-email';

  async demarrer() {
    this.poserCarte({ titre: "Confirmation de l'email", centre: true }, this.gabaritEtat({ icone: '⏳', titre: 'Un instant…', texte: '' }));
    this.ecouter('click', '[data-action="renvoyer"]', (bouton) => this.#renvoyer(bouton));

    const jeton = new URLSearchParams(location.search).get('token');
    if (jeton) await this.#confirmer(jeton);
    else await this.#attendre();
  }

  /** @param {Etat} etat */
  #montrer(etat) {
    this.rendre(this.gabaritEtat(etat), this.trouver('.auth-body'));
  }

  /** Arrivée depuis le lien du mail. @param {string} jeton */
  async #confirmer(jeton) {
    try {
      await api.auth.post('verify.php', { token: jeton });
      this.changerTitre('Compte confirmé');
      this.#montrer({
        icone: '✅', titre: "C'est confirmé !",
        texte: 'Ton adresse email est validée. Ta progression est sauvegardée sur ton compte.',
        actions: html`<a href="/cours" class="btn-submit">Découvrir les cours</a>`,
      });
    } catch (erreur) {
      console.error('<cs-verification-email>', erreur);
      if (erreur instanceof ErreurApi && erreur.statut === 0) {
        this.#montrer({ icone: '⚠️', titre: 'Erreur réseau', texte: 'Réessaie dans un instant.' });
        return;
      }
      this.changerTitre('Lien invalide');
      this.#montrer({
        icone: '⚠️', titre: 'Ce lien ne fonctionne plus',
        texte: texteErreur(erreur, 'Le lien est invalide ou a expiré.'),
        actions: html`
          <button type="button" class="btn-submit" data-action="renvoyer">Recevoir un nouveau lien</button>
          <a href="/login" class="lien-secondaire">Se connecter</a>`,
      });
    }
  }

  /** Arrivée juste après l'inscription : on attend que la personne ouvre le mail. */
  async #attendre() {
    const moi = await session.moi();
    if (!moi.logged_in) {
      this.#montrer({
        icone: '✉️', titre: 'Confirme ton adresse',
        texte: 'Ouvre le lien reçu par email pour activer ton compte.',
        actions: html`<a href="/login" class="btn-submit">Se connecter</a>`,
      });
      return;
    }
    if (moi.email_verifie) {
      this.changerTitre('Compte confirmé');
      this.#montrer({
        icone: '✅', titre: 'Ton compte est déjà confirmé',
        texte: 'Rien à faire de plus, bonne lecture !',
        actions: html`<a href="/cours" class="btn-submit">Découvrir les cours</a>`,
      });
      return;
    }
    this.#montrer({
      icone: '✉️', titre: 'Vérifie ta boîte mail',
      texte: html`Un lien de confirmation vient d'être envoyé à <strong>${moi.email || 'ton adresse'}</strong>.<br>Pense à regarder dans les indésirables.`,
      actions: html`
        <button type="button" class="btn-submit" data-action="renvoyer">${RENVOYER}</button>
        <a href="/compte" class="lien-secondaire">Aller sur mon profil</a>`,
    });
  }

  /** @param {HTMLElement} bouton */
  async #renvoyer(bouton) {
    if (!(bouton instanceof HTMLButtonElement) || bouton.disabled) return;
    const libelle = bouton.textContent || RENVOYER;
    this.occuper(bouton, 'Envoi…');
    try {
      await api.auth.post('resend.php');
      this.message('Email envoyé ! Vérifie ta boîte de réception.', 'ok');
      bouton.textContent = 'Lien renvoyé'; // reste inactif : inutile d'en demander un second
    } catch (erreur) {
      // 401 : la session a expiré, il faut se reconnecter pour renvoyer.
      console.error('<cs-verification-email>', erreur);
      this.message(texteErreur(erreur, 'Envoi impossible.'), 'ko');
      this.liberer(bouton, libelle);
    }
  }

  /** @param {Etat} etat */
  gabaritEtat(etat) {
    return html`
      <div class="etat-icone">${etat.icone}</div>
      <div class="etat-titre">${etat.titre}</div>
      ${etat.texte && html`<div class="etat-texte">${etat.texte}</div>`}
      ${etat.actions}
      <div class="avis" role="status" hidden></div>`;
  }
}

VerificationEmail.definir();
