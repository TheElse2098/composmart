/* ============================================================================
   compte-sortie.js — <cs-compte-sortie> : le bas de la page de compte,
   déconnexion et suppression du compte.

   La déconnexion est une action rare : un lien discret, pas un gros bouton
   rouge. La suppression est irréversible : elle est repliée par défaut, bien
   séparée de la déconnexion (on ne clique pas l'une en visant l'autre), et
   son bouton ne s'active qu'une fois le pseudo saisi exactement — un geste
   conscient, pas un clic réflexe.

   Le serveur refait la vérification du pseudo et décide de tout (il refuse de
   supprimer le dernier administrateur) ; ce composant affiche sa réponse.
   Ce que la suppression efface et ce qu'elle garde est écrit dans le texte du
   panneau : le tenir d'accord avec la politique de confidentialité.

   Usage, dans la page de compte :
     <cs-compte-sortie></cs-compte-sortie>
     this.trouver('cs-compte-sortie', CompteSortie).configurer(pseudo);
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

/** Temps laissé pour lire « Compte supprimé » avant le retour à l'accueil. */
const AVANT_ACCUEIL = 3000;

export class CompteSortie extends Composant {
  static balise = 'cs-compte-sortie';
  static styles = [new URL('./compte-sortie.css', import.meta.url)];

  /** Le pseudo à saisir pour confirmer la suppression. */
  #pseudo = '';

  monter() {
    this.ecouter('click', '[data-action="deconnecter"]', (bouton) => this.#deconnecter(bouton));
    this.ecouter('click', '[data-action="ouvrir-suppression"]', () => this.#replier(false));
    this.ecouter('click', '[data-action="annuler-suppression"]', () => this.#replier(true));
    this.ecouter('input', '.danger-input', () => this.#accorderBouton());
    this.ecouter('click', '[data-action="supprimer"]', () => this.#supprimer());
  }

  /**
   * Affiche la sortie pour un membre.
   * @param {string} pseudo
   */
  configurer(pseudo) {
    this.apresMontage(() => {
      this.#pseudo = pseudo;
      this.rendre(this.gabarit(pseudo));
    });
  }

  get #champ() { return this.trouver('.danger-input', HTMLInputElement); }
  get #bouton() { return this.trouver('[data-action="supprimer"]', HTMLButtonElement); }

  /** Le bouton n'est actif que si le pseudo est saisi exactement. */
  #accorderBouton() {
    this.#bouton.disabled = this.#champ.value !== this.#pseudo;
  }

  /** @param {string} texte  vide : rien à dire */
  #message(texte) {
    const zone = this.trouver('.danger-msg');
    zone.textContent = texte;
    zone.hidden = texte === '';
  }

  /** Replie le panneau de suppression (et oublie ce qui y était saisi), ou le déplie.
   *  @param {boolean} replie */
  #replier(replie) {
    this.trouver('.danger-panel').hidden = replie;
    this.trouver('[data-action="ouvrir-suppression"]').hidden = !replie;
    if (replie) {
      this.#champ.value = '';
      this.#bouton.disabled = true;
      this.#message('');
    } else {
      this.#champ.focus();
    }
  }

  /** @param {HTMLElement} bouton */
  async #deconnecter(bouton) {
    if (bouton instanceof HTMLButtonElement) bouton.disabled = true;
    try {
      await api.auth.post('logout.php');
    } catch (erreur) {
      // La page est rechargée de toute façon : elle dira si la session est encore là.
      console.error('<cs-compte-sortie>', erreur);
    }
    location.reload();
  }

  async #supprimer() {
    const bouton = this.#bouton;
    if (bouton.disabled) return;
    bouton.disabled = true;
    bouton.textContent = 'Suppression…';
    this.#message('');
    try {
      await api.auth.post('delete_account.php', { confirmation: this.#champ.value });
      // Confirmation sur place (l'accueil n'a pas de zone de message), puis
      // retour à l'accueil, déconnecté.
      this.rendre(this.gabaritAdieu(), this.trouver('.danger-panel'));
      const attente = setTimeout(() => location.assign('/'), AVANT_ACCUEIL);
      this.aLaFin(() => clearTimeout(attente));
    } catch (erreur) {
      console.error('<cs-compte-sortie>', erreur);
      this.#message(texteErreur(erreur, 'La suppression a échoué.'));
      bouton.textContent = 'Supprimer';
      this.#accorderBouton();
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /** @param {string} pseudo */
  gabarit(pseudo) {
    return html`
      <button type="button" class="btn-logout" data-action="deconnecter">Se déconnecter</button>
      <div class="danger-sep"></div>
      <button type="button" class="btn-danger-open" data-action="ouvrir-suppression">Supprimer mon compte</button>
      <div class="danger-panel" hidden>
        <div class="danger-title">Supprimer définitivement mon compte</div>
        <div class="danger-text">
          Ton compte, ton pseudo, ton adresse email et tes scores seront <b>effacés
          et irrécupérables</b>. Ton activité (XP gagnée, cours terminés, connexions)
          est conservée sous forme de <b>statistiques anonymes</b>, sans aucun lien
          avec toi. Tes signalements de composteurs restent traités, mais sans ton nom.
        </div>
        <label class="danger-label" for="compte-suppression">Pour confirmer, saisis ton nom d'utilisateur : <b>${pseudo}</b></label>
        <input class="danger-input" id="compte-suppression" type="text" autocomplete="off" spellcheck="false" placeholder="Nom d'utilisateur">
        <div class="danger-actions">
          <button type="button" class="btn-danger-cancel" data-action="annuler-suppression">Annuler</button>
          <button type="button" class="btn-danger-go" data-action="supprimer" disabled>Supprimer</button>
        </div>
        <div class="danger-msg" role="alert" hidden></div>
      </div>`;
  }

  gabaritAdieu() {
    return html`
      <div class="danger-title">Compte supprimé</div>
      <div class="danger-text">Tes données personnelles ont été effacées. Merci d'avoir fait un bout de chemin avec Composmart 🌱</div>`;
  }
}

CompteSortie.definir();
