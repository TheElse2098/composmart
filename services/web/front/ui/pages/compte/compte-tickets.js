/* ============================================================================
   compte-tickets.js — <cs-compte-tickets> : « Mes signalements », sur la page
   de compte.

   Les messages que le membre a envoyés depuis « Nous contacter » : ceux qui
   sont ouverts, puis, repliés, ceux qui sont clos. Une réponse d'un
   administrateur pas encore lue est marquée « Réponse ». Un clic ouvre la
   discussion (<cs-fil-discussion>, la même fenêtre que dans le panneau
   d'administration, vue ici du côté de celui qui a écrit).

   Le panneau n'apparaît que si le membre a déjà envoyé un signalement : pas de
   bloc vide sur le profil.

   Le serveur ne renvoie que les tickets de la session en cours : c'est lui qui
   vérifie à qui appartient un ticket, jamais cette page.

   Usage, dans la page de compte : <cs-compte-tickets></cs-compte-tickets>
   ============================================================================ */
import { FilDiscussion, gabaritStatut } from '../../composants/fil-discussion/fil-discussion.js';
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html, jourCourt, pluriel } from '../../socle/outils.js';

/**
 * @typedef {object} Ticket  une ligne de /api/contact/tickets.php
 * @property {number} id
 * @property {string} sujet
 * @property {string} categorie
 * @property {string} statut    `ouvert`, `clos`, `clos_definitif`
 * @property {string} activite  date du dernier message
 * @property {boolean} non_lu   un administrateur a répondu depuis la dernière lecture
 */

/** @type {Record<string, string>} */
const STATUTS = { ouvert: 'Ouvert', clos: 'Clos', clos_definitif: 'Fermé' };

/** Catégories du formulaire « Nous contacter ». @type {Record<string, string>} */
const CATEGORIES = { bug: '🐛', suggestion: '💡', question: '❓', autre: '✉️' };

/**
 * La discussion vue par celui qui a ouvert le ticket : ses messages sont à
 * droite, il peut le dire résolu ou le rouvrir. La fermeture définitive
 * appartient aux administrateurs.
 * @type {import('../../composants/fil-discussion/fil-discussion.js').PointDeVue}
 */
export const VUE_TITULAIRE = {
  admin: false,
  statuts: STATUTS,
  invite: 'Écrire un message…',
  lire: (id) => api.contact.get('tickets.php', { id }),
  repondre: (id, corps) => api.contact.post('tickets.php', { action: 'repondre', id, corps }),
  agir: (id, action) => api.contact.post('tickets.php', { action, id }),
  titre: (ticket) => '#' + ticket.id + ' · ' + ticket.sujet,
  auteur: (message) => (message.est_admin ? message.auteur + ' · ADMIN' : 'Moi'),
  lectureSeule: (statut) => (statut === 'clos'
    ? 'Signalement clos — rouvre-le pour répondre.'
    : 'Signalement définitivement clos : il reste lisible, mais plus modifiable.'),
  actions: (statut) => {
    if (statut === 'ouvert') return [{ action: 'clore', libelle: '✓ Marquer comme résolu' }];
    if (statut === 'clos') return [{ action: 'rouvrir', libelle: '↺ Rouvrir ce signalement' }];
    return [];
  },
};

/**
 * Ce que dit la pastille du titre : les réponses à lire d'abord, sinon le
 * nombre de signalements ouverts.
 * @param {Ticket[]} tickets
 */
export function resume(tickets) {
  const nonLus = tickets.filter((t) => t.non_lu).length;
  if (nonLus > 0) return pluriel(nonLus, 'réponse non lue', 'réponses non lues');
  return pluriel(tickets.filter((t) => t.statut === 'ouvert').length, 'ouvert', 'ouverts');
}

export class CompteTickets extends Composant {
  static balise = 'cs-compte-tickets';
  // La pastille d'état des lignes est habillée par la feuille du fil de discussion.
  static styles = [
    new URL('./compte-tickets.css', import.meta.url),
    new URL('../../composants/fil-discussion/fil-discussion.css', import.meta.url),
  ];

  /** Les signalements clos sont-ils dépliés ? Gardé d'un rechargement à l'autre. */
  #closVisibles = false;

  async monter() {
    this.hidden = true; // rien à montrer tant qu'on ne sait pas s'il y a des signalements
    this.rendre(this.gabarit());
    this.trouver('cs-fil-discussion', FilDiscussion).configurer(VUE_TITULAIRE);

    this.ecouter('click', '[data-ticket]', (ligne) => {
      this.trouver('cs-fil-discussion', FilDiscussion).ouvrir(Number(ligne.dataset.ticket));
    });
    this.ecouter('click', '[data-action="voir-clos"]', () => {
      this.#closVisibles = !this.#closVisibles;
      this.#montrerClos();
    });
    // Discussion refermée : la réponse est lue, le signalement peut-être clos.
    this.ecouter('fil-ferme', 'cs-fil-discussion', () => this.#charger());

    await this.#charger();
  }

  async #charger() {
    const zone = this.trouver('[data-zone="liste"]');
    try {
      /** @type {{ tickets: Ticket[] }} */
      const d = await api.contact.get('tickets.php');
      this.hidden = d.tickets.length === 0;
      this.trouver('.panel-count').textContent = resume(d.tickets);
      this.rendre(this.gabaritListe(d.tickets), zone);
      this.#montrerClos();
    } catch (erreur) {
      console.error('<cs-compte-tickets>', erreur);
      this.hidden = false;
      this.trouver('.panel-count').textContent = '';
      this.afficherErreur(texteErreur(erreur, "Tes signalements n'ont pas pu être chargés."), zone);
    }
  }

  /** Déplie ou replie les signalements clos, et accorde le libellé du bouton. */
  #montrerClos() {
    const liste = this.querySelector('[data-zone="clos"]');
    const bouton = this.querySelector('[data-action="voir-clos"]');
    if (!(liste instanceof HTMLElement) || !(bouton instanceof HTMLElement)) return; // aucun signalement clos
    liste.hidden = !this.#closVisibles;
    bouton.textContent = (this.#closVisibles ? 'Masquer' : 'Voir') + ' les signalements clos (' + liste.children.length + ')';
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <section class="panel">
        <div class="panel-head">📨 Mes signalements <span class="panel-count"></span></div>
        <div data-zone="liste"></div>
      </section>
      <cs-fil-discussion></cs-fil-discussion>`;
  }

  /** @param {Ticket[]} tickets */
  gabaritListe(tickets) {
    const ouverts = tickets.filter((t) => t.statut === 'ouvert');
    const clos = tickets.filter((t) => t.statut !== 'ouvert');
    return html`
      <div>${ouverts.length ? ouverts.map((t) => this.gabaritTicket(t)) : html`<div class="tickets-vide">Aucun signalement ouvert.</div>`}</div>
      ${clos.length > 0 && html`
        <button type="button" class="ticket-voir-clos" data-action="voir-clos"></button>
        <div data-zone="clos" hidden>${clos.map((t) => this.gabaritTicket(t))}</div>`}`;
  }

  /** @param {Ticket} t */
  gabaritTicket(t) {
    return html`<button type="button" class="ticket-row" data-ticket="${t.id}">${gabaritStatut(t.statut, STATUTS)}<span class="ticket-sujet">${CATEGORIES[t.categorie] || '✉️'} #${t.id} · ${t.sujet}</span>${t.non_lu && html`<span class="ticket-reponse">Réponse</span>`}<span class="ticket-date">${jourCourt(t.activite)}</span></button>`;
  }
}

CompteTickets.definir();
