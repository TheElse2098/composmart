/* ============================================================================
   carte-auth.js — classe de base des six pages d'authentification.

   Chaque page (connexion, inscription, mot de passe oublié, nouveau mot de
   passe, confirmation de l'email, compte admin initial) est une carte seule :
   un en-tête (logo, titre) et un corps. Ce qui leur est commun est ici :

     poserCarte(options, corps)  la carte entière
     message(texte, sorte)       un message au-dessus du formulaire (`.avis`)
     occuper(bouton, texte)      bouton inactif pendant un envoi
     liberer(bouton, texte)      et de nouveau utilisable
   et, d'office, le bouton 👁 qui affiche ou masque un mot de passe.

   Une page hérite de cette classe et écrit demarrer() :

     export class Connexion extends CarteAuth {
       static balise = 'cs-connexion';
       demarrer() {
         this.poserCarte({ titre: 'Se connecter' }, this.gabaritFormulaire());
         this.ecouter('submit', 'form', …);
       }
     }

   Habillage : auth.css, dans ce dossier.
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { Html, html } from '../../socle/outils.js';

/**
 * @typedef {object} OptionsCarte
 * @property {string} titre
 * @property {string} [pastille]     au-dessus du titre (compte admin initial)
 * @property {string} [sousTitre]    sous le titre
 * @property {boolean} [centre]      corps centré, pour un état plutôt qu'un formulaire
 * @property {boolean} [sansTitre]   en-tête réduit au logo
 */

export class CarteAuth extends Composant {
  /** Une page ajoute ses propres feuilles à celle-ci, s'il en faut.
   *  @type {(string | URL)[]} */
  static styles = [new URL('./auth.css', import.meta.url)];

  monter() {
    // Le bouton 👁 de chaque mot de passe, d'où qu'il vienne dans la carte.
    this.ecouter('click', '[data-afficher]', (bouton) => {
      const champ = this.querySelector('#' + bouton.dataset.afficher);
      if (!(champ instanceof HTMLInputElement)) return;
      const visible = champ.type === 'password';
      champ.type = visible ? 'text' : 'password';
      bouton.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    });
    return this.demarrer();
  }

  /**
   * Le contenu propre à la page : poser la carte, ses écoutes, ses demandes.
   * À redéfinir.
   * @returns {void | Promise<void>}
   */
  demarrer() {}

  /**
   * Pose (ou repose) la carte entière.
   * @param {OptionsCarte} options
   * @param {Html} corps
   */
  poserCarte(options, corps) {
    this.rendre(html`
      <main class="auth-card">
        <div class="auth-header">
          <a href="/" class="auth-logo">Compos<span>mart</span></a>
          ${options.pastille && html`<div class="auth-badge">${options.pastille}</div>`}
          ${!options.sansTitre && html`<h1 class="auth-title">${options.titre}</h1>`}
          ${options.sousTitre && html`<div class="auth-subtitle">${options.sousTitre}</div>`}
        </div>
        <div class="auth-body${options.centre ? ' centre' : ''}">${corps}</div>
      </main>`);
  }

  /** Change le titre de la carte, sans toucher au reste. @param {string} titre */
  changerTitre(titre) {
    this.trouver('.auth-title').textContent = titre;
  }

  /**
   * Affiche un message dans la zone `.avis` de la carte.
   * @param {string} texte
   * @param {'ok' | 'ko'} sorte
   */
  message(texte, sorte) {
    const avis = this.trouver('.avis');
    avis.className = 'avis ' + sorte;
    avis.textContent = texte;
    avis.hidden = false;
  }

  /** Efface le message. */
  effacerMessage() {
    const avis = this.querySelector('.avis');
    if (avis instanceof HTMLElement) avis.hidden = true;
  }

  /**
   * @param {HTMLButtonElement} bouton
   * @param {string} texte  pendant l'envoi : « Connexion… »
   */
  occuper(bouton, texte) {
    bouton.disabled = true;
    bouton.textContent = texte;
  }

  /**
   * @param {HTMLButtonElement} bouton
   * @param {string} texte  le libellé d'origine
   */
  liberer(bouton, texte) {
    bouton.disabled = false;
    bouton.textContent = texte;
  }

  /**
   * Le champ d'un mot de passe, avec son bouton 👁.
   * @param {{ id: string, libelle: string, indication: string, autocomplete: string }} champ
   */
  gabaritMotDePasse(champ) {
    return html`
      <div class="field">
        <label for="${champ.id}">${champ.libelle}</label>
        <div class="pass-wrap">
          <input type="password" id="${champ.id}" name="${champ.id}" placeholder="${champ.indication}" autocomplete="${champ.autocomplete}" required>
          <button type="button" class="toggle-pass" data-afficher="${champ.id}" aria-label="Afficher le mot de passe">👁</button>
        </div>
      </div>`;
  }

  /** La valeur d'un champ de la carte. @param {string} id */
  valeur(id) {
    return this.trouver('#' + id, HTMLInputElement).value;
  }
}
