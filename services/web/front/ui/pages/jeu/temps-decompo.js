/* ============================================================================
   temps-decompo.js — <cs-temps-decompo> : le jeu « Combien de temps ? »
   (/jeu-temps-decompo).

   Un déchet ; on estime le temps qu'il met à se décomposer en glissant un
   curseur, d'un jour à mille ans. L'échelle est logarithmique : l'écart entre
   la réponse et la vérité se mesure en ordres de grandeur, et les paliers de
   précision des règles (tolérance, points, message) en découlent. Après
   validation, la vraie durée apparaît sur la ligne.

   Une partie mélange des déchets « courts » et « longs » (limite en jours
   dans les règles), pour qu'elle ne soit pas faite que de l'un ou de l'autre.

   Contenu (déchets, durées, explications) et règles : /jeux-admin.
   ============================================================================ */
import { html, pluriel } from '../../socle/outils.js';
import { Jeu, melanger } from './jeu.js';

/**
 * @typedef {object} Dechet
 * @property {string} emoji
 * @property {string} nom    « une peau de banane » : il suit « Combien de temps met »
 * @property {number} jours  la vraie durée
 * @property {string} info
 *
 * @typedef {object} Seuil  un palier de précision, du plus précis au plus large
 * @property {number} d      tolérance, en fraction de la ligne
 * @property {number} pts
 * @property {string} label
 */

/** L'échelle : d'un jour à mille ans. Une position p ∈ [0, 1] vaut 10^(p × log10(365 000)) jours. */
const JOURS_MAX = 365000;
const LOG_MAX = Math.log10(JOURS_MAX);

/** Les repères sous la ligne. */
const REPERES = [
  { libelle: '1 jour', jours: 1 },
  { libelle: '1 mois', jours: 30 },
  { libelle: '1 an', jours: 365 },
  { libelle: '10 ans', jours: 3650 },
  { libelle: '100 ans', jours: 36500 },
  { libelle: '1000 ans', jours: 365000 },
];

/** La largeur du pion du curseur : elle doit suivre celle de temps-decompo.css. */
const PION = 46;

/** @param {number} p @returns {number} jours */
export const versJours = (p) => Math.pow(10, p * LOG_MAX);
/** @param {number} jours @returns {number} position sur la ligne */
export const versPosition = (jours) => Math.log10(Math.max(1, jours)) / LOG_MAX;

/**
 * Une durée telle qu'on la dit : jours, semaines, mois, puis années.
 * @param {number} jours
 */
export function duree(jours) {
  if (jours < 14) return pluriel(Math.round(jours), 'jour', 'jours');
  if (jours < 60) return pluriel(Math.round(jours / 7), 'semaine', 'semaines');
  if (jours < 350) return Math.round(jours / 30) + ' mois';
  return pluriel(Math.round(jours / 365), 'an', 'ans');
}

/**
 * Le palier atteint pour un écart donné : son rang, ses points, son message.
 * Au-delà de la plus large tolérance : raté.
 * @param {Seuil[]} seuils
 * @param {number} ecart  en fraction de la ligne
 * @returns {{ rang: number, pts: number, label: string }}
 */
export function precision(seuils, ecart) {
  const rang = seuils.findIndex((s) => ecart <= s.d);
  return rang < 0 ? { rang, pts: 0, label: '❌ Raté !' } : { rang, pts: seuils[rang].pts, label: seuils[rang].label };
}

export class TempsDecompo extends Jeu {
  static balise = 'cs-temps-decompo';
  static slug = 'temps-decompo';
  static pastille = '⏳ Combien de temps ?';
  static titre = 'La nature prend son temps';
  static styles = [...Jeu.styles, new URL('./temps-decompo.css', import.meta.url)];

  /** @type {Dechet[]} */
  #dechets = [];
  #manche = 0;
  #score = 0;
  #valide = false;

  get #nombre() { return this.jeu.regles.nb_courts + this.jeu.regles.nb_longs; }
  get #curseur() { return this.trouver('input[type="range"]', HTMLInputElement); }

