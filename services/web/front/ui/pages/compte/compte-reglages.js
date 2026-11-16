/* ============================================================================
   compte-reglages.js — <cs-compte-reglages> : le panneau « Mon compte » de la
   page de compte.

   Ce que le site sait de l'identité du membre (pseudo, adresse email, état de
   sa confirmation, date d'inscription) et ce qu'il peut y faire :
     - se faire renvoyer le lien de confirmation, tant que l'adresse n'est pas
       confirmée (le serveur limite à 3 envois par heure) ;
     - changer d'adresse email, mot de passe à l'appui ;
     - télécharger ses données (droit d'accès et de portabilité, RGPD).
   L'adresse sert à récupérer le compte : elle doit rester consultable ici,
   pas seulement dans le rappel qui disparaît une fois l'adresse confirmée.

   Toutes les règles sont côté serveur (mot de passe exigé, limites d'envoi) ;
   ce composant affiche ses réponses, phrase pour phrase.

   Usage, dans la page de compte :
     <cs-compte-reglages></cs-compte-reglages>
     this.trouver('cs-compte-reglages', CompteReglages).configurer(profil);
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { enregistrer } from '../../socle/fichier.js';
import { html, moisAnnee } from '../../socle/outils.js';

/**
 * Ce que le panneau affiche du membre (un extrait de /api/auth/profile.php).
 * @typedef {object} Identite
 * @property {string} username
 * @property {string | null} email
 * @property {boolean} email_verifie
 * @property {string} membre_depuis
 */

/** Délai avant de recharger la page, le temps de lire le message de réussite. */
const AVANT_RECHARGEMENT = 2500;

export class CompteReglages extends Composant {
  static balise = 'cs-compte-reglages';
  static styles = [new URL('./compte-reglages.css', import.meta.url)];

  monter() {
    this.ecouter('click', '[data-action="renvoyer"]', (bouton) => this.#renvoyer(bouton));
    this.ecouter('click', '[data-action="ouvrir-email"]', () => {
      const formulaire = this.trouver('.email-form');
      formulaire.hidden = !formulaire.hidden;
      if (!formulaire.hidden) this.trouver('[name="email"]').focus();
    });
    this.ecouter('submit', '.email-form', (_formulaire, evenement) => {
      evenement.preventDefault(); // pas de rechargement : la réponse s'affiche ici
      this.#changerEmail();
    });
    this.ecouter('click', '[data-action="exporter"]', (bouton) => this.#exporter(bouton));
  }

  /**
   * Affiche le panneau pour un membre.
   * @param {Identite} identite
   */
  configurer(identite) {
    this.apresMontage(() => this.rendre(this.gabarit(identite)));
  }

  /**
   * Écrit un message sous un bouton, ou l'efface.
   * @param {string} zone   `renvoi`, `export`, `email`
   * @param {string} texte  vide : rien à dire
   */
  #message(zone, texte) {
    const element = this.trouver('[data-message="' + zone + '"]');
    element.textContent = texte;
    element.hidden = texte === '';
  }

  /** @param {HTMLElement} bouton */
  async #renvoyer(bouton) {
    if (!(bouton instanceof HTMLButtonElement)) return;
    bouton.disabled = true;
    bouton.textContent = 'Envoi…';
    try {
      await api.auth.post('resend.php');
      this.#message('renvoi', 'Lien envoyé, regarde ta boîte mail.');
      bouton.textContent = 'Lien envoyé ✓'; // reste inactif : inutile d'en demander un second
    } catch (erreur) {
      console.error('<cs-compte-reglages>', erreur);
      this.#message('renvoi', texteErreur(erreur, "L'envoi a échoué."));
      bouton.textContent = 'Réessayer';
      bouton.disabled = false;
    }
  }

