/* ============================================================================
   journal.js — <cs-admin-journal> : l'onglet « Journal » du panneau
   d'administration.

   La liste des actions enregistrées par les cinq services (audit_log), de la
   plus récente à la plus ancienne, trente par page. Deux filtres : la
   catégorie puis, dans la catégorie, l'action ; et une plage de dates. Un clic
   sur une ligne ouvre son détail (<cs-admin-journal-detail>).

   Le serveur renvoie avec chaque page la liste des actions présentes en base :
   les menus ne proposent que ce qui existe réellement.

   Fichiers du journal :
     journal.js           la liste et ses filtres (ce fichier)
     journal-detail.js    la fenêtre de détail, l'annulation
     journal-diff.js      comparer un avant et un après
     journal-libelles.js  le vocabulaire : actions, catégories, champs

   Usage, dans le panneau : <cs-admin-journal></cs-admin-journal>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { gabaritPages } from './communs.js';
import { AdminJournalDetail } from './journal-detail.js';
import { CATEGORIES, categorieDe, dateJournal, libelleAction } from './journal-libelles.js';

/**
 * @typedef {import('./journal-detail.js').Resume} Resume
 *
 * @typedef {object} Page  /api/admin/audit.php
 * @property {Resume[]} entries
 * @property {string[]} types   actions présentes en base
 * @property {number} page
 * @property {number} pages
 * @property {number} total     entrées qui passent le filtre
 */

/**
 * Les catégories à proposer : celles qui ont au moins une action en base.
 * @param {string[]} types
 */
export function categoriesPresentes(types) {
  const presentes = new Set(types.map(categorieDe));
  return CATEGORIES.filter((c) => presentes.has(c.id));
}

/**
 * Les actions d'une catégorie présentes en base, triées par libellé.
 * @param {string[]} types
 * @param {string} categorie  `tous` : aucune (le second menu reste fermé)
 * @returns {{ action: string, icone: string, texte: string }[]}
 */
export function actionsDe(types, categorie) {
  if (categorie === 'tous') return [];
  return types
    .filter((t) => categorieDe(t) === categorie)
    .map((t) => ({ action: t, ...libelleAction(t) }))
    .sort((a, b) => a.texte.localeCompare(b.texte, 'fr'));
}

export class AdminJournal extends Composant {
  static balise = 'cs-admin-journal';
  static styles = [new URL('./journal.css', import.meta.url)];

  // Filtres : gardés tant que le panneau est ouvert, d'un onglet à l'autre.
  #categorie = 'tous';
  #action = 'tous';
  #depuis = '';
  #jusqu = '';
  #page = 1;

  /** Actions présentes en base, d'après la dernière réponse. @type {string[]} */
  #types = [];
  /** Les lignes affichées. @type {Resume[]} */
  #entrees = [];
  /** Numéro de la dernière demande : une réponse plus ancienne est ignorée. */
  #demande = 0;

