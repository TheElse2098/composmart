/* ============================================================================
   fenetre.js — classe de base des fenêtres : un panneau posé par-dessus la
   page, sur un fond assombri (détail d'une entrée, formulaire de correction).

   Ce qui est commun à toutes est ici : le cadre, l'ouverture, la fermeture
   (bouton, clic à côté, Échap), la page figée derrière, l'habillage
   (styles/fenetre.css). Une fenêtre se réduit à son contenu :

     export class Exemple extends Fenetre {
       static balise = 'cs-exemple';
       static styles = [...Fenetre.styles, new URL('./exemple.css', import.meta.url)];

       monter() {
         this.poserFenetre(html`
           <div class="fenetre__titre">Titre</div>
           …
           <div class="fenetre__actions">
             <button type="button" class="fenetre__annuler" data-action="fermer">Annuler</button>
             <button type="button" class="fenetre__valider" data-action="enregistrer">Enregistrer</button>
           </div>`);
         this.ecouter('click', '[data-action="enregistrer"]', () => this.#enregistrer());
       }

       ouvrir(donnees) {
         this.desQuePosee(() => { …remplir… ; this.montrer(); });
       }
     }

   Le composant parent pose la balise dans son gabarit et l'ouvre par une
   méthode : `this.trouver('cs-exemple', Exemple).ouvrir(donnees)`.

   Tout élément `data-action="fermer"` ferme la fenêtre. Pour une simple
   question (oui / non) ou un message, utiliser confirmer() et informer() de
   composants/dialogue : ce n'est pas le rôle d'une fenêtre.
   ============================================================================ */
import { Composant } from './composant.js';
import { Html, html } from './outils.js';

export class Fenetre extends Composant {
  /** Une fenêtre ajoute sa feuille à celle-ci :
   *  `static styles = [...Fenetre.styles, new URL('./x.css', import.meta.url)]`.
   *  @type {(string | URL)[]} */
  static styles = [new URL('../styles/fenetre.css', import.meta.url)];

  /** Ce qui attend que le cadre soit posé. @type {(() => void) | null} */
  #enAttente = null;

  /**
   * Pose le cadre, fermé, avec son contenu. À appeler une fois, dans monter().
   *
   * Deux cadres existent. Le cadre simple entoure un formulaire court d'une
   * marge. Le cadre « en colonne » n'a pas de marge : un en-tête fixe
   * (`.fenetre__tete`, avec son `.fenetre__titre` et sa croix
   * `.fenetre__fermer`), puis un corps qui défile seul — pour un contenu long.
   *
   * @param {Html} contenu
   * @param {{ colonne?: boolean }} [options]
   */
  poserFenetre(contenu, { colonne = false } = {}) {
    // Une ouverture demandée avant la pose est servie une fois monter() terminé.
    queueMicrotask(() => {
      const action = this.#enAttente;
      this.#enAttente = null;
      if (action && this.isConnected) action();
    });
    this.rendre(html`<div class="fenetre__fond${colonne && ' fenetre__fond--colonne'}"><div class="fenetre__boite${colonne && ' fenetre__boite--colonne'}" role="dialog" aria-modal="true">${contenu}</div></div>`);
    this.ecouter('click', '[data-action="fermer"]', () => this.fermer());
    this.ecouter('click', '.fenetre__fond', (fond, evenement) => {
      if (evenement.target === fond) this.fermer(); // clic à côté de la fenêtre
    });
    this.ecouterSur(document, 'keydown', (evenement) => {
      // Une boîte de confirmation ouverte par-dessus garde la touche pour elle.
      if (evenement instanceof KeyboardEvent && evenement.key === 'Escape' && !document.querySelector('cs-dialogue')) this.fermer();
    });
    // Retirée de la page encore ouverte : la page ne doit pas rester figée.
    this.aLaFin(() => { if (this.ouverte) document.body.style.overflow = ''; });
  }

  /** Le cadre est-il posé ? Faux tant que la feuille de style n'est pas arrivée. */
  get posee() {
    return this.querySelector('.fenetre__fond') !== null;
  }

  /**
   * Exécute l'action tout de suite si le cadre est posé, sinon dès qu'il le
   * sera : un clic peut précéder l'arrivée de la feuille de style. À utiliser
   * dans la méthode qui ouvre la fenêtre. Une seule action attend, la dernière.
   * @param {() => void} action
   */
  desQuePosee(action) {
    if (this.posee) action();
    else this.#enAttente = action;
  }

  get ouverte() {
    const fond = this.querySelector('.fenetre__fond');
    return fond !== null && fond.classList.contains('ouverte');
  }

  /** Affiche la fenêtre et fige la page derrière elle. */
  montrer() {
    this.trouver('.fenetre__fond').classList.add('ouverte');
    document.body.style.overflow = 'hidden';
  }

  /** Ferme la fenêtre. Sans effet si elle l'est déjà. */
  fermer() {
    if (!this.ouverte) return;
    this.trouver('.fenetre__fond').classList.remove('ouverte');
    document.body.style.overflow = '';
    this.aLaFermeture();
  }

  /** La fenêtre vient d'être fermée. À redéfinir pour oublier ce qu'elle montrait. */
  aLaFermeture() {}
}
