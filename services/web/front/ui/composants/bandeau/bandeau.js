/* ============================================================================
   bandeau.js — <cs-bandeau> : la barre du haut, le tiroir du téléphone, la
   case « Admin ».

   Deux présentations, choisies par le CSS selon la largeur :
     - téléphone (< 900 px) : logo et burger, qui ouvre le tiroir ;
     - ordinateur (≥ 900 px) : les liens en ligne dans la barre, sans burger.

   Le menu est décrit une seule fois, dans PAGES ci-dessous : ajouter, renommer
   ou retirer une entrée ici le répercute sur toutes les pages, dans la barre
   comme dans le tiroir.

   La case rouge « Admin » n'apparaît que pour un administrateur. Ce n'est
   qu'un raccourci d'affichage : chaque page d'administration vérifie les
   droits côté serveur.

   Usage :
     <cs-bandeau></cs-bandeau>
     <script type="module" src="/ui/composants/bandeau/bandeau.js"></script>
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { session } from '../../socle/session.js';
import { theme } from '../../socle/theme.js';

/**
 * @typedef {object} Page
 * @property {string} href      adresse du lien
 * @property {string[]} chemins adresses pour lesquelles le lien est marqué actif
 * @property {string} icone     emoji affiché dans le tiroir
 * @property {string} long      libellé dans le tiroir
 * @property {string} [court]   libellé dans la barre, pour les pages qui y figurent
 */

/** Toutes les pages du menu. Les adresses sont sans « .html » : le serveur
 *  sert `/carte` directement, alors que `/carte.html` coûte une redirection.
 *  @type {Record<string, Page>} */
const PAGES = {
  accueil:    { href: '/',              chemins: ['/', '/index.html'],                            icone: '🏠', long: 'Accueil' },
  compte:     { href: '/compte',        chemins: ['/compte', '/compte.html'],                     icone: '👤', long: 'Mon compte' },
  classement: { href: '/classement',    chemins: ['/classement', '/classement.html'],             icone: '🏆', long: 'Classement',        court: 'Classement' },
  carte:      { href: '/carte',         chemins: ['/carte', '/carte.html'],                       icone: '🗺️', long: 'Carte interactive', court: 'Carte' },
  cours:      { href: '/cours',         chemins: ['/cours', '/cours.html', '/cours-detail.html'], icone: '📚', long: 'Les cours',         court: 'Cours' },
  jeux:       { href: '/jeux',          chemins: ['/jeux', '/jeux.html'],                         icone: '🎮', long: 'Jeux',              court: 'Jeux' },
  materiel:   { href: '/materiel',      chemins: ['/materiel', '/materiel.html'],                 icone: '🧰', long: 'Le matériel',       court: 'Matériel' },
  evenement:  { href: '/evenement',     chemins: ['/evenement', '/evenement.html'],               icone: '🎟️', long: 'Événements',        court: 'Événements' },
  contact:    { href: '/contact',       chemins: ['/contact', '/contact.html'],                   icone: '✉️', long: 'Nous contacter',    court: 'Nous contacter' },
};

/** Ordre des liens dans la barre (ordinateur). */
const BARRE = ['carte', 'cours', 'jeux', 'materiel', 'classement', 'evenement', 'contact'];

/** Ordre des entrées dans le tiroir (téléphone). */
const TIROIR = ['accueil', 'compte', 'classement', 'carte', 'cours', 'jeux', 'materiel', 'evenement', 'contact'];

/** Espaces d'administration : la case « Admin » y est marquée active. */
const ESPACES_ADMIN = ['/admin', '/jeux-admin', '/evenements-admin'];

/**
 * Adresse sans barre oblique finale : `/classement/` et `/classement` sont la même page.
 * @param {string} chemin
 * @returns {string}
 */
export function normaliser(chemin) {
  return chemin.replace(/\/+$/, '') || '/';
}

/**
 * @param {Page} page
 * @param {string} chemin adresse courante, normalisée
 * @returns {boolean}
 */
function estActive(page, chemin) {
  return page.chemins.some((c) => normaliser(c) === chemin);
}

/**
 * @param {string} chemin adresse courante, normalisée
 * @returns {boolean}
 */
export function dansAdmin(chemin) {
  return ESPACES_ADMIN.some((espace) => chemin === espace || chemin.startsWith(espace + '/'));
}

export class Bandeau extends Composant {
  static balise = 'cs-bandeau';
  static styles = [new URL('./bandeau.css', import.meta.url)];

  /** Le tiroir et son voile vivent sous <body>, hors du composant : le bandeau
   *  est collé en haut de page (position: sticky), et un tiroir placé dedans
   *  se retrouvait comprimé dans la hauteur de la barre au lieu de couvrir
   *  l'écran.
   *  @type {HTMLElement | null} */
  #tiroir = null;
  /** @type {HTMLElement | null} */
  #voile = null;
  #ouvert = false;

