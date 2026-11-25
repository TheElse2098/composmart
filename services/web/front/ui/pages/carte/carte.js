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
import { session } from '../../socle/session.js';
import { informer } from '../../composants/dialogue/dialogue.js';
import { CarteFiche } from './carte-fiche.js';
import { CarteSignalements } from './carte-signalements.js';
import { CLE_VUE, VUE_DEFAUT, distanceLisible, ecrireVue, lireVue, texteCompteur, zoneAutour } from './carte-outils.js';
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
  /** Qui regarde la carte : décide de l'ajout (compte connecté) et des outils d'administration. @type {Promise<import('../../socle/session.js').Moi> | null} */
  #moi = null;
  /** Numéro du dernier clic : le panneau d'ajout d'un clic dépassé ne s'affiche pas en retard. */
  #jetonClic = 0;

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
    this.ecouter('click', '[data-action="rajouter"]', (b) => this.#rajouter(b));
    this.#ecouterContributions(fond);
    // En plein écran, la carte passe au-dessus du menu du téléphone, qui
    // s'ouvrirait derrière elle, invisible : on sort du plein écran d'abord.
    // Le burger du bandeau garde l'identifiant burgerBtn pour cette raison.
    this.ecouterSur(document, 'click', (e) => {
      if (e.target instanceof Element && e.target.closest('#burgerBtn') && fond.pleinEcran) fond.quitterPleinEcran();
    });

    this.#moi = session.moi();
    this.#moi.then((moi) => {
      if (!moi.logged_in || !moi.isAdmin) return;
      this.#fiche().fixerAdmin(true);
      this.trouver('cs-carte-signalements', CarteSignalements).activer();
    });

    this.#compteur('Recherche des composteurs…');
    this.#chargerTotal();
    await this.#chargerZone();
  }

  /**
   * Ce que la fiche et le panneau des signalements annoncent : la carte suit.
   * @param {FondCarte} fond
   */
  #ecouterContributions(fond) {
    this.ecouterSur(this, 'compost-propose', () => {
      fond.retirerClic();
      this.#clic = null;
      informer({ titre: 'Merci ! Ta demande a été envoyée.', texte: 'Le composteur apparaîtra sur la carte une fois validé par un administrateur.' });
    });
    this.ecouterSur(this, 'compost-modifie', (e) => {
      const d = /** @type {CustomEvent<{ id: number, conteneur: boolean }>} */ (e).detail;
      fond.changerType(d.id, d.conteneur);
    });
    this.ecouterSur(this, 'compost-supprime', (e) => {
      fond.retirer(/** @type {CustomEvent<{ id: number }>} */ (e).detail.id);
      this.#majCompteur();
    });
    this.ecouterSur(this, 'voir-compost', (e) => {
      const p = /** @type {CustomEvent<Point>} */ (e).detail;
      fond.voler(p.lat, p.lon, 17);
      this.#ouvrirFiche(p);
    });
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

  /**
   * Charge les points d'une zone (par défaut, celle qui est visible) ; ceux
   * déjà affichés ne sont pas recréés. Avant un déplacement animé, on charge
   * la zone d'arrivée : ses points sont là pendant l'animation.
   * @param {import('./fond-carte.js').Bornes} [bornes]
   */
  async #chargerZone(bornes) {
    const fond = this.#fond;
    if (!fond) return;
    try {
      /** @type {Point[]} */
      const points = await api.carte.post('sites.php', champsZone(bornes || fond.bornes));
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
    this.#jetonClic++;
    this.trouver('.rajouter').hidden = true;
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
    // Un nouveau clic invalide la recherche précédente, ville comprise.
    fond.effacerProche();
    fond.retirerPosition();
    fond.poserClic(lat, lon);
    const bouton = this.trouver('[data-action="proche-clic"]', HTMLButtonElement);
    bouton.hidden = false;
    bouton.disabled = false;
    bouton.textContent = TEXTE_PROCHE;
    this.#panneauAjout();
  }

  /**
   * Le panneau d'ajout sous la carte : un bouton pour un compte connecté, une
   * invitation à se connecter sinon. Il attend de savoir qui regarde ; si un
   * autre clic a eu lieu entre-temps, il laisse la place au plus récent.
   */
  async #panneauAjout() {
    const jeton = ++this.#jetonClic;
    const zone = this.trouver('.rajouter');
    zone.hidden = false;
    this.rendre(html`<div class="rajouter-connexion">…</div>`, zone);
    const moi = this.#moi ? await this.#moi : { logged_in: false };
    if (jeton !== this.#jetonClic) return;
    this.rendre(moi.logged_in
      ? html`<button type="button" data-action="rajouter">📍 Cliquez ici pour rajouter le compost</button>`
      : html`<div class="rajouter-connexion">Connecte-toi pour proposer un composteur ici. <a href="/login">Se connecter</a></div>`, zone);
  }

  /**
   * Vérifie d'abord qu'aucun point n'existe déjà à cet endroit, puis ouvre le
   * formulaire. Rien n'est écrit en base avant son envoi.
   * @param {HTMLElement} bouton
   */
  async #rajouter(bouton) {
    const clic = this.#clic;
    if (!clic || !(bouton instanceof HTMLButtonElement)) return;
    const zone = this.trouver('.rajouter');
    bouton.disabled = true;
    try {
      await api.carte.post('sites.php', { lat_click: clic[0], lon_click: clic[1] });
    } catch (erreur) {
      console.error('<cs-carte> ajout', erreur);
      zone.textContent = '⚠️ ' + texteErreur(erreur, 'Ajout impossible pour le moment.');
      return;
    }
    zone.hidden = true;
    this.trouver('[data-action="proche-clic"]').hidden = true;
    this.#fiche().proposer(clic[0], clic[1]);
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
      await this.#chargerZone(zoneAutour([clic, [d.lat, d.lon]]));
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
      // Même dessin que pour un point cliqué : le lieu cherché (repère bleu),
      // un trait jusqu'au composteur, et un vol qui cadre les deux. Les points
      // de toute la zone sont chargés avant le départ : ils sont là pendant
      // l'animation.
      fond.poserPosition(lat, lon);
      await this.#chargerZone(zoneAutour([[lat, lon], [d.lat, d.lon]]));
      fond.montrerProche([lat, lon], d, () => this.#fiche().ouvrir({ id: d.id, lat: d.lat, lon: d.lon }), { voler: true });
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
          <div class="rajouter" hidden></div>
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
        <cs-carte-signalements></cs-carte-signalements>
      </div>`;
  }
}

Carte.definir();
