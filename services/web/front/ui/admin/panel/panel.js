/* ============================================================================
   panel.js — <cs-admin-panel> : le panneau d'administration (/admin/panel).

   Le cadre du panneau : son en-tête, sa rangée d'onglets avec leurs
   compteurs, et la zone où s'affiche l'onglet choisi. Chaque onglet est un
   composant à part, dans son propre fichier : modifier le journal n'oblige
   plus à ouvrir le code des signalements ou des comptes.

   Contrat d'un onglet :
     - il est créé à sa première ouverture, puis gardé : ses filtres, sa
       période, sa recherche survivent à un aller-retour entre onglets ;
     - à chaque retour, le panneau appelle sa méthode rafraichir() : une action
       faite ailleurs (valider un ajout) se voit en revenant (dans le journal) ;
     - quand il modifie des données, il émet « donnees-modifiees » : le panneau
       remet à jour les compteurs des onglets.

   Ce fichier est servi par « web », donc lisible par tous : il ne contient que
   du code. Les données n'arrivent que par les API, qui vérifient les droits.

   Usage, dans la coquille servie par courses-api (admin-pages/vues/panel.html) :
     <cs-admin-panel></cs-admin-panel>
     <script type="module" src="/ui/admin/panel/panel.js"></script>
   ============================================================================ */
import { ErreurApi, api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import './ajouts.js';
import './journal.js';
import './signalements.js';
import './vue-ensemble.js';

/**
 * @typedef {object} Onglet
 * @property {string} cle
 * @property {string} libelle
 * @property {'signalements' | 'en_attente' | 'a_traiter'} [compteur]  ce que compte sa pastille
 *
 * @typedef {object} Compteurs  ce qui attend une décision, par onglet
 * @property {number} [signalements]  signalements ouverts sur la carte
 * @property {number} [en_attente]    ajouts de composteurs à valider
 * @property {number} [a_traiter]     messages sans réponse
 */

/** @type {Onglet[]} */
const ONGLETS = [
  { cle: 'ensemble', libelle: "📊 Vue d'ensemble" },
  { cle: 'signalements', libelle: '🚩 Signalements', compteur: 'signalements' },
  { cle: 'ajouts', libelle: '🌱 Ajouts', compteur: 'en_attente' },
  { cle: 'messages', libelle: '✉️ Messages', compteur: 'a_traiter' },
  { cle: 'utilisateurs', libelle: '👥 Utilisateurs' },
  { cle: 'journal', libelle: '📜 Journal' },
];

/** Un onglet sait-il se recharger ? @param {unknown} element @returns {element is { rafraichir: () => unknown }} */
function seRafraichit(element) {
  return typeof (/** @type {any} */ (element)?.rafraichir) === 'function';
}

export class AdminPanel extends Composant {
  static balise = 'cs-admin-panel';
  static styles = [new URL('./panel.css', import.meta.url)];

  #onglet = 'ensemble';

  monter() {
    this.rendre(this.gabarit(this.#onglet));
    this.ecouter('click', '[data-onglet]', (bouton) => this.#ouvrir(bouton.dataset.onglet));
    this.ecouterSur(this, 'donnees-modifiees', () => this.#compter());
    this.#ouvrir(this.#onglet);
    this.#compter();
  }

  /** @param {string | undefined} cle */
  #ouvrir(cle) {
    const onglet = ONGLETS.find((o) => o.cle === cle);
    if (!onglet) return;
    this.#onglet = onglet.cle;

    for (const bouton of this.tous('[data-onglet]')) {
      const actif = bouton.dataset.onglet === onglet.cle;
      bouton.classList.toggle('active', actif);
      bouton.setAttribute('aria-selected', String(actif));
    }
    for (const zone of this.tous('[data-contenu]')) {
      zone.hidden = zone.dataset.contenu !== onglet.cle;
    }

    const zone = this.trouver('[data-contenu="' + onglet.cle + '"]');
    const composant = zone.firstElementChild;
    if (!composant) this.rendre(this.gabaritOnglet(onglet.cle), zone); // première ouverture
    else if (seRafraichit(composant)) composant.rafraichir();          // retour sur l'onglet
  }

  /** Met à jour les pastilles des onglets. Les deux sources sont indépendantes :
   *  l'une peut manquer sans priver l'autre de ses pastilles. */
  async #compter() {
    /** @param {unknown} erreur */
    const refuse = (erreur) => {
      // Session expirée ou droits retirés : cette page n'a plus lieu d'être.
      if (erreur instanceof ErreurApi && erreur.statut === 403) location.replace('/');
      else console.error('<cs-admin-panel>', erreur);
      return {};
    };
    const [carte, messages] = await Promise.all([
      api.carte.get('count.php').catch(refuse),
      api.admin.get('tickets.php', { count: 1 }).catch(refuse),
    ]);
    this.#montrerCompteurs({ ...carte, ...messages });
  }

  /** @param {Compteurs} compteurs */
  #montrerCompteurs(compteurs) {
    for (const onglet of ONGLETS) {
      if (!onglet.compteur) continue;
      const n = compteurs[onglet.compteur];
      if (n === undefined) continue; // source indisponible : la pastille reste comme elle était
      const bouton = this.trouver('[data-onglet="' + onglet.cle + '"]');
      const pastille = this.trouver('[data-onglet="' + onglet.cle + '"] .tab-count');
      pastille.textContent = String(n);
      pastille.hidden = n <= 0;
      bouton.classList.toggle('alert', n > 0);
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /** @param {string} actif clé de l'onglet ouvert au départ */
  gabarit(actif) {
    return html`
      <div class="hero">
        <div class="hero-badge">🔧 Administration</div>
        <h1>Admin panel</h1>
        <a href="/admin" class="hero-lien">← Administration</a>
      </div>

      <div class="tabs" role="tablist">
        ${ONGLETS.map((o) => html`
          <button type="button" class="tab${o.cle === actif ? ' active' : ''}" role="tab" aria-selected="${String(o.cle === actif)}" data-onglet="${o.cle}">${o.libelle}${o.compteur && html`<span class="tab-count" hidden></span>`}</button>`)}
      </div>

      <div class="page-content">
        ${ONGLETS.map((o) => html`<section data-contenu="${o.cle}" hidden></section>`)}
      </div>`;
  }

  /**
   * Le composant d'un onglet. La balise est écrite en toutes lettres : c'est
   * ce qui permet au vérificateur de s'assurer que son module est bien chargé.
   * @param {string} cle
   */
  gabaritOnglet(cle) {
    switch (cle) {
      case 'ensemble':
        return html`<cs-admin-vue-ensemble></cs-admin-vue-ensemble>`;
      case 'signalements':
        return html`<cs-admin-signalements></cs-admin-signalements>`;
      case 'ajouts':
        return html`<cs-admin-ajouts></cs-admin-ajouts>`;
      case 'journal':
        return html`<cs-admin-journal></cs-admin-journal>`;
      default:
        return this.gabaritEnAttente();
    }
  }

  /** Onglet pas encore reconstruit : il renvoie vers le panneau en service. */
  gabaritEnAttente() {
    return html`
      <div class="en-attente">
        <p>Cet onglet n'est pas encore reconstruit dans cette version du panneau.</p>
        <a href="/admin/panel" class="hero-lien">Ouvrir le panneau actuel</a>
      </div>`;
  }
}

AdminPanel.definir();
