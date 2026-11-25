/* ============================================================================
   carte.js — <cs-carte> : la carte des composteurs (/carte).

   La carte et ses deux calques (composteurs, conteneurs), dont les points se
   chargent au fil des déplacements ; le dernier cadrage est retenu d'une
   visite à l'autre. Par-dessus : une consigne, le compteur, la recherche du
   composteur le plus proche d'une ville ou d'un point cliqué, et la fiche du
   composteur ouvert (<cs-carte-fiche>).

   Tout ce qui touche à Leaflet passe par FondCarte (fond-carte.js) : les tests
   la remplacent par une imitation (Carte.fabriquerFond).

   Usage :
     <cs-carte></cs-carte>
     <script type="module" src="/ui/pages/carte/carte.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { informer } from '../../composants/dialogue/dialogue.js';
import { CarteFiche } from './carte-fiche.js';
import { CLE_VUE, VUE_DEFAUT, distanceLisible, ecrireVue, lireVue, texteCompteur } from './carte-outils.js';
import { FondCarte } from './fond-carte.js';

/**
 * @typedef {import('./fond-carte.js').Point} Point
 *
 * Réponse de sites.php (plus_proche).
 * @typedef {Point & { distance_m: number }} Proche
 */

/** En dessous (vue « monde »), on ne recharge pas : le serveur plafonne la réponse. */
const ZOOM_MIN_CHARGEMENT = 5;
/** Attente après un déplacement avant de recharger : pas de rafale pendant un glisser. */
const DELAI_RECHARGEMENT = 400;
const TEXTE_PROCHE = "📍 Trouver le composteur le plus proche d'ici";

/**
 * Les bornes d'une zone, telles que sites.php les attend.
 * @param {import('./fond-carte.js').Bornes} b
 */
export function champsZone(b) {
  return { france: 'france', north: b.nord, south: b.sud, east: b.est, west: b.ouest };
}

export class Carte extends Composant {
  static balise = 'cs-carte';
  static styles = [
    new URL('../../../assets/vendor/leaflet-1.9.4/leaflet.css', import.meta.url),
    new URL('../../../assets/vendor/markercluster-1.4.1/MarkerCluster.css', import.meta.url),
    new URL('../../../assets/vendor/markercluster-1.4.1/MarkerCluster.Default.css', import.meta.url),
    new URL('../../../assets/vendor/leaflet-fullscreen-1.4.5/Control.FullScreen.css', import.meta.url),
    new URL('./carte.css', import.meta.url),
  ];

  /**
   * Fabrique le fond de carte. Les tests la remplacent par une imitation.
   * @type {(element: HTMLElement, vue: import('./carte-outils.js').Vue, reglages: { allerAuDefaut: () => void }) => FondCarte}
   */
  static fabriquerFond = (element, vue, reglages) => new FondCarte(element, vue, reglages);

  /** @type {FondCarte | null} */
  #fond = null;
  /** Total en base (count.php), null tant qu'il n'est pas connu. @type {number | null} */
  #total = null;
  /** Le point cliqué sur la carte. @type {[number, number] | null} */
  #clic = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #rechargement = undefined;

