/* ============================================================================
   tri-eclair.js — <cs-tri-eclair> : le jeu « Tri éclair » (/jeu-tri-eclair).

   Un déchet à mettre dans le bon bac (compost, recyclage, poubelle) avant la
   fin du chrono, en le faisant glisser ou en touchant le bac. Une erreur ou
   un temps écoulé coûte une vie ; plus de vies, la partie s'arrête. Le chrono
   part de `duree_debut` secondes et en perd `duree_pas` à chaque manche,
   jamais sous `duree_min` : ça accélère, sans devenir injouable.

   Le glisser passe par les Pointer Events (souris et doigt avec une seule
   API) et setPointerCapture, qui garde le geste même si le doigt sort de
   l'objet : le glisser-déposer HTML natif est peu fiable sur mobile.

   Contenu (déchets, propre à ce jeu : il lui faut trois bacs nets, pas la
   nuance « avec prudence » de Compost ou pas) et règles : /jeux-admin.
   ============================================================================ */
import { html, pluriel } from '../../socle/outils.js';
import { Jeu, melanger } from './jeu.js';

/**
 * @typedef {'compost' | 'recyclage' | 'poubelle'} Bac
 *
 * @typedef {object} Dechet
 * @property {string} emoji
 * @property {string} nom
 * @property {Bac} cat
 * @property {string} info
 *
 * @typedef {{ pointeur: number, decalageX: number, decalageY: number }} Geste  un glisser en cours
 *
 * @typedef {object} Regles
 * @property {number} nb_items     déchets par partie
 * @property {number} vies
 * @property {number} duree_debut  secondes, première manche
 * @property {number} duree_pas    secondes perdues à chaque manche
 * @property {number} duree_min    plancher, en secondes
 */

/** @type {Record<Bac, string>} */
export const BACS = { compost: 'Compost', recyclage: 'Recyclage', poubelle: 'Poubelle' };

/** Le temps de lire le retour avant la manche suivante. */
const LECTURE = 1100;

/**
 * La durée du chrono d'une manche, en secondes.
 * @param {{ duree_debut: number, duree_pas: number, duree_min: number }} regles
 * @param {number} manche  0 pour la première
 */
export function dureeManche(regles, manche) {
  return Math.max(regles.duree_min, regles.duree_debut - manche * regles.duree_pas);
}

/**
 * La consigne, qui cite les règles.
 * @param {{ vies: number, duree_pas: number }} regles
 */
export function consigne(regles) {
  return 'Glisse le déchet vers le bon bac, ou touche directement le bac. '
    + pluriel(regles.vies, 'vie', 'vies')
    + (regles.duree_pas > 0 ? ', et le temps se resserre à chaque manche !' : ', et le chrono ne pardonne pas !');
}

export class TriEclair extends Jeu {
  static balise = 'cs-tri-eclair';
  static slug = 'tri-eclair';
  static pastille = '⚡ Tri éclair';
  static titre = 'Vite, dans le bon bac !';
  static styles = [...Jeu.styles, new URL('./tri-eclair.css', import.meta.url)];

  /** @type {Dechet[]} */
  #dechets = [];
  #manche = 0;
  #score = 0;
  #vies = 0;
  /** La manche est tranchée : plus rien ne compte jusqu'à la suivante. */
  #tranche = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #chrono = undefined;
  /** @type {Geste | null} */
  #geste = null;

  get #regles() { return /** @type {Regles} */ (this.jeu.regles); }
  get #nombre() { return this.#regles.nb_items; }
  get #objet() { return this.trouver('.item-chip'); }

