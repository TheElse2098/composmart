/* ============================================================================
   mot-mystere.js — <cs-mot-mystere> : le jeu « Mot mystère » (/jeu-mot-mystere).

   Un indice, les lettres du mot dans le désordre ; on les replace dans
   l'ordre. Un clic sur une case remplie rend sa lettre. Mot trouvé du premier
   coup, au deuxième, ou après : les points baissent (règles du jeu). « Passer »
   montre le mot et ne rapporte rien.

   Contenu (mots et indices) et règles (nombre de mots, points selon le nombre
   d'essais) : /jeux-admin.
   ============================================================================ */
import { html } from '../../socle/outils.js';
import { Jeu, melanger } from './jeu.js';

/**
 * @typedef {object} Mot
 * @property {string} mot
 * @property {string} indice
 *
 * @typedef {{ lettre: string, tuile: number }} Placee  une lettre posée, et la tuile d'où elle vient
 */

/** Le temps de voir le mot juste, ou le mot révélé, avant le suivant. */
const APRES_REUSSITE = 900;
const APRES_PASSE = 1100;
/** Le temps de voir que la réponse est fausse avant de la retirer. */
const APRES_ECHEC = 600;

/**
 * Les lettres d'un mot dans le désordre, jamais dans l'ordre du mot (sauf
 * pour un mot d'une lettre, ou fait d'une seule lettre répétée).
 * @param {string} mot
 * @param {(lettres: string[]) => string[]} [melange]
 * @returns {string[]}
 */
export function tuilesDe(mot, melange = melanger) {
  const lettres = melange(mot.split(''));
  if (lettres.join('') === mot && mot.length > 1) return [lettres[1], lettres[0], ...lettres.slice(2)];
  return lettres;
}

export class MotMystere extends Jeu {
  static balise = 'cs-mot-mystere';
  static slug = 'mot-mystere';
  static pastille = '🔤 Mot mystère';
  static titre = 'Retrouve le mot caché';
  static styles = [...Jeu.styles, new URL('./mot-mystere.css', import.meta.url)];

  /** @type {Mot[]} */
  #mots = [];
  #manche = 0;
  #score = 0;
  /** Essais ratés sur le mot en cours. */
  #erreurs = 0;
  /** Les lettres proposées pour ce mot, une par tuile. @type {string[]} */
  #tuiles = [];
  /** Les lettres posées, dans l'ordre. @type {Placee[]} */
  #reponse = [];
  /** Le mot est trouvé ou révélé : plus rien ne se joue jusqu'au suivant. */
  #fige = false;

  get #nombre() { return this.jeu.regles.nb_mots; }
  get #mot() { return this.#mots[this.#manche].mot; }

  preparer() {
    this.ecouter('click', '.tile', (tuile) => this.#poser(Number(tuile.dataset.tuile)));
    this.ecouter('click', '.slot', (caseMot) => this.#retirer(Number(caseMot.dataset.place)));
    this.ecouter('click', '[data-action="effacer"]', () => { if (!this.#fige) this.#toutRetirer(); });
    this.ecouter('click', '[data-action="passer"]', () => this.#passer());
  }

  nouvellePartie() {
    this.#mots = melanger(this.jeu.items).slice(0, this.#nombre);
    this.#manche = 0;
    this.#score = 0;
    this.#montrerManche();
  }

  #montrerStatut() {
    this.statut(html`<span>Mot ${this.#manche + 1}/${this.#nombre}</span><span>Score : ${this.#score}</span>`);
  }

  #montrerManche() {
    this.#erreurs = 0;
    this.#reponse = [];
    this.#fige = false;
    const mot = this.#mot;
    this.#tuiles = tuilesDe(mot);
    this.#montrerStatut();
    this.rendre(html`💡 <b>Indice :</b> ${this.#mots[this.#manche].indice}`, this.trouver('.indice'));
    const cases = this.trouver('.slots');
    cases.className = 'slots';
    this.rendre(html`${mot.split('').map((_l, i) => html`<div class="slot" data-place="${i}"></div>`)}`, cases);
    this.rendre(html`${this.#tuiles.map((l, i) => html`<button type="button" class="tile" data-tuile="${i}">${l}</button>`)}`, this.trouver('.tiles'));
  }

  /** @param {number} i */
  #tuile(i) {
    return this.trouver('.tile[data-tuile="' + i + '"]', HTMLButtonElement);
  }

  /** @param {number} i  la tuile cliquée */
  #poser(i) {
    if (this.#fige || this.#reponse.length >= this.#mot.length) return;
    const tuile = this.#tuile(i);
    if (tuile.disabled) return;
    tuile.disabled = true;
    this.#reponse.push({ lettre: this.#tuiles[i], tuile: i });
    this.#montrerReponse();
    if (this.#reponse.length === this.#mot.length) this.#verifier();
  }

  /** @param {number} place  la case cliquée */
  #retirer(place) {
    if (this.#fige || place >= this.#reponse.length) return;
    const [retiree] = this.#reponse.splice(place, 1);
    this.#tuile(retiree.tuile).disabled = false;
    this.#montrerReponse();
  }

  #toutRetirer() {
    for (const p of this.#reponse) this.#tuile(p.tuile).disabled = false;
    this.#reponse = [];
    this.#montrerReponse();
  }

  #montrerReponse() {
    this.tous('.slot').forEach((caseMot, i) => {
      caseMot.textContent = this.#reponse[i] ? this.#reponse[i].lettre : '';
      caseMot.classList.toggle('filled', !!this.#reponse[i]);
    });
  }

  #verifier() {
    const cases = this.trouver('.slots');
    if (this.#reponse.map((p) => p.lettre).join('') === this.#mot) {
      this.#fige = true;
      cases.classList.add('good');
      // Premier essai, deuxième, troisième et suivants : les points des règles.
      this.#score += this.jeu.regles.points[Math.min(this.#erreurs, 2)];
      this.#montrerStatut();
      this.attendre(APRES_REUSSITE, () => this.#suivant());
      return;
    }
    this.#erreurs++;
    cases.classList.add('bad');
    this.attendre(APRES_ECHEC, () => {
      cases.classList.remove('bad');
      this.#toutRetirer();
    });
  }

  /** Révèle le mot, sans points, et passe au suivant. */
  #passer() {
    if (this.#fige) return;
    this.#fige = true;
    const mot = this.#mot;
    this.tous('.slot').forEach((caseMot, i) => {
      caseMot.textContent = mot[i];
      caseMot.classList.add('filled');
    });
    for (const tuile of this.tous('.tile')) if (tuile instanceof HTMLButtonElement) tuile.disabled = true;
    this.attendre(APRES_PASSE, () => this.#suivant());
  }

  #suivant() {
    this.#manche++;
    if (this.#manche >= this.#nombre) this.terminer(this.#score);
    else this.#montrerManche();
  }

  gabaritStatut() {
    return html`<span>Mot 1/8</span><span>Score : 0</span>`;
  }

  gabaritZone() {
    return html`
      <div class="indice"></div>
      <div class="slots"></div>
      <div class="tiles"></div>
      <div class="game-actions">
        <button type="button" class="btn-effacer" data-action="effacer">⌫ Effacer</button>
        <button type="button" class="btn-passer" data-action="passer">⏭ Passer</button>
      </div>`;
  }
}

MotMystere.definir();
