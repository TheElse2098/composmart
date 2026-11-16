/* ============================================================================
   contact.js — <cs-contact> : le formulaire « Nous contacter » (page /contact).

   Un membre connecté écrit un message (catégorie, sujet, texte) ; il devient
   un ticket qu'il suit depuis sa page de compte, rubrique « Mes
   signalements ». Un visiteur est invité à se connecter : le serveur refuse
   un message anonyme (et c'est lui qui vérifie, pas cette page).

   Les limites (longueur du sujet et du message, nombre de messages par heure)
   sont celles du serveur, dont la réponse s'affiche telle quelle.

   Usage :
     <cs-contact></cs-contact>
     <script type="module" src="/ui/pages/contact/contact.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { session } from '../../socle/session.js';

export class Contact extends Composant {
  static balise = 'cs-contact';
  static styles = [new URL('./contact.css', import.meta.url)];

  async monter() {
    this.rendre(this.gabaritAttente());
    this.ecouter('submit', 'form', (_formulaire, evenement) => {
      evenement.preventDefault(); // la réponse s'affiche ici, sans recharger la page
      this.#envoyer();
    });
    const moi = await session.moi();
    this.rendre(moi.logged_in ? this.gabaritFormulaire() : this.gabaritVisiteur());
  }

  /**
   * Affiche un message au-dessus du formulaire.
   * @param {'ok' | 'error'} sorte
   * @param {string} texte
   */
  #message(sorte, texte) {
    const zone = this.trouver('.msg');
    zone.className = 'msg ' + sorte;
    zone.textContent = texte;
    zone.hidden = false;
  }

  async #envoyer() {
    const formulaire = this.trouver('form');
    const bouton = this.trouver('[type="submit"]', HTMLButtonElement);
    if (bouton.disabled) return;
    this.trouver('.msg').hidden = true;
    bouton.disabled = true;
    bouton.textContent = 'Envoi…';
    try {
      await api.contact.post('send.php', {
        categorie: this.trouver('[name="categorie"]', HTMLSelectElement).value,
        sujet: this.trouver('[name="sujet"]', HTMLInputElement).value.trim(),
        message: this.trouver('[name="message"]', HTMLTextAreaElement).value.trim(),
      });
      this.#message('ok', '✅ Message envoyé, merci ! Tu peux suivre la réponse depuis ta page de compte, rubrique « Mes signalements ».');
      if (formulaire instanceof HTMLFormElement) formulaire.reset();
    } catch (erreur) {
      console.error('<cs-contact>', erreur);
      this.#message('error', texteErreur(erreur, 'Erreur réseau, réessaie.'));
    } finally {
      bouton.disabled = false;
      bouton.textContent = 'Envoyer';
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabaritAttente() {
    return html`<div class="contact-card"><div class="guard"><div class="guard-emoji">⏳</div><div class="guard-text">Chargement…</div></div></div>`;
  }

  gabaritVisiteur() {
    return html`
      <div class="contact-card">
        <div class="guard">
          <div class="guard-emoji">🔒</div>
          <div class="guard-text">Tu dois être connecté pour nous envoyer un message.</div>
          <div class="guard-btns">
            <a href="/login">Se connecter</a>
            <a href="/signin" class="secondary">Créer un compte</a>
          </div>
        </div>
      </div>`;
  }

  gabaritFormulaire() {
    return html`
      <div class="contact-card">
        <div class="msg" role="status" hidden></div>
        <form>
          <div class="field">
            <label for="contact-categorie">Catégorie</label>
            <select name="categorie" id="contact-categorie">
              <option value="question">Question</option>
              <option value="bug">Signaler un bug</option>
              <option value="suggestion">Suggestion</option>
              <option value="autre">Autre</option>
            </select>
          </div>
          <div class="field">
            <label for="contact-sujet">Sujet</label>
            <input type="text" name="sujet" id="contact-sujet" maxlength="150" placeholder="Résume ta demande en quelques mots" required>
          </div>
          <div class="field">
            <label for="contact-message">Message</label>
            <textarea name="message" id="contact-message" maxlength="3000" placeholder="Décris ta demande…" required></textarea>
          </div>
          <button type="submit" class="btn-submit">Envoyer</button>
          <p class="rgpd-info">Ton message et ton pseudo sont lus uniquement par l'équipe Composmart, et conservés 2 ans après la clôture de ta demande. <a href="/confidentialite#traitements" target="_blank" rel="noopener">En savoir plus</a></p>
        </form>
      </div>`;
  }
}

Contact.definir();
