/* ============================================================================
   fond-carte.js — FondCarte : tout ce que la carte demande à Leaflet, et rien
   d'autre.

   Le reste de la page (<cs-carte>, la fiche, la recherche) ne parle qu'à cette
   classe, jamais à `L` : c'est ce qui permet de tester la page sous Node, où
   Leaflet n'existe pas, en lui donnant une imitation de FondCarte
   (tests/front/carte.test.mjs). Changer de bibliothèque de carte ne
   toucherait que ce fichier.

   Bibliothèques (scripts classiques de assets/vendor) : Leaflet,
   MarkerCluster, Leaflet.fullscreen. La PAGE les cite dans son en-tête, dans
   cet ordre, et non `static scripts` : celui-ci les chargerait en parallèle,
   sans ordre garanti, alors que les extensions se branchent sur Leaflet au
   moment où elles s'exécutent.
   ============================================================================ */

/**
 * Un point de la carte tel que sites.php le sert. `t` vaut « C » pour un
 * conteneur, autre chose pour un composteur.
 * @typedef {{ id: number, lat: number, lon: number, t?: string }} Point
 *
 * @typedef {{ nord: number, sud: number, est: number, ouest: number }} Bornes
 */

/** Icônes partagées par tous les marqueurs (2 objets au lieu de 6 000). */
const ICONES = {
  conteneur: { iconUrl: '/assets/img/marker-bleu.png', iconSize: [20, 38], iconAnchor: [10, 38], popupAnchor: [0, -38] },
  compost: { iconUrl: '/assets/img/icon_vert.png', iconSize: [25, 38], iconAnchor: [19, 38], popupAnchor: [0, -38] },
  clic: { iconUrl: '/assets/img/compost_proche.png', iconSize: [30, 30], iconAnchor: [12, 20] },
  position: { iconUrl: '/assets/img/bleu.png', iconSize: [30, 30], iconAnchor: [15, 15] },
};

/** Groupes de marqueurs : chargement étalé sur plusieurs images, la page reste fluide. */
const GROUPE = { maxClusterRadius: 50, chunkedLoading: true };

export class FondCarte {
  /** @type {any} */ #L;
  /** @type {any} */ #carte;
  /** @type {any} */ #pleinEcran;
  /** @type {any} */ #composteurs;
  /** @type {any} */ #conteneurs;
  /** @type {Record<string, any>} */ #icones = {};
  /** Un seul marqueur par point, quelle que soit la zone qui l'a chargé. @type {Map<number, any>} */
  #marqueurs = new Map();
  /** Le point posé par un clic sur la carte. @type {any} */
  #marqueurClic = null;
  /** Le point d'où part la dernière recherche d'une ville. @type {any} */
  #marqueurPosition = null;
  /** Résultat de « plus proche » : la cible et le trait qui la relie. @type {any[]} */
  #proche = [];

