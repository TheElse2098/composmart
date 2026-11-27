/* ============================================================================
   parcours-edition.js — <cs-admin-parcours-edition> : l'éditeur des slides,
   pour deux sortes de déroulé qui manipulent exactement les mêmes objets :

     /evenements-admin/parcours/<id>     un parcours de la bibliothèque
                                         (parcours.php, table parcours_slides)
     /evenements-admin/<id>/deroule      le déroulé propre à un événement
                                         (admin.php, table evenement_slides)

   Mêmes quinze types, mêmes formulaires, même validation serveur : seuls
   l'endpoint et le nom de la clé changent (cibleDe()), plutôt qu'une seconde
   copie de l'éditeur qui divergerait au premier type de slide ajouté.

   Un déroulé d'atelier démarré reste consultable mais n'écrit plus : le
   serveur le dit (`modifiable`, `verrou`), l'éditeur passe en lecture seule.

   L'ordre se change aux flèches (toucher, clavier) ou au glisser-déposer
   (souris). La liste n'est pas réordonnée pendant le survol, seulement au
   dépôt : redessiner en plein glissement détruirait l'élément que le
   navigateur déplace. Un liseré montre où la slide atterrira.

   Usage :
     <cs-admin-parcours-edition></cs-admin-parcours-edition>
     <script type="module" src="/ui/admin/ateliers/parcours-edition.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { html } from '../../socle/outils.js';
import { ADRESSES } from './adresses.js';
import { deplacer, rangDepot } from './outils-ateliers.js';
import { PageAteliers } from './page-ateliers.js';
import { AdminSlideEdition } from './slide-edition.js';

/**
 * @typedef {import('./slide-edition.js').Slide} Slide
 * @typedef {import('./slide-edition.js').Registre} Registre
 *
 * @typedef {object} CibleEdition
 * @property {string} fichier     endpoint des slides
 * @property {string} detail      action qui rend le déroulé
 * @property {string} cle         nom de la clé dans les envois
 * @property {number} id
 * @property {boolean} evenement  vrai pour le déroulé d'un événement
 */

/**
 * Ce que l'adresse désigne, ou null si elle ne désigne rien.
 * @param {string} chemin  location.pathname
 * @returns {CibleEdition | null}
 */
export function cibleDe(chemin) {
  const parcours = chemin.match(/\/parcours\/(\d+)\/?$/);
  if (parcours) return { fichier: 'parcours.php', detail: 'detail', cle: 'parcours_id', id: Number(parcours[1]), evenement: false };
  const deroule = chemin.match(/\/(\d+)\/deroule\/?$/);
  if (deroule) return { fichier: 'admin.php', detail: 'deroule', cle: 'evenement_id', id: Number(deroule[1]), evenement: true };
  return null;
}

/**
 * La ligne de résumé sous le titre.
 * @param {Slide[]} slides
 * @param {{ nom: string, nb_slides: number }[]} [sources]  parcours dont le déroulé a été monté
 * @returns {string}
 */
export function resumeDeroule(slides, sources = []) {
  const total = slides.reduce((s, x) => s + x.points, 0);
  let texte = slides.length + ' slide(s) · ' + total + ' points au total';
  if (sources.length) texte += ' · monté depuis ' + sources.map((s) => s.nom + ' (' + s.nb_slides + ')').join(' + ');
  return texte;
}

export class AdminParcoursEdition extends PageAteliers {
  static balise = 'cs-admin-parcours-edition';
  static styles = [...PageAteliers.styles, new URL('./parcours-edition.css', import.meta.url)];

  /** @type {CibleEdition | null} */
  #cible = null;
  /** @type {Registre} */
  #registre = {};
  /** @type {Slide[]} */
  #slides = [];
  #modifiable = true;
  /** Le formulaire du nom a été rempli : un rechargement ne l'écrase plus. */
  #infosPosees = false;
  /** Rang de la slide en cours de glissement. @type {number | null} */
  #glisse = null;
  #chargement = 0;