  async monter() {
    this.rendre(this.gabarit());
    this.aLaFin(() => clearTimeout(this.#rechargement));

    const fond = /** @type {typeof Carte} */ (this.constructor).fabriquerFond(this.trouver('.carte-fond'), this.#vueInitiale(), {
      allerAuDefaut: () => fond.placer(VUE_DEFAUT.centre, VUE_DEFAUT.zoom),
    });
    this.#fond = fond;

    fond.surDeplacement(() => this.#apresDeplacement());
    fond.surClic((lat, lon) => this.#cliquer(lat, lon));
    this.ecouter('click', '[data-action="proche-clic"]', (b) => this.#procheDuClic(b));
    this.ecouter('click', '[data-action="chercher"]', () => this.#montrerRecherche(true));
    this.ecouter('submit', '.recherche', (_f, e) => { e.preventDefault(); this.#chercherVille(); });
    // En plein écran, la carte passe au-dessus du menu du téléphone, qui
    // s'ouvrirait derrière elle, invisible : on sort du plein écran d'abord.
    // Le burger du bandeau garde l'identifiant burgerBtn pour cette raison.
    this.ecouterSur(document, 'click', (e) => {
      if (e.target instanceof Element && e.target.closest('#burgerBtn') && fond.pleinEcran) fond.quitterPleinEcran();
    });

    this.#compteur('Recherche des composteurs…');
    this.#chargerTotal();
    await this.#chargerZone();
  }

  /** @returns {CarteFiche} */
  #fiche() {
    return this.trouver('cs-carte-fiche', CarteFiche);
  }

  /** @returns {import('./carte-outils.js').Vue} */
  #vueInitiale() {
    try {
      return lireVue(localStorage.getItem(CLE_VUE)) || VUE_DEFAUT;
    } catch {
      return VUE_DEFAUT; // stockage refusé (navigation privée) : la vue par défaut
    }
  }

  /** @param {string} texte */
  #compteur(texte) {
    this.trouver('.compteur').textContent = texte;
  }

  #majCompteur() {
    if (this.#fond) this.#compteur(texteCompteur(this.#total, this.#fond.nombre));
  }

  async #chargerTotal() {
    try {
      /** @type {{ composts: number }} */
      const d = await api.carte.get('count.php');
      if (typeof d.composts === 'number') {
        this.#total = d.composts;
        this.#majCompteur();
      }
    } catch (erreur) {
      // Le compteur reste sur le nombre affiché.
      console.error('<cs-carte> count.php', erreur);
    }
  }

  /** Charge les points de la zone visible ; ceux déjà affichés ne sont pas recréés. */
  async #chargerZone() {
    const fond = this.#fond;
    if (!fond) return;
    try {
      /** @type {Point[]} */
      const points = await api.carte.post('sites.php', champsZone(fond.bornes));
      if (Array.isArray(points)) fond.ajouter(points, (p) => this.#ouvrirFiche(p));
      this.#majCompteur();
    } catch (erreur) {
      console.error('<cs-carte> sites.php', erreur);
      this.#compteur(texteErreur(erreur, "Les composteurs n'ont pas pu être chargés."));
    }
  }

  #apresDeplacement() {
    const fond = this.#fond;
    if (!fond) return;
    try {
      const [lat, lon] = fond.centre;
      localStorage.setItem(CLE_VUE, ecrireVue(lat, lon, fond.zoom));
    } catch {
      // Stockage plein ou refusé : la carte marche sans mémoriser sa vue.
    }
    if (fond.zoom < ZOOM_MIN_CHARGEMENT) return;
    clearTimeout(this.#rechargement);
    this.#rechargement = setTimeout(() => {
      // Purge avant chargement : la mémoire est libérée d'abord, et les points
      // de la nouvelle zone ne risquent pas d'être purgés dans la foulée.
      fond.purger();
      this.#majCompteur();
      this.#chargerZone();
    }, DELAI_RECHARGEMENT);
  }

  /** @param {Point} point */
  #ouvrirFiche(point) {
    this.#fond?.retirerClic();
    this.#clic = null;
    this.trouver('[data-action="proche-clic"]').hidden = true;
    this.#fiche().ouvrir({ id: point.id, lat: point.lat, lon: point.lon });
  }

  // ── Clic sur la carte : « le plus proche d'ici » ─────────────────────────

