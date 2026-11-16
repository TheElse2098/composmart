/* ============================================================================
   ajout-edition.js — <cs-admin-ajout-edition> : la fenêtre « Modifier la
   demande », pour corriger un composteur proposé avant de le valider.

   Type, accès, gestionnaire, contact, et pour chaque déchet du référentiel
   une pastille à trois états : neutre → autorisé → interdit → neutre.

   Une fois la correction enregistrée, la fenêtre se ferme et le composant
   émet « donnees-modifiees ».

   Usage, dans l'onglet des ajouts :
     <cs-admin-ajout-edition></cs-admin-ajout-edition>
     this.trouver('cs-admin-ajout-edition', AdminAjoutEdition).ouvrir(demande, dechets);
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Fenetre } from '../../socle/fenetre.js';
import { html } from '../../socle/outils.js';
import { ACCES_COMPOSTEUR, TYPES_COMPOSTEUR } from './carte-libelles.js';

/**
 * Une demande d'ajout (/api/carte/pending.php?action=liste).
 * @typedef {object} Demande
 * @property {number} id
 * @property {number} lat
 * @property {number} lon
 * @property {string | null} type
 * @property {string | null} acces
 * @property {string | null} gestion
 * @property {string | null} info_gestion
 * @property {string} propose_par  pseudo, ou « Anonyme »
 * @property {string} date
 * @property {string[]} mettre      déchets autorisés
 * @property {string[]} pas_mettre  déchets interdits
 */

/** États d'une pastille de déchet, dans l'ordre des clics. */
const NEUTRE = '0';
const AUTORISE = '1';
const INTERDIT = '2';

export class AdminAjoutEdition extends Fenetre {
  static balise = 'cs-admin-ajout-edition';
  static styles = [...Fenetre.styles, new URL('./ajout-edition.css', import.meta.url)];

  /** La demande en cours de correction. @type {number | null} */
  #id = null;

  monter() {
    this.poserFenetre(this.gabarit());
    this.ecouter('click', '.elt-chip', (pastille) => {
      const suivant = (Number(pastille.dataset.etat) + 1) % 3;
      pastille.setAttribute('data-etat', String(suivant));
    });
    this.ecouter('click', '[data-action="enregistrer"]', (bouton) => this.#enregistrer(bouton));
  }

  /**
   * Ouvre la fenêtre sur une demande.
   * @param {Demande} demande
   * @param {string[]} dechets  le référentiel des déchets, par ordre alphabétique
   */
  ouvrir(demande, dechets) {
    this.apresMontage(() => {
      this.#id = demande.id;
      this.trouver('.fenetre__titre').textContent = 'Modifier la demande #' + demande.id;
      this.#champ('type').value = demande.type || TYPES_COMPOSTEUR[0];
      this.#champ('acces').value = demande.acces || ACCES_COMPOSTEUR[0];
      this.#champ('gestion').value = demande.gestion || '';
      this.#champ('info_gestion').value = demande.info_gestion || '';
      this.rendre(this.gabaritDechets(demande, dechets), this.trouver('.elt-grid'));
      this.#erreur('');
      this.montrer();
    });
  }

  aLaFermeture() {
    this.#id = null;
  }

  /**
   * @param {string} nom
   * @returns {HTMLInputElement | HTMLSelectElement}
   */
  #champ(nom) {
    const champ = this.trouver('[data-champ="' + nom + '"]');
    if (!(champ instanceof HTMLInputElement || champ instanceof HTMLSelectElement)) {
      throw new Error('<cs-admin-ajout-edition> : « ' + nom + ' » n\'est pas un champ');
    }
    return champ;
  }

  /** @param {string} message  vide : aucune erreur à montrer */
  #erreur(message) {
    const zone = this.trouver('.fenetre__erreur');
    zone.textContent = message;
    zone.hidden = message === '';
  }

  /** @param {HTMLElement} bouton */
  async #enregistrer(bouton) {
    if (this.#id === null || !(bouton instanceof HTMLButtonElement)) return;

    const corps = new URLSearchParams({ action: 'modifier', id: String(this.#id) });
    for (const nom of ['type', 'acces', 'gestion', 'info_gestion']) corps.set(nom, this.#champ(nom).value);
    for (const pastille of this.tous('.elt-chip')) {
      const dechet = pastille.dataset.nom || '';
      if (pastille.dataset.etat === AUTORISE) corps.append('mettre[]', dechet);
      else if (pastille.dataset.etat === INTERDIT) corps.append('pas_mettre[]', dechet);
    }

    bouton.disabled = true;
    try {
      await api.carte.post('pending.php', corps);
      this.fermer();
      this.emettre('donnees-modifiees');
    } catch (erreur) {
      console.error('<cs-admin-ajout-edition>', erreur);
      this.#erreur(texteErreur(erreur, 'Enregistrement impossible.'));
    } finally {
      bouton.disabled = false;
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="fenetre__titre">Modifier la demande</div>

      <div class="fenetre__label">Type</div>
      <select class="fenetre__champ" data-champ="type" aria-label="Type">
        ${TYPES_COMPOSTEUR.map((t) => html`<option value="${t}">${t}</option>`)}
      </select>

      <div class="fenetre__label">Accès</div>
      <select class="fenetre__champ" data-champ="acces" aria-label="Accès">
        ${ACCES_COMPOSTEUR.map((a) => html`<option value="${a}">${a}</option>`)}
      </select>

      <div class="fenetre__label">Gestion</div>
      <input class="fenetre__champ" data-champ="gestion" type="text" maxlength="300" placeholder="Mairie, association…" aria-label="Gestion">

      <div class="fenetre__label">Infos de contact</div>
      <input class="fenetre__champ" data-champ="info_gestion" type="text" maxlength="300" placeholder="Téléphone, horaires…" aria-label="Infos de contact">

      <div class="fenetre__label">Déchets acceptés</div>
      <div class="elt-grid"></div>
      <div class="fenetre__aide">Clic : neutre → ✅ autorisé → ❌ interdit</div>

      <div class="fenetre__erreur" role="alert" hidden></div>
      <div class="fenetre__actions">
        <button type="button" class="fenetre__annuler" data-action="fermer">Annuler</button>
        <button type="button" class="fenetre__valider" data-action="enregistrer">Enregistrer</button>
      </div>`;
  }

  /**
   * Une pastille par déchet du référentiel, dans l'état que lui donne la demande.
   * @param {Demande} demande
   * @param {string[]} dechets
   */
  gabaritDechets(demande, dechets) {
    return html`${dechets.map((nom) => {
      const etat = (demande.mettre || []).includes(nom) ? AUTORISE : (demande.pas_mettre || []).includes(nom) ? INTERDIT : NEUTRE;
      return html`<button type="button" class="elt-chip" data-etat="${etat}" data-nom="${nom}">${nom}</button>`;
    })}`;
  }
}

AdminAjoutEdition.definir();
