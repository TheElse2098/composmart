/* ============================================================================
   journal-detail.js — <cs-admin-journal-detail> : la fenêtre de détail d'une
   entrée du journal.

   Elle montre ce que l'entrée a conservé (qui, quand, quoi, l'avant et
   l'après, l'élément supprimé) et propose d'annuler l'action quand c'est
   possible. La liste du journal ne transporte qu'un résumé : le détail est
   demandé au serveur à l'ouverture.

   Annulation : la demande part vers le service qui possède les données
   (table ANNULATIONS). C'est lui qui relit l'entrée, vérifie que l'élément
   n'a pas bougé depuis, remet l'état d'avant et journalise sa propre action.
   Ici on ne fait que demander, puis afficher sa réponse.

   Après une annulation réussie, le composant émet « donnees-modifiees ».

   Usage, dans le journal :
     <cs-admin-journal-detail></cs-admin-journal-detail>
     this.trouver('cs-admin-journal-detail', AdminJournalDetail).ouvrir(resume);
   ============================================================================ */
import { confirmer, informer } from '../../composants/dialogue/dialogue.js';
import { ErreurApi, api, texteErreur } from '../../socle/api.js';
import { Fenetre } from '../../socle/fenetre.js';
import { html } from '../../socle/outils.js';
import { MOTIFS } from './carte-libelles.js';
import { changements, diffCoursTexte, diffObjet, diffQuiz, etatElement, ligne, valeur } from './journal-diff.js';
import { ANNULATIONS, AVEC_AVANT_APRES, PRECISIONS_ANNULATION, annulable, dateJournal, libelleAction } from './journal-libelles.js';

/**
 * Une ligne de la liste du journal (/api/admin/audit.php).
 * @typedef {object} Resume
 * @property {number} id
 * @property {string} username
 * @property {string} action
 * @property {string | null} details
 * @property {string | null} target_type
 * @property {number | null} target_id
 * @property {string} date
 * @property {boolean} [annule]
 *
 * L'entrée complète (/api/admin/audit.php?id=N). `snapshot` est ce que le
 * service a conservé au moment de l'action ; sa forme dépend de l'action.
 * @typedef {Resume & { snapshot: Record<string, any> | null, annule_at: string | null, annule_par: string | null }} Entree
 */

/** @param {unknown[] | undefined} liste @param {string} [sorte] */
const puces = (liste, sorte = '') => (liste && liste.length
  ? html`${liste.map((x) => html`<span class="audit-chip${sorte ? ' ' + sorte : ''}">${x}</span>`)}`
  : null);

/**
 * Les lignes propres à certains types d'entrée (signalement, composteur,
 * compte, email), en tête du détail. Qui et quand sont dans l'en-tête de la
 * fenêtre ; l'avant/après et l'élément supprimé, communs à tous, viennent après.
 * @param {Entree} a
 */
