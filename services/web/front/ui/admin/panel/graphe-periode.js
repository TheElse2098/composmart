/* ============================================================================
   graphe-periode.js — <cs-admin-graphe-periode> : un graphique en barres avec
   son choix de période (7 jours, 30 jours, 3 mois, tout).

   Le composant ne sait pas ce qu'il trace : le parent lui donne, par
   configurer(), la fonction qui va chercher les données d'une période. La vue
   d'ensemble s'en sert deux fois (activité des comptes, parc de composteurs).

   Le dessin est confié à Chart.js, que le composant charge lui-même.

   Usage, dans le gabarit d'un parent :
     <cs-admin-graphe-periode data-graphe="parc"></cs-admin-graphe-periode>
   puis, juste après l'affichage :
     this.trouver('[data-graphe="parc"]', AdminGraphePeriode).configurer({ … });
   ============================================================================ */
import { texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { theme } from '../../socle/theme.js';

/**
 * @typedef {'7d' | '30d' | '90d' | 'tout'} Periode
 *
 * @typedef {object} Serie
 * @property {string} nom               libellé dans la légende
 * @property {number[]} valeurs         une valeur par étiquette
 * @property {'vert' | 'orange'} couleur
 *
 * @typedef {object} Donnees
 * @property {string[]} labels          étiquettes de l'axe horizontal
 * @property {Serie[]} series
 *
 * @typedef {object} Reglage
 * @property {(periode: Periode) => Promise<Donnees>} source  va chercher les données d'une période
 * @property {boolean} depuisZero  faux pour un cumul : l'axe part alors du plus
 *   petit total, sinon quelques unités de variation sur des milliers ne se voient pas
 */

/** @type {[Periode, string][]} */
const PERIODES = [['7d', '7 jours'], ['30d', '30 jours'], ['90d', '3 mois'], ['tout', 'Tout']];

const COULEURS = {
  vert: { fond: 'rgba(45,153,89,0.75)', trait: '#2d9959' },
  orange: { fond: 'rgba(249,168,37,0.75)', trait: '#f9a825' },
};

/**
 * @param {string | undefined} valeur
 * @returns {valeur is Periode}
 */
function estPeriode(valeur) {
  return PERIODES.some(([cle]) => cle === valeur);
}

/**
 * La description du graphique attendue par Chart.js. Les couleurs du texte et
 * de la grille dépendent du thème : Chart.js dessine dans un <canvas>, que le
 * CSS n'atteint pas.
 * @param {Donnees} donnees
 * @param {boolean} sombre
 * @param {boolean} depuisZero
 */
export function descriptionGraphique(donnees, sombre, depuisZero) {
  const grille = sombre ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const texte = sombre ? '#7aaa8a' : '#4a7a5a';
  const police = { family: 'Nunito, Arial, sans-serif', size: 11, weight: '700' };
  const graduations = { color: texte, font: police, maxRotation: 45 };

  return {
    type: 'bar',
    data: {
      labels: donnees.labels,
      datasets: donnees.series.map((serie) => ({
        label: serie.nom,
        data: serie.valeurs,
        backgroundColor: COULEURS[serie.couleur].fond,
        borderColor: COULEURS[serie.couleur].trait,
        borderWidth: 1,
        borderRadius: 4,
      })),
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: texte, font: police, boxWidth: 12, padding: 16 } } },
      scales: {
        x: { grid: { color: grille }, ticks: { ...graduations, maxTicksLimit: 15 } },
        y: { grid: { color: grille }, ticks: { ...graduations, precision: 0 }, beginAtZero: depuisZero },
      },
    },
  };
}

export class AdminGraphePeriode extends Composant {
  static balise = 'cs-admin-graphe-periode';
  static styles = [new URL('./graphe-periode.css', import.meta.url)];
  static scripts = [new URL('../../../assets/vendor/chartjs-4.6.1/chart.umd.min.js', import.meta.url)];

  /** @type {Periode} */
  #periode = '30d';
  /** @type {Reglage | null} */
  #reglage = null;
  /** @type {Donnees | null} */
  #donnees = null;
  /** L'objet Chart.js, une fois le premier dessin fait. @type {any} */
  #graphique = null;

  /**
   * Dit au graphique quoi tracer. À appeler par le parent juste après l'avoir
   * affiché, avant que le composant ne se monte.
   * @param {Reglage} reglage
   */
  configurer(reglage) {
    this.#reglage = reglage;
  }

  async monter() {
    this.rendre(this.gabarit(this.#periode));
    this.ecouter('click', '[data-periode]', (bouton) => this.#choisir(bouton.dataset.periode));
    // Un changement de thème se voit tout de suite, sans attendre le prochain chargement.
    this.ecouterSur(document, 'themechange', () => this.#dessiner());
    this.aLaFin(() => {
      if (this.#graphique) this.#graphique.destroy();
      this.#graphique = null;
    });
    await this.rafraichir();
  }

  /** Recharge les données de la période choisie (qui est conservée). */
  async rafraichir() {
    if (!this.#reglage) throw new Error('<' + this.localName + '> : configurer() doit être appelé avant l’affichage');
    const periode = this.#periode;
    const message = this.trouver('.graphe-message');
    try {
      const donnees = await this.#reglage.source(periode);
      if (periode !== this.#periode) return; // la période a changé entre-temps
      this.#donnees = donnees;
      message.hidden = true;
      this.#dessiner();
    } catch (erreur) {
      if (periode !== this.#periode) return;
      console.error('<' + this.localName + '>', erreur);
      message.textContent = texteErreur(erreur, "Ce graphique n'a pas pu être chargé.");
      message.hidden = false;
    }
  }

  /** @param {string | undefined} periode */
  #choisir(periode) {
    if (!estPeriode(periode) || periode === this.#periode) return;
    this.#periode = periode;
    for (const bouton of this.tous('[data-periode]')) {
      bouton.classList.toggle('active', bouton.dataset.periode === periode);
    }
    this.rafraichir();
  }

  #dessiner() {
    if (!this.#donnees || !this.#reglage) return;
    const description = descriptionGraphique(this.#donnees, theme.sombre, this.#reglage.depuisZero);
    if (this.#graphique) {
      // Même graphique, nouvelles données : Chart.js anime le passage de l'un à l'autre.
      this.#graphique.data = description.data;
      this.#graphique.options = description.options;
      this.#graphique.update();
      return;
    }
    const Chart = /** @type {any} */ (globalThis).Chart;
    this.#graphique = new Chart(this.trouver('canvas'), description);
  }

  /** @param {Periode} periode période sélectionnée */
  gabarit(periode) {
    return html`
      <div class="evo-bar">
        ${PERIODES.map(([cle, libelle]) => html`
          <button type="button" class="evo-btn${cle === periode ? ' active' : ''}" data-periode="${cle}">${libelle}</button>`)}
      </div>
      <div class="evo-card">
        <div class="graphe-toile"><canvas></canvas></div>
        <p class="graphe-message" role="alert" hidden></p>
      </div>`;
  }
}

AdminGraphePeriode.definir();
