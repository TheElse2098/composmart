/* ============================================================================
   faux-dom.mjs — un navigateur en réduction, pour monter les composants sous
   Node et vérifier ce qu'ils affichent et ce qu'ils font d'un clic.

   Ce qu'il sait faire : lire le HTML écrit par les gabarits, retrouver un
   élément par un sélecteur simple, faire remonter un évènement, créer les
   composants enregistrés et les prévenir quand ils entrent dans la page ou en
   sortent, charger une feuille de style (pour de faux), répondre à fetch.

   Ce qu'il ne fait pas : aucune mise en page, aucune couleur, aucun CSS lu ;
   les sélecteurs se limitent à `balise`, `.classe`, `#id`, `[attribut]`,
   `[attribut="valeur"]`, leurs combinaisons, l'espace (descendant) et la
   virgule. Ce qui dépend d'un vrai rendu se vérifie sur le site déployé.

   Usage, AVANT d'importer un module de ui/ :
     import { installerFauxDom } from './faux-dom.mjs';
     const dom = installerFauxDom();
     await import('../../services/web/front/ui/pages/classement/classement.js');
     const page = dom.monter('<cs-classement></cs-classement>');
     await dom.stabiliser();
   ============================================================================ */

const VIDES = new Set(['br', 'hr', 'img', 'input', 'link', 'meta']);

