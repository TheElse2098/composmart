/* ============================================================================
   accueil.js — <cs-admin-accueil> : l'accueil de l'administration (/admin).

   Une tuile par espace. Chaque espace garde son adresse, son service et son
   contrôle des droits ; cette page ne fait que les rassembler et afficher ce
   qui attend une action.

   Les compteurs sont demandés après l'affichage, chacun de son côté : un
   service lent ou en panne laisse sa tuile cliquable, avec la mention
   « indisponible » à la place des chiffres.

   Ce fichier est servi par « web », donc lisible par tous : il ne contient que
   du code. Les données n'arrivent que par les API, qui vérifient les droits.

   Usage, dans la coquille servie par courses-api (admin-pages/vues/accueil.html) :
     <cs-admin-accueil></cs-admin-accueil>
     <script type="module" src="/ui/admin/accueil/accueil.js"></script>
   ============================================================================ */
import { api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html, pluriel } from '../../socle/outils.js';

/**
 * Une puce d'état sous une tuile. `alerte` : quelque chose attend une action.
 * `calme` : rien à signaler, ou état inconnu.
 * @typedef {object} Puce
 * @property {string} texte
 * @property {'alerte' | 'calme'} [sorte]
 */

/** @typedef {{ statut: string }} AvecStatut */

const TUILES = [
  { cle: 'panel',      href: '/admin/panel',      emoji: '🔧', titre: 'Admin panel',       description: 'Signalements et ajouts de composteurs, messages, utilisateurs, statistiques et journal.' },
  { cle: 'cours',      href: '/admin/themes',     emoji: '📚', titre: 'Édition des cours', description: 'Thèmes, cours, quiz et médias : écrire, publier et réorganiser le catalogue.' },
  { cle: 'jeux',       href: '/jeux-admin',       emoji: '🎮', titre: 'Édition des jeux',  description: 'Contenu et règles des mini-jeux : déchets, mots, durées, nombre de manches.' },
  { cle: 'evenements', href: '/evenements-admin', emoji: '🎟️', titre: 'Event panel',       description: "Ateliers en présentiel : création, déroulé, parcours, banque d'images et d'anecdotes, suivi en direct." },
];

/** @type {Puce} */
const INDISPONIBLE = { texte: 'État indisponible', sorte: 'calme' };

/**
 * Compte les éléments par statut.
 * @param {AvecStatut[]} elements
 * @returns {Record<string, number>}
 */
function parStatut(elements) {
  /** @type {Record<string, number>} */
  const n = {};
  for (const e of elements) n[e.statut] = (n[e.statut] || 0) + 1;
  return n;
}

/**
 * Admin panel : ce qui attend une décision (mêmes sources que ses onglets).
 * Une source injoignable vaut `null` : elle est signalée, et « Rien à
 * traiter » n'est affiché que si les deux ont répondu.
 * @param {{ signalements: number, en_attente: number } | null} carte    /api/carte/count.php
 * @param {{ a_traiter: number } | null} tickets                         /api/admin/tickets.php?count=1
 * @returns {Puce[]}
 */
export function etatPanel(carte, tickets) {
  /** @type {Puce[]} */
  const puces = [];
  if (carte && carte.signalements > 0) puces.push({ texte: pluriel(carte.signalements, 'signalement', 'signalements'), sorte: 'alerte' });
  if (carte && carte.en_attente > 0) puces.push({ texte: pluriel(carte.en_attente, 'ajout à valider', 'ajouts à valider'), sorte: 'alerte' });
  if (tickets && tickets.a_traiter > 0) puces.push({ texte: pluriel(tickets.a_traiter, 'message', 'messages'), sorte: 'alerte' });

  if (!carte) puces.push({ texte: 'Carte injoignable', sorte: 'calme' });
  if (!tickets) puces.push({ texte: 'Messages injoignables', sorte: 'calme' });
  if (!puces.length) puces.push({ texte: 'Rien à traiter ✓', sorte: 'calme' });
  return puces;
}

/**
 * Publiés et brouillons, pour les cours comme pour les jeux.
 * @param {AvecStatut[]} elements
 * @param {[string, string]} publie  singulier et pluriel de « publié »
 * @returns {Puce[]}
 */
