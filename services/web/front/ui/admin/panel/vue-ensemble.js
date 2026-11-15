/* ============================================================================
   vue-ensemble.js — <cs-admin-vue-ensemble> : premier onglet du panneau
   d'administration.

   Les chiffres du site (comptes, composteurs, cours validés, parties, ce qui
   attend une décision) puis deux graphiques : l'activité des comptes et la
   taille du parc de composteurs.

   Les chiffres viennent de trois services, chacun ne connaissant que sa base :
   courses-api (comptes, cours), map-api (carte), games-api (parties). Un
   service qui ne répond pas laisse un tiret à la place de ses chiffres ; les
   autres s'affichent.

   Usage, dans le panneau : <cs-admin-vue-ensemble></cs-admin-vue-ensemble>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { AdminGraphePeriode } from './graphe-periode.js';

/**
 * @typedef {object} StatsComptes   /api/admin/stats.php, champ `stats`
 * @property {number} users
 * @property {number} admins
 * @property {number} completions   cours validés, comptes supprimés compris
 *
 * @typedef {object} CompteursCarte /api/carte/count.php
 * @property {number} composts
 * @property {number} en_attente
 * @property {number} signalements
 *
 * @typedef {object} CompteursJeux  /api/jeux/count.php
 * @property {number} parties
 *
 * @typedef {object} Carte          une case de la grille de chiffres
 * @property {number | null} n      `null` : chiffre indisponible
 * @property {string} libelle
 * @property {boolean} [alerte]     quelque chose attend une décision
 */

/**
 * Les sept chiffres de la vue d'ensemble. Une source absente (`null`) donne
 * des chiffres indisponibles, pas des zéros : un zéro dirait « rien à traiter ».
 * @param {StatsComptes | null} comptes
 * @param {CompteursCarte | null} carte
 * @param {CompteursJeux | null} jeux
 * @returns {Carte[]}
 */
export function chiffres(comptes, carte, jeux) {
  return [
    { n: comptes ? comptes.users : null, libelle: 'Utilisateurs' },
    { n: carte ? carte.composts : null, libelle: 'Composteurs' },
    { n: comptes ? comptes.completions : null, libelle: 'Cours validés' },
    { n: jeux ? jeux.parties : null, libelle: 'Parties jouées' },
    { n: comptes ? comptes.admins : null, libelle: 'Admins' },
    { n: carte ? carte.en_attente : null, libelle: 'Ajouts en attente', alerte: !!carte && carte.en_attente > 0 },
    { n: carte ? carte.signalements : null, libelle: 'Signalements', alerte: !!carte && carte.signalements > 0 },
  ];
}

export class AdminVueEnsemble extends Composant {
  static balise = 'cs-admin-vue-ensemble';
  static styles = [new URL('./vue-ensemble.css', import.meta.url)];

  async monter() {
    this.rendre(this.gabarit());

    this.trouver('[data-graphe="activite"]', AdminGraphePeriode).configurer({
      depuisZero: true,
      source: async (periode) => {
        /** @type {{ labels: string[], inscrits: number[], connexions: number[] | null }} */
        const d = await api.admin.get('evolution.php', { period: periode });
        /** @type {import('./graphe-periode.js').Serie[]} */
        const series = [{ nom: 'Inscriptions', valeurs: d.inscrits, couleur: 'vert' }];
        if (d.connexions) series.push({ nom: 'Connexions', valeurs: d.connexions, couleur: 'orange' });
        return { labels: d.labels, series };
      },
    });
    this.trouver('[data-graphe="parc"]', AdminGraphePeriode).configurer({
      depuisZero: false,
      source: async (periode) => {
        /** @type {{ labels: string[], totaux: number[] }} */
        const d = await api.carte.get('evolution.php', { periode });
        return { labels: d.labels, series: [{ nom: 'Composteurs sur la carte', valeurs: d.totaux || [], couleur: 'vert' }] };
      },
    });

    await this.#chargerChiffres();
  }

  /** Recharge les chiffres et les deux graphiques, périodes conservées. Appelé
   *  par le panneau à chaque retour sur l'onglet. */
  async rafraichir() {
    await Promise.all([
      this.#chargerChiffres(),
      ...this.tous('cs-admin-graphe-periode').map((graphe) => (graphe instanceof AdminGraphePeriode ? graphe.rafraichir() : null)),
    ]);
  }

  async #chargerChiffres() {
    const grille = this.trouver('.stats-grid');
    /** Une source en panne est notée dans la console et comptée comme absente. @param {unknown} erreur */
    const absente = (erreur) => {
      console.error('<cs-admin-vue-ensemble>', erreur);
      return null;
    };
    try {
      const [comptes, carte, jeux] = await Promise.all([
        api.admin.get('stats.php').then((d) => d.stats),
        api.carte.get('count.php').catch(absente),
        api.jeux.get('count.php').catch(absente),
      ]);
      this.rendre(this.gabaritChiffres(chiffres(comptes, carte, jeux)), grille);
    } catch (erreur) {
      console.error('<cs-admin-vue-ensemble>', erreur);
      this.afficherErreur(texteErreur(erreur, "Les chiffres n'ont pas pu être chargés."), grille);
    }
  }

  gabarit() {
    return html`
      <div class="section-title">📊 Vue d'ensemble</div>
      <div class="stats-grid"></div>

      <div class="section-title">📈 Évolution</div>
      <cs-admin-graphe-periode data-graphe="activite"></cs-admin-graphe-periode>

      <div class="section-title">🌱 Composteurs sur la carte</div>
      <cs-admin-graphe-periode data-graphe="parc"></cs-admin-graphe-periode>`;
  }

  /** @param {Carte[]} cartes */
  gabaritChiffres(cartes) {
    return html`${cartes.map((c) => html`
      <div class="stat-card${c.alerte ? ' alert' : ''}">
        <div class="stat-num">${c.n === null ? '—' : c.n}</div>
        <div class="stat-lbl">${c.libelle}</div>
      </div>`)}`;
  }
}

AdminVueEnsemble.definir();
