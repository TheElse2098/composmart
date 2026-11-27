/* ============================================================================
   evenements.js — <cs-admin-evenements> : la liste des ateliers, leur
   création et leur cycle de vie (/evenements-admin).

   Chaque changement d'état est confirmé avant d'être envoyé : il a un effet
   immédiat sur les téléphones de la salle. Un refus du serveur s'affiche en
   tête de page (l'ancienne page appelait une fonction inexistante, et le
   refus passait inaperçu).

   Usage :
     <cs-admin-evenements></cs-admin-evenements>
     <script type="module" src="/ui/admin/ateliers/evenements.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { html } from '../../socle/outils.js';
import { ADRESSES } from './adresses.js';
import { dateEvenement, dateVersServeur } from './outils-ateliers.js';
import { PageAteliers } from './page-ateliers.js';

/**
 * Réponse de /api/evenements/admin.php?action=liste.
 * @typedef {'prevu' | 'ouvert' | 'en_cours' | 'termine' | 'annule'} Statut
 * @typedef {object} Evenement
 * @property {number} id
 * @property {string} titre
 * @property {string | null} lieu
 * @property {string} date_debut
 * @property {string} code
 * @property {Statut} statut
 * @property {number} nb_participants
 * @property {boolean | number} [supprime]
 */

/** L'onglet des événements supprimés. */
export const SUPPRIMES = 'supprimes';

/** @type {Record<Statut, string>} */
export const STATUTS = { prevu: 'Prévu', ouvert: 'Ouvert', en_cours: 'En cours', annule: 'Annulé', termine: 'Terminé' };

/** Les onglets, dans l'ordre : '' pour tous. */
const ONGLETS = /** @type {const} */ (['', 'prevu', 'ouvert', 'en_cours', 'annule', 'termine']);

/** Ce qu'on peut faire d'un événement selon son statut, en plus du suivi,
 *  de l'annulation et de la suppression. */
export const ACTIONS_PAR_STATUT = {
  prevu: [{ action: 'ouvrir', classe: 'vert', libelle: '▶ Ouvrir' }],
  ouvert: [{ action: 'reprevoir', classe: 'gris', libelle: '↩ Repasser en Prévu' }, { action: 'demarrer', classe: 'vert', libelle: '🟢 Démarrer' }],
  en_cours: [{ action: 'terminer', classe: 'gris', libelle: '🏁 Terminer' }],
  termine: [],
  annule: [],
};

/** La question posée avant chaque action. */
export const CONFIRMATIONS = {
  ouvrir: { titre: 'Ouvrir les inscriptions ?', texte: 'Les participants pourront rejoindre avec le code.', valider: 'Ouvrir' },
  reprevoir: { titre: 'Repasser en « Prévu » ?', texte: 'Les inscriptions seront coupées.', valider: 'Repasser en Prévu' },
  demarrer: { titre: "Démarrer l'atelier ?", texte: 'Les inscriptions se ferment : personne ne pourra plus rejoindre.', valider: 'Démarrer' },
  terminer: { titre: "Terminer l'atelier ?", texte: 'Tous les participants seront déconnectés.', valider: 'Terminer', danger: true },
  annuler: { titre: 'Annuler cet événement ?', texte: 'Tous les participants seront déconnectés. Personne ne pourra plus rejoindre.', valider: 'Annuler l’événement', danger: true },
  supprimer: { titre: 'Supprimer cet événement ?', texte: 'Il disparaît de la liste mais reste consultable dans les supprimés. Aucune donnée n’est effacée.', valider: 'Supprimer', danger: true },
  restaurer: { titre: 'Restaurer cet événement ?', texte: 'Il réapparaîtra dans la liste, avec son statut d’origine.', valider: 'Restaurer' },
};

export class AdminEvenements extends PageAteliers {
  static balise = 'cs-admin-evenements';
  static styles = [...PageAteliers.styles, new URL('./evenements.css', import.meta.url)];

  /** L'onglet affiché : '', un statut, ou SUPPRIMES. */
  #onglet = '';
  /** Numéro du dernier chargement : une réponse plus ancienne est ignorée
   *  (deux onglets cliqués de suite). */
  #chargement = 0;

  monter() {
    this.poserPage({
      retour: { adresse: '/admin', libelle: 'Administration' },
      badge: '🎟️ Administration',
      titre: 'Événements',
      // Les parcours, anecdotes et images sont des bibliothèques à part et
      // non des onglets : elles ont leurs propres adresses.
      liens: html`
        <div class="evt-liens">
          <a class="hero-lien" href="${ADRESSES.parcours}">🎬 Bibliothèque de parcours →</a>
          <a class="hero-lien" href="${ADRESSES.anecdotes}">💡 Anecdotes →</a>
          <a class="hero-lien" href="${ADRESSES.images}">🖼️ Images →</a>
        </div>`,
      corps: this.gabarit(),
    });
    this.ecouter('submit', '.evt-creation', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#creer();
    });
    this.ecouter('click', '[data-onglet]', (bouton) => this.#changerOnglet(bouton.dataset.onglet || ''));
    this.ecouter('click', '[data-action]', (bouton) => this.#agir(bouton.dataset.action || '', Number(bouton.dataset.id)));
    this.#charger();
  }

  /** @param {string} onglet */
  #changerOnglet(onglet) {
    this.#onglet = onglet;
    for (const bouton of this.tous('[data-onglet]')) {
      const actif = bouton.dataset.onglet === onglet;
      bouton.classList.toggle('actif', actif);
      bouton.setAttribute('aria-pressed', actif ? 'true' : 'false');
    }
    this.#charger();
  }

