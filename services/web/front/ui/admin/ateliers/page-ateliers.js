/* ============================================================================
   page-ateliers.js — classe de base des pages d'administration des ateliers
   (événements, anecdotes, images).

   Ce qu'elles ont en commun est ici : le lien de retour, l'en-tête, la zone
   de message (une confirmation s'efface seule, une erreur reste), et la
   feuille ateliers.css. Une page hérite de cette classe et pose son contenu :

     export class Exemple extends PageAteliers {
       static balise = 'cs-admin-exemple';
       static styles = [...PageAteliers.styles, new URL('./exemple.css', import.meta.url)];

       monter() {
         this.poserPage({ retour: …, badge: '💡 Exemple', titre: 'Exemple', corps: html`…` });
       }
     }
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { Html, html } from '../../socle/outils.js';

/** Durée d'affichage d'une confirmation (« Anecdote ajoutée. »). */
const DUREE_CONFIRMATION = 2200;

/**
 * @typedef {object} Page
 * @property {{ adresse: string, libelle: string }} retour
 * @property {string} badge
 * @property {string} titre
 * @property {string} [sousTitre]
 * @property {Html} [liens]   sous le titre (liens vers les autres pages)
 * @property {Html} corps
 */

export class PageAteliers extends Composant {
  /** Une page ajoute sa feuille à celle-ci :
   *  `static styles = [...PageAteliers.styles, new URL('./x.css', import.meta.url)]`.
   *  @type {(string | URL)[]} */
  static styles = [new URL('./ateliers.css', import.meta.url)];

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #effacement;

  /**
   * Pose la page entière. À appeler une fois, dans monter().
   * @param {Page} page
   */
  poserPage({ retour, badge, titre, sousTitre, liens, corps }) {
    this.classList.add('ateliers');
    this.rendre(html`
      <nav class="liens"><a href="${retour.adresse}">← ${retour.libelle}</a></nav>
      <div class="hero">
        <div class="hero-badge">${badge}</div>
        <h1>${titre}</h1>
        ${sousTitre && html`<p class="hero-sub">${sousTitre}</p>`}
        ${liens || ''}
      </div>
      <main class="page-content">
        <div class="msg msg-page" role="status" hidden></div>
        ${corps}
      </main>`);
    this.aLaFin(() => clearTimeout(this.#effacement));
  }

  /**
   * Affiche un message en tête de page. Une confirmation s'efface d'elle-même ;
   * une erreur reste jusqu'au message suivant.
   * @param {string} texte
   * @param {boolean} [ok]
   */
  message(texte, ok = false) {
    const zone = this.trouver('.msg-page');
    clearTimeout(this.#effacement);
    zone.textContent = texte;
    zone.className = 'msg msg-page ' + (ok ? 'ok' : 'error');
    zone.hidden = false;
    if (ok) this.#effacement = setTimeout(() => { zone.hidden = true; }, DUREE_CONFIRMATION);
  }

  /** Retire le message affiché. */
  effacerMessage() {
    clearTimeout(this.#effacement);
    this.trouver('.msg-page').hidden = true;
  }

  /**
   * Valeur d'un champ du composant, sans les espaces autour.
   * @param {string} selecteur
   * @returns {string}
   */
  champ(selecteur) {
    const element = this.querySelector(selecteur);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
      throw new Error('<' + this.localName + '> : aucun champ « ' + selecteur + ' »');
    }
    return element.value.trim();
  }

  /**
   * Remplit un champ du composant.
   * @param {string} selecteur
   * @param {string} valeur
   */
  remplir(selecteur, valeur) {
    const element = this.querySelector(selecteur);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error('<' + this.localName + '> : aucun champ « ' + selecteur + ' »');
    }
    element.value = valeur;
  }

  /**
   * Bouton occupé le temps d'un envoi : désactivé, avec un texte d'attente.
   * Rend la fonction qui le libère.
   * @param {string} selecteur
   * @param {string} attente
   * @returns {() => void}
   */
  occuper(selecteur, attente) {
    const bouton = this.trouver(selecteur, HTMLButtonElement);
    const texte = bouton.textContent;
    bouton.disabled = true;
    bouton.textContent = attente;
    return () => {
      bouton.disabled = false;
      bouton.textContent = texte;
    };
  }
}
