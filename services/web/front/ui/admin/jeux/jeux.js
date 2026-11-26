/* ============================================================================
   jeux.js — <cs-admin-jeux> : les mini-jeux, leur statut et leur activité
   (/jeux-admin). L'ordre choisi ici est celui de la page Jeux et de l'accueil.

   Usage :
     <cs-admin-jeux></cs-admin-jeux>
     <script type="module" src="/ui/admin/jeux/jeux.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { echanger, html, pluriel } from '../../socle/outils.js';
import { ADRESSE_JEUX } from './adresses.js';
import { dateFr } from './contenu-jeux.js';

/**
 * Réponse de /api/jeux/admin.php?action=liste.
 * @typedef {object} JeuResume
 * @property {string} slug
 * @property {string} nom
 * @property {string} emoji
 * @property {string} description
 * @property {'publie' | 'brouillon'} statut
 * @property {number} nb_items
 * @property {number} score_max
 * @property {number} parties
 * @property {number} joueurs
 * @property {string | null} maj_at
 * @property {string | null} maj_par
 */

export class AdminJeux extends Composant {
  static balise = 'cs-admin-jeux';
  static styles = [new URL('./jeux.css', import.meta.url)];

  /** @type {JeuResume[]} */
  #jeux = [];

  async monter() {
    this.rendre(this.gabarit());
    this.ecouter('click', '[data-deplacer]', (b) => this.#deplacer(Number(b.dataset.deplacer), b.dataset.sens === 'haut' ? -1 : 1));
    try {
      /** @type {{ jeux: JeuResume[] }} */
      const d = await api.jeux.get('admin.php', { action: 'liste' });
      this.#jeux = d.jeux;
    } catch (erreur) {
      console.error('<cs-admin-jeux>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), this.trouver('.grille'));
      return;
    }
    this.#dessiner();
  }

  #dessiner() {
    this.rendre(html`${this.#jeux.map((j, i) => this.gabaritJeu(j, i, this.#jeux.length))}`, this.trouver('.grille'));
  }

  /** @param {string} texte @param {boolean} [ko] */
  #message(texte, ko = false) {
    const zone = this.trouver('.msg');
    zone.textContent = texte;
    zone.className = 'msg' + (ko ? ' ko' : '');
  }

  /**
   * L'ordre change tout de suite à l'écran ; le serveur le retient ensuite.
   * @param {number} i
   * @param {-1 | 1} sens
   */
  async #deplacer(i, sens) {
    this.#jeux = echanger(this.#jeux, i, sens);
    this.#dessiner();
    try {
      await api.jeux.postJson('admin.php', { slugs: this.#jeux.map((j) => j.slug) }, { action: 'ordre' });
      this.#message('Ordre enregistré.');
    } catch (erreur) {
      console.error('<cs-admin-jeux>', erreur);
      this.#message(texteErreur(erreur, 'Ordre non enregistré.'), true);
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <nav class="liens"><a href="/admin">← Administration</a></nav>
      <div class="hero">
        <div class="hero-badge">🎮 Administration</div>
        <h1>Édition des jeux</h1>
        <div class="hero-sous">Contenu, règles et textes des mini-jeux. L'ordre est celui de la page Jeux.</div>
      </div>
      <div class="msg" role="status"></div>
      <main class="grille"><p class="cs-etat">Chargement…</p></main>`;
  }

  /**
   * @param {JeuResume} j
   * @param {number} i
   * @param {number} total
   */
  gabaritJeu(j, i, total) {
    return html`
      <div class="carte">
        <div class="carte-emoji">${j.emoji}</div>
        <div class="carte-corps">
          <a class="carte-nom" href="${ADRESSE_JEUX}/${j.slug}">${j.nom}</a>
          <div class="carte-desc">${j.description}</div>
          <div class="puces">
            <span class="puce ${j.statut}">${j.statut === 'publie' ? 'Publié' : 'Brouillon'}</span>
            <span class="puce">${pluriel(j.nb_items, 'élément', 'éléments')}</span>
            <span class="puce">Score max ${j.score_max}</span>
            <span class="puce">${pluriel(j.parties, 'partie', 'parties')} · ${pluriel(j.joueurs, 'joueur', 'joueurs')}</span>
          </div>
          ${j.maj_at && html`<div class="carte-maj">Modifié le ${dateFr(j.maj_at)}${j.maj_par && ' par ' + j.maj_par}</div>`}
        </div>
        <div class="carte-actions">
          <a class="btn btn-edit" href="${ADRESSE_JEUX}/${j.slug}">Modifier</a>
          <div class="ordre">
            <button type="button" class="btn btn-ordre" data-deplacer="${i}" data-sens="haut" title="Monter" aria-label="Monter ${j.nom}"${i === 0 && html` disabled`}>↑</button>
            <button type="button" class="btn btn-ordre" data-deplacer="${i}" data-sens="bas" title="Descendre" aria-label="Descendre ${j.nom}"${i === total - 1 && html` disabled`}>↓</button>
          </div>
        </div>
      </div>`;
  }
}

AdminJeux.definir();
