/* ============================================================================
   carte-fiche.js — <cs-carte-fiche> : la fiche d'un composteur, ouverte au
   clic sur son marqueur. Un panneau en bas de l'écran sur téléphone, une
   colonne à droite sur ordinateur.

   Trois usages :
     - lecture : type et accès, adresse (géocodage inverse d'OpenStreetMap),
       ce qui y est autorisé ou interdit, gestionnaire et contact, itinéraire
       à pied ou en voiture, Waze, et le signalement d'une erreur ;
     - modification (administrateur) : les mêmes informations en formulaire,
       et la suppression du composteur ;
     - proposition (compte connecté) : le formulaire vide d'un nouveau
       composteur, qui part en validation chez un administrateur.
   Les droits sont vérifiés par map-api ; la fiche ne fait que proposer les
   bons boutons.

   Prévient son parent par :
     « compost-propose »                       la demande est partie
     « compost-modifie » ({ id, conteneur })   pour changer l'icône du point
     « compost-supprime » ({ id })             pour retirer le point

   Usage, dans <cs-carte> :
     <cs-carte-fiche></cs-carte-fiche>
     const fiche = this.trouver('cs-carte-fiche', CarteFiche);
     fiche.fixerAdmin(true);
     fiche.ouvrir({ id, lat, lon });   fiche.proposer(lat, lon);   fiche.fermer();
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { ACCES_COMPOSTEUR, ELEMENTS_REGLES, MOTIFS, TYPES_COMPOSTEUR } from './carte-libelles.js';
import { SANS_DONNEES, adresseLisible, contactEnLiens, lienItineraire, lienWaze } from './carte-outils.js';

/**
 * Réponse de sites.php (autorinter) : une ligne, ou rien si le point n'existe
 * plus. Une liste de règles vide arrive en chaîne vide.
 * @typedef {object} Detail
 * @property {string[] | ''} autor
 * @property {string[] | ''} inter
 * @property {{ type: string, acces: string, gestion: string | null, info_gestion: string | null }} donnees
 *
 * @typedef {{ id: number, lat: number, lon: number }} PointFiche  id 0 : pas encore en base
 *
 * Ce que le formulaire envoie à sites.php.
 * @typedef {object} Formulaire
 * @property {string} type
 * @property {string} acces
 * @property {string[]} mettre      autorisé
 * @property {string[]} pas_mettre  interdit
 * @property {string} gestion
 * @property {string} info_gestion
 *
 * @typedef {'lecture' | 'modification' | 'proposition'} Mode
 */

/** Le temps de lire « merci » avant que le formulaire de signalement se replie. */
const REPLI_SIGNALEMENT = 2500;

/**
 * Le corps de la requête d'enregistrement. Un point déjà en base est désigné
 * par son id ; un nouveau, par sa position : c'est l'absence d'id qui dit au
 * serveur de créer plutôt que de modifier.
 * @param {Formulaire} f
 * @param {PointFiche} point
 * @returns {URLSearchParams}
 */
export function corpsFormulaire(f, point) {
  const corps = new URLSearchParams({ type: f.type, acces: f.acces });
  for (const e of f.mettre) corps.append('mettre[]', e);
  for (const e of f.pas_mettre) corps.append('pas_mettre[]', e);
  corps.set('gestion', f.gestion);
  corps.set('info_gestion', f.info_gestion);
  if (point.id) corps.set('id', String(point.id));
  else {
    corps.set('lat', String(point.lat));
    corps.set('lon', String(point.lon));
  }
  return corps;
}

/**
 * Une valeur affichée « Pas de données » n'est pas une valeur : le champ part vide.
 * @param {string | null | undefined} valeur
 */
function valeurDeChamp(valeur) {
  return valeur && valeur !== SANS_DONNEES ? valeur : '';
}

export class CarteFiche extends Composant {
  static balise = 'cs-carte-fiche';
  static styles = [new URL('./carte-fiche.css', import.meta.url)];