export function lignesPropres(a) {
  const s = a.snapshot || {};
  const lignes = [];
  if (a.details) lignes.push(ligne('Objet', a.details));

  if (a.target_type === 'signalement') {
    lignes.push(ligne('Signalé par', s.reporter || 'Anonyme'));
    lignes.push(ligne('Motif', MOTIFS[s.motif] || s.motif || '—'));
    lignes.push(s.commentaire ? ligne('Commentaire', '« ' + s.commentaire + ' »') : ligne('Commentaire', 'aucun', true));
    lignes.push(ligne('Composteur', s.compost_id != null ? '#' + s.compost_id : '—'));
  } else if (a.target_type === 'compost' && Array.isArray(s.ids) && s.ids.length > 1) {
    // Traitement en masse : une seule entrée pour tout le lot (cf. pending.php).
    lignes.push(ligne('Composteurs', html`${s.ids.map((/** @type {unknown} */ i) => html`<span class="audit-chip">#${i}</span>`)}`));
    lignes.push(ligne('Traités', s.traites + ' / ' + s.ids.length));
  } else if (a.target_type === 'compost') {
    lignes.push(ligne('Composteur', '#' + (a.target_id != null ? a.target_id : (s.id != null ? s.id : '—'))));
    if (s.propose_par) lignes.push(ligne('Proposé par', s.propose_par));
    if (s.type) lignes.push(ligne('Type', s.type));
    if (s.acces) lignes.push(ligne('Accès', s.acces));
    if (s.gestion) lignes.push(ligne('Gestion', s.gestion));
    if (s.lat != null && s.lon != null) lignes.push(ligne('Position', Number(s.lat).toFixed(5) + ', ' + Number(s.lon).toFixed(5)));
    const autorise = puces(s.mettre);
    const interdit = puces(s.pas_mettre, 'nok');
    if (autorise) lignes.push(ligne('Autorisé', autorise));
    if (interdit) lignes.push(ligne('Interdit', interdit));
  } else if (a.target_type === 'user') {
    // Suppressions et purges : ni pseudo ni numéro, volontairement (RGPD).
    lignes.push(ligne('Utilisateur', s.username || (a.target_id != null ? '#' + a.target_id : 'compte effacé'), !s.username && a.target_id == null));
    if (s.admin !== undefined && !s.changements) lignes.push(ligne('Nouveau rôle', s.admin ? 'Administrateur' : 'Utilisateur'));
    if (s.etait_admin !== undefined) lignes.push(ligne('Était admin', s.etait_admin ? 'oui' : 'non'));
  } else if (a.target_type === 'mail') {
    lignes.push(ligne('Destinataire', s.to || '—'));
    lignes.push(ligne('Sujet', s.sujet || '—'));
    lignes.push(ligne('Statut', s.ok ? '✅ Envoyé' : "❌ Échec d'envoi"));
    if (s.erreur) lignes.push(ligne('Raison', s.erreur));
    if (s.nb) lignes.push(ligne('Éléments groupés', s.nb));
  }

  if (s.annule) lignes.push(ligne('Annule', "l'entrée n°" + s.annule + ' du journal'));
  if (a.target_type === 'ticket' && s.sujet) lignes.push(ligne('Ticket', '« ' + s.sujet + ' »'));
  if (s.restaure_depuis) lignes.push(ligne('Version restaurée', dateJournal(s.restaure_depuis)));
  if (s.progressions_effacees != null) lignes.push(ligne('Progressions effacées', s.progressions_effacees));
  if (Array.isArray(s.deroule) && !s.changements) lignes.push(ligne('Déroulé', valeur(s.deroule)));
  if (s.type && a.action.indexOf('slide_') >= 0) lignes.push(ligne('Type de slide', s.type));
  return lignes;
}

/**
 * Le corps de la fenêtre pour une entrée.
 * @param {Entree} a
 */
export function gabaritDetail(a) {
  const s = a.snapshot || {};
  const sections = [];

  if (a.annule_at) {
    sections.push(html`<div class="audit-annule-banniere">↩️ Annulée le ${dateJournal(a.annule_at)}${a.annule_par && ' par ' + a.annule_par}</div>`);
  }
  const propres = lignesPropres(a);
  if (propres.length) sections.push(html`<div class="audit-sec">${propres}</div>`);

  if (s.message) {
    sections.push(html`<div class="audit-sec"><div class="fenetre__label">Message envoyé</div><div class="val-apres">${s.message}</div></div>`);
  }
  if (s.changements) {
    sections.push(html`<div class="audit-sec"><div class="fenetre__label">Modifications</div>${changements(s.changements)}</div>`);
  } else if (AVEC_AVANT_APRES.test(a.action)) {
    sections.push(html`<div class="audit-note">Avant / après non disponible : entrée écrite avant le 26/10/2026, quand le journal ne le conservait pas encore.</div>`);
  }
  if (s.etat) {
    const titre = /_(cree|demande)$/.test(a.action) ? 'Élément créé' : "Élément tel qu'il était avant suppression";
    sections.push(html`<div class="audit-sec"><div class="fenetre__label">${titre}</div>${etatElement(s.etat)}</div>`);
  }
  if (!sections.length) sections.push(html`<div class="audit-note">Aucun détail enregistré pour cette action.</div>`);

  // Texte, quiz, vidéo, podcast d'un cours : trop lourds pour le journal, ils
  // sont relus dans l'historique des versions (zone remplie après coup).
  if (s.version_id && Array.isArray(s.contenu_modifie) && s.contenu_modifie.length) {
    sections.push(html`<div class="audit-sec"><div class="fenetre__label">Contenu du cours</div><div data-zone="contenu-cours"><div class="audit-note">Chargement du contenu…</div></div></div>`);
  }
  return html`${sections}`;
}

/**
 * Le contenu d'un cours, avant et après, pour les parties modifiées.
 * @param {string[]} parties  parmi `texte`, `quiz`, `video`, `podcast`
 * @param {Record<string, any>} avant
 * @param {Record<string, any>} apres
 */
export function gabaritContenuCours(parties, avant, apres) {
  return html`
    ${parties.includes('texte') && html`<div class="fenetre__label">Texte</div>${diffCoursTexte(avant.texte, apres.texte)}`}
    ${parties.includes('quiz') && html`<div class="fenetre__label">Quiz</div>${diffQuiz(avant.quiz, apres.quiz)}`}
    ${parties.includes('video') && html`<div class="fenetre__label">Vidéo</div>${diffObjet(avant.video, apres.video)}`}
    ${parties.includes('podcast') && html`<div class="fenetre__label">Podcast</div>${diffObjet(avant.podcast, apres.podcast)}`}`;
}

export class AdminJournalDetail extends Fenetre {
  static balise = 'cs-admin-journal-detail';
  static styles = [...Fenetre.styles, new URL('./journal-detail.css', import.meta.url)];

  /** L'entrée affichée. Une réponse arrivée en retard pour une autre est ignorée.
   *  @type {Resume | null} */
  #resume = null;
  /** @type {Entree | null} */
  #entree = null;

  monter() {
    this.poserFenetre(this.gabarit());
    this.ecouter('click', '[data-action="annuler"]', (bouton) => this.#annuler(bouton));
  }

  /**
   * Ouvre la fenêtre sur une entrée et va chercher son détail.
   * @param {Resume} resume
   */
  ouvrir(resume) {
    this.apresMontage(() => { this.#afficher(resume); });
  }

  /** @param {Resume} resume */
  async #afficher(resume) {
    this.#resume = resume;
    this.#entree = null;
    const libelle = libelleAction(resume.action);
    this.trouver('.audit-modal-icon').textContent = libelle.icone;
    this.trouver('.fenetre__titre').textContent = libelle.texte;
    this.trouver('.audit-meta').textContent = 'par ' + resume.username + ' · ' + dateJournal(resume.date);
    const corps = this.trouver('.audit-modal-body');
    this.rendre(html`<div class="audit-note">Chargement…</div>`, corps);
    this.#montrerActions(null);
    this.montrer();

    try {
      /** @type {{ entry: Entree }} */
      const d = await api.admin.get('audit.php', { id: resume.id });
      if (this.#resume !== resume) return;
      this.#entree = d.entry;
      this.rendre(gabaritDetail(d.entry), corps);
      this.#montrerActions(d.entry);
      this.#chargerContenuCours(d.entry, resume);
    } catch (erreur) {
      if (this.#resume !== resume) return;
      console.error('<cs-admin-journal-detail>', erreur);
      this.rendre(html`<div class="audit-note">${texteErreur(erreur, 'Détail indisponible.')}</div>`, corps);
    }
  }

  /** Fenêtre fermée : une réponse encore attendue ne doit plus rien afficher. */
  aLaFermeture() {
    this.#resume = null;
    this.#entree = null;
  }

  /**
   * @param {Entree} entree
   * @param {Resume} resume
   */
  async #chargerContenuCours(entree, resume) {
    const s = entree.snapshot || {};
    const zone = this.querySelector('[data-zone="contenu-cours"]');
    if (!zone) return;
    try {
      /** @type {{ avant: Record<string, any> | null, apres: Record<string, any> | null }} */
      const d = await api.admin.get('cours_versions.php', { id: s.version_id });
      if (this.#resume !== resume) return;
      if (!d.avant) this.rendre(html`<div class="audit-note">Contenu indisponible.</div>`, zone);
      else if (!d.apres) this.rendre(html`<div class="audit-note">Le contenu d'après n'est plus disponible.</div>`, zone);
      else this.rendre(gabaritContenuCours(s.contenu_modifie, d.avant, d.apres), zone);
    } catch (erreur) {
      if (this.#resume !== resume) return;
      console.error('<cs-admin-journal-detail>', erreur);
      this.rendre(html`<div class="audit-note">${texteErreur(erreur, 'Contenu indisponible.')}</div>`, zone);
    }
  }

  /** Boutons du bas : « Annuler cette action » si l'entrée le permet, et « Fermer ».
   *  @param {Entree | null} entree */
  #montrerActions(entree) {
    this.rendre(html`
      ${entree && annulable(entree) && html`<button type="button" class="modal-annuler-action" data-action="annuler">↩️ Annuler cette action</button>`}
      <button type="button" class="fenetre__annuler" data-action="fermer">Fermer</button>`, this.trouver('.fenetre__actions'));
  }

  /** @param {HTMLElement} bouton */
  async #annuler(bouton) {
    const entree = this.#entree;
    const resume = this.#resume;
    const ou = entree && ANNULATIONS[entree.action];
    if (!entree || !resume || !ou || !(bouton instanceof HTMLButtonElement)) return;

    const precision = PRECISIONS_ANNULATION[entree.action] ? PRECISIONS_ANNULATION[entree.action] + ' ' : '';
    const ok = await confirmer({
      titre: 'Annuler « ' + libelleAction(entree.action).texte + ' » ?',
      texte: precision + "L'état d'avant cette action est remis. Si l'élément a été modifié depuis, l'annulation est refusée.",
      valider: "Annuler l'action",
      annuler: 'Garder',
      danger: true,
    });
    if (!ok) return;

    bouton.disabled = true;
    try {
      const demande = { action: 'annuler', audit_id: entree.id };
      /** @type {{ slides_non_retablies?: string[] } | null} */
      const d = await api[ou.service].post(ou.fichier, demande, demande);
      if (d && d.slides_non_retablies && d.slides_non_retablies.length) {
        informer({ titre: 'Parcours rétabli en partie', texte: 'Slides qui ne passent plus la validation : ' + d.slides_non_retablies.join(' ; ') });
      }
      this.emettre('donnees-modifiees');
      this.ouvrir(resume); // rouverte pour afficher « Annulée le … »
    } catch (erreur) {
      bouton.disabled = false;
      console.error('<cs-admin-journal-detail>', erreur);
      const reseau = erreur instanceof ErreurApi && erreur.statut === 0;
      informer(reseau
        ? { titre: 'Erreur réseau', texte: "L'annulation n'a pas pu être envoyée." }
        : { titre: 'Annulation impossible', texte: texteErreur(erreur, "Le serveur a refusé l'annulation.") });
    }
  }

  /** L'intérieur de la fenêtre : en-tête, corps et boutons, remplis par ouvrir(). */
  gabarit() {
    return html`
      <div class="audit-modal-head">
        <span class="audit-modal-icon"></span>
        <div>
          <div class="fenetre__titre"></div>
          <div class="audit-meta"></div>
        </div>
        <button type="button" class="audit-modal-close" data-action="fermer" aria-label="Fermer">✕</button>
      </div>
      <div class="audit-modal-body"></div>
      <div class="fenetre__actions"></div>`;
  }
}

AdminJournalDetail.definir();