  monter() {
    this.#cible = cibleDe(location.pathname);
    const cible = this.#cible;
    this.poserPage({
      retour: { adresse: ADRESSES.liste, libelle: 'Tous les événements' },
      badge: cible && cible.evenement ? '🎬 Déroulé de l’événement' : '🎬 Parcours',
      titre: '—',
      liens: html`
        <p class="hero-sub pe-resume"></p>
        ${cible && cible.evenement && html`<p class="hero-sub pe-retour"><a href="${ADRESSES.suivi(cible.id)}">← Revenir à l’événement</a></p>`}`,
      corps: this.gabarit(cible),
    });
    if (!cible) {
      this.afficherErreur('Adresse inconnue.', this.trouver('.pe-slides'));
      return;
    }
    this.ecouter('submit', '.pe-infos', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#enregistrerInfos();
    });
    this.ecouter('click', '[data-action="ajouter"]', () => {
      const choix = this.trouver('.pe-type', HTMLSelectElement);
      this.#ouvrirSlide(choix.value, null);
    });
    this.ecouter('click', '[data-monter]', (b) => this.#deplacerDe(Number(b.dataset.monter), -1));
    this.ecouter('click', '[data-descendre]', (b) => this.#deplacerDe(Number(b.dataset.descendre), 1));
    this.ecouter('click', '[data-ouvrir]', (b) => {
      const slide = this.#slides[Number(b.dataset.ouvrir)];
      if (slide) this.#ouvrirSlide(slide.type, slide);
    });
    this.ecouter('click', '[data-retirer]', (b) => {
      const slide = this.#slides[Number(b.dataset.retirer)];
      if (slide) this.#supprimer(slide.id);
    });
    this.ecouter('slide-enregistree', 'cs-admin-slide-edition', () => this.#charger());
    this.#brancherGlisser();
    this.#charger();
  }

  async #charger() {
    const cible = this.#cible;
    if (!cible) return;
    const numero = ++this.#chargement;
    const zone = this.trouver('.pe-slides');
    /** @type {any} */
    let d;
    try {
      // Le registre des types vient du serveur : l'éditeur ne code en dur ni
      // les libellés ni la notion de « slide notée ». Une seule fois.
      const [types, detail] = await Promise.all([
        Object.keys(this.#registre).length ? null : api.evenements.get('parcours.php', { action: 'types' }),
        api.evenements.get(cible.fichier, { action: cible.detail, id: cible.id }),
      ]);
      if (types) this.#registre = types.types || {};
      d = detail;
    } catch (erreur) {
      if (numero !== this.#chargement) return;
      console.error('<cs-admin-parcours-edition>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), zone);
      return;
    }
    if (numero !== this.#chargement) return;

    this.#slides = d.slides || [];
    const titre = this.trouver('.hero h1');
    if (cible.evenement) {
      titre.textContent = 'Déroulé — ' + d.evenement.titre;
      this.#modifiable = d.modifiable !== false;
      const verrou = this.trouver('.pe-verrou');
      verrou.textContent = '🔒 ' + (d.verrou || 'Déroulé en lecture seule.');
      verrou.hidden = this.#modifiable;
      this.trouver('.pe-resume').textContent = resumeDeroule(this.#slides, d.sources || []);
    } else {
      titre.textContent = d.parcours.nom;
      this.trouver('.pe-resume').textContent = resumeDeroule(this.#slides);
      if (!this.#infosPosees) {
        this.remplir('[name="nom"]', d.parcours.nom);
        this.remplir('[name="description"]', d.parcours.description || '');
        this.#infosPosees = true;
      }
    }
    const ajout = this.trouver('.pe-ajout');
    ajout.hidden = !this.#modifiable;
    if (this.#modifiable && !this.querySelector('.pe-type option')) {
      this.rendre(html`${Object.entries(this.#registre).map(([t, r]) => html`<option value="${t}">${(r.icone || '') + '  ' + r.nom}</option>`)}`, this.trouver('.pe-type'));
    }
    this.#dessiner();
  }

  #dessiner() {
    this.rendre(this.gabaritSlides(this.#slides, this.#registre, this.#modifiable), this.trouver('.pe-slides'));
  }

  /**
   * @param {string} type
   * @param {Slide | null} slide
   */
  #ouvrirSlide(type, slide) {
    const cible = this.#cible;
    if (!cible || !type) return;
    this.trouver('cs-admin-slide-edition', AdminSlideEdition).ouvrir({
      type,
      slide,
      registre: this.#registre,
      modifiable: this.#modifiable,
      cible: { fichier: cible.fichier, cle: cible.cle, id: cible.id },
    });
  }

  async #enregistrerInfos() {
    const cible = this.#cible;
    if (!cible || cible.evenement) return;
    const liberer = this.occuper('.pe-infos [type="submit"]', 'Envoi…');
    try {
      await api.evenements.post('parcours.php', { id: cible.id, nom: this.champ('[name="nom"]'), description: this.champ('[name="description"]') }, { action: 'modifier' });
    } catch (erreur) {
      console.error('<cs-admin-parcours-edition>', erreur);
      this.message(texteErreur(erreur, 'Erreur réseau.'));
      liberer();
      return;
    }
    liberer();
    this.message('Enregistré.', true);
    this.#charger();
  }

  /** @param {number} i @param {-1 | 1} sens */
  #deplacerDe(i, sens) {
    const j = i + sens;
    if (!this.#modifiable || j < 0 || j >= this.#slides.length) return;
    this.#reordonner(deplacer(this.#slides, i, j));
  }

  /**
   * Le nouvel ordre s'affiche tout de suite ; s'il est refusé, la liste
   * revient à celle du serveur plutôt que de montrer un ordre qui n'existe pas.
   * @param {Slide[]} slides
   */
  async #reordonner(slides) {
    const cible = this.#cible;
    if (!cible) return;
    this.#slides = slides;
    this.#dessiner();
    try {
      await api.evenements.postJson(cible.fichier, { [cible.cle]: cible.id, ordre: slides.map((s) => s.id) }, { action: 'slide_reordonner' });
    } catch (erreur) {
      console.error('<cs-admin-parcours-edition>', erreur);
      this.message(texteErreur(erreur, 'Réordonnancement impossible.'));
      this.#charger();
    }
  }

  /** @param {number} id */
  async #supprimer(id) {
    const cible = this.#cible;
    if (!cible || !this.#modifiable) return;
    if (!(await confirmer({ titre: 'Supprimer cette slide ?', valider: 'Supprimer', danger: true }))) return;
    try {
      await api.evenements.post(cible.fichier, { id }, { action: 'slide_supprimer' });
    } catch (erreur) {
      console.error('<cs-admin-parcours-edition>', erreur);
      this.message(texteErreur(erreur, 'Suppression impossible.'));
      return;
    }
    this.#charger();
  }

  // ── Glisser-déposer ───────────────────────────────────────────────────────

  #nettoyerCibles() {
    for (const ligne of this.tous('.slide-row')) ligne.classList.remove('cible-avant', 'cible-apres');
  }

  /**
   * La ligne survolée, et si le curseur est dans sa moitié haute.
   * @param {HTMLElement} ligne
   * @param {Event} evenement
   */
  #survol(ligne, evenement) {
    const r = ligne.getBoundingClientRect();
    const y = /** @type {MouseEvent} */ (evenement).clientY;
    return { rang: Number(ligne.dataset.rang), avant: y - r.top < r.height / 2 };
  }

  #brancherGlisser() {
    this.ecouter('dragstart', '.slide-row[draggable]', (ligne, evenement) => {
      this.#glisse = Number(ligne.dataset.rang);
      ligne.classList.add('glisse');
      const transfert = /** @type {DragEvent} */ (evenement).dataTransfer;
      if (transfert) {
        transfert.effectAllowed = 'move';
        // Firefox n'amorce pas le glissement sans données transférées.
        try { transfert.setData('text/plain', String(this.#glisse)); } catch { /* vieux navigateurs */ }
      }
    });
    this.ecouter('dragend', '.slide-row', (ligne) => {
      ligne.classList.remove('glisse');
      this.#glisse = null;
      this.#nettoyerCibles();
    });
    this.ecouter('dragover', '.slide-row', (ligne, evenement) => {
      const { rang, avant } = this.#survol(ligne, evenement);
      if (this.#glisse === null || this.#glisse === rang) return;
      evenement.preventDefault(); // sans quoi le dépôt est refusé
      const transfert = /** @type {DragEvent} */ (evenement).dataTransfer;
      if (transfert) transfert.dropEffect = 'move';
      this.#nettoyerCibles();
      ligne.classList.add(avant ? 'cible-avant' : 'cible-apres');
    });
    this.ecouter('dragleave', '.slide-row', (ligne, evenement) => {
      // dragleave survient aussi en passant sur un enfant : on ne nettoie que
      // si le curseur a vraiment quitté la ligne.
      const vers = /** @type {MouseEvent} */ (evenement).relatedTarget;
      if (!(vers instanceof Element) || !ligne.contains(vers)) ligne.classList.remove('cible-avant', 'cible-apres');
    });
    this.ecouter('drop', '.slide-row', (ligne, evenement) => {
      evenement.preventDefault();
      const depart = this.#glisse;
      this.#glisse = null;
      this.#nettoyerCibles();
      if (depart === null || !this.#modifiable) return;
      const { rang, avant } = this.#survol(ligne, evenement);
      const arrivee = rangDepot(depart, rang, avant);
      if (arrivee !== null) this.#reordonner(deplacer(this.#slides, depart, arrivee));
    });
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /** @param {CibleEdition | null} cible */
  gabarit(cible) {
    return html`
      <!-- Atelier démarré : l'éditeur reste consultable mais n'écrit plus. -->
      <div class="msg error pe-verrou" hidden></div>
      ${cible && !cible.evenement && html`
        <div class="card">
          <form class="pe-infos">
            <div class="duo">
              <div class="field"><label for="pe-nom">Nom</label><input type="text" id="pe-nom" name="nom" maxlength="150" required></div>
              <div class="field"><label for="pe-description">Description</label><input type="text" id="pe-description" name="description" maxlength="300"></div>
            </div>
            <button type="submit" class="btn-s">Enregistrer</button>
          </form>
        </div>`}
      <div class="section-titre">🧩 Slides</div>
      <div class="pe-slides"><p class="cs-etat">Chargement…</p></div>
      <div class="card pe-ajout" hidden>
        <div class="field"><label for="pe-type">Ajouter une slide</label><select id="pe-type" class="pe-type"></select></div>
        <button type="button" class="btn-p" data-action="ajouter">+ Ajouter</button>
      </div>
      <cs-admin-slide-edition></cs-admin-slide-edition>`;
  }

  /**
   * @param {Slide[]} slides
   * @param {Registre} registre
   * @param {boolean} modifiable
   */
  gabaritSlides(slides, registre, modifiable) {
    if (!slides.length) return html`<div class="empty-msg">Aucune slide. Ajoute la première ci-dessous.</div>`;
    return html`${slides.map((s, i) => {
      const reg = registre[s.type];
      const nom = reg ? reg.nom : s.type;
      // Atelier démarré : on consulte une slide, on ne la déplace ni ne la
      // supprime — un bouton grisé vaut mieux qu'un bouton qui ne fait rien.
      const bloque = !modifiable && html` disabled`;
      // L'icône porte un title plutôt qu'un texte lu : le nom du type est
      // écrit juste en dessous, d'où aussi le aria-hidden.
      return html`
        <div class="slide-row" data-rang="${i}"${modifiable && html` draggable="true"`}>
          ${modifiable && html`<div class="slide-poignee" title="Glisser pour déplacer" aria-hidden="true">⠿</div>`}
          <div class="slide-rang">${i + 1}</div>
          <div class="slide-icone" title="${nom}" aria-hidden="true">${(reg && reg.icone) || '📄'}</div>
          <div class="slide-info">
            <div class="slide-titre">${s.titre || nom}</div>
            <div class="slide-type">${nom}</div>
          </div>
          ${s.points > 0 && html`<span class="slide-pts">${s.points} pts</span>`}
          <div class="slide-btns">
            <button type="button" data-monter="${i}" aria-label="Monter"${bloque || (i === 0 && html` disabled`)}>↑</button>
            <button type="button" data-descendre="${i}" aria-label="Descendre"${bloque || (i === slides.length - 1 && html` disabled`)}>↓</button>
            <button type="button" data-ouvrir="${i}" aria-label="${modifiable ? 'Modifier' : 'Consulter'}">${modifiable ? '✏️' : '👁'}</button>
            <button type="button" class="sup" data-retirer="${i}" aria-label="Supprimer"${bloque}>🗑</button>
          </div>
        </div>`;
    })}`;
  }
}

AdminParcoursEdition.definir();
