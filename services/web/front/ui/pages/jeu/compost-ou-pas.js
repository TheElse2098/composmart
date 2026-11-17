/* ============================================================================
   compost-ou-pas.js — <cs-compost-ou-pas> : le jeu « Compost ou pas ? »
   (/jeu-compost-ou-pas).

   Un déchet à la fois ; on répond « au compost », « avec prudence » ou
   « poubelle ». Un point par bonne réponse. Après chaque réponse, une courte
   explication, puis le déchet suivant.

   Catégorie d'un déchet : `oui` au compost sans réserve, `attention`
   seulement dans un compost mûr et bien conduit, `non` jamais. Avec trois
   réponses possibles, un « raté » nomme la bonne : sinon on ne sait pas
   laquelle des deux autres c'était.

   Contenu (déchets) et règles (nombre par partie) : /jeux-admin.
   ============================================================================ */
import { html } from '../../socle/outils.js';
import { Jeu, melanger } from './jeu.js';

/**
 * @typedef {object} Dechet
 * @property {string} emoji
 * @property {string} nom
 * @property {'oui' | 'attention' | 'non'} cat
 * @property {string} info  l'explication montrée après la réponse
 */

/** @type {Record<string, string>} */
export const CATEGORIES = { oui: 'Au compost', attention: 'Avec prudence', non: 'Poubelle' };

/** Le temps de lire l'explication avant le déchet suivant. */
const LECTURE = 2400;

export class CompostOuPas extends Jeu {
  static balise = 'cs-compost-ou-pas';
  static slug = 'compost-ou-pas';
  static pastille = '♻️ Compost ou pas ?';
  static titre = "Bien trier, ça s'apprend";
  static styles = [...Jeu.styles, new URL('./compost-ou-pas.css', import.meta.url)];

  /** @type {Dechet[]} */
  #dechets = [];
  #manche = 0;
  #score = 0;
  /** Une réponse est déjà donnée pour cette manche. */
  #repondu = false;

  get #nombre() { return this.jeu.regles.nb_items; }

  preparer() {
    this.ecouter('click', '[data-choix]', (bouton) => this.#repondre(/** @type {Dechet['cat']} */ (bouton.dataset.choix)));
  }

  nouvellePartie() {
    this.#dechets = melanger(this.jeu.items).slice(0, this.#nombre);
    this.#manche = 0;
    this.#score = 0;
    this.#montrerManche();
  }

  #montrerStatut() {
    this.statut(html`<span>Déchet ${this.#manche + 1}/${this.#nombre}</span><span>Score : ${this.#score}</span>`);
  }

  #montrerManche() {
    this.#repondu = false;
    const dechet = this.#dechets[this.#manche];
    this.#montrerStatut();
    this.trouver('.item-emoji').textContent = dechet.emoji;
    this.trouver('.item-nom').textContent = dechet.nom;
    this.trouver('.feedback').className = 'feedback';
    for (const bouton of this.tous('[data-choix]')) if (bouton instanceof HTMLButtonElement) bouton.disabled = false;
  }

  /** @param {Dechet['cat']} choix */
  #repondre(choix) {
    if (this.#repondu) return;
    this.#repondu = true;
    for (const bouton of this.tous('[data-choix]')) if (bouton instanceof HTMLButtonElement) bouton.disabled = true;

    const dechet = this.#dechets[this.#manche];
    const juste = choix === dechet.cat;
    if (juste) this.#score++;
    this.#montrerStatut();
    const retour = this.trouver('.feedback');
    retour.className = 'feedback ' + (juste ? 'ok' : 'ko');
    retour.textContent = juste
      ? '✓ Bien vu ! ' + dechet.info
      : '✗ Raté, c\'était « ' + CATEGORIES[dechet.cat] + ' ». ' + dechet.info;

    this.attendre(LECTURE, () => {
      this.#manche++;
      if (this.#manche >= this.#nombre) this.terminer(this.#score);
      else this.#montrerManche();
    });
  }

  gabaritStatut() {
    return html`<span>Déchet 1/12</span><span>Score : 0</span>`;
  }

  gabaritZone() {
    return html`
      <div class="item-emoji"></div>
      <div class="item-nom"></div>
      <div class="choices">
        <button type="button" class="btn-oui" data-choix="oui">✅ Au compost</button>
        <button type="button" class="btn-attention" data-choix="attention">⚠️ Avec prudence</button>
        <button type="button" class="btn-non" data-choix="non">🗑️ Poubelle</button>
      </div>
      <div class="feedback" role="status"></div>
      <div class="regle"><b>Avec prudence</b> = acceptable seulement dans un compost mûr et bien géré, en petite quantité et enfoui. À éviter en bac de balcon ou en compost jeune.</div>`;
  }
}

CompostOuPas.definir();