  preparer() {
    this.ecouter('input', 'input[type="range"]', () => this.#montrerBulle());
    this.ecouter('click', '[data-action="valider"]', () => this.#valider());
    this.ecouter('click', '[data-action="continuer"]', () => this.#continuer());
    // La ligne change de largeur : repères, bulle et vraie réponse suivent.
    this.ecouterSur(window, 'resize', () => {
      this.#placerReperes();
      this.#montrerBulle();
      if (this.#valide) this.#placerVraie();
    });
  }

  nouvellePartie() {
    const limite = this.jeu.regles.seuil_court;
    const courts = this.jeu.items.filter((/** @type {Dechet} */ d) => d.jours <= limite);
    const longs = this.jeu.items.filter((/** @type {Dechet} */ d) => d.jours > limite);
    this.#dechets = melanger(melanger(courts).slice(0, this.jeu.regles.nb_courts)
      .concat(melanger(longs).slice(0, this.jeu.regles.nb_longs)));
    this.#manche = 0;
    this.#score = 0;
    this.#montrerManche();
    this.#placerReperes(); // la zone est visible : la largeur de la ligne est connue
  }

  /**
   * La position horizontale (px) du centre du pion pour une position p de
   * l'échelle : le pion ne dépasse pas de la ligne, sa course fait largeur − PION.
   * @param {number} p
   */
  #enPixels(p) {
    return PION / 2 + p * (this.#curseur.offsetWidth - PION);
  }

  #placerReperes() {
    this.rendre(html`${REPERES.map((r) => html`<span class="tick">${r.libelle}</span>`)}`, this.trouver('.ticks'));
    this.tous('.tick').forEach((repere, i) => { repere.style.left = this.#enPixels(versPosition(REPERES[i].jours)) + 'px'; });
  }

  #montrerBulle() {
    const p = Number(this.#curseur.value) / 1000;
    const bulle = this.trouver('.bubble');
    bulle.textContent = '~' + duree(versJours(p));
    bulle.style.left = this.#enPixels(p) + 'px';
  }

  #placerVraie() {
    this.trouver('.true-marker').style.left = this.#enPixels(versPosition(this.#dechets[this.#manche].jours)) + 'px';
  }

  #montrerStatut() {
    this.statut(html`<span>Déchet ${this.#manche + 1}/${this.#nombre}</span><span>Score : ${this.#score}</span>`);
  }

  #montrerManche() {
    this.#valide = false;
    const dechet = this.#dechets[this.#manche];
    this.#montrerStatut();
    this.trouver('.item-emoji').textContent = dechet.emoji;
    this.trouver('.item-question').textContent = 'Combien de temps met ' + dechet.nom + ' à se décomposer ?';
    this.trouver('.feedback').className = 'feedback';
    const valider = this.trouver('[data-action="valider"]', HTMLButtonElement);
    valider.hidden = false;
    valider.disabled = false;
    this.trouver('[data-action="continuer"]').hidden = true;
    this.trouver('.true-marker').classList.remove('show');
    const curseur = this.#curseur;
    curseur.disabled = false;
    curseur.value = '500';
    this.#montrerBulle();
  }

  #valider() {
    if (this.#valide) return;
    this.#valide = true;
    this.#curseur.disabled = true;
    this.trouver('[data-action="valider"]').hidden = true;

    const dechet = this.#dechets[this.#manche];
    const ecart = Math.abs(Number(this.#curseur.value) / 1000 - versPosition(dechet.jours));
    const { rang, pts, label } = precision(this.jeu.regles.seuils, ecart);
    this.#score += pts;
    this.#montrerStatut();

    this.#placerVraie();
    this.trouver('.true-marker').classList.add('show');

    const retour = this.trouver('.feedback');
    retour.className = 'feedback ' + (rang === 0 ? 'ok' : pts >= 1 ? 'mid' : 'ko');
    this.rendre(html`<strong>${label} +${pluriel(pts, 'pt', 'pts')}</strong><br>Réponse : <strong>${duree(dechet.jours)}</strong>. ${dechet.info}`, retour);
    this.trouver('[data-action="continuer"]').hidden = false;
  }

  #continuer() {
    this.#manche++;
    if (this.#manche >= this.#nombre) this.terminer(this.#score);
    else this.#montrerManche();
  }

  gabaritStatut() {
    return html`<span>Déchet 1/10</span><span>Score : 0</span>`;
  }

  gabaritZone() {
    return html`
      <div class="item-emoji"></div>
      <div class="item-question"></div>
      <div class="slider-zone">
        <div class="bubble-wrap"><span class="bubble">~1 mois</span></div>
        <div class="track-wrap">
          <span class="true-marker">📍</span>
          <input type="range" min="0" max="1000" value="500" aria-label="Estimation de la durée de décomposition">
        </div>
        <div class="ticks"></div>
      </div>
      <button type="button" class="btn-valider" data-action="valider">Valider ✓</button>
      <div class="feedback" role="status"></div>
      <button type="button" class="btn-continuer" data-action="continuer" hidden>Continuer ➜</button>`;
  }
}

TempsDecompo.definir();
