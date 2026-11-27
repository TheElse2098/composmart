/* ============================================================================
   choix-tags.js — <cs-choix-tags> : un sélecteur de tags à pastilles.

   Remplace la saisie « nature, hiver, chiffre-choc » séparée par des virgules,
   qui a trois défauts : rien ne montre quels tags existent déjà, une faute de
   frappe crée silencieusement un tag jumeau qui ne retrouvera jamais ses
   images, et il faut connaître la convention de séparateur. Ici on clique ce
   qui existe, et le (+) ne sert qu'à créer ce qui manque.

   Reprend assets/js/tag-picker.js, que la console d'animation utilise encore
   (phase 10 de la refonte).

   Les tags sont normalisés exactement comme côté serveur (minuscules, espaces
   resserrés, 40 caractères) : ce qui est affiché est ce qui sera enregistré.

   Usage :
     <cs-choix-tags></cs-choix-tags>
     const tags = this.trouver('cs-choix-tags', ChoixTags);
     tags.configurer({ disponibles: [{ tag: 'nature', n: 4 }], choisis: ['nature'], creation: true, tout: true });
     tags.valeur();                 // ['nature', …]
     this.ecouter('tags', 'cs-choix-tags', …);   // à chaque modification
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

/**
 * @typedef {{ tag: string, n?: number }} TagDisponible
 * @typedef {object} ReglageTags
 * @property {TagDisponible[]} [disponibles]  le vocabulaire existant
 * @property {string[]} [choisis]             la sélection de départ
 * @property {boolean} [creation]             afficher le (+) ; vrai par défaut
 * @property {boolean} [tout]                 afficher « Tous » / « Aucun »
 * @property {string} [messageVide]
 */

/**
 * Même règle que img_tags_parser() / anec_mots_parser() côté PHP.
 * @param {unknown} t
 */
export function normaliserTag(t) {
  return String(t == null ? '' : t).trim().replace(/[ \t]+/g, ' ').toLowerCase().slice(0, 40);
}

export class ChoixTags extends Composant {
  static balise = 'cs-choix-tags';
  static styles = [new URL('./choix-tags.css', import.meta.url)];

  /** @type {TagDisponible[]} */
  #dispo = [];
  /** @type {string[]} */
  #choisis = [];
  #creation = true;
  #tout = false;
  #messageVide = 'Aucun tag pour le moment.';
  /** Le champ de création est ouvert. */
  #enCreation = false;

