/* ============================================================================
   jeu.js — classe de base des quatre mini-jeux (pages jeu-<slug>.html).

   Le contenu et les règles d'un jeu vivent en base et s'éditent depuis
   /jeux-admin ; chaque page n'est qu'une mécanique. Ce qui est commun aux
   quatre est ici :

     - charger le jeu (/api/jeux/catalogue.php?action=jeu) et, s'il n'est pas
       disponible, le dire avec un lien vers les autres jeux ;
     - l'en-tête (pastille au nom du jeu, titre) et la mention « brouillon »
       qu'un administrateur voit sur un jeu pas encore publié ;
     - la carte de jeu, avec sa barre d'état au-dessus ;
     - l'écran de fin : score, message du palier atteint, record, XP gagnée,
       top 5, invitation à se connecter pour un visiteur, « Rejouer » ;
     - les attentes entre deux manches, annulées si la page est quittée.

   Un jeu hérite de cette classe et écrit sa mécanique :

     export class CompostOuPas extends Jeu {
       static balise = 'cs-compost-ou-pas';
       static slug = 'compost-ou-pas';
       static pastille = '♻️ Compost ou pas ?';     // avant chargement
       static titre = 'Bien trier, ça s\'apprend';
       static styles = [...Jeu.styles, new URL('./compost-ou-pas.css', import.meta.url)];

       gabaritZone() { return html`…la zone de jeu…`; }
       gabaritStatut() { return html`<span>Déchet 1/12</span>…`; }
       preparer() { …une fois, le jeu chargé : écoutes… }
       nouvellePartie() { …remettre à zéro, première manche… }
     }

   Pour finir une partie : this.terminer(score, suffixe?). Tout texte venant
   de la base (saisi dans l'administration) passe par html`` : jamais lu
   comme du HTML.
   ============================================================================ */