  /** @type {PointFiche | null} */
  #point = null;
  /** La fiche lue en dernier, de quoi préremplir sa modification. @type {Detail | null} */
  #detail = null;
  #admin = false;
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
    this.ecouter('click', '[data-action="modifier"]', () => this.#modifier());
    this.ecouter('click', '[data-action="enregistrer"]', (b) => this.#enregistrer(b));
    this.ecouter('click', '[data-action="supprimer"]', (b) => this.#supprimer(b));
  }

  get ouvert() {
    const panneau = this.querySelector('.tabl');
    return panneau instanceof HTMLElement && !panneau.hidden;
  }

  /** Un administrateur voit « Modifier » et « Supprimer ». @param {boolean} admin */
  fixerAdmin(admin) {
    this.#admin = admin;
  }

  /** @param {PointFiche} point */
  ouvrir(point) {
    this.apresMontage(() => { this.#ouvrir(point); });
  }

  /**
   * Le formulaire d'un nouveau composteur, à cette position.
   * @param {number} lat
   * @param {number} lon
   */
  proposer(lat, lon) {
    this.apresMontage(() => {
      const ouverture = this.#preparer({ id: 0, lat, lon });
      this.#detail = null;
      this.rendre(this.gabaritFormulaire(null, 'proposition'), this.trouver('.tabl-corps'));
      this.#adresse({ id: 0, lat, lon }, ouverture);
    });
  }

  fermer() {
    this.apresMontage(() => {
      this.#ouverture++;
      this.#point = null;
      this.trouver('.tabl').hidden = true;
    });
  }

  /**
   * Remet la fiche à zéro pour un point et l'affiche.
   * @param {PointFiche} point
   * @returns {number} le numéro de cette ouverture
   */
  #preparer(point) {
    const ouverture = ++this.#ouverture;
    this.#point = point;
    clearTimeout(this.#repli);
    const panneau = this.trouver('.tabl');
    this.rendre(this.gabaritAttente(), panneau);
    panneau.hidden = false;
    return ouverture;
  }

  /** @param {PointFiche} point */
  async #ouvrir(point) {
    const ouverture = this.#preparer(point);
    this.#adresse(point, ouverture);
    try {
      /** @type {Detail[]} */
      const lignes = await api.carte.post('sites.php', { autorinter: point.id });
      if (ouverture !== this.#ouverture) return;
      if (!Array.isArray(lignes) || !lignes.length) {
        this.afficherErreur('Ce composteur n\'existe plus.', this.trouver('.tabl-corps'));
        return;
      }
      this.#detail = lignes[0];
      this.rendre(this.gabaritEntete(lignes[0]), this.trouver('.tabl-header'));
      this.rendre(this.gabaritDetail(lignes[0], point, this.#admin), this.trouver('.tabl-corps'));
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

  // ── Signalement ───────────────────────────────────────────────────────────

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

  // ── Modification, proposition, suppression ────────────────────────────────

  #modifier() {
    if (!this.#point || !this.#detail) return;
    this.rendre(html``, this.trouver('.tabl-header'));
    this.rendre(this.gabaritFormulaire(this.#detail, 'modification'), this.trouver('.tabl-corps'));
  }

  /** @param {string} message  vide : plus d'erreur */
  #erreur(message) {
    const zone = this.trouver('.fiche-erreur');
    zone.textContent = message ? '⚠️ ' + message : '';
    zone.hidden = !message;
  }

  /** @returns {Formulaire} */
  #lireFormulaire() {
    /** @param {string} nom */
    const valeur = (nom) => {
      const champ = this.trouver('[data-champ="' + nom + '"]');
      return champ instanceof HTMLInputElement || champ instanceof HTMLSelectElement ? champ.value : '';
    };
    /** @param {string} regle */
    const cochees = (regle) => this.tous('[data-regle="' + regle + '"]')
      .filter((c) => c instanceof HTMLInputElement && c.checked)
      .map((c) => /** @type {HTMLInputElement} */ (c).value);
    return {
      type: valeur('type'),
      acces: valeur('acces'),
      mettre: cochees('mettre'),
      pas_mettre: cochees('pas_mettre'),
      gestion: valeur('gestion'),
      info_gestion: valeur('info_gestion'),
    };
  }

  /** @param {HTMLElement} bouton */
  async #enregistrer(bouton) {
    const point = this.#point;
    if (!point || !(bouton instanceof HTMLButtonElement)) return;
    const formulaire = this.#lireFormulaire();
    this.#erreur('');
    bouton.disabled = true;
    try {
      await api.carte.post('sites.php', corpsFormulaire(formulaire, point));
    } catch (erreur) {
      console.error('<cs-carte-fiche>', erreur);
      this.#erreur(texteErreur(erreur, 'Enregistrement impossible, réessaie.'));
      bouton.disabled = false;
      return;
    }
    if (!point.id) {
      // La demande part en validation : le point n'apparaît pas tant qu'un
      // administrateur ne l'a pas acceptée.
      this.fermer();
      this.emettre('compost-propose');
      return;
    }
    this.emettre('compost-modifie', { id: point.id, conteneur: formulaire.type === 'Conteneur' });
    this.#ouvrir(point);
  }

  /** @param {HTMLElement} bouton */
  async #supprimer(bouton) {
    const point = this.#point;
    if (!point || !point.id || !(bouton instanceof HTMLButtonElement)) return;
    const ok = await confirmer({
      titre: 'Supprimer ce composteur ?',
      texte: 'Il disparaît de la carte pour tout le monde.',
      valider: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    this.#erreur('');
    bouton.disabled = true;
    try {
      await api.carte.post('sites.php', { supprimer: point.id });
    } catch (erreur) {
      console.error('<cs-carte-fiche>', erreur);
      this.#erreur(texteErreur(erreur, "Le composteur n'a pas été supprimé, réessaie."));
      bouton.disabled = false;
      return;
    }
    this.fermer();
    this.emettre('compost-supprime', { id: point.id });
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
   * Règles, gestionnaire, itinéraires, actions, signalement.
   * @param {Detail} d
   * @param {PointFiche} point
   * @param {boolean} admin
   */
  gabaritDetail(d, point, admin) {
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
        ${admin && html`<button type="button" class="btn-principal" data-action="modifier">✏️ Modifier</button>`}
        <button type="button" class="btn-signaler" data-action="signaler">⚠️ Signaler</button>
        ${admin && html`<button type="button" class="btn-supprimer" data-action="supprimer">🗑 Supprimer</button>`}
      </div>
      <div class="fiche-erreur" role="alert" hidden></div>
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

  /**
   * Le formulaire : vide pour une proposition, prérempli pour une modification.
   * Le contact est publié sur la carte : on oriente vers un contact
   * institutionnel, pas un numéro personnel (RGPD).
   * @param {Detail | null} d
   * @param {Mode} mode
   */
  gabaritFormulaire(d, mode) {
    const type = d ? d.donnees.type : '';
    const acces = d ? d.donnees.acces : '';
    const autor = d && Array.isArray(d.autor) ? d.autor : [];
    const inter = d && Array.isArray(d.inter) ? d.inter : [];
    /** @param {'mettre' | 'pas_mettre'} regle @param {string[]} cochees */
    const cases = (regle, cochees) => ELEMENTS_REGLES.map((e) => html`
      <label class="edit-check"><input type="checkbox" data-regle="${regle}" value="${e}"${cochees.includes(e) && html` checked`}> ${e}</label>`);
    return html`
      <div class="tabl-edition">
        <select class="edit-select" data-champ="type" aria-label="Type">
          ${TYPES_COMPOSTEUR.map((t) => html`<option value="${t}"${t === type && html` selected`}>${t}</option>`)}
        </select>
        <select class="edit-select" data-champ="acces" aria-label="Accès">
          ${ACCES_COMPOSTEUR.map((a) => html`<option value="${a}"${a === acces && html` selected`}>${a}</option>`)}
        </select>
      </div>
      <div class="tabl-rules">
        <div>
          <div class="rules-title ok">✅ Autorisé</div>
          <div class="rules-list">${cases('mettre', autor)}</div>
        </div>
        <div>
          <div class="rules-title nok">❌ Interdit</div>
          <div class="rules-list">${cases('pas_mettre', inter)}</div>
        </div>
      </div>
      <div class="tabl-info">
        <div class="info-row"><span class="info-icon">🏢</span><div class="info-val">
          <input type="text" class="edit-input" data-champ="gestion" maxlength="300" placeholder="Gestionnaire (mairie, association…)" value="${valeurDeChamp(d && d.donnees.gestion)}" aria-label="Gestionnaire">
        </div></div>
        <div class="info-row"><span class="info-icon">📞</span><div class="info-val">
          <input type="text" class="edit-input" data-champ="info_gestion" maxlength="300" placeholder="Contact public du gestionnaire (site, tél. mairie…)" value="${valeurDeChamp(d && d.donnees.info_gestion)}" aria-label="Contact public du gestionnaire">
        </div></div>
      </div>
      <div class="tabl-actions">
        <button type="button" class="btn-principal" data-action="enregistrer">${mode === 'proposition' ? '📤 Envoyer la demande' : '💾 Enregistrer'}</button>
        ${mode === 'modification' && html`<button type="button" class="btn-supprimer" data-action="supprimer">🗑 Supprimer</button>`}
      </div>
      <div class="fiche-erreur" role="alert" hidden></div>`;
  }
}

CarteFiche.definir();
