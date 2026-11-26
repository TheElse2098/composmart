/* ============================================================================
   jeu-contenu.js — <cs-admin-jeu-contenu> : le contenu d'un mini-jeu (mots,
   déchets), dans l'éditeur. Une ligne par élément, des colonnes propres à
   chaque jeu (contenu-jeux.js), un filtre, l'ajout et le retrait.

   Le contenu peut compter des centaines de lignes : la saisie met à jour
   l'état sans redessiner (le curseur reste en place, la page reste fluide).
   Seuls l'ajout et le retrait d'une ligne redessinent la liste.

   Prévient son parent par « modifie ».

   Usage, dans <cs-admin-jeu> :
     const contenu = this.trouver('cs-admin-jeu-contenu', AdminJeuContenu);
     contenu.configurer({ slug, items, categories, regles });
     contenu.majRegles(regles);   // la limite court / long et le résumé suivent
     contenu.elements();          // le contenu à enregistrer
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { AIDES_CONTENU, COLONNES, aideJours, correspond, resumeContenu, seuilCourt } from './contenu-jeux.js';

/**
 * @typedef {import('./contenu-jeux.js').Element} Element
 * @typedef {import('./contenu-jeux.js').Colonne} Colonne
 * @typedef {{ slug: string, items: Element[], categories?: Record<string, string>, regles: any }} ReglageContenu
 */

export class AdminJeuContenu extends Composant {
  static balise = 'cs-admin-jeu-contenu';
  static styles = [new URL('./jeu-contenu.css', import.meta.url)];

  #slug = '';
  /** @type {Element[]} */
  #items = [];
  /** @type {Record<string, string> | undefined} */
  #categories = undefined;
  /** @type {any} */
  #regles = {};
  /** Les lignes ajoutées pendant cette visite, mises en évidence. @type {Set<Element>} */
  #neuves = new Set();

