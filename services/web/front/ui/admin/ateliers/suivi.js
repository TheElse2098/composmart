/* ============================================================================
   suivi.js — <cs-admin-suivi> : la console d'un atelier
   (/evenements-admin/<id>) — carte d'accueil (code, QR, lien), onglets,
   projection en salle.

   La page sonde le serveur toutes les 3 s : l'en-tête et la liste des
   participants à chaque tour, puis l'onglet affiché. Rien n'est redessiné
   qui n'a pas changé (rendreSiChange) : une animation de slide ne repart pas
   de zéro, une liste déroulante ouverte ne se referme pas. Un tour n'en
   chevauche jamais un autre : sur un réseau lent, les demandes ne
   s'empilent pas.

   Phase 10c-1 de la refonte : la console AFFICHE (en-tête, animation,
   participants, classement, projection), mais n'agit pas encore ; les
   actions restent sur la console en service jusqu'à la 10c-2.

   Usage :
     <cs-admin-suivi></cs-admin-suivi>
     <script type="module" src="/ui/admin/ateliers/suivi.js"></script>
     (le QR code vient de /assets/vendor/qrcode-generator, cité par la page)
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { html } from '../../socle/outils.js';
import { ADRESSES } from './adresses.js';
import { dateEvenement } from './outils-ateliers.js';
import { PageAteliers } from './page-ateliers.js';
import { AdminSuiviAnimation } from './suivi-animation.js';
import { AdminSuiviClassement } from './suivi-classement.js';
import { AdminSuiviParticipants } from './suivi-participants.js';
import { SONDAGE_MS, STATUTS_SUIVI, evenementDe, lienRejoindre } from './suivi-outils.js';

/**
 * Réponse de admin.php?action=suivi.
 * @typedef {object} EvenementSuivi
 * @property {number} id
 * @property {string} titre
 * @property {string | null} lieu
 * @property {string} date_debut
 * @property {string} code
 * @property {string} statut
 * @property {boolean} supprime
 * @property {number} nb_slides
 * @property {string | null} parcours_nom
 * @property {string | null} theme_slides
 *
 * @typedef {{ id: number, nom_affiche: string, equipe_id: number | null, rejoint_at: string, points: number }} Participant
 */

/** @typedef {'animation' | 'participants' | 'classement'} Onglet */
/** @type {{ cle: Onglet, libelle: string }[]} */
const ONGLETS = [
  { cle: 'animation', libelle: '🎬 Animation' },
  { cle: 'participants', libelle: '👥 Participants' },
  { cle: 'classement', libelle: '🏆 Classement' },
];

export class AdminSuivi extends PageAteliers {
  static balise = 'cs-admin-suivi';
  static styles = [...PageAteliers.styles, new URL('../../styles/slides.css', import.meta.url), new URL('./suivi.css', import.meta.url)];

  /** @type {number | null} */
  #id = null;
  /** @type {Onglet} */
  #onglet = 'animation';
  /** Un tour de sondage est en cours. */
  #occupe = false;
  /** Le dernier tour a échoué : un message le dit, à effacer au retour. */
  #enPanne = false;
  /** Le lien porté par le QR affiché. */
  #lienQr = '';
  #charge = false;