  monter() {
    this.ecouter('click', '[data-tag]', (b) => this.#basculer(b.dataset.tag || ''));
    this.ecouter('click', '[data-action="creer"]', () => {
      this.#enCreation = true;
      this.#dessiner();
      const champ = this.querySelector('.tgp-neuf input');
      if (champ instanceof HTMLElement) champ.focus();
    });
    this.ecouter('click', '[data-action="ajouter"]', () => this.#valider());
    this.ecouter('click', '[data-action="annuler"]', () => this.#fermerCreation());
    this.ecouter('keydown', '.tgp-neuf input', (_c, e) => {
      if (!(e instanceof KeyboardEvent)) return;
      if (e.key === 'Enter') { e.preventDefault(); this.#valider(); }
      if (e.key === 'Escape') { e.preventDefault(); this.#fermerCreation(); }
    });
    this.ecouter('click', '[data-action="tout"]', () => this.#basculerTout());
    this.#dessiner();
  }

  /** @param {ReglageTags} reglage */
  configurer({ disponibles = [], choisis = [], creation = true, tout = false, messageVide }) {
    this.#dispo = disponibles.slice();
    this.#choisis = choisis.map(normaliserTag).filter(Boolean);
    this.#creation = creation;
    this.#tout = tout;
    if (messageVide) this.#messageVide = messageVide;
    this.apresMontage(() => this.#dessiner());
  }

  /** La sélection. @returns {string[]} */
  valeur() {
    return this.#choisis.slice();
  }

  /** Remplace la sélection. @param {string[]} tags */
  definir(tags) {
    this.#choisis = (tags || []).map(normaliserTag).filter(Boolean);
    this.apresMontage(() => this.#dessiner());
  }

  /** Remplace le vocabulaire. @param {TagDisponible[]} liste */
  disponibles(liste) {
    this.#dispo = (liste || []).slice();
    this.apresMontage(() => this.#dessiner());
  }

  #prevenir() {
    this.emettre('tags', this.valeur());
  }

  /** @param {string} tag */
  #basculer(tag) {
    const i = this.#choisis.indexOf(tag);
    if (i < 0) this.#choisis.push(tag);
    else this.#choisis.splice(i, 1);
    this.#dessiner();
    this.#prevenir();
  }

  #valider() {
    const champ = this.querySelector('.tgp-neuf input');
    if (!(champ instanceof HTMLInputElement)) return;
    const tag = normaliserTag(champ.value);
    if (!tag) { champ.focus(); return; }
    // Un tag déjà connu n'est pas recréé : il est simplement sélectionné.
    if (!this.#dispo.some((d) => d.tag === tag)) this.#dispo.push({ tag, n: 0 });
    if (!this.#choisis.includes(tag)) this.#choisis.push(tag);
    this.#enCreation = false;
    this.#dessiner();
    this.#prevenir();
  }

  #fermerCreation() {
    this.#enCreation = false;
    this.#dessiner();
  }

  #basculerTout() {
    const complet = this.#dispo.every((d) => this.#choisis.includes(d.tag));
    if (complet) {
      // On ne vide que ce qui vient du vocabulaire : un tag orphelin
      // sélectionné à la main n'a pas à disparaître dans l'opération.
      this.#choisis = this.#choisis.filter((t) => !this.#dispo.some((d) => d.tag === t));
    } else {
      for (const d of this.#dispo) if (!this.#choisis.includes(d.tag)) this.#choisis.push(d.tag);
    }
    this.#dessiner();
    this.#prevenir();
  }

  #dessiner() {
    this.rendre(this.gabarit());
  }

  gabarit() {
    const dispo = this.#dispo;
    const choisis = this.#choisis;
    // Tags sélectionnés qui ne sont pas (ou plus) dans le vocabulaire : ils
    // restent visibles et décochables, sinon on ne pourrait plus les retirer
    // d'un événement dont la dernière image vient d'être supprimée.
    const orphelins = choisis.filter((t) => !dispo.some((d) => d.tag === t));
    const complet = dispo.every((d) => choisis.includes(d.tag));
    return html`
      ${dispo.map((d) => {
        const on = choisis.includes(d.tag);
        return html`<button type="button" class="tgp-chip${on && ' on'}" data-tag="${d.tag}" aria-pressed="${on ? 'true' : 'false'}">${d.tag}${d.n ? html`<span class="n"> ${d.n}</span>` : ''}</button>`;
      })}
      ${orphelins.map((t) => html`<button type="button" class="tgp-chip on" data-tag="${t}" title="Ce tag n'est plus porté par aucune image">${t} ⚠</button>`)}
      ${!dispo.length && !choisis.length && html`<span class="tgp-vide">${this.#messageVide}</span>`}
      ${this.#creation && html`<button type="button" class="tgp-plus" data-action="creer" title="Créer un tag" aria-label="Créer un tag">+</button>`}
      ${this.#tout && dispo.length > 0 && html`<span class="tgp-sep"></span><button type="button" class="tgp-tout" data-action="tout">${complet ? 'Aucun' : 'Tous'}</button>`}
      ${this.#enCreation && html`
        <div class="tgp-neuf">
          <input type="text" maxlength="40" placeholder="Nouveau tag" aria-label="Nouveau tag">
          <button type="button" class="tgp-chip on" data-action="ajouter">Ajouter</button>
          <button type="button" class="tgp-chip" data-action="annuler">Annuler</button>
        </div>`}`;
  }
}

ChoixTags.definir();