  async monter() {
    this.rendre(this.gabarit());

    this.ecouter('change', '[data-filtre="categorie"]', (menu) => {
      if (!(menu instanceof HTMLSelectElement)) return;
      this.#categorie = menu.value;
      this.#action = 'tous';
      this.#montrerActions();
      this.#filtrer();
    });
    this.ecouter('change', '[data-filtre="action"]', (menu) => {
      if (!(menu instanceof HTMLSelectElement)) return;
      this.#action = menu.value;
      this.#filtrer();
    });
    this.ecouter('change', '[data-filtre="depuis"], [data-filtre="jusqu"]', () => this.#lireDates());
    this.ecouter('click', '[data-action="effacer-dates"]', () => {
      this.trouver('[data-filtre="depuis"]', HTMLInputElement).value = '';
      this.trouver('[data-filtre="jusqu"]', HTMLInputElement).value = '';
      this.#lireDates();
    });

    this.ecouter('click', '[data-page]', (bouton) => {
      this.#page = Number(bouton.dataset.page);
      this.#charger();
    });
    this.ecouter('click', '.audit-head', (ligne) => this.#ouvrir(ligne));
    this.ecouter('keydown', '.audit-head', (ligne, evenement) => {
      if (!(evenement instanceof KeyboardEvent) || (evenement.key !== 'Enter' && evenement.key !== ' ')) return;
      evenement.preventDefault(); // Espace ferait défiler la page
      this.#ouvrir(ligne);
    });

    // Une action annulée depuis le détail : sa ligne change, une autre s'ajoute.
    this.ecouter('donnees-modifiees', 'cs-admin-journal-detail', () => this.#charger());

    await this.#charger();
  }

  /** Recharge la page affichée, filtres conservés. Appelé par le panneau à
   *  chaque retour sur l'onglet. */
  async rafraichir() {
    await this.#charger();
  }

  /** Un filtre a changé : retour à la première page. */
  #filtrer() {
    this.#page = 1;
    this.#charger();
  }

  #lireDates() {
    const debut = this.trouver('[data-filtre="depuis"]', HTMLInputElement);
    const fin = this.trouver('[data-filtre="jusqu"]', HTMLInputElement);
    this.#depuis = debut.value;
    this.#jusqu = fin.value;
    // Bornes croisées : le navigateur empêche lui-même de choisir une fin
    // antérieure au début, plutôt que d'accepter puis d'afficher une liste vide.
    fin.min = this.#depuis;
    debut.max = this.#jusqu;
    this.trouver('[data-action="effacer-dates"]').hidden = !this.#depuis && !this.#jusqu;
    this.#filtrer();
  }

  /** Actions à demander au serveur ; aucune = tout le journal. @returns {string[]} */
  #actionsDemandees() {
    if (this.#action !== 'tous') return [this.#action];
    if (this.#categorie === 'tous') return [];
    return this.#types.filter((t) => categorieDe(t) === this.#categorie);
  }

  async #charger() {
    const demande = ++this.#demande;
    const zone = this.trouver('[data-zone="liste"]');
    try {
      /** @type {Page} */
      const d = await api.admin.get('audit.php', {
        page: this.#page,
        actions: this.#actionsDemandees().join(',') || null,
        depuis: this.#depuis || null,
        jusqu: this.#jusqu || null,
      });
      if (demande !== this.#demande) return;

      // Une action faite dans un autre onglet peut ajouter un type en cours de
      // session : les menus suivent, sans perdre le choix en cours.
      if (d.types.join(',') !== this.#types.join(',')) {
        this.#types = d.types;
        this.#montrerCategories();
      }
      this.#page = d.page; // le serveur ramène une page trop lointaine à la dernière
      this.#entrees = d.entries;
      this.trouver('.section-compte').textContent = d.total ? '(' + d.total + ')' : '';
      this.rendre(this.gabaritListe(d), zone);
    } catch (erreur) {
      if (demande !== this.#demande) return;
      console.error('<cs-admin-journal>', erreur);
      this.#entrees = [];
      this.afficherErreur(texteErreur(erreur, "Le journal n'a pas pu être chargé."), zone);
    }
  }

  /** Remplit le menu des catégories, puis celui des actions. Une catégorie qui
   *  n'a plus d'action en base est abandonnée. */
  #montrerCategories() {
    const categories = categoriesPresentes(this.#types);
    if (!categories.some((c) => c.id === this.#categorie)) this.#categorie = 'tous';
    this.rendre(this.gabaritCategories(categories, this.#categorie), this.trouver('[data-filtre="categorie"]'));
    this.#montrerActions();
  }

  /** Second menu : les actions de la catégorie choisie. Masqué s'il n'y a pas
   *  de choix à faire (aucune catégorie, ou une seule action). */
  #montrerActions() {
    const actions = actionsDe(this.#types, this.#categorie);
    if (!actions.some((a) => a.action === this.#action)) this.#action = 'tous';
    const menu = this.trouver('[data-filtre="action"]');
    menu.hidden = actions.length < 2;
    this.rendre(this.gabaritActions(actions, this.#action), menu);
  }

  /** @param {HTMLElement} ligne */
  #ouvrir(ligne) {
    const entree = this.#entrees.find((e) => String(e.id) === ligne.dataset.id);
    if (entree) this.trouver('cs-admin-journal-detail', AdminJournalDetail).ouvrir(entree);
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="section-title">📜 Journal d'activité <span class="section-compte"></span></div>
      <div class="audit-filters">
        <select class="audit-type-select" data-filtre="categorie" aria-label="Catégorie">${this.gabaritCategories([], 'tous')}</select>
        <select class="audit-type-select" data-filtre="action" aria-label="Action" hidden></select>
        <label class="audit-date-lbl">Du <input class="audit-date-input" type="date" data-filtre="depuis"></label>
        <label class="audit-date-lbl">au <input class="audit-date-input" type="date" data-filtre="jusqu"></label>
        <button type="button" class="audit-date-reset" data-action="effacer-dates" hidden>✕ Effacer les dates</button>
      </div>
      <div data-zone="liste"><p class="cs-etat">Chargement…</p></div>
      <cs-admin-journal-detail></cs-admin-journal-detail>`;
  }

  /**
   * @param {{ id: string, icone: string, texte: string }[]} categories
   * @param {string} choisie
   */
  gabaritCategories(categories, choisie) {
    return html`<option value="tous">Toutes les catégories</option>${categories.map((c) => html`<option value="${c.id}"${c.id === choisie && html` selected`}>${c.icone} ${c.texte}</option>`)}`;
  }

  /**
   * @param {{ action: string, icone: string, texte: string }[]} actions
   * @param {string} choisie
   */
  gabaritActions(actions, choisie) {
    return html`<option value="tous">Toutes ses actions</option>${actions.map((a) => html`<option value="${a.action}"${a.action === choisie && html` selected`}>${a.icone} ${a.texte}</option>`)}`;
  }

  /** @param {Page} d */
  gabaritListe(d) {
    if (!d.entries.length) return html`<div class="empty-msg">Aucune action enregistrée pour ce filtre.</div>`;
    return html`
      ${d.entries.map((e) => this.gabaritLigne(e))}
      ${gabaritPages(d, 'action', 'actions')}`;
  }

  /** @param {Resume} e */
  gabaritLigne(e) {
    const libelle = libelleAction(e.action);
    return html`
      <div class="audit-item">
        <div class="audit-head" role="button" tabindex="0" data-id="${e.id}">
          <div class="audit-icon">${libelle.icone}</div>
          <div class="audit-main">
            <span class="audit-action">${libelle.texte}</span>${e.annule && html`<span class="audit-badge-annule">↩️ annulée</span>`}${e.details && html` <span class="audit-meta">(${e.details})</span>`}
            <div class="audit-meta">par ${e.username}</div>
          </div>
          <div class="audit-date">${dateJournal(e.date)}</div>
          <div class="audit-chevron">›</div>
        </div>
      </div>`;
  }
}

AdminJournal.definir();
