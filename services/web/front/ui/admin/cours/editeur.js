/* ============================================================================
   editeur.js — <cs-admin-editeur> : l'éditeur d'un cours
   (/admin/themes/<thème>/<cours>, ou /admin/themes/<thème>/nouveau).

   Le cadre de la page : en-tête et fil d'Ariane, quatre onglets, la zone
   d'erreur, la barre d'enregistrement fixée en bas. Chaque onglet est un
   composant : <cs-admin-editeur-panneaux> (contenu et aperçu),
   <cs-admin-editeur-medias>, <cs-admin-editeur-quiz>, <cs-admin-editeur-fiche>.
   L'éditeur leur donne le cours à l'ouverture, et leur redemande leur part à
   l'enregistrement.

   Le thème et le cours sont lus dans l'adresse : le contrôleur de
   courses-api a déjà vérifié qu'ils existent (sinon : 404), le reste vient
   des API.

   Chaque enregistrement archive la version précédente du cours : une erreur
   se rattrape depuis le journal du panneau d'administration.

   Usage :
     <cs-admin-editeur></cs-admin-editeur>
     <script type="module" src="/ui/admin/cours/editeur.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { AdminEditeurFiche } from './editeur-fiche.js';
import { AdminEditeurMedias } from './editeur-medias.js';
import { AdminEditeurPanneaux } from './editeur-panneaux.js';
import { AdminEditeurQuiz } from './editeur-quiz.js';
import { decouperPanneaux, panneauVide } from './panneaux-markdown.js';
import { questionsDuServeur } from './quiz-edition.js';

/**
 * Ce que les onglets partagent sur le cours ouvert. `id` vaut 0 tant que le
 * cours n'est pas créé ; il est mis à jour au premier enregistrement.
 * @typedef {{ id: number }} ContexteEditeur
 *
 * @typedef {object} Route
 * @property {string} prefixe  `/admin/themes`, la page des thèmes
 * @property {string} theme    slug du thème
 * @property {string | null} cours  slug du cours ; null pour un nouveau cours
 *
 * @typedef {'' | 'modifie' | 'ok' | 'ko'} SorteEtat
 */

/** @type {{ vue: string, libelle: string }[]} */
const ONGLETS = [
  { vue: 'contenu', libelle: '📝 Contenu' },
  { vue: 'medias', libelle: '🎬 Vidéo & podcast' },
  { vue: 'quiz', libelle: '❓ Quiz' },
  { vue: 'fiche', libelle: '⚙️ Fiche' },
];

/**
 * Le thème et le cours désignés par l'adresse.
 * @param {string} chemin
 * @returns {Route | null}
 */
export function routeEditeur(chemin) {
  const m = /^(\/admin\/themes)\/([^/]+)\/([^/]+)\/?$/.exec(chemin);
  if (!m) return null;
  return { prefixe: m[1], theme: decodeURIComponent(m[2]), cours: m[3] === 'nouveau' ? null : decodeURIComponent(m[3]) };
}

export class AdminEditeur extends Composant {
  static balise = 'cs-admin-editeur';
  static styles = [new URL('./editeur.css', import.meta.url)];

  /** @type {Route | null} */
  #route = null;
  /** @type {ContexteEditeur} */
  #contexte = { id: 0 };
  /** Des modifications ne sont pas enregistrées. */
  #modifie = false;

