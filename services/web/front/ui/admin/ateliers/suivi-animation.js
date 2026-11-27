/* ============================================================================
   suivi-animation.js — <cs-admin-suivi-animation> : l'onglet Animation de la
   console — où en est l'atelier, la slide en cours telle que la salle la voit
   (avec la correction, puisque c'est l'écran de l'animateur), les réponses
   reçues, le déroulé.

   La page (<cs-admin-suivi>) lui donne l'événement à chaque tour
   (poserEvenement) et lui demande de se mettre à jour (rafraichir) quand
   l'onglet est affiché.

   La carte de la slide n'est redessinée que si elle change : la redessiner à
   chaque tour ferait repartir son animation de zéro, et rembobinerait une
   vidéo en cours. Les cartes qui portent un classement le suivent, mais ne
   se redessinent elles aussi que s'il a bougé.

   Phase 10c-1 : affichage seul. Suivant, Précédent, « Aller à », la notation
   et l'affectation d'un parcours arrivent en 10c-2.
   ============================================================================ */
import { api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { ajusterMedias, ouvrirFacade } from '../../composants/slide/media-slide.js';
import { rejouer, rendreSlide } from '../../composants/slide/rendu-slide.js';
import { ADRESSES } from './adresses.js';
import { barresResultats, derouleOuvert, montrerResultats, slideAvecClassement } from './suivi-outils.js';

/**
 * Réponse de animation.php?action=etat.
 * @typedef {object} EtatAnimation
 * @property {{ id: number, theme: string }} evenement
 * @property {{ id: number, type: string, titre: string | null, points: number, contenu: any, aleatoire?: boolean } | null} slide
 * @property {number} index    -1 tant que l'atelier n'a pas commencé
 * @property {number} total
 * @property {number} nb_reponses
 * @property {number} nb_participants
 * @property {{ id: number, type: string, titre: string | null }[]} sommaire
 *
 * @typedef {import('./suivi-outils.js').Resultats} Resultats
 * @typedef {Record<string, { nom: string, icone?: string }>} Registre
 */

export class AdminSuiviAnimation extends Composant {
  static balise = 'cs-admin-suivi-animation';
  static styles = [new URL('./suivi-animation.css', import.meta.url)];

  /** @type {import('./suivi.js').EvenementSuivi | null} */
  #evenement = null;
  /** @type {Registre | null} */
  #registre = null;
  /** Signature de la carte affichée ; vide : à redessiner. */
  #signature = '';

  monter() {
    this.rendre(this.gabarit());
    this.ecouter('click', '[data-action="projection"]', () => this.emettre('projection'));
    this.ecouter('click', '.video-facade-btn', (bouton) => ouvrirFacade(bouton));
    this.ecouter('click', '[data-rejouer]', (bouton) => rejouer(bouton));
  }

  /**
   * L'événement, à chaque tour : décide des zones à montrer.
   * @param {import('./suivi.js').EvenementSuivi} evt
   */
  poserEvenement(evt) {
    this.#evenement = evt;
    this.apresMontage(() => {
      const avecSlides = evt.nb_slides > 0;
      this.trouver('.anim-sans-parcours').hidden = avecSlides;
      this.trouver('.anim-console').hidden = !avecSlides;
      const deroule = this.trouver('.anim-deroule');
      deroule.hidden = !(avecSlides && derouleOuvert(evt));
      this.rendreSiChange(html`${evt.nb_slides} slide(s) dans cet événement.`, this.trouver('.anim-deroule-source'));
      this.trouver('.anim-lien-deroule').setAttribute('href', ADRESSES.deroule(evt.id));
    });
  }

  /** Met l'onglet à jour. Une erreur remonte à la page, qui la signale. */
  async rafraichir() {
    // Le premier tour peut arriver avant la feuille de style de l'onglet :
    // on l'attend, plutôt que de laisser l'onglet vide jusqu'au tour suivant.
    // Pas plus de 10 s : un onglet qui ne se monte pas ne doit pas figer la
    // console entière (l'erreur remonte alors à la page, qui la signale).
    await new Promise((pret) => {
      const delai = setTimeout(() => pret(undefined), 10000);
      this.apresMontage(() => { clearTimeout(delai); pret(undefined); });
    });
    const evt = this.#evenement;
    if (!evt || evt.nb_slides <= 0) return;
    if (!this.#registre) {
      // Les noms et icônes des types, pour le déroulé. Sans eux, le type brut.
      try {
        const d = await api.evenements.get('parcours.php', { action: 'types' });
        this.#registre = d.types || {};
      } catch (erreur) {
        console.error('<cs-admin-suivi-animation>', erreur);
      }
    }
    /** @type {EtatAnimation} */
    const d = await api.evenements.get('animation.php', { action: 'etat', id: evt.id });
    this.#dessinerBarre(d);
    await this.#dessinerCarte(d);
    this.rendreSiChange(this.gabaritSommaire(d, this.#registre || {}), this.trouver('.sommaire'));
    const zone = this.trouver('.anim-resultats');
    if (d.slide && montrerResultats(d.slide, d.nb_reponses)) {
      /** @type {Resultats} */
      const r = await api.evenements.get('animation.php', { action: 'resultats', slide_id: d.slide.id });
      zone.hidden = false;
      this.rendreSiChange(this.gabaritResultats(r), this.trouver('.resultats'));
    } else {
      zone.hidden = true;
    }
  }

  /** @param {EtatAnimation} d */
  #dessinerBarre(d) {
    const position = d.index >= 0 ? d.index + 1 : 0;
    const pct = d.total ? position / d.total * 100 : 0;
    this.rendreSiChange(html`
      <span class="console-pos">${position} / ${d.total}</span>
      <div class="progress"><div style="width: ${pct}%"></div></div>
      <span class="repondu">${d.nb_reponses} / ${d.nb_participants} ont répondu</span>`, this.trouver('.console-barre'));
  }

  /** @param {EtatAnimation} d */
  async #dessinerCarte(d) {
    const zone = this.trouver('.apercu');
    if (!d.slide) {
      this.#signature = '';
      this.rendreSiChange(html`
        <div class="apercu-type">En attente</div>
        <div class="apercu-titre">Le parcours n'a pas encore démarré</div>
        <div class="hint">Les participants voient la salle d'attente. Clique sur « Démarrer ».</div>`, zone);
      return;
    }
    const theme = (d.evenement && d.evenement.theme) || 'foret';
    if (slideAvecClassement(d.slide)) {
      // Données vivantes : la carte suit le classement, mais ne se redessine
      // que s'il a changé.
      this.#signature = '';
      let classement = null;
      try {
        const c = await api.evenements.get('animation.php', { action: 'classement', id: d.evenement.id });
        classement = { joueurs: c.joueurs || [], equipes: c.equipes || [] };
      } catch (erreur) {
        console.error('<cs-admin-suivi-animation>', erreur);
      }
      if (this.rendreSiChange(this.gabaritCarte(d, theme, classement), zone)) ajusterMedias(zone);
      return;
    }
    // Le thème entre dans la signature : quelques écarts entre chartes sont
    // figés au rendu (le nombre de pétales de l'encouragement, par exemple).
    const signature = [d.slide.id, d.index, d.total, theme].join('|');
    if (signature === this.#signature) return;
    this.#signature = signature;
    this.rendre(this.gabaritCarte(d, theme, null), zone);
    // Le cadre d'un média prend ses vraies proportions une fois dans la page.
    ajusterMedias(zone);
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="card anim-sans-parcours" hidden>
        <div class="section-titre">🎬 Aucun parcours affecté</div>
        <div class="hint">Les slides d'un parcours sont copiées dans l'événement : tu peux ensuite les adapter pour ce client sans toucher au modèle. L'affectation se fait encore sur la console en service.</div>
      </div>

      <!-- Déroulé propre à cet événement : seulement tant que l'atelier n'a
           pas démarré. -->
      <div class="card anim-deroule" hidden>
        <div class="section-titre">🧩 Déroulé de cet événement</div>
        <div class="hint anim-deroule-source"></div>
        <a class="btn-p anim-lien-deroule" href="#">✏️ Éditer le déroulé</a>
      </div>

      <div class="anim-console" hidden>
        <!-- Sur grand écran : la slide à gauche, ses réponses à droite. -->
        <div class="console-grille">
          <div class="card">
            <div class="console-barre"></div>
            <div class="apercu"></div>
            <div class="console-actions">
              <button type="button" class="btn-s" data-action="projection">🖥️ Projection</button>
            </div>
          </div>
          <div class="console-cote">
            <div class="card anim-resultats" hidden>
              <div class="section-titre">📊 Réponses reçues</div>
              <div class="resultats"></div>
            </div>
            <div class="card anim-sommaire">
              <div class="section-titre">🧭 Aller à une slide</div>
              <div class="sommaire"></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /**
   * @param {EtatAnimation} d
   * @param {string} theme
   * @param {any} classement
   */
  gabaritCarte(d, theme, classement) {
    return html`
      ${rendreSlide(d.slide, { fixe: true, correction: true, position: { index: d.index, total: d.total }, classement, papier: theme === 'papier' })}
      ${d.slide && d.slide.aleatoire && html`<div class="hint">🎲 Anecdote tirée au sort : <b>chaque participant voit la sienne</b>. Celle affichée ici n'est qu'un exemple.</div>`}`;
  }

  /**
   * @param {EtatAnimation} d
   * @param {Registre} registre
   */
  gabaritSommaire(d, registre) {
    return html`<ul class="liste">${(d.sommaire || []).map((s, i) => {
      const type = registre[s.type];
      const nom = type ? type.nom : s.type;
      return html`
        <li${d.slide && s.id === d.slide.id && html` class="courante" aria-current="step"`}>
          <span class="rang">${i + 1}</span>
          <span class="ic" title="${nom}" aria-hidden="true">${(type && type.icone) || '📄'}</span>
          <span class="nom">${s.titre || nom}</span>
        </li>`;
    })}</ul>`;
  }

  /** @param {Resultats} d */
  gabaritResultats(d) {
    const barres = barresResultats(d);
    if (barres) {
      const n = barres.repondants;
      return html`
        <div class="res-total">${n} répondant${n > 1 && 's'}${barres.multi && ' · plusieurs choix possibles'}</div>
        ${barres.barres.map((b) => html`
          <div class="res-opt${b.juste && ' juste'}${b.tete && ' tete'}" style="--pct: ${b.pct}%">
            <span>${b.libelle}</span>
            <span class="res-nb">${b.pct} % <small>(${b.nb})</small></span>
          </div>`)}`;
    }
    const reponses = d.reponses || [];
    if (d.type === 'question_ouverte' || d.type === 'defi') {
      return html`
        <div class="hint">La notation se fait encore sur la console en service.</div>
        ${reponses.length ? html`<ul class="liste">${reponses.map((r) => html`
          <li><span class="nom">${r.nom}${r.reponse && html` — <i>${String(r.reponse)}</i>`}</span><span class="pts">${r.points}</span></li>`)}</ul>`
        : html`<div class="hint">Aucune réponse pour l'instant.</div>`}`;
    }
    if (!reponses.length) return html`<div class="hint">Aucune réponse pour l'instant.</div>`;
    return html`<ul class="liste">${reponses.map((r) => html`<li><span class="nom">${r.nom}</span><span class="pts">${r.points}</span></li>`)}</ul>`;
  }
}

AdminSuiviAnimation.definir();