import { ErreurApi, api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { Html, html } from '../../socle/outils.js';

/**
 * @typedef {object} Palier  un message de fin, selon la part du score maximal atteinte
 * @property {number} min    de 0 à 1
 * @property {string} emoji
 * @property {string} texte
 *
 * @typedef {object} DonneesJeu  /api/jeux/catalogue.php?action=jeu, champ `jeu`
 * @property {string} slug
 * @property {string} nom
 * @property {string} emoji
 * @property {string} statut      `publie` ; `brouillon`, vu des seuls administrateurs
 * @property {number} score_max
 * @property {Palier[]} messages
 * @property {any[]} items        le contenu, propre à chaque jeu
 * @property {Record<string, any>} regles  les règles, propres à chaque jeu
 */

/**
 * Copie mélangée d'un tableau (Fisher-Yates).
 * @template T
 * @param {T[]} tableau
 * @returns {T[]}
 */
export function melanger(tableau) {
  const copie = tableau.slice();
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/**
 * Le palier de fin atteint : le plus exigeant dont le minimum est atteint, à
 * défaut le plus bas.
 * @param {Palier[] | null | undefined} messages
 * @param {number} part  score / score maximal, de 0 à 1
 * @returns {{ emoji: string, texte: string }}
 */
export function palier(messages, part) {
  const liste = (messages || []).slice().sort((a, b) => b.min - a.min);
  for (const m of liste) if (part >= m.min) return m;
  return liste[liste.length - 1] || { emoji: '🎮', texte: '' };
}

/** Rang des cinq premiers du classement. */
const MEDAILLES = ['🥇', '🥈', '🥉', '4.', '5.'];

export class Jeu extends Composant {
  /** Le jeu à charger. À définir dans chaque jeu. */
  static slug = '';
  /** La pastille de l'en-tête, avant que le nom du jeu n'arrive. */
  static pastille = '';
  /** Le titre de l'en-tête. */
  static titre = '';

  /** Un jeu ajoute sa feuille à celle-ci :
   *  `static styles = [...Jeu.styles, new URL('./x.css', import.meta.url)]`.
   *  @type {(string | URL)[]} */
  static styles = [new URL('./jeu.css', import.meta.url)];

  /** Le jeu chargé. Disponible dans preparer() et nouvellePartie().
   *  @type {DonneesJeu} */
  jeu = /** @type {DonneesJeu} */ ({});

  /** Les attentes en cours (entre deux manches). @type {Set<ReturnType<typeof setTimeout>>} */
  #attentes = new Set();

  async monter() {
    const classe = /** @type {typeof Jeu} */ (this.constructor);
    this.classList.add('jeu');
    this.aLaFin(() => this.annulerAttentes());
    this.rendre(this.gabaritCadre(classe));
    this.ecouter('click', '[data-action="rejouer"]', () => {
      this.annulerAttentes();
      this.rendre(this.gabaritFinVide(), this.trouver('.end-screen'));
      this.trouver('.end-screen').hidden = true;
      this.trouver('.game-zone').hidden = false;
      this.nouvellePartie();
    });

    try {
      /** @type {{ jeu: DonneesJeu }} */
      const d = await api.jeux.get('catalogue.php', { action: 'jeu', slug: classe.slug });
      this.jeu = d.jeu;
    } catch (erreur) {
      console.error('<' + this.localName + '>', erreur);
      this.rendre(html`<div class="jeu-etat">Ce jeu n'est pas disponible pour le moment.<br><a href="/jeux">🎮 Voir les autres jeux</a></div>`, this.trouver('.game-card'));
      return;
    }

    this.trouver('.hero-badge').textContent = (this.jeu.emoji ? this.jeu.emoji + ' ' : '') + this.jeu.nom;
    // Seul un administrateur reçoit un brouillon : on le lui rappelle.
    this.trouver('.jeu-brouillon').hidden = this.jeu.statut !== 'brouillon';
    this.trouver('.jeu-etat').remove();
    this.trouver('.game-zone').hidden = false;
    this.preparer();
    this.nouvellePartie();
  }

  // ── À écrire dans chaque jeu ──────────────────────────────────────────────

  /** La zone de jeu (dans la carte). @returns {Html} */
  gabaritZone() { return html``; }

  /** La barre d'état au-dessus de la carte, au départ. @returns {Html} */
  gabaritStatut() { return html``; }

  /** Une fois le jeu chargé, avant la première partie : les écoutes de la mécanique. */
  preparer() {}

  /** Une partie neuve : tout remettre à zéro, première manche. */
  nouvellePartie() {}

  // ── À la disposition des jeux ─────────────────────────────────────────────

  /**
   * Remplace le contenu de la barre d'état.
   * @param {Html} gabarit
   */
  statut(gabarit) {
    this.rendre(gabarit, this.trouver('.game-status'));
  }

  /**
   * Exécute l'action après un délai, sauf si la page est quittée ou la
   * partie relancée entre-temps.
   * @param {number} millisecondes
   * @param {() => void} action
   */
  attendre(millisecondes, action) {
    const numero = setTimeout(() => {
      this.#attentes.delete(numero);
      action();
    }, millisecondes);
    this.#attentes.add(numero);
  }

  /** Annule toutes les attentes en cours. */
  annulerAttentes() {
    for (const numero of this.#attentes) clearTimeout(numero);
    this.#attentes.clear();
  }

  /**
   * Fin de partie : l'écran de fin, puis l'enregistrement du score et le top 5.
   * @param {number} score
   * @param {string} [suffixe]  ajouté au message du palier (« Partie écourtée… »)
   */
  terminer(score, suffixe = '') {
    const max = this.jeu.score_max;
    const m = palier(this.jeu.messages, max > 0 ? score / max : 0);
    this.trouver('.game-zone').hidden = true;
    const fin = this.trouver('.end-screen');
    fin.hidden = false;
    this.trouver('.end-emoji').textContent = m.emoji || '🎮';
    this.trouver('.end-score').textContent = score + ' / ' + max;
    this.trouver('.end-msg').textContent = m.texte + (suffixe ? ' ' + suffixe : '');
    this.#enregistrer(score);
  }

  /** @param {number} score */
  async #enregistrer(score) {
    const slug = this.jeu.slug;
    try {
      /** @type {{ record?: boolean, xp_gagne?: number }} */
      const d = await api.jeux.post('score.php', { action: 'save', jeu_id: slug, score });
      if (d.record && score > 0) this.trouver('.end-record').hidden = false;
      if (d.xp_gagne && d.xp_gagne > 0) {
        const xp = this.trouver('.end-xp');
        xp.textContent = '⚡ +' + d.xp_gagne + ' XP';
        xp.hidden = false;
      }
    } catch (erreur) {
      const visiteur = erreur instanceof ErreurApi && /** @type {any} */ (erreur.donnees)?.error === 'not_logged_in';
      if (visiteur) this.trouver('.save-info').hidden = false;
      else console.error('<' + this.localName + '>', erreur);
    }

    // Le top 5 se montre aussi à un visiteur.
    try {
      /** @type {{ top?: { username: string, score: number }[] }} */
      const d = await api.jeux.get('score.php', { action: 'infos', jeu_id: slug });
      if (!d.top || !d.top.length) return;
      this.rendre(html`${d.top.map((t, i) => html`<div class="lb-row"><span>${MEDAILLES[i]} ${t.username}</span><span>${t.score}</span></div>`)}`, this.trouver('.lb-rows'));
      this.trouver('.leaderboard').hidden = false;
    } catch (erreur) {
      console.error('<' + this.localName + '>', erreur); // l'écran de fin se passe du classement
    }
  }

  // ── Gabarits communs ──────────────────────────────────────────────────────

  /** @param {typeof Jeu} classe */
  gabaritCadre(classe) {
    return html`
      <div class="hero">
        <div class="hero-badge">${classe.pastille}</div>
        <h1>${classe.titre}</h1>
        <div class="jeu-brouillon" hidden>🛠️ Brouillon : ce jeu n'est visible que des administrateurs.</div>
      </div>
      <div class="page-content">
        <div class="game-status">${this.gabaritStatut()}</div>
        <div class="game-card">
          <div class="jeu-etat">Chargement…</div>
          <div class="game-zone" hidden>${this.gabaritZone()}</div>
          <div class="end-screen" hidden>${this.gabaritFinVide()}</div>
        </div>
      </div>`;
  }

  /** L'écran de fin, vide : rempli par terminer(). */
  gabaritFinVide() {
    return html`
      <div class="end-emoji">🏆</div>
      <div class="end-score"></div>
      <div class="end-msg"></div>
      <div class="end-record" hidden>🎉 Nouveau record perso !</div>
      <div class="end-xp" hidden></div>
      <div class="leaderboard" hidden>
        <div class="lb-title">🏅 Top 5</div>
        <div class="lb-rows"></div>
      </div>
      <div class="save-info" hidden>
        <div class="save-info-text">Connecte-toi pour sauvegarder ton score et apparaître dans le classement !</div>
        <div class="save-info-actions">
          <a href="/login" class="save-info-btn-login">Se connecter</a>
          <a href="/signin" class="save-info-btn-register">Créer un compte</a>
        </div>
      </div>
      <div class="end-actions">
        <button type="button" class="btn-rejouer" data-action="rejouer">🔄 Rejouer</button>
        <a href="/jeux" class="btn-retour">🎮 Autres jeux</a>
      </div>`;
  }
}
