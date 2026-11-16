/* ============================================================================
   jeux.js — <cs-jeux> : la liste des mini-jeux (page /jeux).

   Les jeux viennent de la base (/api/jeux/catalogue.php, édités dans
   /jeux-admin), dans l'ordre choisi par l'administration ; un administrateur
   reçoit aussi les brouillons, marqués comme tels. Un membre connecté voit son
   record à chaque jeu ; un visiteur, une invitation à se connecter pour
   garder ses scores.

   Deux demandes indépendantes : sans les records, la liste s'affiche quand
   même.

   Usage :
     <cs-jeux></cs-jeux>
     <script type="module" src="/ui/pages/jeux/jeux.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

/**
 * @typedef {object} Jeu  /api/jeux/catalogue.php?action=liste
 * @property {string} slug
 * @property {string} nom
 * @property {string} emoji
 * @property {string} description
 * @property {string} statut     `publie` ; `brouillon`, vu des seuls administrateurs
 * @property {number} score_max
 *
 * @typedef {object} Records  /api/jeux/score.php?action=bests
 * @property {boolean} logged_in
 * @property {Record<string, number>} bests  meilleur score par jeu
 */

export class Jeux extends Composant {
  static balise = 'cs-jeux';
  static styles = [new URL('./jeux.css', import.meta.url)];

  async monter() {
    this.afficherChargement('Chargement des jeux…');
    const [catalogue, records] = await Promise.allSettled([
      /** @type {Promise<{ jeux: Jeu[] }>} */ (api.jeux.get('catalogue.php', { action: 'liste' })),
      /** @type {Promise<Records>} */ (api.jeux.get('score.php', { action: 'bests' })),
    ]);
    if (records.status === 'rejected') console.error('<cs-jeux>', records.reason); // la liste suffit
    if (catalogue.status === 'rejected') {
      console.error('<cs-jeux>', catalogue.reason);
      this.afficherErreur(texteErreur(catalogue.reason, "Les jeux n'ont pas pu être chargés."));
      return;
    }
    this.rendre(this.gabarit(catalogue.value.jeux, records.status === 'fulfilled' ? records.value : null));
  }

  /**
   * @param {Jeu[]} jeux
   * @param {Records | null} records  `null` : on ne sait pas qui est connecté
   */
  gabarit(jeux, records) {
    const bests = records && records.logged_in ? records.bests : null;
    return html`
      ${records && !records.logged_in && html`
        <div class="login-invite">
          <span class="login-invite-emoji">🏆</span>
          <span><a href="/compte">Connecte-toi</a> pour sauvegarder tes scores et apparaître dans les classements !</span>
        </div>`}
      ${jeux.map((j) => this.gabaritJeu(j, bests ? bests[j.slug] : undefined))}`;
  }

  /**
   * @param {Jeu} j
   * @param {number | undefined} record
   */
  gabaritJeu(j, record) {
    return html`
      <a class="jeu-card" href="/jeu-${j.slug}">
        <div class="jeu-emoji">${j.emoji}</div>
        <div class="jeu-info">
          <div class="jeu-nom">${j.nom}${j.statut === 'brouillon' && ' (brouillon)'}</div>
          <div class="jeu-desc">${j.description}</div>
          ${record !== undefined && html`<div><span class="jeu-best">🏆 Record : ${record} / ${j.score_max}</span></div>`}
        </div>
        <span class="jeu-jouer">Jouer</span>
      </a>`;
  }
}

Jeux.definir();