  monter() {
    this.#id = evenementDe(location.pathname);
    const id = this.#id;
    this.poserPage({
      retour: { adresse: ADRESSES.liste, libelle: 'Tous les événements' },
      // Pas d'en-tête de page : la carte d'accueil en tient lieu (cf. suivi.css).
      badge: '🎬 Console',
      titre: 'Suivi de l’atelier',
      corps: this.gabarit(id),
    });
    this.classList.add('onglet-animation');
    if (!id) {
      this.afficherErreur('Adresse inconnue.', this.trouver('.suivi-contenu'));
      return;
    }
    this.ecouter('click', '[data-onglet]', (b) => this.#changerOnglet(/** @type {Onglet} */ (b.dataset.onglet)));
    this.ecouter('projection', 'cs-admin-suivi-animation', () => this.#basculerProjection());
    this.ecouterSur(document, 'keydown', (e) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape' && this.classList.contains('projection')) this.#quitterProjection();
    });
    // Sortie du plein écran par le navigateur (Échap, F11) : on quitte aussi
    // la projection, plutôt que de laisser une page à moitié projetée.
    this.ecouterSur(document, 'fullscreenchange', () => {
      if (!document.fullscreenElement && this.classList.contains('projection')) this.#quitterProjection();
    });
    this.aLaFin(() => this.#quitterProjection());
    this.#tour();
    this.minuterie(SONDAGE_MS, () => this.#tour());
  }

  /** Un tour de sondage : l'en-tête, puis l'onglet affiché. */
  async #tour() {
    if (this.#occupe || !this.#id) return;
    this.#occupe = true;
    try {
      await this.#chargerSuivi();
      const onglet = this.#onglet;
      if (onglet === 'animation') await this.trouver('cs-admin-suivi-animation', AdminSuiviAnimation).rafraichir();
      else if (onglet === 'participants') await this.trouver('cs-admin-suivi-participants', AdminSuiviParticipants).rafraichir();
      else await this.trouver('cs-admin-suivi-classement', AdminSuiviClassement).rafraichir();
      if (this.#enPanne) {
        this.#enPanne = false;
        this.effacerMessage();
      }
    } catch (erreur) {
      console.error('<cs-admin-suivi>', erreur);
      if (!this.#charge) {
        this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), this.trouver('.suivi-contenu'));
        return; // pas de console à tenir à jour
      }
      this.#enPanne = true;
      this.message(texteErreur(erreur, 'Liaison avec le serveur interrompue.') + ' Nouvel essai dans quelques secondes.');
    } finally {
      this.#occupe = false;
    }
  }

  async #chargerSuivi() {
    /** @type {{ evenement: EvenementSuivi, participants?: Participant[] }} */
    const d = await api.evenements.get('admin.php', { action: 'suivi', id: this.#id });
    const evt = d.evenement;
    const participants = d.participants || [];
    if (!this.#charge) {
      this.#charge = true;
      this.trouver('.suivi-contenu').hidden = false;
      this.trouver('.suivi-attente').hidden = true;
    }
    // Charte des slides de cet événement : la carte de l'aperçu et la scène
    // de projection en dépendent (cf. styles/slides.css).
    this.setAttribute('data-theme-slide', evt.theme_slides || 'foret');
    this.rendreSiChange(this.gabaritAccueilHaut(evt), this.trouver('.join-haut'));
    this.rendreSiChange(this.gabaritAccueilBas(evt), this.trouver('.join-bas'));
    this.#poserQr(lienRejoindre(location.origin, evt.code));
    this.rendreSiChange(html`(${participants.length})`, this.trouver('.nb-participants'));
    this.trouver('cs-admin-suivi-animation', AdminSuiviAnimation).poserEvenement(evt);
    this.trouver('cs-admin-suivi-participants', AdminSuiviParticipants).poserParticipants(participants);
  }

  /**
   * Le QR code n'est refait que si le lien change. Généré dans le navigateur
   * (qrcode-generator, assets/vendor) : ni le lien ni le code d'accès ne
   * partent vers un service tiers. Correction M, taille selon le lien.
   * @param {string} lien
   */
  #poserQr(lien) {
    const image = this.querySelector('.join-qr');
    if (!(image instanceof HTMLElement)) return;
    const qrcode = /** @type {any} */ (window).qrcode;
    // Bibliothèque pas encore là : nouvel essai au tour suivant.
    if (typeof qrcode !== 'function') return;
    if (image.getAttribute('src') && this.#lienQr === lien) return;
    const q = qrcode(0, 'M');
    q.addData(lien);
    q.make();
    image.setAttribute('src', q.createDataURL(6, 4));
    this.#lienQr = lien;
  }

  /** @param {Onglet} onglet */
  #changerOnglet(onglet) {
    if (!ONGLETS.some((o) => o.cle === onglet) || onglet === this.#onglet) return;
    this.#onglet = onglet;
    for (const b of this.tous('[data-onglet]')) {
      const actif = b.dataset.onglet === onglet;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-selected', actif ? 'true' : 'false');
    }
    for (const o of ONGLETS) this.trouver('.onglet-' + o.cle).hidden = o.cle !== onglet;
    // La page s'élargit pour l'animation seulement (aperçu et réponses côte à côte).
    this.classList.toggle('onglet-animation', onglet === 'animation');
    this.#tour();
  }

  // ── Projection ────────────────────────────────────────────────────────────

  /* Pour l'écran de la salle : la carte d'accueil, l'avancement et la slide,
     sur la scène verte du thème, en plein écran ; rien de ce qui sert à
     l'animateur seul. */
  #basculerProjection() {
    if (this.classList.contains('projection')) {
      this.#quitterProjection();
      return;
    }
    this.classList.add('projection', 'sl-scene');
    document.body.style.overflow = 'hidden';
    const racine = document.documentElement;
    if (racine.requestFullscreen) racine.requestFullscreen().catch(() => { /* refusé : la projection reste dans la fenêtre */ });
  }

  #quitterProjection() {
    if (!this.classList.contains('projection')) return;
    this.classList.remove('projection', 'sl-scene');
    document.body.style.overflow = '';
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /** @param {number | null} id */
  gabarit(id) {
    return html`
      ${id && html`<p class="suivi-avis">Aperçu de la nouvelle console : elle affiche tout, en direct, mais n’agit pas encore. Pour piloter l’atelier, <a href="${ADRESSES.suivi(id)}">ouvre la console en service</a>.</p>`}
      <p class="cs-etat suivi-attente">Chargement…</p>
      <div class="suivi-contenu" hidden>
        <!-- Carte d'accueil : code et QR, projetable en salle d'attente. Le
             QR reste en place d'un tour à l'autre ; seul ce qui l'entoure se
             redessine, et seulement s'il a changé. -->
        <div class="join-card">
          <div class="join-haut"></div>
          <img class="join-qr" width="180" height="180" alt="QR code de l’événement">
          <div class="join-bas"></div>
        </div>
        <div class="suivi-onglets" role="tablist">
          ${ONGLETS.map((o, i) => html`<button type="button" class="suivi-onglet${i === 0 && ' actif'}" role="tab" data-onglet="${o.cle}" aria-selected="${i === 0 ? 'true' : 'false'}">${o.libelle}${o.cle === 'participants' && html` <span class="nb-participants"></span>`}</button>`)}
        </div>
        <div class="onglet-animation"><cs-admin-suivi-animation></cs-admin-suivi-animation></div>
        <div class="onglet-participants" hidden><cs-admin-suivi-participants></cs-admin-suivi-participants></div>
        <div class="onglet-classement" hidden><cs-admin-suivi-classement></cs-admin-suivi-classement></div>
      </div>`;
  }

  /** @param {EvenementSuivi} evt */
  gabaritAccueilHaut(evt) {
    return html`
      <h1 class="join-titre">${evt.titre}</h1>
      <div class="join-meta">${evt.lieu ? evt.lieu + ' · ' : ''}${dateEvenement(evt.date_debut)}</div>
      <div class="join-code">${evt.code}</div>`;
  }

  /** @param {EvenementSuivi} evt */
  gabaritAccueilBas(evt) {
    return html`
      <span class="join-link">${lienRejoindre(location.origin, evt.code)}</span>
      <div>
        <span class="join-statut ${evt.statut}">${STATUTS_SUIVI[/** @type {keyof typeof STATUTS_SUIVI} */ (evt.statut)] || evt.statut}</span>
        ${evt.supprime && html`<span class="join-statut supprime">Supprimé</span>`}
      </div>
      ${evt.supprime && html`<div class="lecture-seule-msg">🗑️ Événement supprimé — lecture seule.</div>`}
      ${!evt.supprime && evt.statut === 'annule' && html`<div class="lecture-seule-msg">✕ Événement annulé.</div>`}`;
  }
}

AdminSuivi.definir();
