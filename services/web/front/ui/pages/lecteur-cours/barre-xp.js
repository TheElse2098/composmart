/* ============================================================================
   barre-xp.js — <cs-barre-xp> : la progression dans le niveau, animée, à la
   fin d'un cours.

   La barre part de l'XP d'avant le cours et glisse jusqu'à celle d'après. Un
   niveau franchi se voit : la barre se remplit, repart de zéro, « Niveau N ! »
   s'affiche, puis elle avance jusqu'à la nouvelle valeur.

   Usage (le parent l'écrit dans son gabarit, puis) :
     this.trouver('cs-barre-xp', BarreXp).montrer(ancienXp, nouvelXp, niveau);
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

/** XP qu'il faut pour passer un niveau (même règle que complete.php). */
export const XP_PAR_NIVEAU = 100;

/** Le temps de voir la barre à son point de départ. */
const AVANT = 300;
/** Remplissage jusqu'au bout quand un niveau est franchi. */
const REMPLISSAGE = 700;
const COURBE = 'cubic-bezier(.4,0,.2,1)';

/**
 * Les étapes de l'animation, sans le DOM.
 * @param {number} ancien  XP avant le cours
 * @param {number} nouveau XP après
 * @param {number | null | undefined} niveau  niveau renvoyé par le serveur ; à défaut, déduit de `nouveau`
 * @returns {{ depart: number, arrivee: number, niveau: number, monte: boolean }}
 *   depart et arrivee en pourcentage de la barre
 */
export function etapesXp(ancien, nouveau, niveau) {
  const final = niveau || Math.floor(nouveau / XP_PAR_NIVEAU) + 1;
  return {
    depart: ancien % XP_PAR_NIVEAU,
    arrivee: nouveau % XP_PAR_NIVEAU,
    niveau: final,
    monte: final > Math.floor(ancien / XP_PAR_NIVEAU) + 1,
  };
}

export class BarreXp extends Composant {
  static balise = 'cs-barre-xp';
  static styles = [new URL('./barre-xp.css', import.meta.url)];

  /** @type {ReturnType<typeof setTimeout>[]} */
  #attentes = [];

  monter() {
    this.aLaFin(() => this.#annuler());
  }

  /**
   * @param {number} ancien
   * @param {number} nouveau
   * @param {number | null} [niveau]
   */
  montrer(ancien, nouveau, niveau) {
    this.apresMontage(() => {
      this.#annuler();
      const etapes = etapesXp(ancien, nouveau, niveau);
      this.rendre(this.gabarit(etapes.niveau, etapes.arrivee));
      const barre = this.trouver('.xp-barre');
      this.#poser(barre, etapes.depart, null);
      if (!etapes.monte) {
        this.#plusTard(AVANT, () => this.#poser(barre, etapes.arrivee, '0.9s'));
        return;
      }
      this.#plusTard(AVANT, () => {
        this.#poser(barre, 100, '0.7s');
        this.#plusTard(REMPLISSAGE + 50, () => {
          this.#poser(barre, 0, null);
          const bravo = this.trouver('.xp-bravo');
          bravo.textContent = '🎉 Niveau ' + etapes.niveau + ' !';
          bravo.hidden = false;
          this.#plusTard(80, () => this.#poser(barre, etapes.arrivee, '0.9s'));
        });
      });
    });
  }

  /**
   * @param {HTMLElement} barre
   * @param {number} pourcent
   * @param {string | null} duree  `null` : sans transition, d'un coup
   */
  #poser(barre, pourcent, duree) {
    barre.style.transition = duree ? 'width ' + duree + ' ' + COURBE : 'none';
    barre.style.width = pourcent + '%';
  }

  /** @param {number} ms @param {() => void} action */
  #plusTard(ms, action) {
    this.#attentes.push(setTimeout(action, ms));
  }

  #annuler() {
    for (const attente of this.#attentes.splice(0)) clearTimeout(attente);
  }

  /** @param {number} niveau @param {number} dansNiveau */
  gabarit(niveau, dansNiveau) {
    return html`
      <div class="xp-ligne">
        <span class="xp-niveau">Niveau ${niveau}</span>
        <span class="xp-texte">${dansNiveau} / ${XP_PAR_NIVEAU} XP</span>
      </div>
      <div class="xp-piste"><div class="xp-barre"></div></div>
      <div class="xp-bravo" role="status" hidden></div>`;
  }
}

BarreXp.definir();
