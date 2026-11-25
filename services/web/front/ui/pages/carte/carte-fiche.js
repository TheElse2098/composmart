/* ============================================================================
   carte-fiche.js — <cs-carte-fiche> : la fiche d'un composteur, ouverte au
   clic sur son marqueur.

   Type et accès, adresse (géocodage inverse d'OpenStreetMap), ce qui y est
   autorisé ou interdit, gestionnaire et contact, itinéraire à pied ou en
   voiture, Waze, et le signalement d'une erreur. Un panneau en bas de l'écran
   sur téléphone, une colonne à droite sur ordinateur.

   Usage, dans <cs-carte> :
     <cs-carte-fiche></cs-carte-fiche>
     this.trouver('cs-carte-fiche', CarteFiche).ouvrir({ id, lat, lon });
     … .fermer()
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { MOTIFS } from './carte-libelles.js';
import { SANS_DONNEES, adresseLisible, contactEnLiens, lienItineraire, lienWaze } from './carte-outils.js';

/**
 * Réponse de sites.php (autorinter) : une ligne, ou rien si le point n'existe
 * plus. Une liste de règles vide arrive en chaîne vide.
 * @typedef {object} Detail
 * @property {string[] | ''} autor
 * @property {string[] | ''} inter
 * @property {{ type: string, acces: string, gestion: string | null, info_gestion: string | null }} donnees
 *
 * @typedef {{ id: number, lat: number, lon: number }} PointFiche
 */

/** Le temps de lire « merci » avant que le formulaire de signalement se replie. */
const REPLI_SIGNALEMENT = 2500;

export class CarteFiche extends Composant {
  static balise = 'cs-carte-fiche';
  static styles = [new URL('./carte-fiche.css', import.meta.url)];

  /** @type {PointFiche | null} */
  #point = null;
  /** Numéro de l'ouverture en cours : une réponse arrivée après qu'on a ouvert un autre point est ignorée. */
  #ouverture = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #repli = undefined;