/** @type {Record<string, string>} */
const ENTITES = { lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'" };

/** @param {string} texte */
const decoder = (texte) => texte.replace(/&(lt|gt|amp|quot|#39);/g, (_, nom) => ENTITES[nom]);

// ── Sélecteurs ──────────────────────────────────────────────────────────────

/**
 * @typedef {{ nom: string, classes: string[], id: string, attributs: { nom: string, valeur: string | null }[] }} Simple
 */

/**
 * @param {string} texte  un sélecteur sans espace ni virgule : `a.actif[data-x="1"]`
 * @returns {Simple}
 */
function lireSimple(texte) {
  const m = texte.match(/^([a-zA-Z][\w-]*|\*)?((?:\.[\w-]+|#[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/);
  if (!m) throw new Error('faux DOM : sélecteur non pris en charge « ' + texte + ' »');
  /** @type {Simple} */
  const simple = { nom: m[1] && m[1] !== '*' ? m[1].toLowerCase() : '', classes: [], id: '', attributs: [] };
  for (const partie of m[2].matchAll(/\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (partie[1]) simple.classes.push(partie[1]);
    else if (partie[2]) simple.id = partie[2];
    else simple.attributs.push({ nom: partie[3], valeur: partie[4] ?? null });
  }
  return simple;
}

/** Un sélecteur : des variantes (virgule), chacune une chaîne de descendants (espace).
 *  @param {string} selecteur @returns {Simple[][]} */
const lireSelecteur = (selecteur) => selecteur.split(',').map((variante) => variante.trim().split(/\s+/).map(lireSimple));

/** @param {FauxElement} element @param {Simple} simple */
function correspond(element, simple) {
  if (simple.nom && element.localName !== simple.nom) return false;
  if (simple.id && element.getAttribute('id') !== simple.id) return false;
  const classes = (element.getAttribute('class') || '').split(/\s+/);
  if (!simple.classes.every((c) => classes.includes(c))) return false;
  return simple.attributs.every((a) => element.hasAttribute(a.nom) && (a.valeur === null || element.getAttribute(a.nom) === a.valeur));
}

// ── Évènements ──────────────────────────────────────────────────────────────

export class FauxEvenement {
  /**
   * @param {string} type
   * @param {{ detail?: unknown, key?: string, bubbles?: boolean }} [options]
   */
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
    this.key = options.key;
    this.bubbles = options.bubbles ?? true;
    /** @type {FauxElement | null} */
    this.target = null;
  }

  preventDefault() {}
}

// ── Éléments ────────────────────────────────────────────────────────────────

export class FauxElement {
  /** @type {Map<string, Set<Function>>} */
  #ecoutes = new Map();
  #ecrit = '';

  /** @param {string} [nom] */
  constructor(nom = 'div') {
    this.localName = nom;
    /** @type {Map<string, string>} */
    this.attributs = new Map();
    /** Enfants : éléments et textes. @type {(FauxElement | string)[]} */
    this.noeuds = [];
    /** @type {FauxElement | null} */
    this.parentElement = null;
    /** Racine de la page (<body>, <head>) : ce qui y est attaché est « dans la page ». */
    this.racine = false;
    /** @type {Record<string, string>} */
    this.style = {};
  }

  // Attributs
  /** @param {string} nom */
  getAttribute(nom) { return this.attributs.has(nom) ? /** @type {string} */ (this.attributs.get(nom)) : null; }
  /** @param {string} nom @param {unknown} valeur */
  setAttribute(nom, valeur) { this.attributs.set(nom, String(valeur)); }
  /** @param {string} nom */
  hasAttribute(nom) { return this.attributs.has(nom); }
  /** @param {string} nom */
  removeAttribute(nom) { this.attributs.delete(nom); }

  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  set className(valeur) { this.setAttribute('class', valeur); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(valeur) { if (valeur) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(valeur) { if (valeur) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }

  get classList() {
    const lire = () => this.className.split(/\s+/).filter(Boolean);
    /** @param {string[]} classes */
    const ecrire = (classes) => { this.className = classes.join(' '); };
    return {
      contains: (/** @type {string} */ c) => lire().includes(c),
      add: (/** @type {string} */ c) => { if (!lire().includes(c)) ecrire([...lire(), c]); },
      remove: (/** @type {string} */ c) => { ecrire(lire().filter((x) => x !== c)); },
      toggle: (/** @type {string} */ c, /** @type {boolean} */ forcer) => {
        const mettre = forcer === undefined ? !lire().includes(c) : forcer;
        ecrire(mettre ? [...new Set([...lire(), c])] : lire().filter((x) => x !== c));
        return mettre;
      },
    };
  }

  /** `data-periode="jour"` se lit `dataset.periode`. @returns {Record<string, string>} */
  get dataset() {
    /** @type {Record<string, string>} */
    const donnees = {};
    for (const [nom, valeur] of this.attributs) {
      if (nom.startsWith('data-')) donnees[nom.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase())] = valeur;
    }
    return donnees;
  }

  // Contenu
  /** @returns {string} */
  get textContent() {
    return this.noeuds.map((n) => (typeof n === 'string' ? n : n.textContent)).join('');
  }

  set textContent(texte) {
    this.#vider();
    this.#ecrit = '';
    this.noeuds = [String(texte)];
  }

  /** Le dernier HTML écrit par `innerHTML = …` (pas une relecture de l'arbre). */
  get innerHTML() { return this.#ecrit; }

  set innerHTML(html) {
    this.#vider();
    this.#ecrit = html;
    for (const noeud of analyser(html)) this.#attacher(noeud);
  }

  get children() { return /** @type {FauxElement[]} */ (this.noeuds.filter((n) => typeof n !== 'string')); }

  #vider() {
    for (const enfant of this.children) {
      const etait = enfant.isConnected;
      enfant.parentElement = null;
      if (etait) enfant.#prevenir('disconnectedCallback');
    }
    this.noeuds = [];
  }

  /** @param {FauxElement | string} noeud */
  #attacher(noeud) {
    this.noeuds.push(noeud);
    if (typeof noeud === 'string') return;
    noeud.parentElement = this;
    if (this.isConnected) noeud.#prevenir('connectedCallback');
  }

  /** Prévient un élément et ses descendants, comme le navigateur le fait pour
   *  les composants. @param {'connectedCallback' | 'disconnectedCallback'} rappel */
  #prevenir(rappel) {
    const soi = /** @type {any} */ (this);
    if (typeof soi[rappel] === 'function') soi[rappel]();
    for (const enfant of this.children) enfant.#prevenir(rappel);
  }

  // Arbre
  /** @param {...(FauxElement | string)} noeuds */
  append(...noeuds) {
    for (const noeud of noeuds) {
      if (typeof noeud !== 'string') noeud.remove();
      this.#attacher(noeud);
    }
  }

  /** @param {FauxElement} noeud */
  appendChild(noeud) {
    this.append(noeud);
    return noeud;
  }

  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    const etait = this.isConnected;
    parent.noeuds = parent.noeuds.filter((n) => n !== this);
    this.parentElement = null;
    if (etait) this.#prevenir('disconnectedCallback');
  }

  get isConnected() {
    for (let e = /** @type {FauxElement | null} */ (this); e; e = e.parentElement) if (e.racine) return true;
    return false;
  }

  /** @param {FauxElement | null} autre */
  contains(autre) {
    for (let e = autre; e; e = e.parentElement) if (e === this) return true;
    return false;
  }

  /** @param {string} selecteur */
  matches(selecteur) {
    return lireSelecteur(selecteur).some((chaine) => {
      if (!correspond(this, chaine[chaine.length - 1])) return false;
      // Les sélecteurs précédents doivent correspondre à des ancêtres, dans l'ordre.
      let ancetre = this.parentElement;
      for (let i = chaine.length - 2; i >= 0; i--) {
        while (ancetre && !correspond(ancetre, chaine[i])) ancetre = ancetre.parentElement;
        if (!ancetre) return false;
        ancetre = ancetre.parentElement;
      }
      return true;
    });
  }

  /** @param {string} selecteur @returns {FauxElement | null} */
  closest(selecteur) {
    for (let e = /** @type {FauxElement | null} */ (this); e; e = e.parentElement) if (e.matches(selecteur)) return e;
    return null;
  }

  /** @param {string} selecteur @returns {FauxElement[]} */
  querySelectorAll(selecteur) {
    /** @type {FauxElement[]} */
    const trouves = [];
    for (const enfant of this.children) {
      if (enfant.matches(selecteur)) trouves.push(enfant);
      trouves.push(...enfant.querySelectorAll(selecteur));
    }
    return trouves;
  }

  /** @param {string} selecteur @returns {FauxElement | null} */
  querySelector(selecteur) {
    return this.querySelectorAll(selecteur)[0] ?? null;
  }

  // Évènements
  /** @param {string} type @param {Function} reaction */
  addEventListener(type, reaction) {
    if (!this.#ecoutes.has(type)) this.#ecoutes.set(type, new Set());
    this.#ecoutes.get(type)?.add(reaction);
  }

  /** @param {string} type @param {Function} reaction */
  removeEventListener(type, reaction) {
    this.#ecoutes.get(type)?.delete(reaction);
  }

  /** Nombre d'écoutes encore posées sur cet élément, tous types confondus. */
  get nombreEcoutes() {
    let n = 0;
    for (const reactions of this.#ecoutes.values()) n += reactions.size;
    return n;
  }

  /**
   * Distribue un évènement à cet élément puis, s'il « bulle », à ses parents.
   * @param {FauxEvenement} evenement
   */
  dispatchEvent(evenement) {
    if (!evenement.target) evenement.target = this;
    for (let e = /** @type {FauxElement | null} */ (this); e; e = evenement.bubbles ? e.parentElement : null) {
      for (const reaction of [...(e.#ecoutes.get(evenement.type) ?? [])]) reaction(evenement);
    }
    return true;
  }

  /** Un clic, comme celui d'un visiteur : il remonte jusqu'aux écoutes des parents. */
  click() {
    this.dispatchEvent(new FauxEvenement('click'));
  }
}

class HTMLElement extends FauxElement {}
class HTMLButtonElement extends HTMLElement {}
class HTMLAnchorElement extends HTMLElement {}
class HTMLLinkElement extends HTMLElement {
  get rel() { return this.getAttribute('rel') || ''; }
  set rel(valeur) { this.setAttribute('rel', valeur); }
  get href() { return this.getAttribute('href') || ''; }
  set href(valeur) { this.setAttribute('href', valeur); }
}

/** Composants enregistrés par customElements.define(). @type {Map<string, new () => FauxElement>} */
const definis = new Map();

/** @param {string} nom @returns {FauxElement} */
function creerElement(nom) {
  const Classe = definis.get(nom)
    ?? (nom === 'button' ? HTMLButtonElement : nom === 'a' ? HTMLAnchorElement : nom === 'link' ? HTMLLinkElement : HTMLElement);
  const element = new Classe();
  element.localName = nom;
  return element;
}

/**
 * Lit du HTML bien formé (celui des gabarits) et rend ses nœuds de premier niveau.
 * @param {string} html
 * @returns {(FauxElement | string)[]}
 */
export function analyser(html) {
  /** @type {(FauxElement | string)[]} */
  const racine = [];
  /** @type {FauxElement[]} */
  const pile = [];
  /** @param {FauxElement | string} noeud */
  const poser = (noeud) => {
    const parent = pile[pile.length - 1];
    if (!parent) { racine.push(noeud); return; }
    parent.noeuds.push(noeud);
    if (typeof noeud !== 'string') noeud.parentElement = parent;
  };

  const motif = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let fin = 0;
  for (const m of html.matchAll(motif)) {
    if (m.index !== fin) throw new Error('faux DOM : HTML illisible près de « ' + html.slice(fin, fin + 30) + ' »');
    fin = m.index + m[0].length;

    if (m[1]) {
      const ouvert = pile.pop();
      if (!ouvert || ouvert.localName !== m[1].toLowerCase()) {
        throw new Error('faux DOM : </' + m[1] + '> ferme <' + (ouvert ? ouvert.localName : '?') + '>');
      }
    } else if (m[2]) {
      const element = creerElement(m[2].toLowerCase());
      for (const a of m[3].matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) element.attributs.set(a[1], decoder(a[2] ?? ''));
      poser(element);
      if (!VIDES.has(element.localName) && !m[4]) pile.push(element);
    } else if (m[5] !== undefined) {
      poser(decoder(m[5]));
    }
  }
  if (fin !== html.length) throw new Error('faux DOM : HTML illisible près de « ' + html.slice(fin, fin + 30) + ' »');
  if (pile.length) throw new Error('faux DOM : <' + pile[pile.length - 1].localName + '> jamais refermé');
  return racine;
}

// ── Installation ────────────────────────────────────────────────────────────

/**
 * Installe les globales du navigateur dont le front a besoin.
 * @returns {{
 *   document: any,
 *   stockage: Map<string, string>,
 *   liensAjoutes: FauxElement[],
 *   monter: (html: string) => FauxElement,
 *   stabiliser: () => Promise<void>,
 *   vider: () => void,
 *   aller: (chemin: string) => void,
 * }}
 */
export function installerFauxDom() {
  const g = /** @type {any} */ (globalThis);
  if (g.__fauxDom) return g.__fauxDom;

  const body = new HTMLElement('body');
  body.racine = true;
  const head = new HTMLElement('head');
  head.racine = true;
  const html = new HTMLElement('html');
  const page = new FauxElement('#document');
  /** @type {FauxElement[]} */
  const liensAjoutes = [];
  const stockage = new Map();

  // Une feuille ajoutée au <head> se « charge » juste après ; une feuille dont
  // l'adresse contient « introuvable » échoue.
  const ajouter = head.append.bind(head);
  head.append = (...noeuds) => {
    ajouter(...noeuds);
    for (const noeud of noeuds) {
      if (typeof noeud === 'string' || noeud.localName !== 'link') continue;
      liensAjoutes.push(noeud);
      const echec = (noeud.getAttribute('href') || '').includes('introuvable');
      queueMicrotask(() => noeud.dispatchEvent(new FauxEvenement(echec ? 'error' : 'load', { bubbles: false })));
    }
  };

  const document = {
    baseURI: 'https://composmart.test/',
    /** @type {FauxElement | null} */
    activeElement: null,
    documentElement: html,
    body,
    head,
    createElement: creerElement,
    querySelectorAll: (/** @type {string} */ s) => [...head.querySelectorAll(s), ...body.querySelectorAll(s)],
    querySelector: (/** @type {string} */ s) => head.querySelector(s) ?? body.querySelector(s),
    addEventListener: page.addEventListener.bind(page),
    removeEventListener: page.removeEventListener.bind(page),
    dispatchEvent: page.dispatchEvent.bind(page),
  };

  g.Element = FauxElement;
  g.HTMLElement = HTMLElement;
  g.HTMLButtonElement = HTMLButtonElement;
  g.HTMLAnchorElement = HTMLAnchorElement;
  g.HTMLLinkElement = HTMLLinkElement;
  g.CustomEvent = FauxEvenement;
  g.KeyboardEvent = class KeyboardEvent extends FauxEvenement {};
  g.document = document;
  g.location = { pathname: '/' };
  g.customElements = {
    get: (/** @type {string} */ nom) => definis.get(nom),
    define: (/** @type {string} */ nom, /** @type {new () => FauxElement} */ classe) => { definis.set(nom, classe); },
  };
  Object.defineProperty(g, 'localStorage', {
    configurable: true,
    value: {
      getItem: (/** @type {string} */ cle) => (stockage.has(cle) ? stockage.get(cle) : null),
      setItem: (/** @type {string} */ cle, /** @type {string} */ valeur) => { stockage.set(cle, String(valeur)); },
    },
  });

  g.__fauxDom = {
    document,
    stockage,
    liensAjoutes,
    /** Écrit du HTML dans <body> et rend son premier élément. */
    monter(/** @type {string} */ source) {
      const conteneur = creerElement('div');
      body.append(conteneur);
      conteneur.innerHTML = source;
      return conteneur.children[0];
    },
    /** Laisse aboutir ce qui est en attente : feuilles, réponses du faux fetch, promesses. */
    async stabiliser() {
      for (let i = 0; i < 6; i++) await new Promise((resoudre) => setTimeout(resoudre, 0));
    },
    /** Retire tout de <body> (les composants en sont prévenus) et remet l'état de page à neuf. */
    vider() {
      for (const enfant of [...body.children]) enfant.remove();
      document.activeElement = null;
      body.style = {};
      g.location.pathname = '/';
      html.className = '';
      stockage.clear();
    },
    /** Change l'adresse de la page, pour le prochain composant monté. */
    aller(/** @type {string} */ chemin) { g.location.pathname = chemin; },
  };
  return g.__fauxDom;
}

/**
 * Remplace `fetch` par des réponses fixées d'avance et note les appels reçus.
 * @param {(adresse: string, options: any) => { statut?: number, corps?: unknown, texte?: string } | Error} repondre
 * @returns {{ appels: { adresse: string, options: any }[] }}
 */
export function fauxFetch(repondre) {
  /** @type {{ adresse: string, options: any }[]} */
  const appels = [];
  /** @type {any} */ (globalThis).fetch = async (/** @type {string} */ adresse, /** @type {any} */ options) => {
    appels.push({ adresse, options });
    const reponse = repondre(adresse, options);
    if (reponse instanceof Error) throw reponse;
    const texte = reponse.texte ?? (reponse.corps === undefined ? '' : JSON.stringify(reponse.corps));
    return new Response(texte, { status: reponse.statut ?? 200 });
  };
  return { appels };
}