export function etatPublication(elements, publie) {
  const n = parStatut(elements);
  /** @type {Puce[]} */
  const puces = [{ texte: pluriel(n.publie || 0, publie[0], publie[1]) }];
  if (n.brouillon > 0) puces.push({ texte: pluriel(n.brouillon, 'brouillon', 'brouillons'), sorte: 'alerte' });
  return puces;
}

/**
 * Événements : ceux qui vivent en ce moment ou approchent.
 * @param {AvecStatut[]} evenements
 * @returns {Puce[]}
 */
export function etatEvenements(evenements) {
  const n = parStatut(evenements);
  /** @type {Puce[]} */
  const puces = [];
  if (n.en_cours > 0) puces.push({ texte: pluriel(n.en_cours, 'en cours', 'en cours'), sorte: 'alerte' });
  if (n.ouvert > 0) puces.push({ texte: pluriel(n.ouvert, 'ouvert', 'ouverts') });
  if (n.prevu > 0) puces.push({ texte: pluriel(n.prevu, 'prévu', 'prévus') });
  if (!puces.length) puces.push({ texte: 'Aucun événement à venir', sorte: 'calme' });
  return puces;
}

export class AdminAccueil extends Composant {
  static balise = 'cs-admin-accueil';
  static styles = [new URL('./accueil.css', import.meta.url)];

  monter() {
    this.rendre(this.gabarit());

    // Chaque tuile se remplit de son côté : aucune n'attend les autres.
    this.#remplir('panel', async () => {
      const [carte, tickets] = await Promise.all([
        api.carte.get('count.php').catch((erreur) => this.#injoignable(erreur)),
        api.admin.get('tickets.php', { count: 1 }).catch((erreur) => this.#injoignable(erreur)),
      ]);
      return etatPanel(carte, tickets);
    });
    this.#remplir('cours', async () => {
      /** @type {{ themes: { cours: AvecStatut[] }[] }} */
      const d = await api.admin.get('themes_manage.php');
      return etatPublication((d.themes || []).flatMap((t) => t.cours || []), ['cours publié', 'cours publiés']);
    });
    this.#remplir('jeux', async () => {
      /** @type {{ jeux: AvecStatut[] }} */
      const d = await api.jeux.get('admin.php', { action: 'liste' });
      return etatPublication(d.jeux || [], ['jeu publié', 'jeux publiés']);
    });
    this.#remplir('evenements', async () => {
      /** @type {{ evenements: AvecStatut[] }} */
      const d = await api.evenements.get('admin.php', { action: 'liste' });
      return etatEvenements(d.evenements || []);
    });
  }

  /**
   * Une source du panel qui ne répond pas : notée dans la console, comptée
   * comme absente.
   * @param {unknown} erreur
   * @returns {null}
   */
  #injoignable(erreur) {
    console.error('<cs-admin-accueil>', erreur);
    return null;
  }

  /**
   * Affiche l'état d'une tuile, ou « indisponible » si sa source échoue.
   * @param {string} cle
   * @param {() => Promise<Puce[]>} calculer
   */
  async #remplir(cle, calculer) {
    const zone = this.trouver('[data-etat="' + cle + '"]');
    let puces;
    try {
      puces = await calculer();
    } catch (erreur) {
      console.error('<cs-admin-accueil> ' + cle, erreur);
      puces = [INDISPONIBLE];
    }
    this.rendre(this.gabaritPuces(puces), zone);
  }

  gabarit() {
    return html`
      <div class="hero">
        <div class="hero-badge">🔧 Administration</div>
        <h1>Que veux-tu gérer ?</h1>
      </div>

      <main class="tuiles">
        ${TUILES.map((t) => html`
          <a class="tuile" href="${t.href}">
            <span class="tuile-fleche">→</span>
            <div class="tuile-emoji">${t.emoji}</div>
            <div class="tuile-titre">${t.titre}</div>
            <div class="tuile-desc">${t.description}</div>
            <div class="tuile-etat" data-etat="${t.cle}"></div>
          </a>`)}
      </main>`;
  }

  /** @param {Puce[]} puces */
  gabaritPuces(puces) {
    return html`${puces.map((p) => html`<span class="puce${p.sorte ? ' ' + p.sorte : ''}">${p.texte}</span>`)}`;
  }
}

AdminAccueil.definir();
