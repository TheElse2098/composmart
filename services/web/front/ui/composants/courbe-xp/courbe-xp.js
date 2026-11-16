/* ============================================================================
   courbe-xp.js — <cs-courbe-xp> : la courbe d'XP cumulée d'un joueur.

   L'XP gagnée jour après jour depuis le premier gain, en une courbe et son
   aire, avec le total au-dessus et les deux dates extrêmes en dessous. C'est
   la même courbe sur la page de compte du joueur et sur sa fiche dans le
   panneau d'administration : un administrateur qui compare ce qu'un joueur
   lui décrit doit voir exactement ce que ce joueur voit.

   Usage :
     <cs-courbe-xp></cs-courbe-xp>
     this.trouver('cs-courbe-xp', CourbeXp).montrer(historique, 'Aucun gain pour l’instant.');

   `historique` : les gains datés, du plus ancien au plus récent
   (`xp_history` de /api/auth/profile.php et de /api/auth/fiche_joueur.php).

   La page qui l'accueille peut régler deux mesures sur la balise :
     --courbe-hauteur   hauteur du dessin (120px)
     --courbe-total     taille du total (1.5rem)
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

/**
 * @typedef {object} Gain
 * @property {number} delta        XP gagnée
 * @property {string} created_at   « 2026-11-14 09:15:00 »
 *
 * @typedef {object} Point
 * @property {number} n     jours écoulés depuis le premier gain
 * @property {number} xp    XP cumulée ce jour-là
 * @property {Date} date
 */

const JOUR = 86400000;

// Le dessin, dans son repère. Marges réduites : aucun texte n'est dessiné
// dans le SVG, pas de gouttière à réserver.
const LARGEUR = 300;
const HAUTEUR = 100;
const MARGE = { gauche: 4, droite: 4, haut: 8, bas: 4 };

/** Une date MySQL (sans fuseau) : le « T » rend sa lecture fiable d'un navigateur à l'autre.
 *  @param {string} texte */
export function dateSql(texte) {
  return new Date(String(texte).replace(' ', 'T'));
}

/** « 14 nov. » @param {Date} date */
const jourCourt = (date) => date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** La clé « AAAA-MM-JJ » d'un jour, à l'heure locale (pas en UTC, qui peut décaler le jour).
 *  @param {Date} d */
const cleJour = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/**
 * L'XP cumulée jour par jour, du premier gain au dernier. Les jours sans gain
 * sont comblés : la courbe y reste plate au lieu de les sauter.
 * @param {Gain[]} historique  du plus ancien au plus récent
 * @returns {Point[]}
 */
export function pointsXp(historique) {
  if (!historique.length) return [];
  /** @type {Map<string, number>} */
  const parJour = new Map();
  for (const gain of historique) {
    const jour = String(gain.created_at).slice(0, 10);
    parJour.set(jour, (parJour.get(jour) || 0) + gain.delta);
  }
  const jours = [...parJour.keys()];
  const debut = dateSql(jours[0] + ' 00:00:00');
  const fin = dateSql(jours[jours.length - 1] + ' 00:00:00');
  const duree = Math.round((fin.getTime() - debut.getTime()) / JOUR);

  /** @type {Point[]} */
  const points = [];
  let cumul = 0;
  for (let n = 0; n <= duree; n++) {
    // Jour suivant du calendrier, pas « 24 heures plus tard » : le jour du
    // passage à l'heure d'hiver en dure 25, et un pas de 24 heures compterait
    // ce jour-là deux fois, puis laisserait le dernier jour de côté.
    const date = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + n);
    cumul += parJour.get(cleJour(date)) || 0;
    points.push({ n, xp: cumul, date });
  }
  return points;
}

/**
 * La courbe : total, dessin, dates extrêmes — ou un message s'il n'y a rien à tracer.
 * @param {Gain[]} historique
 * @param {string} [messageVide]
 */
export function gabaritCourbe(historique, messageVide = 'Pas encore assez de données pour tracer une courbe.') {
  const points = pointsXp(historique);
  if (!points.length) return html`<div class="courbe-vide">${messageVide}</div>`;

  const premier = points[0];
  const dernier = points[points.length - 1];
  const maximum = dernier.xp || 1;
  const bas = HAUTEUR - MARGE.bas;
  /** @param {number} n */
  const x = (n) => (MARGE.gauche + (n / Math.max(1, dernier.n)) * (LARGEUR - MARGE.gauche - MARGE.droite)).toFixed(1);
  /** @param {number} xp */
  const y = (xp) => (MARGE.haut + (1 - xp / maximum) * (HAUTEUR - MARGE.haut - MARGE.bas)).toFixed(1);

  const ligne = points.map((p, i) => (i === 0 ? 'M' : 'L') + x(p.n) + ',' + y(p.xp)).join(' ');
  const aire = ligne + ' L' + x(dernier.n) + ',' + bas + ' L' + x(0) + ',' + bas + ' Z';

  // Le dessin est étiré en largeur (preserveAspectRatio="none") : un texte ou
  // un cercle visible y serait déformé d'autant. Le total est donc écrit en
  // HTML au-dessus, et le trait garde son épaisseur grâce à vector-effect.
  // Les cercles, transparents, ne servent qu'au survol : date et XP du jour.
  return html`
    <div class="courbe-total">${dernier.xp} XP <span>au total</span></div>
    <svg class="courbe-dessin" viewBox="0 0 ${LARGEUR} ${HAUTEUR}" preserveAspectRatio="none" role="img" aria-label="Courbe d'XP cumulée du ${jourCourt(premier.date)} au ${jourCourt(dernier.date)}, de 0 à ${maximum} XP">
      <line class="courbe-sol" vector-effect="non-scaling-stroke" x1="${MARGE.gauche}" y1="${bas}" x2="${LARGEUR - MARGE.droite}" y2="${bas}"></line>
      <path class="courbe-aire" d="${aire}"></path>
      <path class="courbe-trait" vector-effect="non-scaling-stroke" d="${ligne}"></path>
      ${points.map((p) => html`<circle cx="${x(p.n)}" cy="${y(p.xp)}" r="7" fill="transparent"><title>${jourCourt(p.date)} — ${p.xp} XP</title></circle>`)}
    </svg>
    <div class="courbe-dates"><span>${jourCourt(premier.date)}</span><span>${jourCourt(dernier.date)}</span></div>`;
}

export class CourbeXp extends Composant {
  static balise = 'cs-courbe-xp';
  static styles = [new URL('./courbe-xp.css', import.meta.url)];

  /** Ce qu'il faut tracer, reçu avant ou après l'arrivée de la feuille de style.
   *  @type {{ historique: Gain[], messageVide?: string } | null} */
  #demande = null;
  #pret = false;

  monter() {
    this.#pret = true;
    this.#tracer();
  }

  /**
   * Trace la courbe d'un historique de gains.
   * @param {Gain[]} historique  du plus ancien au plus récent
   * @param {string} [messageVide]  ce qu'on dit quand il n'y a encore aucun gain
   */
  montrer(historique, messageVide) {
    this.#demande = { historique, messageVide };
    this.#tracer();
  }

  /** Rien n'est dessiné avant la feuille de style : sans elle, l'aire serait noire. */
  #tracer() {
    if (this.#pret && this.#demande) this.rendre(gabaritCourbe(this.#demande.historique, this.#demande.messageVide));
  }
}

CourbeXp.definir();
