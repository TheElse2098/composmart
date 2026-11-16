/* ============================================================================
   messages.js — <cs-admin-messages> : l'onglet « Messages » du panneau
   d'administration.

   Les tickets ouverts depuis la page « Nous contacter », vingt par page, du
   plus récemment actif au plus ancien, filtrés par état. Un ticket « à
   répondre » est un ticket ouvert dont le dernier mot est à son auteur et
   qu'aucun administrateur n'a encore lu. Un clic ouvre la discussion
   (<cs-fil-discussion>, la même fenêtre que sur la page de compte, vue ici
   du côté administrateur).

   Lire un ticket le marque comme lu : à la fermeture de la discussion la
   liste est rechargée et le composant émet « donnees-modifiees » (le panneau
   recompte la pastille de l'onglet).

   Usage, dans le panneau : <cs-admin-messages></cs-admin-messages>
   ============================================================================ */
import { FilDiscussion, dateMessage, gabaritStatut } from '../../composants/fil-discussion/fil-discussion.js';
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html, pluriel } from '../../socle/outils.js';
import { gabaritPages } from './communs.js';

/**
 * @typedef {object} Ticket  une ligne de /api/admin/tickets.php
 * @property {number} id
 * @property {string} username     son auteur, ou « Compte supprimé »
 * @property {string} categorie
 * @property {string} sujet
 * @property {string} statut       `ouvert`, `clos`, `clos_definitif`
 * @property {string} activite     date du dernier message
 * @property {number} nb_messages
 * @property {boolean} non_lu      à répondre
 *
 * @typedef {object} Page  /api/admin/tickets.php?statut=&page=
 * @property {Ticket[]} tickets
 * @property {number} a_traiter    tickets à répondre, tous filtres confondus
 * @property {number} page
 * @property {number} pages
 * @property {number} total        tickets du filtre
 */

/** Les filtres, dans l'ordre des boutons. La clé est ce que le serveur attend. */
const FILTRES = [
  { cle: 'ouvert', libelle: 'Ouverts' },
  { cle: 'clos', libelle: 'Clos' },
  { cle: 'clos_definitif', libelle: 'Fermés définitivement' },
  { cle: 'tous', libelle: 'Tous' },
];

/** @type {Record<string, string>} */
const STATUTS = { ouvert: 'Ouvert', clos: 'Clos', clos_definitif: 'Fermé déf.' };

/** Catégories du formulaire « Nous contacter ». @type {Record<string, string>} */
const CATEGORIES = { bug: '🐛 Bug', suggestion: '💡 Suggestion', question: '❓ Question', autre: '✉️ Autre' };

/**
 * La discussion vue par un administrateur : ses messages sont à droite, il
 * peut clore, rouvrir, fermer pour de bon.
 * @type {import('../../composants/fil-discussion/fil-discussion.js').PointDeVue}
 */
export const VUE_ADMIN = {
  admin: true,
  statuts: STATUTS,
  invite: 'Répondre… (Ctrl+Entrée pour envoyer)',
  lire: (id) => api.admin.get('tickets.php', { id }),
  repondre: (id, corps) => api.admin.postJson('tickets.php', { action: 'repondre', id, corps }),
  agir: (id, action) => api.admin.postJson('tickets.php', { action, id }),
  titre: (ticket) => '#' + ticket.id + ' · ' + ticket.sujet + ' — ' + ticket.username,
  auteur: (message) => (message.est_admin ? message.auteur + ' · ADMIN' : message.auteur),
  lectureSeule: (statut) => (statut === 'clos'
    ? 'Ticket clos — rouvre-le pour répondre.'
    : 'Ticket définitivement fermé : lecture seule.'),
  actions: (statut) => {
    if (statut === 'clos_definitif') return [];
    return [
      statut === 'ouvert' ? { action: 'clore', libelle: '✓ Clore' } : { action: 'rouvrir', libelle: '↺ Rouvrir' },
      {
        action: 'fermer_definitif',
        libelle: '⛔ Fermer définitivement',
        danger: true,
        confirmation: {
          titre: 'Fermer définitivement ce ticket ?',
          texte: 'Personne ne pourra plus le rouvrir ni y répondre — pas même un admin.',
          valider: 'Fermer définitivement',
          danger: true,
        },
      },
    ];
  },
};