  async monter() {
    this.#route = routeEditeur(location.pathname);
    this.rendre(this.gabarit(this.#route ? this.#route.prefixe : '/admin/themes'));

    this.ecouter('click', '[data-vue]', (b) => this.#ouvrir(b.dataset.vue || ''));
    this.ecouter('click', '[data-action="enregistrer"]', () => { this.#enregistrer(null); });
    this.ecouter('click', '[data-action="publier"]', () => {
      this.#enregistrer(this.#fiche().valeurs().statut === 'publie' ? 'brouillon' : 'publie');
    });
    this.ecouterSur(this, 'modifie', () => this.#toucher());
    this.ecouterSur(this, 'etat', (e) => {
      const d = /** @type {CustomEvent<{ texte: string, sorte: SorteEtat }>} */ (e).detail;
      this.#etat(d.texte, d.sorte);
    });
    this.ecouterSur(this, 'erreur', (e) => this.#erreur(String(/** @type {CustomEvent} */ (e).detail || '')));
    this.ecouterSur(this, 'statut', (e) => this.#badge(String(/** @type {CustomEvent} */ (e).detail)));
    this.ecouterSur(this, 'inserer', (e) => {
      this.#ouvrir('contenu');
      this.#panneaux().insererBloc(String(/** @type {CustomEvent} */ (e).detail));
    });
    this.ecouterSur(this, 'supprime', () => {
      this.#modifie = false;
      location.href = this.#route ? this.#route.prefixe : '/admin/themes';
    });
    this.ecouterSur(window, 'beforeunload', (e) => {
      if (!this.#modifie) return;
      e.preventDefault();
      /** @type {BeforeUnloadEvent} */ (e).returnValue = '';
    });

    await this.#charger();
  }

  #panneaux() { return this.trouver('cs-admin-editeur-panneaux', AdminEditeurPanneaux); }
  #quiz() { return this.trouver('cs-admin-editeur-quiz', AdminEditeurQuiz); }
  #medias() { return this.trouver('cs-admin-editeur-medias', AdminEditeurMedias); }
  #fiche() { return this.trouver('cs-admin-editeur-fiche', AdminEditeurFiche); }

  async #charger() {
    const route = this.#route;
    if (!route) {
      this.#erreur('Adresse inattendue : ouvre le cours depuis la page des thèmes.');
      return;
    }
    /** @type {import('./editeur-fiche.js').ThemeChoix[]} */
    let themes;
    /** @type {any} */
    let cours = null;
    try {
      [{ themes }, cours] = await Promise.all([
        api.admin.get('themes_manage.php'),
        route.cours ? api.admin.get('cours_get.php', { slug: route.cours }) : Promise.resolve(null),
      ]);
    } catch (erreur) {
      console.error('<cs-admin-editeur>', erreur);
      this.#erreur(texteErreur(erreur, 'Chargement impossible.'));
      return;
    }

    const theme = themes.find((t) => t.slug === route.theme);
    this.trouver('.fil-theme').textContent = theme ? theme.nom : route.theme;
    this.#contexte = { id: cours ? cours.id : 0 };

    this.#panneaux().configurer(cours ? decouperPanneaux(cours.texte) : [panneauVide()]);
    this.#quiz().configurer(cours ? questionsDuServeur(cours.quiz) : []);
    this.#medias().configurer(cours && cours.video, cours && cours.podcast, this.#contexte);
    this.#fiche().configurer({ cours, themes, themeId: theme ? theme.id : 0, contexte: this.#contexte });

    if (cours) {
      this.#titre(cours.titre);
      this.#lienPublic(cours.slug);
    }
    this.#badge(cours ? cours.statut : 'brouillon');
  }

  /** @param {string} vue */
  #ouvrir(vue) {
    for (const b of this.tous('[data-vue]')) b.classList.toggle('actif', b.dataset.vue === vue);
    for (const v of this.tous('[data-onglet]')) v.classList.toggle('actif', v.dataset.onglet === vue);
  }

  /** @param {string} titre */
  #titre(titre) {
    this.trouver('h1').textContent = titre;
    this.trouver('.fil-cours').textContent = titre;
  }

  /** @param {string} slug */
  #lienPublic(slug) {
    const lien = this.trouver('.lien-public');
    lien.setAttribute('href', '/cours/' + slug);
    lien.hidden = false;
  }

  /** @param {string} statut */
  #badge(statut) {
    const badge = this.trouver('.badge-statut');
    badge.textContent = statut;
    badge.className = 'badge-statut ' + statut;
    this.trouver('[data-action="publier"]').textContent = statut === 'publie' ? 'Repasser en brouillon' : 'Publier';
  }

  #toucher() {
    this.#modifie = true;
    this.#etat('Modifications non enregistrées', 'modifie');
  }

  /** @param {string} texte @param {SorteEtat} [sorte] */
  #etat(texte, sorte = '') {
    const etat = this.trouver('.etat');
    etat.textContent = texte;
    etat.className = 'etat' + (sorte ? ' ' + sorte : '');
  }

  /** @param {string} message  vide : plus d'erreur */
  #erreur(message) {
    const zone = this.trouver('.erreur');
    zone.textContent = message;
    zone.hidden = message === '';
    if (message) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** @param {boolean} occupe */
  #boutons(occupe) {
    for (const b of this.tous('.barre-enregistrement .btn')) if (b instanceof HTMLButtonElement) b.disabled = occupe;
  }

  /**
   * @param {string | null} statut  null : celui choisi dans la fiche
   */
  async #enregistrer(statut) {
    const route = this.#route;
    if (!route) return;
    this.#erreur('');
    const fiche = this.#fiche().valeurs();
    if (!fiche.titre.trim()) {
      this.#ouvrir('fiche');
      this.#erreur('Le titre est obligatoire.');
      return;
    }
    const medias = this.#medias().fiches();
    const corps = {
      id: this.#contexte.id || 0,
      video: medias.video,
      podcast: medias.podcast,
      theme_id: fiche.theme_id,
      titre: fiche.titre,
      slug: fiche.slug,
      description: fiche.description,
      emoji: fiche.emoji,
      niveau: fiche.niveau,
      xp: fiche.xp,
      statut: statut || fiche.statut,
      texte: this.#panneaux().markdown(),
      quiz: this.#quiz().questions(),
    };

    this.#boutons(true);
    this.#etat('Enregistrement…');
    /** @type {{ id: number, slug: string, statut: string }} */
    let reponse;
    try {
      reponse = await api.admin.postJson('cours_save.php', corps);
    } catch (erreur) {
      console.error('<cs-admin-editeur>', erreur);
      this.#erreur(texteErreur(erreur, 'Enregistrement impossible.'));
      this.#etat('Échec', 'ko');
      return;
    } finally {
      this.#boutons(false);
    }

    this.#modifie = false;
    this.#etat('Enregistré ✓', 'ok');
    this.#titre(fiche.titre.trim());
    this.#fiche().fixerStatut(reponse.statut);
    this.#badge(reponse.statut);

    // Création : l'adresse devient celle du cours, pour que le rechargement
    // et le partage du lien tombent sur la bonne page.
    if (!this.#contexte.id) {
      this.#contexte.id = reponse.id;
      const themeSlug = fiche.theme_slug || route.theme;
      history.replaceState({}, '', route.prefixe + '/' + themeSlug + '/' + reponse.slug);
      this.#route = { ...route, theme: themeSlug, cours: reponse.slug };
      this.#fiche().apresCreation(reponse.slug);
      this.#lienPublic(reponse.slug);
    }
  }

