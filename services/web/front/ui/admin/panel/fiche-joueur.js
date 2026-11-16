/* ============================================================================
   fiche-joueur.js — <cs-admin-fiche-joueur> : la fiche d'un joueur, ouverte
   depuis la liste des utilisateurs.

   Volontairement réduite : niveau, XP (et sa courbe), cours terminés, meilleur
   score à chaque jeu — rien d'autre. Ni adresse email, ni aucune autre donnée
   de compte. Elle sert à un administrateur qui enquête sur un bug qu'un joueur
   signale (score, XP ou niveau incohérent), pas à consulter son compte.
   N'y ajouter aucun champ sans mettre à jour le registre RGPD.

   Deux services répondent, chacun ne connaissant que sa base : auth-api
   (niveau, XP, cours) et games-api (jeux). Sans le second, la fiche s'affiche
   quand même, avec un mot à la place des jeux.

   Usage, dans l'onglet des utilisateurs :
     <cs-admin-fiche-joueur></cs-admin-fiche-joueur>
     this.trouver('cs-admin-fiche-joueur', AdminFicheJoueur).ouvrir(id, pseudo);
   ============================================================================ */
import { CourbeXp } from '../../composants/courbe-xp/courbe-xp.js';
import { api, texteErreur } from '../../socle/api.js';
import { Fenetre } from '../../socle/fenetre.js';
import { html } from '../../socle/outils.js';

/**
 * @typedef {object} Joueur  /api/auth/fiche_joueur.php?user_id=
 * @property {number} niveau
 * @property {number} xp
 * @property {import('../../composants/courbe-xp/courbe-xp.js').Gain[]} xp_history
 * @property {{ titre: string, emoji: string, completed_at: string }[]} cours
 *
 * @typedef {object} Score  un jeu, dans /api/jeux/score.php?action=profile&user_id=
 * @property {string} slug
 * @property {string | null} nom
 * @property {string | null} emoji
 * @property {number} max
 * @property {number | null} best  `null` : jamais joué
 */

/** « 2026-11-14 09:15:00 » → « 14/11/2026 ». @param {string | null | undefined} date */
export function jourFr(date) {
  return (date || '').slice(0, 10).split('-').reverse().join('/');
}

export class AdminFicheJoueur extends Fenetre {
  static balise = 'cs-admin-fiche-joueur';
  static styles = [...Fenetre.styles, new URL('./fiche-joueur.css', import.meta.url)];

  /** Le joueur affiché ; `null` fenêtre fermée. Une réponse pour un autre est ignorée.
   *  @type {number | null} */
  #id = null;

  monter() {
    this.poserFenetre(html`
      <div class="fenetre__tete">
        <div class="fenetre__titre">Fiche joueur</div>
        <button type="button" class="fenetre__fermer" data-action="fermer" aria-label="Fermer">✕</button>
      </div>
      <div class="fiche-corps"></div>`, { colonne: true });
  }

  /**
   * Ouvre la fiche d'un joueur.
   * @param {number} id
   * @param {string} pseudo  affiché tout de suite, pendant le chargement
   */
  ouvrir(id, pseudo) {
    this.apresMontage(() => { this.#afficher(id, pseudo); });
  }

  aLaFermeture() {
    this.#id = null;
  }

  /**
   * @param {number} id
   * @param {string} pseudo
   */
  async #afficher(id, pseudo) {
    this.#id = id;
    this.trouver('.fenetre__titre').textContent = '👤 ' + pseudo;
    const corps = this.trouver('.fiche-corps');
    this.rendre(html`<div class="empty-msg">Chargement…</div>`, corps);
    this.montrer();

    try {
      const [joueur, jeux] = await Promise.all([
        /** @type {Promise<Joueur>} */ (api.auth.get('fiche_joueur.php', { user_id: id })),
        // Les jeux viennent d'un autre service : sans lui, le reste de la fiche s'affiche.
        /** @type {Promise<{ records: Score[] } | null>} */ (api.jeux.get('score.php', { action: 'profile', user_id: id }).catch((erreur) => {
          console.error('<cs-admin-fiche-joueur>', erreur);
          return null;
        })),
      ]);
      if (this.#id !== id) return;
      this.rendre(this.gabaritFiche(joueur, jeux ? jeux.records : null), corps);
      this.trouver('cs-courbe-xp', CourbeXp).montrer(joueur.xp_history || [], "Aucun gain d'XP enregistré pour l'instant.");
    } catch (erreur) {
      if (this.#id !== id) return;
      console.error('<cs-admin-fiche-joueur>', erreur);
      this.rendre(html`<div class="empty-msg">${texteErreur(erreur, 'Chargement impossible.')}</div>`, corps);
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  /**
   * @param {Joueur} joueur
   * @param {Score[] | null} jeux  `null` : le service des jeux n'a pas répondu
   */
  gabaritFiche(joueur, jeux) {
    const cours = joueur.cours || [];
    return html`
      <div class="fiche-chiffres">
        <div class="fiche-chiffre"><div class="fiche-nombre">Niv. ${joueur.niveau}</div><div class="fiche-libelle">Niveau</div></div>
        <div class="fiche-chiffre"><div class="fiche-nombre">${joueur.xp}</div><div class="fiche-libelle">XP total</div></div>
      </div>

      <div class="section-title sans-marge">📈 Progression XP</div>
      <cs-courbe-xp></cs-courbe-xp>

      <div class="section-title">📚 Cours terminés</div>
      <div class="fiche-liste">
        ${cours.length ? cours.map((c) => html`
          <div class="fiche-ligne"><span class="fiche-emoji">${c.emoji}</span><span class="fiche-nom">${c.titre}</span><span class="fiche-date">${jourFr(c.completed_at)}</span></div>`)
          : html`<div class="empty-msg">Aucun cours terminé.</div>`}
      </div>

      <div class="section-title">🎮 Jeux terminés</div>
      <div class="fiche-liste">${this.gabaritJeux(jeux)}</div>`;
  }

  /** @param {Score[] | null} jeux */
  gabaritJeux(jeux) {
    if (!jeux) return html`<div class="empty-msg">Scores indisponibles pour le moment.</div>`;
    if (!jeux.length) return html`<div class="empty-msg">Aucun jeu disponible.</div>`;
    return html`${jeux.map((r) => html`
      <div class="fiche-ligne"><span class="fiche-emoji">${r.emoji || '🎮'}</span><span class="fiche-nom">${r.nom || r.slug}</span>${r.best === null
        ? html`<span class="fiche-score vide">Jamais joué</span>`
        : html`<span class="fiche-score">${r.best} / ${r.max}</span>`}</div>`)}`;
  }
}

AdminFicheJoueur.definir();