export class AdminMessages extends Composant {
  static balise = 'cs-admin-messages';
  // La pastille d'état des lignes est habillée par la feuille du fil de discussion.
  static styles = [
    new URL('./messages.css', import.meta.url),
    new URL('../../composants/fil-discussion/fil-discussion.css', import.meta.url),
  ];

  // Filtre et page : gardés tant que le panneau est ouvert.
  #filtre = 'ouvert';
  #page = 1;
  /** Numéro de la dernière demande : une réponse plus ancienne est ignorée. */
  #demande = 0;

  async monter() {
    this.rendre(this.gabarit(this.#filtre));
    this.trouver('cs-fil-discussion', FilDiscussion).configurer(VUE_ADMIN);

    this.ecouter('click', '[data-filtre]', (bouton) => {
      this.#filtre = bouton.dataset.filtre || 'ouvert';
      this.#page = 1;
      for (const b of this.tous('[data-filtre]')) b.classList.toggle('active', b === bouton);
      this.#charger();
    });
    this.ecouter('click', '[data-page]', (bouton) => {
      this.#page = Number(bouton.dataset.page);
      this.#charger();
    });
    this.ecouter('click', '[data-ticket]', (ligne) => {
      this.trouver('cs-fil-discussion', FilDiscussion).ouvrir(Number(ligne.dataset.ticket));
    });

    // Discussion refermée : le ticket est lu, peut-être clos ou répondu.
    this.ecouter('fil-ferme', 'cs-fil-discussion', () => {
      this.emettre('donnees-modifiees');
      this.#charger();
    });

    await this.#charger();
  }

  /** Recharge la page affichée, filtre conservé. Appelé par le panneau à
   *  chaque retour sur l'onglet. */
  async rafraichir() {
    await this.#charger();
  }

  async #charger() {
    const demande = ++this.#demande;
    const zone = this.trouver('[data-zone="liste"]');
    try {
      /** @type {Page} */
      const d = await api.admin.get('tickets.php', { statut: this.#filtre, page: this.#page });
      if (demande !== this.#demande) return;
      this.#page = d.page; // le serveur ramène une page trop lointaine à la dernière
      this.trouver('.section-compte').textContent = d.a_traiter > 0 ? '(' + d.a_traiter + ' à traiter)' : '';
      this.rendre(this.gabaritListe(d), zone);
    } catch (erreur) {
      if (demande !== this.#demande) return;
      console.error('<cs-admin-messages>', erreur);
      this.afficherErreur(texteErreur(erreur, "Les messages n'ont pas pu être chargés."), zone);
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /** @param {string} filtre  le filtre actif au départ */
  gabarit(filtre) {
    return html`
      <div class="section-title">✉️ Signalements <span class="section-compte"></span></div>
      <div class="contact-filters">
        ${FILTRES.map((f) => html`<button type="button" class="contact-filter${f.cle === filtre ? ' active' : ''}" data-filtre="${f.cle}">${f.libelle}</button>`)}
      </div>
      <div data-zone="liste"><p class="cs-etat">Chargement…</p></div>
      <cs-fil-discussion></cs-fil-discussion>`;
  }

  /** @param {Page} d */
  gabaritListe(d) {
    if (!d.tickets.length) return html`<div class="empty-msg">Aucun ticket dans ce filtre 📭</div>`;
    return html`
      ${d.tickets.map((t) => this.gabaritTicket(t))}
      ${gabaritPages(d, 'ticket', 'tickets')}`;
  }

  /** @param {Ticket} t */
  gabaritTicket(t) {
    return html`
      <button type="button" class="ticket${t.non_lu ? ' non-lu' : ''}" data-ticket="${t.id}">
        <span class="ticket-sujet">${gabaritStatut(t.statut, STATUTS)} #${t.id} · ${t.sujet}${t.non_lu && html`<span class="ticket-arepondre">à répondre</span>`}</span>
        <span class="ticket-meta">par ${t.username} · ${CATEGORIES[t.categorie] || t.categorie} · ${pluriel(t.nb_messages, 'message', 'messages')} · dernière activité ${dateMessage(t.activite)}</span>
      </button>`;
  }
}

AdminMessages.definir();