  monter() {
    this.rendre(html`
      <div class="carte-aide"></div>
      <div class="outils">
        <input type="text" class="recherche" placeholder="🔍 Filtrer les éléments…" aria-label="Filtrer les éléments">
        <button type="button" class="btn btn-vert btn-mini" data-action="ajouter">➕ Ajouter</button>
      </div>
      <div class="resume" role="status"></div>
      <div class="lignes"></div>`);
    this.ecouter('input', '.recherche', () => this.#filtrer());
    this.ecouter('input', '[data-k]', (champ) => this.#saisir(champ));
    this.ecouter('change', 'select[data-k]', (champ) => this.#saisir(champ));
    this.ecouter('click', '[data-retirer]', (b) => this.#retirer(Number(b.dataset.retirer)));
    this.ecouter('click', '[data-action="ajouter"]', () => this.#ajouter());
  }

  /** @param {ReglageContenu} reglage */
  configurer({ slug, items, categories, regles }) {
    this.apresMontage(() => {
      this.#slug = slug;
      this.#categories = categories;
      this.#items = items.map((it) => this.#normaliser(it));
      this.#regles = regles;
      this.#neuves.clear();
      this.trouver('.carte-aide').textContent = AIDES_CONTENU[slug] || '';
      this.trouver('.recherche', HTMLInputElement).value = '';
      this.#dessiner();
    });
  }

  /** Les règles ont changé : le résumé et les indications de durée suivent. @param {any} regles */
  majRegles(regles) {
    this.apresMontage(() => {
      this.#regles = regles;
      const seuil = seuilCourt(regles);
      for (const champ of this.tous('[data-k="jours"]')) {
        const aide = champ.parentElement && champ.parentElement.querySelector('.aide');
        if (aide && champ instanceof HTMLInputElement) aide.textContent = aideJours(champ.value, seuil);
      }
      this.#resume();
    });
  }

  /**
   * Le contenu tel qu'à envoyer : les colonnes du jeu, rien d'autre ; une
   * durée vide reste vide, sinon un nombre.
   * @returns {Element[]}
   */
  elements() {
    return this.#items.map((it) => this.#normaliser(it));
  }

  /**
   * Un élément réduit aux colonnes du jeu : un champ absent vaut vide, une
   * catégorie absente vaut la première (c'est ce qu'affiche son menu).
   * @param {Element} it
   * @returns {Element}
   */
  #normaliser(it) {
    /** @type {Element} */
    const propre = {};
    for (const c of COLONNES[this.#slug] || []) {
      const v = it[c.k] ?? '';
      propre[c.k] = c.type === 'cat' && v === '' && this.#categories ? Object.keys(this.#categories)[0] : v;
    }
    return propre;
  }

  /** @param {HTMLElement} champ */
  #saisir(champ) {
    if (!(champ instanceof HTMLInputElement || champ instanceof HTMLTextAreaElement || champ instanceof HTMLSelectElement)) return;
    const item = this.#items[Number(champ.dataset.i)];
    const cle = champ.dataset.k || '';
    if (!item) return;
    item[cle] = cle === 'jours' ? (champ.value === '' ? '' : Number(champ.value)) : champ.value;
    if (cle === 'jours') {
      const aide = champ.parentElement && champ.parentElement.querySelector('.aide');
      if (aide) aide.textContent = aideJours(champ.value, seuilCourt(this.#regles));
    }
    this.#resume();
    this.emettre('modifie');
  }

  /** @param {number} i */
  #retirer(i) {
    this.#items.splice(i, 1);
    this.#dessiner();
    this.emettre('modifie');
  }

  /** Une ligne vide en tête de liste, le filtre effacé pour qu'elle se voie. */
  #ajouter() {
    const item = this.#normaliser({});
    this.#items.unshift(item);
    this.#neuves.add(item);
    this.trouver('.recherche', HTMLInputElement).value = '';
    this.#dessiner();
    this.emettre('modifie');
    const premier = this.querySelector('.ligne [data-k]');
    if (premier instanceof HTMLElement) premier.focus();
  }

  #dessiner() {
    const colonnes = COLONNES[this.#slug] || [];
    this.rendre(html`${this.#items.map((it, i) => this.gabaritLigne(it, i, colonnes))}`, this.trouver('.lignes'));
    this.#filtrer();
    this.#resume();
  }

  #filtrer() {
    const filtre = this.trouver('.recherche', HTMLInputElement).value;
    for (const ligne of this.tous('.ligne')) {
      const item = this.#items[Number(ligne.dataset.ligne)];
      ligne.hidden = !!item && !correspond(item, filtre, this.#categories);
    }
  }

  #resume() {
    const morceaux = resumeContenu(this.#slug, this.#items, this.#regles, this.#categories);
    this.rendre(html`${morceaux.map((m) => (m.ko ? html`<span class="ko">${m.texte}</span>` : m.texte))}`, this.trouver('.resume'));
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /**
   * @param {Element} it
   * @param {number} i
   * @param {Colonne[]} colonnes
   */
  gabaritLigne(it, i, colonnes) {
    const seuil = seuilCourt(this.#regles);
    return html`
      <div class="ligne${this.#neuves.has(it) && ' neuve'}" data-ligne="${i}">
        <span class="ligne-n">${i + 1}</span>
        ${colonnes.map((c) => html`<div class="ch ch-${c.large ? 'large' : c.type}">${this.gabaritChamp(c, it, i, seuil)}</div>`)}
        <button type="button" class="suppr" data-retirer="${i}" title="Retirer cet élément" aria-label="Retirer l'élément ${i + 1}">✕</button>
      </div>`;
  }

  /**
   * @param {Colonne} c
   * @param {Element} it
   * @param {number} i
   * @param {number} seuil
   */
  gabaritChamp(c, it, i, seuil) {
    const valeur = it[c.k] ?? '';
    if (c.type === 'cat') {
      const categories = this.#categories || {};
      const choisie = valeur || Object.keys(categories)[0];
      return html`<select data-i="${i}" data-k="${c.k}" title="${c.titre}" aria-label="${c.titre}">
        ${Object.entries(categories).map(([v, libelle]) => html`<option value="${v}"${v === choisie && html` selected`}>${libelle}</option>`)}
      </select>`;
    }
    if (c.type === 'zone') {
      return html`<textarea data-i="${i}" data-k="${c.k}" rows="2" maxlength="${c.max}" placeholder="${c.titre}" title="${c.titre}" aria-label="${c.titre}">${valeur}</textarea>`;
    }
    if (c.type === 'jours') {
      return html`<input type="number" data-i="${i}" data-k="${c.k}" min="1" max="365000" step="1" value="${valeur}" placeholder="${c.titre}" title="${c.titre}" aria-label="${c.titre}">
        <div class="aide">${aideJours(valeur, seuil)}</div>`;
    }
    const longueur = c.type === 'emoji' ? 16 : c.type === 'mot' ? 20 : c.max;
    return html`<input type="text" data-i="${i}" data-k="${c.k}" maxlength="${longueur}" value="${valeur}" placeholder="${c.titre}" title="${c.titre}" aria-label="${c.titre}">`;
  }
}

AdminJeuContenu.definir();
