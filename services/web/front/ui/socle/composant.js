/* ============================================================================
   composant.js — classe de base de tous les morceaux d'interface.

   Un composant est une balise `<cs-…>` : le navigateur crée l'objet quand la
   balise apparaît dans la page et le prévient quand elle en sort. La classe de
   base s'occupe de ce qui est commun à tous :

     - charger les feuilles de style du composant avant le premier affichage ;
     - n'insérer que du HTML échappé (rendre() refuse une chaîne brute) ;
     - ne pas redessiner sous les doigts de quelqu'un qui saisit ;
     - retirer écoutes et minuteries quand le composant quitte la page ;
     - afficher une erreur à la place du composant plutôt que rien.

   Un composant se réduit alors à ce qui lui est propre :

     export class Exemple extends Composant {
       static balise = 'cs-exemple';
       static styles = [new URL('./exemple.css', import.meta.url)];

       async monter() {
         this.ecouter('click', '[data-action="recharger"]', () => this.#charger());
         await this.#charger();
       }

       async #charger() {
         this.rendre(this.gabarit(await api.cours.get('list.php')));
       }

       gabarit(d) { return html`<ul>${d.cours.map((c) => html`<li>${c.titre}</li>`)}</ul>`; }
     }
     Exemple.definir();

   Règles et recettes : docs/front.md.
   ============================================================================ */
import { texteErreur } from './api.js';
import { Html, html } from './outils.js';

/** Variables de couleur et polices du site. Chargées d'office : un composant
 *  doit s'afficher correctement même dans une page qui ne les référence pas
 *  elle-même (c'est le cas de pages pas encore migrées). */
const JETONS = new URL('../styles/jetons.css', import.meta.url);
const POLICES = new URL('../../assets/css/fonts.css', import.meta.url);

/** @type {Map<string, Promise<void>>} */
const feuilles = new Map();

/** Délai au bout duquel un composant s'affiche même si une feuille de style
 *  n'a toujours pas répondu. */
const ATTENTE_STYLE = 4000;

/**
 * Ajoute une feuille de style à la page, une seule fois. La promesse se résout
 * quand la feuille est appliquée. Une feuille introuvable, ou qui tarde trop,
 * est signalée dans la console mais ne bloque pas le composant : mal habillé
 * vaut mieux qu'absent.
 * @param {string | URL} adresse
 * @returns {Promise<void>}
 */
export function chargerStyle(adresse) {
  const href = new URL(String(adresse), document.baseURI).href;
  let demande = feuilles.get(href);
  if (!demande) {
    demande = new Promise((resoudre) => {
      /** Feuille déjà référencée par la page, ou balise à créer. */
      let lien = null;
      for (const present of document.querySelectorAll('link[rel="stylesheet"]')) {
        if (present instanceof HTMLLinkElement && present.href === href) lien = present;
      }
      // Déjà appliquée : c'est le cas des feuilles citées dans le <head>, que
      // le navigateur charge avant d'exécuter le moindre module.
      if (lien && lien.sheet) {
        resoudre();
        return;
      }

      const delai = setTimeout(() => {
        console.error('[ui] feuille de style toujours en attente : ' + href);
        resoudre();
      }, ATTENTE_STYLE);
      /** @param {boolean} trouvee */
      const finir = (trouvee) => {
        clearTimeout(delai);
        if (!trouvee) console.error('[ui] feuille de style introuvable : ' + href);
        resoudre();
      };

      // Référencée mais encore en chargement (posée à l'instant par un script
      // de la page) : on attend la même balise plutôt que d'en créer une autre.
      const nouvelle = !lien;
      if (!lien) {
        lien = document.createElement('link');
        lien.rel = 'stylesheet';
        lien.href = href;
      }
      lien.addEventListener('load', () => finir(true));
      lien.addEventListener('error', () => finir(false));
      if (nouvelle) document.head.appendChild(lien);
    });
    feuilles.set(href, demande);
  }
  return demande;
}

export class Composant extends HTMLElement {
  /** Nom de la balise, toujours `cs-…`. À définir dans chaque composant. */
  static balise = '';

  /** Feuilles de style du composant, chargées avant monter().
   *  @type {(string | URL)[]} */
  static styles = [];

