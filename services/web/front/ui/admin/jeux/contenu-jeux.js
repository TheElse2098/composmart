/* ============================================================================
   contenu-jeux.js — le contenu de chaque mini-jeu (mots, déchets) tel que
   l'éditeur d'administration le présente : les colonnes d'une ligne, l'aide,
   et le résumé « N éléments (M par partie) » qui signale un contenu
   insuffisant pour les règles.

   Fonctions pures, sans DOM.
   ============================================================================ */
import { pluriel } from '../../socle/outils.js';
import { duree } from '../../pages/jeu/durees.js';
import { SEUIL_COURT_DEFAUT } from './regles-jeux.js';

/**
 * Une colonne : `k` est la clé dans l'élément ; le type choisit le champ.
 * @typedef {object} Colonne
 * @property {string} k
 * @property {'mot' | 'texte' | 'emoji' | 'cat' | 'zone' | 'jours'} type
 * @property {string} titre
 * @property {number} [max]
 * @property {boolean} [large]
 *
 * @typedef {Record<string, string | number>} Element  une ligne du contenu
 */

/** @type {Record<string, Colonne[]>} */
export const COLONNES = {
  'mot-mystere': [
    { k: 'mot', type: 'mot', titre: 'Mot (3 à 12 lettres)' },
    { k: 'indice', type: 'texte', titre: 'Indice', max: 200, large: true },
    { k: 'emoji', type: 'emoji', titre: 'Emoji (ateliers)' },
  ],
  'compost-ou-pas': [
    { k: 'emoji', type: 'emoji', titre: 'Emoji' },
    { k: 'nom', type: 'texte', titre: 'Déchet', max: 80 },
    { k: 'cat', type: 'cat', titre: 'Catégorie' },
    { k: 'info', type: 'zone', titre: 'Explication affichée après la réponse', max: 400 },
  ],
  'temps-decompo': [
    { k: 'emoji', type: 'emoji', titre: 'Emoji' },
    { k: 'nom', type: 'texte', titre: 'Déchet, ex. « un trognon de pomme »', max: 80 },
    { k: 'jours', type: 'jours', titre: 'Durée en jours' },
    { k: 'info', type: 'zone', titre: 'Explication affichée après la réponse', max: 400 },
  ],
};
COLONNES['tri-eclair'] = COLONNES['compost-ou-pas'];

/** @type {Record<string, string>} */
export const AIDES_CONTENU = {
  'mot-mystere': 'Les lettres du mot deviennent les tuiles à remettre dans l\'ordre (accents et caractères spéciaux retirés). L\'emoji ne sert que dans les slides d\'atelier.',
  'compost-ou-pas': 'Chaque partie tire des déchets au hasard dans cette liste.',
  'temps-decompo': 'Question posée : « Combien de temps met <déchet> à se décomposer ? ». Court ou long : d\'après la limite fixée dans les règles.',
  'tri-eclair': 'Chaque partie tire des déchets au hasard dans cette liste.',
};

/** @param {unknown} s */
export function sansAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * La limite court / long des règles, ou celle par défaut si elle est vide.
 * @param {any} regles
 */
export function seuilCourt(regles) {
  const v = regles && Number(regles.seuil_court);
  return Number.isFinite(v) ? v : SEUIL_COURT_DEFAUT;
}

/**
 * « ≈ 3 mois · court », à côté d'une durée saisie ; vide si elle n'en est pas une.
 * @param {string | number} jours
 * @param {number} seuil
 */
export function aideJours(jours, seuil) {
  const j = Number(jours);
  if (jours === '' || !(j >= 1)) return '';
  return '≈ ' + duree(j) + ' · ' + (j <= seuil ? 'court' : 'long');
}

/**
 * Le résumé du contenu, morceau par morceau ; `ko` marque ce qui ne suffit
 * pas aux règles (il en faut au moins autant que par partie).
 * @param {string} slug
 * @param {Element[]} items
 * @param {any} regles
 * @param {Record<string, string> | undefined} categories
 * @returns {{ texte: string, ko: boolean }[]}
 */
export function resumeContenu(slug, items, regles, categories) {
  if (slug === 'temps-decompo') {
    const seuil = seuilCourt(regles);
    const courts = items.filter((i) => i.jours !== '' && Number(i.jours) <= seuil).length;
    const longs = items.filter((i) => i.jours !== '' && Number(i.jours) > seuil).length;
    return [
      { texte: pluriel(courts, 'déchet court', 'déchets courts') + ' (' + (regles.nb_courts || 0) + ' par partie)', ko: courts < regles.nb_courts },
      { texte: ' · ', ko: false },
      { texte: pluriel(longs, 'déchet long', 'déchets longs') + ' (' + (regles.nb_longs || 0) + ' par partie)', ko: longs < regles.nb_longs },
    ];
  }
  const mots = slug === 'mot-mystere';
  const parPartie = mots ? regles.nb_mots : regles.nb_items;
  /** @type {{ texte: string, ko: boolean }[]} */
  const morceaux = [{
    texte: pluriel(items.length, mots ? 'mot' : 'élément', mots ? 'mots' : 'éléments') + ' (' + (parPartie || 0) + ' par partie)',
    ko: items.length < parPartie,
  }];
  if (categories) {
    const parts = Object.entries(categories).map(([v, libelle]) => items.filter((i) => i.cat === v).length + ' ' + libelle.toLowerCase());
    morceaux.push({ texte: ' — ' + parts.join(' · '), ko: false });
  }
  return morceaux;
}

/**
 * La ligne correspond-elle au filtre ? Sans accents ni majuscules, sur tous
 * ses champs (la catégorie par son libellé).
 * @param {Element} item
 * @param {string} filtre
 * @param {Record<string, string> | undefined} categories
 */
export function correspond(item, filtre, categories) {
  const q = sansAccents(filtre.trim());
  if (!q) return true;
  const texte = Object.entries(item).map(([k, v]) => (k === 'cat' && categories ? categories[String(v)] || v : v)).join(' ');
  return sansAccents(texte).includes(q);
}

/**
 * « 25/11/2026 à 14:03 », depuis une date du serveur.
 * @param {string | null | undefined} s
 */
export function dateFr(s) {
  if (!s) return '';
  const [d, h] = s.split(' ');
  return d.split('-').reverse().join('/') + (h ? ' à ' + h.slice(0, 5) : '');
}
