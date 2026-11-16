/* ============================================================================
   fil-discussion.js — <cs-fil-discussion> : la fenêtre de discussion d'un
   ticket (« nous contacter »).

   Le fil des messages en bulles, la zone de réponse, et les boutons qui
   changent l'état du ticket. Tant que la fenêtre est ouverte, le fil est relu
   toutes les 8 secondes : la personne en face peut écrire pendant qu'on lit.

   La même fenêtre sert aux deux bouts de la conversation : l'administrateur
   dans le panneau, le titulaire du ticket sur sa page de compte. Ce qui les
   distingue tient dans un « point de vue », donné une fois par le composant
   parent : à quel service parler, quels messages sont « les miens », quels
   mots et quelles actions proposer. Ce fichier ne connaît aucun endpoint.

   Usage :
     <cs-fil-discussion></cs-fil-discussion>

     const fil = this.trouver('cs-fil-discussion', FilDiscussion);
     fil.configurer({
       admin: true,
       statuts: { ouvert: 'Ouvert', clos: 'Clos' },
       invite: 'Répondre…',
       lire: (id) => api.admin.get('tickets.php', { id }),
       repondre: (id, corps) => api.admin.postJson('tickets.php', { action: 'repondre', id, corps }),
       agir: (id, action) => api.admin.postJson('tickets.php', { action, id }),
       titre: (ticket) => '#' + ticket.id + ' · ' + ticket.sujet,
       auteur: (message) => message.auteur,
       lectureSeule: (statut) => 'Ticket clos.',
       actions: (statut) => (statut === 'ouvert' ? [{ action: 'clore', libelle: '✓ Clore' }] : []),
     });
     fil.ouvrir(12);

   À la fermeture, le composant émet « fil-ferme » : lire un ticket l'a marqué
   comme lu, la liste du parent est à recharger.

   La pastille d'état d'un ticket s'affiche aussi dans les listes :
   gabaritStatut(), habillé par la feuille de ce composant.
   ============================================================================ */
import { texteErreur } from '../../socle/api.js';
import { Fenetre } from '../../socle/fenetre.js';
import { html } from '../../socle/outils.js';
import { confirmer } from '../dialogue/dialogue.js';

/**
 * @typedef {object} Ticket
 * @property {number} id
 * @property {string} sujet
 * @property {string} statut       `ouvert`, `clos`, `clos_definitif`
 * @property {string} [username]   son auteur (vu par un administrateur)
 *
 * @typedef {object} Message
 * @property {string} auteur
 * @property {boolean} est_admin
 * @property {string} corps
 * @property {string} created_at
 *
 * @typedef {{ ticket: Ticket, messages: Message[] }} Fil
 *
 * @typedef {object} Action  un bouton sous le fil
 * @property {string} action    ce qui est passé à `agir()`
 * @property {string} libelle
 * @property {boolean} [danger]
 * @property {import('../dialogue/dialogue.js').Options} [confirmation]  à confirmer avant d'agir
 *
 * @typedef {object} PointDeVue
 * @property {boolean} admin  vrai : « mes » messages sont ceux des administrateurs
 * @property {Record<string, string>} statuts  libellés de la pastille d'état
 * @property {string} invite  texte grisé de la zone de réponse
 * @property {(id: number) => Promise<Fil>} lire
 * @property {(id: number, corps: string) => Promise<unknown>} repondre
 * @property {(id: number, action: string) => Promise<unknown>} agir
 * @property {(ticket: Ticket) => string} titre
 * @property {(message: Message) => string} auteur  qui a écrit, tel qu'on le montre
 * @property {(statut: string) => string} lectureSeule  ce qu'on dit d'un ticket auquel on ne peut pas répondre
 * @property {(statut: string) => Action[]} actions
 */

/** Intervalle de relecture du fil, fenêtre ouverte. */
const RELECTURE = 8000;

/**
 * La pastille d'état d'un ticket. Utilisable hors de la fenêtre (listes).
 * @param {string} statut
 * @param {Record<string, string>} libelles  un état sans libellé garde son code
 */