  /** Enregistre la balise auprès du navigateur. À appeler une fois, en fin de fichier. */
  static definir() {
    if (!/^cs-[a-z0-9]+(-[a-z0-9]+)*$/.test(this.balise)) {
      throw new Error(this.name + ' : balise « ' + this.balise + ' » invalide (attendu : cs-nom)');
    }
    if (!customElements.get(this.balise)) customElements.define(this.balise, this);
  }

  #monte = false;

  /** Ce qu'il faut défaire quand le composant quitte la page.
   *  @type {(() => void)[]} */
  #nettoyages = [];

  /** Dernier HTML écrit dans chaque zone, pour rendreSiChange().
   *  @type {WeakMap<Element, string>} */
  #affiche = new WeakMap();

  // ── Cycle de vie ─────────────────────────────────────────────────────────

  /** Appelé par le navigateur quand la balise entre dans la page. */
  connectedCallback() {
    if (this.#monte) return; // simple déplacement dans la page
    this.#monte = true;
    this.#demarrer();
  }

  /** Appelé par le navigateur quand la balise sort de la page. */
  disconnectedCallback() {
    // Déplacer un élément (appendChild ailleurs) le fait sortir puis rentrer
    // dans la même tâche. On attend la fin de cette tâche pour ne nettoyer
    // que si le composant a réellement quitté la page.
    queueMicrotask(() => {
      if (this.isConnected || !this.#monte) return;
      this.#monte = false;
      for (const defaire of this.#nettoyages.splice(0)) defaire();
      this.demonter();
    });
  }

  async #demarrer() {
    const classe = /** @type {typeof Composant} */ (this.constructor);
    try {
      await Promise.all([JETONS, POLICES, ...classe.styles].map(chargerStyle));
      if (!this.#monte) return; // retiré de la page pendant le chargement
      await this.monter();
    } catch (erreur) {
      this.surErreur(erreur);
    }
  }

  /**
   * Premier affichage : poser les écoutes, charger les données, rendre.
   * À redéfinir. Peut être asynchrone ; une erreur non rattrapée arrive dans
   * surErreur().
   * @returns {void | Promise<void>}
   */
  monter() {}

  /** Le composant a quitté la page. Les écoutes et minuteries posées par les
   *  méthodes de cette classe sont déjà retirées ; à redéfinir pour le reste. */
  demonter() {}

  /**
   * Une erreur a échappé à monter(). Par défaut : détail dans la console,
   * message à la place du composant.
   * @param {unknown} erreur
   */
  surErreur(erreur) {
    console.error('<' + this.localName + '>', erreur);
    this.afficherErreur(texteErreur(erreur));
  }

  /**
   * Enregistre une action à exécuter quand le composant quitte la page.
   * @param {() => void} defaire
   */
  aLaFin(defaire) {
    this.#nettoyages.push(defaire);
  }

  // ── Affichage ────────────────────────────────────────────────────────────

  /**
   * Remplace le contenu du composant, ou d'une zone, par un gabarit.
   * @param {Html} gabarit  produit par html`…` ; une chaîne brute est refusée
   * @param {Element} [zone]  par défaut le composant entier
   */
  rendre(gabarit, zone = this) {
    this.#ecrire(zone, this.#texte(gabarit));
  }

  /**
   * Comme rendre(), pour un composant qui se rafraîchit tout seul (sondage,
   * minuterie). Ne touche pas à la page si le contenu est déjà celui affiché :
   * une animation en cours ne repart pas de zéro, une vidéo ne rembobine pas.
   * Ne redessine pas non plus pendant une saisie dans la zone : la valeur du
   * serveur n'écrase pas ce que quelqu'un est en train de taper.
   * @param {Html} gabarit
   * @param {Element} [zone]
   * @returns {boolean} vrai si la zone a été redessinée
   */
  rendreSiChange(gabarit, zone = this) {
    const texte = this.#texte(gabarit);
    if (this.#affiche.get(zone) === texte) return false;
    const actif = document.activeElement;
    if (actif && actif !== zone && zone.contains(actif)
        && actif.matches('input, textarea, select, [contenteditable]')) {
      return false;
    }
    this.#ecrire(zone, texte);
    return true;
  }

  /**
   * @param {Html} gabarit
   * @returns {string}
   */
  #texte(gabarit) {
    if (!(gabarit instanceof Html)) {
      throw new TypeError('<' + this.localName + '> : un gabarit html`…` est attendu, pas une chaîne');
    }
    return gabarit.toString();
  }

  /**
   * Seul endroit du front où du HTML entre dans la page.
   * @param {Element} zone
   * @param {string} texte
   */
  #ecrire(zone, texte) {
    zone.innerHTML = texte;
    this.#affiche.set(zone, texte);
  }

  /**
   * Message d'attente à la place du composant ou d'une zone.
   * @param {string} [texte]
   * @param {Element} [zone]
   */
  afficherChargement(texte = 'Chargement…', zone = this) {
    this.rendre(html`<p class="cs-etat">${texte}</p>`, zone);
  }

  /**
   * Message d'erreur à la place du composant ou d'une zone.
   * @param {string} message
   * @param {Element} [zone]
   */
  afficherErreur(message, zone = this) {
    this.rendre(html`<p class="cs-etat cs-etat--erreur" role="alert">⚠️ ${message}</p>`, zone);
  }

  // ── Recherche dans le composant ──────────────────────────────────────────

  /**
   * Premier élément du composant qui correspond au sélecteur. S'il n'existe
   * pas, lève une erreur qui le dit, plutôt que de laisser un `null` casser
   * dix lignes plus loin.
   * @param {string} selecteur
   * @returns {HTMLElement}
   */
  trouver(selecteur) {
    const element = this.querySelector(selecteur);
    if (!(element instanceof HTMLElement)) {
      throw new Error('<' + this.localName + '> : aucun élément « ' + selecteur + ' »');
    }
    return element;
  }

  /**
   * Tous les éléments du composant qui correspondent au sélecteur.
   * @param {string} selecteur
   * @returns {HTMLElement[]}
   */
  tous(selecteur) {
    /** @type {HTMLElement[]} */
    const trouves = [];
    for (const element of this.querySelectorAll(selecteur)) {
      if (element instanceof HTMLElement) trouves.push(element);
    }
    return trouves;
  }

  // ── Évènements et minuteries ─────────────────────────────────────────────

  /**
   * Réagit à un évènement survenu sur un élément du composant. L'écoute est
   * posée une fois sur le composant lui-même : elle vaut aussi pour les
   * éléments qu'un prochain rendre() créera.
   *
   *   this.ecouter('click', '[data-action="fermer"]', (bouton) => …);
   *
   * Seuls comptent les éléments que ce composant a lui-même affichés. Ce qui
   * se passe à l'intérieur d'un composant enfant ne le regarde pas : deux
   * composants imbriqués peuvent utiliser le même sélecteur sans se gêner.
   * Pour réagir à un enfant, écouter l'évènement qu'il émet, sur sa balise :
   *
   *   this.ecouter('choisi', 'cs-enfant', (enfant, evenement) => …);
   *
   * @param {string} type
   * @param {string} selecteur
   * @param {(element: HTMLElement, evenement: Event) => void} reaction
   */
  ecouter(type, selecteur, reaction) {
    this.ecouterSur(this, type, (evenement) => {
      const cible = evenement.target instanceof Element ? evenement.target.closest(selecteur) : null;
      if (cible instanceof HTMLElement && this.#affichePar(cible) === this) reaction(cible, evenement);
    });
  }

  /**
   * Le composant qui a affiché cet élément : son plus proche ancêtre composant.
   * @param {Element} element
   * @returns {Composant | null}
   */
  #affichePar(element) {
    let parent = element.parentElement;
    while (parent && !(parent instanceof Composant)) parent = parent.parentElement;
    return parent;
  }

  /**
   * Écoute une cible extérieure au composant : le document, la fenêtre, un
   * élément placé sous <body>. L'écoute est retirée quand le composant quitte
   * la page.
   * @param {EventTarget} cible
   * @param {string} type
   * @param {(evenement: Event) => void} reaction
   */
  ecouterSur(cible, type, reaction) {
    cible.addEventListener(type, reaction);
    this.aLaFin(() => cible.removeEventListener(type, reaction));
  }

  /**
   * Répète une action tant que le composant est dans la page.
   * @param {number} millisecondes
   * @param {() => void} action
   * @returns {() => void} à appeler pour arrêter plus tôt
   */
  minuterie(millisecondes, action) {
    const numero = setInterval(action, millisecondes);
    const arreter = () => clearInterval(numero);
    this.aLaFin(arreter);
    return arreter;
  }

  /**
   * Prévient les composants parents : l'évènement remonte dans la page.
   * @param {string} nom
   * @param {unknown} [detail]
   */
  emettre(nom, detail) {
    this.dispatchEvent(new CustomEvent(nom, { detail, bubbles: true }));
  }
}