  monter() {
    const chemin = normaliser(location.pathname);

    this.rendre(this.gabaritBarre(chemin));
    this.#poserTiroir(chemin);
    this.#montrerTheme();

    this.ecouter('click', '[data-action="theme"]', () => { theme.basculer(); });
    this.ecouter('click', '[data-action="ouvrir"]', () => this.#ouvrir(true));
    this.ecouterSur(document, 'themechange', () => this.#montrerTheme());
    this.ecouterSur(document, 'keydown', (evenement) => {
      if (evenement instanceof KeyboardEvent && evenement.key === 'Escape') this.#ouvrir(false);
    });

    // Sans attendre : la barre est déjà affichée, la case Admin arrive ensuite.
    this.#revelerAdmin(chemin);
  }

  /**
   * La barre : logo, liens (ordinateur), compte, thème, burger (téléphone).
   *
   * Le burger garde l'identifiant `burgerBtn` de l'ancien bandeau : la carte,
   * pas encore migrée, guette un clic dessus pour quitter le plein écran avant
   * que le menu ne s'ouvre. Seule entorse à la règle « pas d'id global », à
   * retirer quand la carte sera un composant et écoutera le bandeau.
   *
   * @param {string} chemin adresse courante, normalisée
   */
  gabaritBarre(chemin) {
    return html`
      <nav class="bandeau__barre">
        <a href="/" class="bandeau__logo">Compos<span>mart</span></a>
        <ul class="bandeau__liens">
          ${BARRE.map((cle) => html`
            <li><a href="${PAGES[cle].href}" class="${estActive(PAGES[cle], chemin) ? 'actif' : ''}">${PAGES[cle].court}</a></li>`)}
          <li class="bandeau__admin" data-admin hidden><a href="/admin">Admin</a></li>
        </ul>
        <div class="bandeau__droite">
          <a href="/admin" class="bandeau__admin-mini" data-admin hidden>Admin</a>
          <a href="/compte" class="bandeau__profil" aria-label="Mon compte">👤</a>
          <button type="button" class="bandeau__theme" data-action="theme" aria-label="Changer de thème">🌙</button>
          <button type="button" class="bandeau__burger" id="burgerBtn" data-action="ouvrir" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>
        </div>
      </nav>`;
  }

  /**
   * Le contenu du tiroir : en-tête, puis une entrée par page.
   * @param {string} chemin adresse courante, normalisée
   */
  gabaritTiroir(chemin) {
    return html`
      <div class="bandeau-tiroir__tete">
        <div class="bandeau-tiroir__logo">Compos<span>mart</span></div>
        <button type="button" class="bandeau-tiroir__fermer" data-action="fermer" aria-label="Fermer le menu">✕</button>
      </div>
      <ul class="bandeau-tiroir__menu">
        <li class="bandeau-tiroir__admin" data-admin hidden><a href="/admin"><span class="bandeau-tiroir__icone">🔧</span> Admin</a></li>
        <li class="bandeau-tiroir__trait" data-admin hidden aria-hidden="true"></li>
        ${TIROIR.map((cle) => html`
          <li><a href="${PAGES[cle].href}" class="${estActive(PAGES[cle], chemin) ? 'actif' : ''}"><span class="bandeau-tiroir__icone">${PAGES[cle].icone}</span> ${PAGES[cle].long}</a></li>
          <li class="bandeau-tiroir__trait" aria-hidden="true"></li>`)}
      </ul>`;
  }

  /** @param {string} chemin */
  #poserTiroir(chemin) {
    const voile = document.createElement('div');
    voile.className = 'bandeau-voile';
    const tiroir = document.createElement('div');
    tiroir.className = 'bandeau-tiroir';
    this.rendre(this.gabaritTiroir(chemin), tiroir);
    document.body.append(voile, tiroir);

    this.ecouterSur(voile, 'click', () => this.#ouvrir(false));
    this.ecouterSur(tiroir, 'click', (evenement) => {
      if (evenement.target instanceof Element && evenement.target.closest('[data-action="fermer"]')) this.#ouvrir(false);
    });
    this.aLaFin(() => {
      this.#ouvrir(false);
      voile.remove();
      tiroir.remove();
      this.#tiroir = null;
      this.#voile = null;
    });

    this.#tiroir = tiroir;
    this.#voile = voile;
  }

  /** @param {boolean} ouvert */
  #ouvrir(ouvert) {
    if (ouvert === this.#ouvert || !this.#tiroir || !this.#voile) return;
    this.#ouvert = ouvert;
    this.#tiroir.classList.toggle('bandeau-tiroir--ouvert', ouvert);
    this.#voile.classList.toggle('bandeau-voile--ouvert', ouvert);
    const burger = this.querySelector('.bandeau__burger');
    if (burger) {
      burger.classList.toggle('bandeau__burger--ouvert', ouvert);
      burger.setAttribute('aria-expanded', String(ouvert));
    }
    // La page ne défile pas derrière le tiroir ouvert.
    document.body.style.overflow = ouvert ? 'hidden' : '';
  }

  /** L'icône du bouton montre le thème vers lequel on basculera. */
  #montrerTheme() {
    this.trouver('.bandeau__theme').textContent = theme.sombre ? '☀️' : '🌙';
  }

  /** @param {string} chemin */
  async #revelerAdmin(chemin) {
    const moi = await session.moi();
    if (!moi.logged_in || !moi.isAdmin || !this.#tiroir) return;

    const actif = dansAdmin(chemin);
    const cases = [...this.tous('[data-admin]'), ...this.#tiroir.querySelectorAll('[data-admin]')];
    for (const element of cases) {
      if (!(element instanceof HTMLElement)) continue;
      element.hidden = false;
      const lien = element instanceof HTMLAnchorElement ? element : element.querySelector('a');
      if (lien && actif) lien.classList.add('actif');
    }
  }
}

Bandeau.definir();
