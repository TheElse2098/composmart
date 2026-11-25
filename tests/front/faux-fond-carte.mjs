/* ============================================================================
   Imitation de FondCarte pour les tests de la carte : Leaflet n'existe pas
   sous Node. Elle note ce qu'on lui demande (appels, ordre) et laisse le test
   déclencher ce que ferait un visiteur (déplacement, clic sur la carte ou sur
   un point).
   ============================================================================ */

export class FauxFond {
  /** Le dernier fond créé : celui de la carte montée. @type {FauxFond | null} */
  static dernier = null;

  /** @param {any} element @param {any} vue @param {{ allerAuDefaut: () => void }} reglages */
  constructor(element, vue, reglages) {
    this.element = element;
    this.vue = vue;
    this.reglages = reglages;
    /** @type {[string, ...any[]][]} */
    this.appels = [];
    /** Ordre des points ajoutés et des déplacements animés. @type {string[]} */
    this.ordre = [];
    /** @type {Map<number, { point: any, clic: (p: any) => void }>} */
    this.points = new Map();
    this.zoom = vue.zoom;
    /** @type {[number, number]} */
    this.centre = vue.centre;
    this.bornes = { nord: 49, sud: 47, est: 3, ouest: 1 };
    this.pleinEcran = false;
    /** @type {() => void} */ this.deplacement = () => {};
    /** @type {(lat: number, lon: number) => void} */ this.clic = () => {};
    FauxFond.dernier = this;
  }

  /** @param {() => void} f */ surDeplacement(f) { this.deplacement = f; }
  /** @param {(lat: number, lon: number) => void} f */ surClic(f) { this.clic = f; }
  get nombre() { return this.points.size; }
  /** @param {any[]} points @param {(p: any) => void} clic */
  ajouter(points, clic) {
    this.ordre.push('ajouter');
    let n = 0;
    for (const p of points) if (!this.points.has(p.id)) { this.points.set(p.id, { point: p, clic }); n++; }
    this.appels.push(['ajouter', points.length]);
    return n;
  }
  /** Le clic d'un visiteur sur le marqueur d'un point. @param {number} id */
  cliquerPoint(id) { const m = this.points.get(id); if (m) m.clic(m.point); }
  purger() { this.appels.push(['purger']); }
  /** @param {any[]} a */ placer(...a) { this.appels.push(['placer', ...a]); }
  /** @param {any[]} a */ voler(...a) { this.ordre.push('voler'); this.appels.push(['voler', ...a]); }
  quitterPleinEcran() { this.appels.push(['quitterPleinEcran']); }
  /** @param {any[]} a */ poserClic(...a) { this.appels.push(['poserClic', ...a]); }
  retirerClic() { this.appels.push(['retirerClic']); }
  /** @param {any[]} a */ poserPosition(...a) { this.appels.push(['poserPosition', ...a]); }
  retirerPosition() { this.appels.push(['retirerPosition']); }
  /** @param {[number, number]} origine @param {any} cible @param {() => void} clic @param {any} [options] */
  montrerProche(origine, cible, clic, options) {
    this.ordre.push('montrerProche');
    this.appels.push(options ? ['montrerProche', origine, cible.id, options] : ['montrerProche', origine, cible.id]);
    this.clicProche = clic;
  }
  effacerProche() { this.appels.push(['effacerProche']); }
  /** @param {any[]} a */ changerType(...a) { this.appels.push(['changerType', ...a]); }
  /** @param {number} id */ retirer(id) { this.points.delete(id); this.appels.push(['retirer', id]); }
  /** @param {string} nom */ a(nom) { return this.appels.filter((x) => x[0] === nom); }
}