  // ── Gabarit ───────────────────────────────────────────────────────────────

  /** @param {string} prefixe  page des thèmes */
  gabarit(prefixe) {
    return html`
      <div class="page">
        <nav class="liens">
          <a href="${prefixe}">← Thèmes et cours</a>
          <a class="lien-public" href="/cours" hidden>Voir la page publique</a>
        </nav>
        <div class="fil"><a href="${prefixe}">Thèmes</a> › <span class="fil-theme"></span> › <span class="fil-cours">Nouveau cours</span></div>
        <h1>Nouveau cours</h1>

        <div class="onglets" role="tablist">
          ${ONGLETS.map((o, i) => html`<button type="button" class="onglet${i === 0 && ' actif'}" data-vue="${o.vue}">${o.libelle}</button>`)}
        </div>

        <div class="erreur" role="alert" hidden></div>

        <div class="vue actif" data-onglet="contenu"><cs-admin-editeur-panneaux></cs-admin-editeur-panneaux></div>
        <div class="vue" data-onglet="medias"><cs-admin-editeur-medias></cs-admin-editeur-medias></div>
        <div class="vue" data-onglet="quiz"><cs-admin-editeur-quiz></cs-admin-editeur-quiz></div>
        <div class="vue" data-onglet="fiche"><cs-admin-editeur-fiche></cs-admin-editeur-fiche></div>
      </div>

      <div class="barre-enregistrement">
        <div class="barre-dedans">
          <span class="badge-statut brouillon">brouillon</span>
          <button type="button" class="btn btn-vert" data-action="enregistrer">Enregistrer</button>
          <button type="button" class="btn btn-clair" data-action="publier">Publier</button>
          <span class="etat" role="status"></span>
        </div>
      </div>`;
  }
}

AdminEditeur.definir();