export function gabaritStatut(statut, libelles) {
  const connu = ['ouvert', 'clos', 'clos_definitif'].includes(statut);
  return html`<span class="fil-discussion-statut${connu ? ' ' + statut : ''}">${libelles[statut] || statut}</span>`;
}

/** « 2026-11-14T09:15:00 » → « 2026-11-14 09:15 ». @param {string | null | undefined} date */
export function dateMessage(date) {
  return String(date || '').slice(0, 16).replace('T', ' ');
}

export class FilDiscussion extends Fenetre {
  static balise = 'cs-fil-discussion';
  static styles = [...Fenetre.styles, new URL('./fil-discussion.css', import.meta.url)];

  /** @type {PointDeVue | null} */
  #vue = null;
  /** Le ticket affiché ; `null` fenêtre fermée. Une réponse pour un autre est ignorée.
   *  @type {number | null} */
  #id = null;
  /** L'état du ticket affiché, d'après la dernière lecture. */
  #statut = '';
  /** Le ticket auquel appartient ce qui est écrit dans la zone de réponse.
   *  @type {number | null} */
  #brouillon = null;
  /** @type {(() => void) | null} */
  #arreterRelecture = null;

  monter() {
    this.poserFenetre(this.gabarit());
    this.ecouter('click', '[data-action="envoyer"]', () => this.#envoyer());
    this.ecouter('keydown', 'textarea', (_zone, evenement) => {
      if (evenement instanceof KeyboardEvent && evenement.key === 'Enter' && (evenement.ctrlKey || evenement.metaKey)) this.#envoyer();
    });
    this.ecouter('click', '[data-agir]', (bouton) => this.#agir(bouton));
  }

  /**
   * Donne à la fenêtre son point de vue. À appeler une fois, avant ouvrir().
   * @param {PointDeVue} vue
   */
  configurer(vue) {
    this.#vue = vue;
  }

  /**
   * Ouvre la fenêtre sur un ticket.
   * @param {number} id
   */
  ouvrir(id) {
    const vue = this.#vue;
    if (!vue) throw new Error('<cs-fil-discussion> : configurer() doit être appelé avant ouvrir()');
    this.desQuePosee(() => {
      this.#id = id;
      this.#statut = '';
      this.trouver('.fil-titre').textContent = '#' + id;
      this.rendre(html``, this.trouver('.fil-statut'));
      this.afficherChargement('Chargement…', this.trouver('.fil-messages'));
      this.rendre(html``, this.trouver('.fil-actions'));
      this.trouver('.fil-saisie').hidden = true;
      this.trouver('.fil-info').hidden = true;
      // Une réponse commencée survit à une fermeture par mégarde (Échap, clic
      // à côté) ; elle ne suit pas dans la discussion d'un autre ticket.
      const zone = this.trouver('textarea', HTMLTextAreaElement);
      if (id !== this.#brouillon) zone.value = '';
      this.#brouillon = id;
      zone.placeholder = vue.invite;
      this.#erreur('');
      this.montrer();

      this.#lire();
      this.#arreterRelecture?.();
      this.#arreterRelecture = this.minuterie(RELECTURE, () => this.#lire());
    });
  }

  aLaFermeture() {
    this.#arreterRelecture?.();
    this.#arreterRelecture = null;
    this.#id = null;
    this.emettre('fil-ferme');
  }

  /** Relit le fil et l'affiche. Une panne garde ce qui est à l'écran et se signale sous le fil. */
  async #lire() {
    const vue = this.#vue;
    const id = this.#id;
    if (!vue || id === null) return;
    try {
      const fil = await vue.lire(id);
      if (this.#id !== id) return;
      this.#afficher(vue, fil);
      this.#erreur('');
    } catch (erreur) {
      if (this.#id !== id) return;
      console.error('<cs-fil-discussion>', erreur);
      if (this.querySelector('.fil-messages .cs-etat')) this.rendre(html``, this.trouver('.fil-messages'));
      this.#erreur(texteErreur(erreur, "La discussion n'a pas pu être chargée."));
    }
  }

  /**
   * @param {PointDeVue} vue
   * @param {Fil} fil
   */
  #afficher(vue, fil) {
    const ticket = fil.ticket;
    this.#statut = ticket.statut;
    this.rendreSiChange(gabaritStatut(ticket.statut, vue.statuts), this.trouver('.fil-statut'));
    this.trouver('.fil-titre').textContent = vue.titre(ticket);

    // Redessiné seulement si le fil a changé : la relecture ne doit pas casser
    // une sélection de texte ni faire perdre la position de lecture.
    const messages = this.trouver('.fil-messages');
    if (this.rendreSiChange(this.gabaritMessages(vue, fil.messages), messages)) {
      messages.scrollTop = messages.scrollHeight; // le dernier message en vue
    }

    const ouvert = ticket.statut === 'ouvert';
    this.trouver('.fil-saisie').hidden = !ouvert;
    const info = this.trouver('.fil-info');
    info.hidden = ouvert;
    info.textContent = ouvert ? '' : vue.lectureSeule(ticket.statut);
    this.rendreSiChange(this.gabaritActions(vue.actions(ticket.statut)), this.trouver('.fil-actions'));
  }

  /** @param {string} message  vide : rien à signaler */
  #erreur(message) {
    const zone = this.trouver('.fil-erreur');
    zone.textContent = message;
    zone.hidden = message === '';
  }

  async #envoyer() {
    const vue = this.#vue;
    const id = this.#id;
    const zone = this.trouver('textarea', HTMLTextAreaElement);
    const bouton = this.trouver('[data-action="envoyer"]', HTMLButtonElement);
    const corps = zone.value.trim();
    if (!vue || id === null || !corps || bouton.disabled) return;

    bouton.disabled = true;
    try {
      await vue.repondre(id, corps);
      if (this.#id === id) zone.value = '';
      await this.#lire();
    } catch (erreur) {
      console.error('<cs-fil-discussion>', erreur);
      if (this.#id === id) this.#erreur(texteErreur(erreur, "Le message n'a pas pu être envoyé."));
    } finally {
      bouton.disabled = false;
    }
  }

  /** @param {HTMLElement} bouton  porte `data-agir`, l'action demandée */
  async #agir(bouton) {
    const vue = this.#vue;
    const id = this.#id;
    if (!vue || id === null || !(bouton instanceof HTMLButtonElement) || bouton.disabled) return;
    const action = vue.actions(this.#statut).find((a) => a.action === bouton.dataset.agir);
    if (!action) return;
    if (action.confirmation && !await confirmer(action.confirmation)) return;
    if (this.#id !== id) return; // fenêtre fermée pendant la confirmation

    bouton.disabled = true;
    try {
      await vue.agir(id, action.action);
      await this.#lire(); // l'état a changé : boutons et zone de réponse suivent
    } catch (erreur) {
      console.error('<cs-fil-discussion>', erreur);
      if (this.#id === id) this.#erreur(texteErreur(erreur, "L'action n'a pas pu être enregistrée."));
    } finally {
      bouton.disabled = false;
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="fil-tete">
        <span class="fil-statut"></span>
        <div class="fil-titre"></div>
        <button type="button" class="fil-fermer" data-action="fermer" aria-label="Fermer">✕</button>
      </div>
      <div class="fil-messages"></div>
      <div class="fil-info" hidden></div>
      <div class="fil-saisie" hidden>
        <textarea rows="2" maxlength="3000" aria-label="Message"></textarea>
        <button type="button" class="fil-envoyer" data-action="envoyer">Envoyer</button>
      </div>
      <div class="fil-erreur" role="alert" hidden></div>
      <div class="fil-actions"></div>`;
  }

  /**
   * @param {PointDeVue} vue
   * @param {Message[]} messages
   */
  gabaritMessages(vue, messages) {
    return html`${messages.map((m) => html`
      <div class="bulle ${m.est_admin === vue.admin ? 'moi' : 'autre'}"><div class="bulle-meta">${vue.auteur(m)} · ${dateMessage(m.created_at)}</div><div>${m.corps}</div></div>`)}`;
  }

  /** @param {Action[]} actions */
  gabaritActions(actions) {
    return html`${actions.map((a) => html`<button type="button" class="fil-action${a.danger ? ' danger' : ''}" data-agir="${a.action}">${a.libelle}</button>`)}`;
  }
}

FilDiscussion.definir();