  /**
   * @param {HTMLElement} element  le conteneur de la carte
   * @param {{ centre: [number, number], zoom: number }} vue
   * @param {{ allerAuDefaut: () => void }} reglages
   */
  constructor(element, vue, reglages) {
    const L = /** @type {any} */ (globalThis).L;
    if (!L || typeof L.markerClusterGroup !== 'function' || !L.control || typeof L.control.fullscreen !== 'function') {
      throw new Error('Leaflet et ses extensions (MarkerCluster, plein écran) doivent être chargés par la page avant la carte.');
    }
    this.#L = L;
    for (const [nom, icone] of Object.entries(ICONES)) this.#icones[nom] = L.icon(icone);

    const carte = L.map(element).setView(vue.centre, vue.zoom);
    this.#carte = carte;
    // Un seul fond de tuiles (OSM standard) : le mode sombre s'obtient par un
    // filtre CSS sur le calque des tuiles (carte.css), pour garder le relief
    // et les teintes du terrain.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(carte);

    this.#pleinEcran = L.control.fullscreen();
    carte.addControl(this.#pleinEcran);
    L.control.scale({ metric: true, imperial: false }).addTo(carte);
    carte.addControl(new (this.#controleRetour(reglages.allerAuDefaut))());

    this.#composteurs = L.markerClusterGroup(GROUPE).addTo(carte);
    this.#conteneurs = L.markerClusterGroup(GROUPE).addTo(carte);
    L.control.layers({}, { Conteneur: this.#conteneurs, Composteurs: this.#composteurs }, { collapsed: false }).addTo(carte);
  }

  /**
   * Bouton « ↺ » sous le zoom : indispensable dès lors que la vue est
   * mémorisée, sinon quelqu'un zoomé sur une rue n'aurait aucun moyen simple
   * de retrouver la France entière.
   * @param {() => void} action
   */
  #controleRetour(action) {
    const L = this.#L;
    return L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const cadre = L.DomUtil.create('div', 'leaflet-bar');
        const lien = L.DomUtil.create('a', 'reset-vue', cadre);
        lien.href = '#';
        lien.title = 'Revenir à la vue par défaut (France entière)';
        lien.setAttribute('role', 'button');
        lien.setAttribute('aria-label', 'Revenir à la vue par défaut');
        lien.textContent = '↺';
        L.DomEvent.on(lien, 'click', (/** @type {Event} */ e) => {
          L.DomEvent.stop(e);
          action();
        });
        return cadre;
      },
    });
  }

  // ── Évènements ────────────────────────────────────────────────────────────

  /** @param {() => void} action  après chaque déplacement ou zoom */
  surDeplacement(action) { this.#carte.on('moveend', action); }

  /** @param {(lat: number, lon: number) => void} action  clic sur le fond de carte */
  surClic(action) { this.#carte.on('click', (/** @type {any} */ e) => action(e.latlng.lat, e.latlng.lng)); }

  // ── Vue ───────────────────────────────────────────────────────────────────

  get zoom() { return Number(this.#carte.getZoom()); }

  /** @returns {[number, number]} */
  get centre() {
    const c = this.#carte.getCenter();
    return [c.lat, c.lng];
  }

  /** @returns {Bornes} */
  get bornes() {
    const b = this.#carte.getBounds();
    return { nord: b.getNorth(), sud: b.getSouth(), est: b.getEast(), ouest: b.getWest() };
  }

  /** @param {[number, number]} centre @param {number} zoom */
  placer(centre, zoom) { this.#carte.setView(centre, zoom); }

  /** @param {number} lat @param {number} lon @param {number} zoom */
  voler(lat, lon, zoom) { this.#carte.flyTo([lat, lon], zoom); }

  get pleinEcran() { return !!this.#carte._isFullscreen; }

  quitterPleinEcran() { if (this.pleinEcran) this.#pleinEcran.toggleFullScreen(); }

  // ── Points ────────────────────────────────────────────────────────────────

  /** Nombre de points affichés. */
  get nombre() { return this.#marqueurs.size; }

  /**
   * Ajoute les points pas encore affichés. Ajout en masse : le regroupement
   * n'est recalculé qu'une fois, contre une fois par marqueur.
   * @param {Point[]} points
   * @param {(point: Point) => void} surClic
   * @returns {number} combien étaient nouveaux
   */
  ajouter(points, surClic) {
    const L = this.#L;
    /** @type {any[]} */ const conteneurs = [];
    /** @type {any[]} */ const composts = [];
    for (const p of points) {
      if (this.#marqueurs.has(p.id)) continue;
      const conteneur = p.t === 'C';
      const marqueur = L.marker([p.lat, p.lon], { icon: this.#icones[conteneur ? 'conteneur' : 'compost'] });
      marqueur.options.estConteneur = conteneur;
      marqueur.on('click', () => surClic(p));
      this.#marqueurs.set(p.id, marqueur);
      (conteneur ? conteneurs : composts).push(marqueur);
    }
    if (conteneurs.length) this.#conteneurs.addLayers(conteneurs);
    if (composts.length) this.#composteurs.addLayers(composts);
    return conteneurs.length + composts.length;
  }

  /**
   * Retire les points sortis du champ, élargi de 50 % : sinon un petit
   * déplacement purgerait des points en bordure, que la requête suivante
   * irait aussitôt rechercher.
   */
  purger() {
    const zone = this.#carte.getBounds().pad(0.5);
    /** @type {any[]} */ const conteneurs = [];
    /** @type {any[]} */ const composts = [];
    for (const [id, marqueur] of this.#marqueurs) {
      if (zone.contains(marqueur.getLatLng())) continue;
      (marqueur.options.estConteneur ? conteneurs : composts).push(marqueur);
      this.#marqueurs.delete(id);
    }
    if (conteneurs.length) this.#conteneurs.removeLayers(conteneurs);
    if (composts.length) this.#composteurs.removeLayers(composts);
  }

  // ── Repères posés par la page ─────────────────────────────────────────────

  /** Le point cliqué sur la carte. @param {number} lat @param {number} lon */
  poserClic(lat, lon) {
    this.retirerClic();
    this.#marqueurClic = this.#L.marker([lat, lon], { icon: this.#icones.clic }).addTo(this.#carte);
  }

  retirerClic() {
    if (this.#marqueurClic) this.#carte.removeLayer(this.#marqueurClic);
    this.#marqueurClic = null;
  }

  /**
   * La position d'où part une recherche (ville trouvée). Un seul repère à la
   * fois : le précédent disparaît.
   * @param {number} lat @param {number} lon
   */
  poserPosition(lat, lon) {
    this.retirerPosition();
    this.#marqueurPosition = this.#L.marker([lat, lon], { icon: this.#icones.position }).addTo(this.#carte);
  }

  retirerPosition() {
    if (this.#marqueurPosition) this.#carte.removeLayer(this.#marqueurPosition);
    this.#marqueurPosition = null;
  }

  /**
   * Le composteur le plus proche d'un point : la cible, un trait pointillé
   * depuis l'origine, et un cadrage qui garde les deux visibles.
   * @param {[number, number]} origine
   * @param {Point} cible
   * @param {() => void} surClic
   * @param {{ voler?: boolean }} [options]  voler : y aller en vol animé (la
   *   destination peut être loin, une ville cherchée), sinon un simple recadrage
   */
  montrerProche(origine, cible, surClic, { voler = false } = {}) {
    this.effacerProche();
    const L = this.#L;
    const marqueur = L.marker([cible.lat, cible.lon], { icon: this.#icones[cible.t === 'C' ? 'conteneur' : 'compost'] }).addTo(this.#carte);
    marqueur.on('click', surClic);
    const trait = L.polyline([origine, [cible.lat, cible.lon]], { color: '#1e6e3e', weight: 3, dashArray: '6 8', opacity: 0.85 }).addTo(this.#carte);
    this.#proche = [marqueur, trait];
    const cadrage = { padding: [60, 60], maxZoom: 17 };
    if (voler) this.#carte.flyToBounds(trait.getBounds(), cadrage);
    else this.#carte.fitBounds(trait.getBounds(), cadrage);
  }

  effacerProche() {
    for (const calque of this.#proche) this.#carte.removeLayer(calque);
    this.#proche = [];
  }
}