  async #charger() {
    const numero = ++this.#chargement;
    const zone = this.trouver('.evt-liste');
    const onglet = this.#onglet;
    /** @type {Evenement[]} */
    let evenements;
    try {
      const d = await api.evenements.get('admin.php', {
        action: 'liste',
        statut: onglet && onglet !== SUPPRIMES ? onglet : null,
        supprimes: onglet === SUPPRIMES ? 1 : null,
      });
      evenements = d.evenements || [];
    } catch (erreur) {
      if (numero !== this.#chargement) return;
      console.error('<cs-admin-evenements>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), zone);
      return;
    }
    if (numero !== this.#chargement) return;
    this.rendre(this.gabaritListe(evenements, onglet === SUPPRIMES), zone);
  }

  async #creer() {
    const erreur = this.trouver('.evt-creation .msg');
    erreur.hidden = true;
    const liberer = this.occuper('.evt-creation [type="submit"]', 'Création…');
    try {
      await api.evenements.post('admin.php', {
        titre: this.champ('[name="titre"]'),
        lieu: this.champ('[name="lieu"]'),
        date_debut: dateVersServeur(this.champ('[name="date_debut"]')),
      }, { action: 'creer' });
      this.trouver('.evt-creation', HTMLFormElement).reset();
      this.#charger();
    } catch (e) {
      console.error('<cs-admin-evenements>', e);
      erreur.textContent = texteErreur(e, 'Erreur réseau, réessaie.');
      erreur.hidden = false;
    } finally {
      liberer();
    }
  }

  /**
   * @param {string} action
   * @param {number} id
   */
  async #agir(action, id) {
    if (!(action in CONFIRMATIONS) || !id) return;
    if (!(await confirmer(CONFIRMATIONS[/** @type {keyof typeof CONFIRMATIONS} */ (action)]))) return;
    try {
      await api.evenements.post('admin.php', { id }, { action });
      this.effacerMessage();
    } catch (erreur) {
      console.error('<cs-admin-evenements>', erreur);
      this.message(texteErreur(erreur, 'Action impossible.'));
    }
    this.#charger();
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="section-titre">➕ Créer un événement</div>
      <div class="card">
        <form class="evt-creation">
          <div class="field"><label for="evt-titre">Titre</label>
            <input type="text" id="evt-titre" name="titre" maxlength="150" placeholder="Atelier compostage — Entreprise X" required></div>
          <div class="field"><label for="evt-lieu">Lieu</label>
            <input type="text" id="evt-lieu" name="lieu" maxlength="200" placeholder="Salle de réunion, 12 rue…"></div>
          <div class="field"><label for="evt-date">Date et heure</label>
            <input type="datetime-local" id="evt-date" name="date_debut" required></div>
          <div class="msg error" role="alert" hidden></div>
          <button type="submit" class="btn-p">Créer</button>
        </form>
      </div>

      <div class="section-titre">📋 Événements</div>
      <div class="evt-onglets">
        ${ONGLETS.map((o) => html`<button type="button" class="evt-onglet${o === '' && ' actif'}" data-onglet="${o}" aria-pressed="${o === '' ? 'true' : 'false'}">${o ? STATUTS[o] : 'Tous'}</button>`)}
        <button type="button" class="evt-onglet supprimes" data-onglet="${SUPPRIMES}" aria-pressed="false">🗑️ Supprimés</button>
      </div>
      <div class="evt-liste"><p class="cs-etat">Chargement…</p></div>`;
  }

  /**
   * @param {Evenement[]} evenements
   * @param {boolean} vueSupprimes
   */
  gabaritListe(evenements, vueSupprimes) {
    if (!evenements.length) {
      return html`<div class="empty-msg">${vueSupprimes ? 'Aucun événement supprimé.' : 'Aucun événement dans cette catégorie.'}</div>`;
    }
    return html`${evenements.map((e) => this.gabaritEvenement(e, vueSupprimes))}`;
  }

  /**
   * @param {Evenement} e
   * @param {boolean} vueSupprimes
   */
  gabaritEvenement(e, vueSupprimes) {
    const bouton = (/** @type {string} */ action, /** @type {string} */ classe, /** @type {string} */ libelle) =>
      html`<button type="button" class="${classe}" data-action="${action}" data-id="${e.id}">${libelle}</button>`;
    const actions = vueSupprimes
      ? [bouton('restaurer', 'vert', '↩ Restaurer')]
      : [
        ...(ACTIONS_PAR_STATUT[e.statut] || []).map((a) => bouton(a.action, a.classe, a.libelle)),
        e.statut !== 'annule' && bouton('annuler', 'orange', '✕ Annuler'),
        bouton('supprimer', 'rouge', '🗑 Supprimer'),
      ];
    // Le statut (cycle de vie) et la suppression sont deux affichages
    // distincts : un événement supprimé garde son statut visible.
    return html`
      <div class="evt-item">
        <div class="evt-main">
          <div class="evt-titre">${e.titre}</div>
          <div class="evt-meta">${dateEvenement(e.date_debut)}${e.lieu && ' · ' + e.lieu} · code <span class="evt-code">${e.code}</span> · ${e.nb_participants} inscrit(s)</div>
        </div>
        <span class="evt-statut ${e.statut}">${STATUTS[e.statut] || e.statut}</span>
        ${!!e.supprime && html`<span class="evt-statut supprime">Supprimé</span>`}
        <div class="evt-actions">
          <a class="suivi" href="${ADRESSES.suivi(e.id)}">👁 Suivi</a>
          ${actions}
        </div>
      </div>`;
  }
}

AdminEvenements.definir();