  /** @param {number} lat @param {number} lon */
  #cliquer(lat, lon) {
    const fond = this.#fond;
    if (!fond) return;
    this.#clic = [lat, lon];
    this.#fiche().fermer();
    fond.effacerProche();
    fond.poserClic(lat, lon);
    const bouton = this.trouver('[data-action="proche-clic"]', HTMLButtonElement);
    bouton.hidden = false;
    bouton.disabled = false;
    bouton.textContent = TEXTE_PROCHE;
  }

  /**
   * Le composteur le plus proche du point cliqué, calculé par le serveur.
   * @param {HTMLElement} bouton
   */
  async #procheDuClic(bouton) {
    const fond = this.#fond;
    const clic = this.#clic;
    if (!fond || !clic || !(bouton instanceof HTMLButtonElement)) return;
    bouton.disabled = true;
    bouton.textContent = '⏳ Recherche…';
    try {
      /** @type {Proche} */
      const d = await api.carte.post('sites.php', { plus_proche: '1', lat: clic[0], lon: clic[1] });
      if (typeof d.lat !== 'number') throw new Error('réponse inattendue');
      fond.montrerProche(clic, d, () => this.#fiche().ouvrir({ id: d.id, lat: d.lat, lon: d.lon }));
      this.#compteur('Composteur le plus proche : ' + distanceLisible(d.distance_m) + '.');
      bouton.hidden = true;
    } catch (erreur) {
      console.error('<cs-carte> plus_proche', erreur);
      informer({ titre: 'Recherche impossible', texte: texteErreur(erreur, 'Réessaie dans un instant.') });
    } finally {
      bouton.disabled = false;
      bouton.textContent = TEXTE_PROCHE;
    }
  }

  // ── Recherche d'une ville ─────────────────────────────────────────────────

  /** @param {boolean} visible */
  #montrerRecherche(visible) {
    const formulaire = this.trouver('.recherche');
    formulaire.hidden = !visible;
    if (visible) this.trouver('.recherche input').focus();
  }

  /**
   * La ville (ou l'adresse) est trouvée par le géocodage d'OpenStreetMap, puis
   * le composteur le plus proche par le serveur, comme pour un point cliqué.
   */
  async #chercherVille() {
    const fond = this.#fond;
    const champ = this.trouver('.recherche input');
    if (!fond || !(champ instanceof HTMLInputElement)) return;
    const ville = champ.value.trim();
    if (!ville) return;
    this.#montrerRecherche(false);
    this.#compteur('Recherche de ' + ville + '…');

    /** @type {{ lat: string, lon: string }[]} */
    let lieux;
    try {
      lieux = await api.nominatim.get('search', { q: ville, format: 'json', limit: 1, 'accept-language': 'fr' });
    } catch (erreur) {
      console.error('<cs-carte> recherche', erreur);
      this.#compteur('Erreur réseau, réessaie.');
      this.#montrerRecherche(true);
      return;
    }
    if (!Array.isArray(lieux) || !lieux.length) {
      this.#compteur('Ville introuvable, réessaie.');
      this.#montrerRecherche(true);
      return;
    }

    const lat = parseFloat(lieux[0].lat);
    const lon = parseFloat(lieux[0].lon);
    this.#compteur('Recherche du compost le plus proche…');
    try {
      /** @type {Proche} */
      const d = await api.carte.post('sites.php', { plus_proche: '1', lat, lon });
      if (typeof d.lat !== 'number') throw new Error('réponse inattendue');
      fond.poserPosition(lat, lon);
      fond.voler(d.lat, d.lon, 15);
      this.#compteur('Le compost le plus proche est à ' + distanceLisible(d.distance_m) + '.');
      this.#ouvrirFiche(d);
    } catch (erreur) {
      console.error('<cs-carte> plus_proche', erreur);
      this.#compteur(texteErreur(erreur, 'Recherche impossible, réessaie.'));
      this.#montrerRecherche(true);
    }
  }

  // ── Gabarit ───────────────────────────────────────────────────────────────

  /**
   * Le bouton « plus proche d'ici » apparaît au clic sur la carte et part du
   * POINT CLIQUÉ ; « Trouver », en bas, part d'une ville. En bas, une seule
   * pile : chaque bloc sur sa ligne, aucune superposition possible quelle que
   * soit la longueur du texte.
   */
  gabarit() {
    return html`
      <div class="map-wrapper">
        <div class="carte-fond"></div>
        <div class="info_compost">Cliquez sur un point pour avoir des informations ou cliquez sur la carte pour en rajouter un.</div>
        <button type="button" class="plus-proche-clic" data-action="proche-clic" hidden>${TEXTE_PROCHE}</button>
        <div class="pile-bas">
          <div class="compteur" role="status"></div>
          <form class="recherche" hidden>
            <input type="text" placeholder="Adresse, quartier, ville..." aria-label="Adresse, quartier ou ville">
            <button type="submit">Rechercher</button>
          </form>
          <div class="trouver">
            <button type="button" data-action="chercher">📍 Trouver le compost le plus proche</button>
          </div>
        </div>

        <cs-carte-fiche></cs-carte-fiche>
      </div>`;
  }
}

Carte.definir();