  monter() {
    this.aLaFin(() => clearTimeout(this.#repli));
    this.rendre(html`<div class="tabl" hidden></div>`);
    this.ecouter('click', '[data-trajet]', (b) => this.#itineraire(/** @type {'foot' | 'car'} */ (b.dataset.trajet)));
    this.ecouter('click', '[data-action="signaler"]', () => this.#basculerSignalement());
    this.ecouter('click', '[data-action="envoyer-signalement"]', (b) => this.#signaler(b));
  }

  get ouvert() {
    const panneau = this.querySelector('.tabl');
    return panneau instanceof HTMLElement && !panneau.hidden;
  }

  /** @param {PointFiche} point */
  ouvrir(point) {
    this.apresMontage(() => { this.#ouvrir(point); });
  }

  fermer() {
    this.apresMontage(() => {
      this.#ouverture++;
      this.#point = null;
      this.trouver('.tabl').hidden = true;
    });
  }

  /** @param {PointFiche} point */
  async #ouvrir(point) {
    const ouverture = ++this.#ouverture;
    this.#point = point;
    clearTimeout(this.#repli);
    const panneau = this.trouver('.tabl');
    this.rendre(this.gabaritAttente(), panneau);
    panneau.hidden = false;

    this.#adresse(point, ouverture);
    try {
      /** @type {Detail[]} */
      const lignes = await api.carte.post('sites.php', { autorinter: point.id });
      if (ouverture !== this.#ouverture) return;
      if (!Array.isArray(lignes) || !lignes.length) {
        this.afficherErreur('Ce composteur n\'existe plus.', this.trouver('.tabl-corps'));
        return;
      }
      this.rendre(this.gabaritEntete(lignes[0]), this.trouver('.tabl-header'));
      this.rendre(this.gabaritDetail(lignes[0], point), this.trouver('.tabl-corps'));
    } catch (erreur) {
      if (ouverture !== this.#ouverture) return;
      console.error('<cs-carte-fiche>', erreur);
      this.afficherErreur(texteErreur(erreur, 'La fiche n\'a pas pu être chargée.'), this.trouver('.tabl-corps'));
    }
  }

  /**
   * L'adresse vient d'un service tiers : son absence n'empêche rien, la ligne
   * reste simplement vide.
   * @param {PointFiche} point
   * @param {number} ouverture
   */
  async #adresse(point, ouverture) {
    let texte = '';
    try {
      const d = await api.nominatim.get('reverse', { lat: point.lat, lon: point.lon, format: 'json', 'accept-language': 'fr' });
      texte = adresseLisible(d && d.address);
    } catch {
      // Hors service ou point en mer : pas d'adresse, rien d'autre.
    }
    if (ouverture !== this.#ouverture) return;
    this.trouver('.tabl-adresse').textContent = texte ? '📍 ' + texte : '';
  }

  /** @param {'foot' | 'car'} mode */
  #itineraire(mode) {
    const point = this.#point;
    if (!point || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.open(lienItineraire(mode, [position.coords.latitude, position.coords.longitude], [point.lat, point.lon]));
      },
      (erreur) => console.error('Géolocalisation :', erreur.message),
    );
  }

  #basculerSignalement() {
    const zone = this.trouver('.signal-zone');
    zone.hidden = !zone.hidden;
    this.#messageSignalement('', '');
  }

  /** @param {string} texte @param {'' | 'ok' | 'err'} sorte */
  #messageSignalement(texte, sorte) {
    const message = this.trouver('.signal-msg');
    message.textContent = texte;
    message.className = 'signal-msg' + (sorte ? ' ' + sorte : '');
  }

  /** @param {HTMLElement} bouton */
  async #signaler(bouton) {
    const point = this.#point;
    if (!point || !(bouton instanceof HTMLButtonElement)) return;
    const motif = this.trouver('[data-champ="motif"]');
    const commentaire = this.trouver('[data-champ="commentaire"]');
    if (!(motif instanceof HTMLSelectElement) || !(commentaire instanceof HTMLTextAreaElement)) return;
    bouton.disabled = true;
    try {
      await api.carte.post('signalement.php', { action: 'creer', compost_id: point.id, motif: motif.value, commentaire: commentaire.value });
      this.#messageSignalement('✓ Merci, ton signalement a bien été envoyé !', 'ok');
      commentaire.value = '';
      this.#repli = setTimeout(() => { this.trouver('.signal-zone').hidden = true; }, REPLI_SIGNALEMENT);
    } catch (erreur) {
      console.error('<cs-carte-fiche>', erreur);
      this.#messageSignalement(texteErreur(erreur, 'Erreur, réessaie plus tard.'), 'err');
    } finally {
      bouton.disabled = false;
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabaritAttente() {
    return html`
      <div class="tabl-handle"></div>
      <div class="tabl-header"></div>
      <div class="tabl-adresse">📍 Chargement...</div>
      <div class="tabl-corps"><p class="cs-etat">Chargement…</p></div>`;
  }

  /** Type et accès, en pastilles. @param {Detail} d */
  gabaritEntete(d) {
    return html`<div class="badge-type">${d.donnees.type}</div><div class="badge-acces">${d.donnees.acces}</div>`;
  }

  /**
   * Règles, gestionnaire, itinéraires, signalement.
   * @param {Detail} d
   * @param {PointFiche} point
   */
  gabaritDetail(d, point) {
    const autor = Array.isArray(d.autor) ? d.autor : [];
    const inter = Array.isArray(d.inter) ? d.inter : [];
    const pasDeDonnees = html`<span class="no-data">${SANS_DONNEES}</span>`;
    return html`
      <div class="tabl-rules">
        <div>
          <div class="rules-title ok">✅ Autorisé</div>
          <div class="rules-list">${autor.length ? autor.map((a) => html`<span class="chip chip-ok">${a}</span>`) : pasDeDonnees}</div>
        </div>
        <div>
          <div class="rules-title nok">❌ Interdit</div>
          <div class="rules-list">${inter.length ? inter.map((i) => html`<span class="chip chip-nok">${i}</span>`) : pasDeDonnees}</div>
        </div>
      </div>
      <div class="tabl-info">
        <div class="info-row"><span class="info-icon">🏢</span><div class="info-val">${d.donnees.gestion || SANS_DONNEES}</div></div>
        <div class="info-row"><span class="info-icon">📞</span><div class="info-val">${contactEnLiens(d.donnees.info_gestion)}</div></div>
      </div>
      <div class="tabl-trajet">
        <button type="button" class="btn-trajet" data-trajet="foot">🚶 Pied</button>
        <button type="button" class="btn-trajet" data-trajet="car">🚗 Voiture</button>
        <a class="lien-waze" href="${lienWaze(point.lat, point.lon)}" target="_blank" rel="noopener">🗺 Waze</a>
      </div>
      <div class="tabl-actions">
        <button type="button" class="btn-signaler" data-action="signaler">⚠️ Signaler</button>
      </div>
      <div class="signal-zone" hidden>
        <select data-champ="motif" aria-label="Motif du signalement">
          ${Object.entries(MOTIFS).map(([code, libelle]) => html`<option value="${code}">${libelle}</option>`)}
        </select>
        <textarea data-champ="commentaire" maxlength="500" placeholder="Précisions (optionnel)..." aria-label="Précisions"></textarea>
        <p class="rgpd-info">Ton signalement est lu par l'équipe Composmart, avec ton pseudo si tu es connecté. N'écris pas d'informations personnelles. <a href="/confidentialite#traitements" target="_blank" rel="noopener">En savoir plus</a></p>
        <button type="button" class="signal-envoyer" data-action="envoyer-signalement">Envoyer le signalement</button>
        <div class="signal-msg" role="status"></div>
      </div>`;
  }
}

CarteFiche.definir();
