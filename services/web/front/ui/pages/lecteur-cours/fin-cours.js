/* ============================================================================
   fin-cours.js — <cs-fin-cours> : ce qui s'affiche quand un cours est fini.

   Le même bloc sert après le quiz (dans la carte de résultat) et pour un
   cours sans quiz (sous la dernière section, encadré) :
     - il prévient le serveur (complete.php), qui accorde l'XP à un membre et
       ne compte qu'un « cours terminé » anonyme pour un visiteur ;
     - un membre voit l'XP gagnée et sa barre de niveau, ou « Cours déjà
       complété » s'il l'avait déjà fini ;
     - un visiteur est invité à se connecter : rien n'est gardé à son nom.

   Usage :
     <cs-fin-cours></cs-fin-cours>           (ou <cs-fin-cours encadre>)
     this.trouver('cs-fin-cours', FinCours).enregistrer(contexte, reponses);
   ============================================================================ */
import { api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { BarreXp, XP_PAR_NIVEAU } from './barre-xp.js';

/**
 * Ce que le lecteur et le quiz partagent sur le cours en cours de lecture.
 * `xp` est celle du membre ; elle est mise à jour après un gain, pour qu'un
 * quiz refait dans la même page parte de la bonne valeur.
 * @typedef {object} ContexteCours
 * @property {string} slug
 * @property {boolean} membre
 * @property {number} xp
 *
 * Réponse de /api/cours/complete.php.
 * @typedef {object} Fin
 * @property {boolean} success     faux : quiz sous les 50 %, rien n'est accordé
 * @property {number} [xp_earned]  0 quand le cours était déjà fini
 * @property {number} [xp_total]
 * @property {number} [niveau]
 *
 * @typedef {{ gagne: number, ancien: number, nouveau: number, niveau: number }} Bilan
 */

/**
 * Ce qu'un membre doit voir après la réponse du serveur, ou `null` s'il n'y a
 * rien à montrer (le serveur a refusé : la carte de résultat le dit déjà).
 * @param {Fin} reponse
 * @param {number} xpAvant
 * @returns {Bilan | null}
 */
export function bilanFin(reponse, xpAvant) {
  if (!reponse.success) return null;
  const gagne = Number(reponse.xp_earned) || 0;
  if (gagne > 0) {
    return { gagne, ancien: xpAvant, nouveau: Number(reponse.xp_total) || xpAvant + gagne, niveau: Number(reponse.niveau) || 0 };
  }
  return { gagne: 0, ancien: xpAvant, nouveau: xpAvant, niveau: Math.floor(xpAvant / XP_PAR_NIVEAU) + 1 };
}

export class FinCours extends Composant {
  static balise = 'cs-fin-cours';
  static styles = [new URL('./fin-cours.css', import.meta.url)];

  /**
   * @param {ContexteCours} contexte
   * @param {(number | number[])[]} reponses  réponses du quiz, index d'origine des options ; vide sans quiz
   */
  enregistrer(contexte, reponses) {
    this.apresMontage(() => { this.#enregistrer(contexte, reponses); });
  }

  /**
   * @param {ContexteCours} contexte
   * @param {(number | number[])[]} reponses
   */
  async #enregistrer(contexte, reponses) {
    this.rendre(html``);
    /** @type {Fin} */
    let reponse;
    try {
      reponse = await api.cours.postJson('complete.php', { slug: contexte.slug, answers: reponses });
    } catch (erreur) {
      if (!contexte.membre) {
        this.rendre(this.gabaritInvitation());
        return;
      }
      console.error('<cs-fin-cours>', erreur);
      this.rendre(html`<p class="fin-erreur" role="alert">⚠️ Ta progression n'a pas pu être enregistrée. Réessaie plus tard.</p>`);
      return;
    }

    if (!contexte.membre) {
      this.rendre(this.gabaritInvitation());
      return;
    }
    const bilan = bilanFin(reponse, contexte.xp);
    if (!bilan) return;
    contexte.xp = bilan.nouveau;
    this.rendre(this.gabaritGain(bilan.gagne));
    this.trouver('cs-barre-xp', BarreXp).montrer(bilan.ancien, bilan.nouveau, bilan.niveau);
  }

  /** @param {number} gagne */
  gabaritGain(gagne) {
    return html`
      <div class="fin-gain">
        ${gagne > 0
          ? html`<div class="xp-gained">+${gagne} XP gagnés ! 🎉</div>`
          : html`<div class="xp-gained deja">Cours déjà complété.</div>`}
        <cs-barre-xp></cs-barre-xp>
      </div>`;
  }

  gabaritInvitation() {
    return html`
      <div class="fin-invitation">
        <div class="fin-invitation-texte">Connecte-toi pour sauvegarder ta progression !</div>
        <a href="/login" class="fin-connexion">🔑 Se connecter</a>
        <span class="fin-ou">ou</span>
        <a href="/signin" class="fin-inscription">Créer un compte</a>
      </div>`;
  }
}

FinCours.definir();