  async #changerEmail() {
    const bouton = this.trouver('.email-form [type="submit"]', HTMLButtonElement);
    if (bouton.disabled) return;
    bouton.disabled = true;
    try {
      /** @type {{ mail_envoye: boolean }} */
      const d = await api.auth.post('change_email.php', {
        email: this.trouver('[name="email"]', HTMLInputElement).value.trim(),
        password: this.trouver('[name="password"]', HTMLInputElement).value,
      });
      this.#message('email', d.mail_envoye
        ? 'Adresse changée. Ouvre le lien reçu sur la nouvelle adresse pour la confirmer.'
        : "Adresse changée, mais le mail de confirmation n'est pas parti : utilise « Renvoyer le lien ».");
      // La page entière dépend de l'adresse (rappel de confirmation, statut) : on la recharge.
      const attente = setTimeout(() => location.reload(), AVANT_RECHARGEMENT);
      this.aLaFin(() => clearTimeout(attente));
    } catch (erreur) {
      console.error('<cs-compte-reglages>', erreur);
      this.#message('email', texteErreur(erreur, 'La modification a échoué.'));
      bouton.disabled = false;
    }
  }

  /** @param {HTMLElement} bouton */
  async #exporter(bouton) {
    if (!(bouton instanceof HTMLButtonElement)) return;
    bouton.disabled = true;
    this.#message('export', '');
    try {
      const fichier = await api.auth.telecharger('export.php');
      enregistrer(fichier.nom || 'composmart-mes-donnees.json', fichier.contenu);
    } catch (erreur) {
      console.error('<cs-compte-reglages>', erreur);
      this.#message('export', texteErreur(erreur, 'Le téléchargement a échoué.'));
    } finally {
      bouton.disabled = false;
    }
  }

  // ── Gabarit ───────────────────────────────────────────────────────────────

  /** @param {Identite} u */
  gabarit(u) {
    return html`
      <section class="panel">
        <div class="panel-head">👤 Mon compte</div>
        <div class="info-list">
          <div class="info-row"><span class="info-key">Nom d'utilisateur</span><span class="info-value">${u.username}</span></div>
          <div class="info-row"><span class="info-key">Adresse email</span><span class="info-value">${u.email || '—'}</span></div>
          <div class="info-row"><span class="info-key">Statut</span><span class="info-value">${u.email_verifie
            ? html`<span class="info-tag ok">✓ Adresse confirmée</span>`
            : html`<span class="info-tag pending">⏳ En attente de confirmation</span>`}</span></div>
          <div class="info-row"><span class="info-key">Membre depuis</span><span class="info-value">${moisAnnee(u.membre_depuis)}</span></div>
        </div>

        ${!u.email_verifie && html`
          <button type="button" class="info-btn" data-action="renvoyer">Renvoyer le lien de confirmation</button>
          <div class="info-msg" data-message="renvoi" role="status" hidden></div>`}

        <div class="info-links">
          <a href="/mot-de-passe-oublie" class="info-link">Réinitialiser mon mot de passe</a>
          <button type="button" class="info-link" data-action="ouvrir-email">Changer d'adresse email</button>
          <button type="button" class="info-link" data-action="exporter">Télécharger mes données</button>
        </div>
        <div class="info-msg" data-message="export" role="status" hidden></div>

        <form class="email-form" hidden>
          <label for="compte-email-nouveau">Nouvelle adresse</label>
          <input type="email" id="compte-email-nouveau" name="email" autocomplete="email" required>
          <label for="compte-email-mdp">Ton mot de passe actuel</label>
          <input type="password" id="compte-email-mdp" name="password" autocomplete="current-password" required>
          <p class="email-aide">Un lien de confirmation sera envoyé à la nouvelle adresse ; l'ancienne sera prévenue. Pense à la confirmer : c'est elle qui servira à récupérer ton compte.</p>
          <button type="submit" class="info-btn">Changer mon adresse</button>
          <div class="info-msg" data-message="email" role="status" hidden></div>
        </form>

        <p class="email-aide">Pour changer de pseudo, <a href="/contact">écris-nous</a>.</p>
      </section>`;
  }
}

CompteReglages.definir();