  preparer() {
    this.aLaFin(() => clearTimeout(this.#chrono));
    this.trouver('.regle').textContent = consigne(this.#regles);
    this.ecouter('click', '[data-bac]', (bac) => this.#trancher(/** @type {Bac} */ (bac.dataset.bac)));
    this.ecouter('pointerdown', '.item-chip', (_objet, evenement) => this.#saisir(evenement));
    this.ecouter('pointermove', '.item-chip', (_objet, evenement) => this.#deplacer(evenement));
    this.ecouter('pointerup', '.item-chip', (_objet, evenement) => this.#lacher(evenement));
    this.ecouter('pointercancel', '.item-chip', () => this.#annulerGeste());
  }

  nouvellePartie() {
    this.#dechets = melanger(this.jeu.items).slice(0, this.#nombre);
    this.#manche = 0;
    this.#score = 0;
    this.#vies = this.#regles.vies;
    this.#montrerManche();
  }

  #montrerStatut() {
    const vies = Math.max(0, this.#vies);
    this.statut(html`<span>Déchet ${this.#manche + 1}/${this.#nombre}</span><span>${'❤️'.repeat(vies) + '🤍'.repeat(this.#regles.vies - vies)}</span><span>Score : ${this.#score}</span>`);
  }

  /** @param {boolean} geles */
  #gelerBacs(geles) {
    for (const bac of this.tous('[data-bac]')) if (bac instanceof HTMLButtonElement) bac.disabled = geles;
  }

  #montrerManche() {
    this.#tranche = false;
    const dechet = this.#dechets[this.#manche];
    this.#montrerStatut();
    this.trouver('.item-emoji').textContent = dechet.emoji;
    this.trouver('.item-nom').textContent = dechet.nom;
    this.trouver('.feedback').className = 'feedback';
    this.#remettreObjet();
    this.#gelerBacs(false);
    this.#lancerChrono(dureeManche(this.#regles, this.#manche));
  }

  /** @param {number} secondes */
  #lancerChrono(secondes) {
    const barre = this.trouver('.timer-bar');
    barre.style.transition = 'none';
    barre.style.width = '100%';
    // Lire une mesure force le navigateur à appliquer la largeur pleine avant
    // la transition : sinon il fusionne les deux changements et saute l'animation.
    void barre.offsetWidth;
    barre.style.transition = 'width ' + secondes + 's linear';
    barre.style.width = '0%';
    clearTimeout(this.#chrono);
    this.#chrono = setTimeout(() => this.#trancher(null), secondes * 1000);
  }

  /** Fige la barre où elle en est : la manche est tranchée, le temps ne file plus. */
  #figerChrono() {
    clearTimeout(this.#chrono);
    const barre = this.trouver('.timer-bar');
    const largeur = getComputedStyle(barre).width;
    barre.style.transition = 'none';
    barre.style.width = largeur;
  }

  /** @param {Bac | null} choix  `null` : le temps est écoulé */
  #trancher(choix) {
    if (this.#tranche) return;
    this.#tranche = true;
    this.#figerChrono();
    this.#annulerGeste();
    this.#gelerBacs(true);

    const dechet = this.#dechets[this.#manche];
    const retour = this.trouver('.feedback');
    if (choix === dechet.cat) {
      this.#score++;
      retour.className = 'feedback ok';
      retour.textContent = '✓ ' + dechet.info;
    } else {
      this.#vies--;
      retour.className = 'feedback ko';
      retour.textContent = (choix === null ? '⏱️ Trop lent ! ' : '✗ Raté ! ') + "C'était : " + BACS[dechet.cat] + '. ' + dechet.info;
    }
    this.#montrerStatut();

    this.attendre(LECTURE, () => {
      if (this.#vies <= 0) { this.terminer(this.#score, 'Partie écourtée : plus de vies !'); return; }
      this.#manche++;
      if (this.#manche >= this.#nombre) this.terminer(this.#score);
      else this.#montrerManche();
    });
  }

  // ── Glisser le déchet vers un bac ─────────────────────────────────────────

  /** Le bac sous le pointeur, s'il y en a un. @param {number} x @param {number} y @returns {Bac | null} */
  #bacSous(x, y) {
    for (const bac of this.tous('[data-bac]')) {
      const r = bac.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return /** @type {Bac} */ (bac.dataset.bac);
    }
    return null;
  }

  /** @param {Event} evenement */
  #saisir(evenement) {
    if (!(evenement instanceof PointerEvent) || this.#tranche || this.#geste) return;
    const objet = this.#objet;
    objet.setPointerCapture(evenement.pointerId);
    const r = objet.getBoundingClientRect();
    this.#geste = { pointeur: evenement.pointerId, decalageX: evenement.clientX - r.left, decalageY: evenement.clientY - r.top };
    // L'emplacement garde sa hauteur : la carte ne se replie pas sous l'objet qui part.
    this.trouver('.item-chip-slot').style.height = r.height + 'px';
    objet.classList.add('en-cours');
    objet.style.position = 'fixed';
    objet.style.width = r.width + 'px';
    objet.style.left = r.left + 'px';
    objet.style.top = r.top + 'px';
  }

  /** @param {Event} evenement */
  #deplacer(evenement) {
    const geste = this.#geste;
    if (!(evenement instanceof PointerEvent) || !geste || evenement.pointerId !== geste.pointeur) return;
    const objet = this.#objet;
    objet.style.left = (evenement.clientX - geste.decalageX) + 'px';
    objet.style.top = (evenement.clientY - geste.decalageY) + 'px';
    const sous = this.#bacSous(evenement.clientX, evenement.clientY);
    for (const bac of this.tous('[data-bac]')) bac.classList.toggle('survole', bac.dataset.bac === sous);
  }

  /** @param {Event} evenement */
  #lacher(evenement) {
    const geste = this.#geste;
    if (!(evenement instanceof PointerEvent) || !geste || evenement.pointerId !== geste.pointeur) return;
    const sous = this.#bacSous(evenement.clientX, evenement.clientY);
    this.#geste = null;
    this.#remettreObjet();
    if (sous) this.#trancher(sous);
  }

  /**
   * Neutralise un glisser en cours. Nécessaire quand la manche se tranche
   * autrement (temps écoulé, bac touché) pendant que le doigt est encore posé :
   * sans ça, le doigt levé plus tard serait compté pour la manche suivante.
   */
  #annulerGeste() {
    if (this.#geste) {
      try {
        this.#objet.releasePointerCapture(this.#geste.pointeur);
      } catch {
        // Capture déjà rendue par le navigateur : rien à faire.
      }
      this.#geste = null;
    }
    this.#remettreObjet();
  }

  /** L'objet revient à sa place, les bacs perdent leur survol. */
  #remettreObjet() {
    const objet = this.#objet;
    objet.classList.remove('en-cours');
    objet.style.position = '';
    objet.style.left = '';
    objet.style.top = '';
    objet.style.width = '';
    this.trouver('.item-chip-slot').style.height = '';
    for (const bac of this.tous('[data-bac]')) bac.classList.remove('survole');
  }

  gabaritStatut() {
    return html`<span>Déchet 1/15</span><span>❤️❤️❤️</span><span>Score : 0</span>`;
  }

  gabaritZone() {
    return html`
      <div class="timer-wrap"><div class="timer-bar"></div></div>
      <div class="item-chip-slot">
        <div class="item-chip">
          <div class="item-emoji"></div>
          <div class="item-nom"></div>
        </div>
      </div>
      <div class="feedback" role="status"></div>
      <div class="bacs">
        <button type="button" class="bac bac-compost" data-bac="compost"><span class="bac-emoji">🌱</span><span>Compost</span></button>
        <button type="button" class="bac bac-recyclage" data-bac="recyclage"><span class="bac-emoji">♻️</span><span>Recyclage</span></button>
        <button type="button" class="bac bac-poubelle" data-bac="poubelle"><span class="bac-emoji">🗑️</span><span>Poubelle</span></button>
      </div>
      <div class="regle"></div>`;
  }
}

TriEclair.definir();
