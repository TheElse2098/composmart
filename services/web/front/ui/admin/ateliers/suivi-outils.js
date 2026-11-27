/* ============================================================================
   suivi-outils.js — les calculs de la console de suivi d'un atelier, sans
   affichage : testables sous Node.
   ============================================================================ */

/** Intervalle du sondage de la console : compteurs, réponses et classement
 *  suivent l'atelier sans action de l'animateur. */
export const SONDAGE_MS = 3000;

/** Le libellé de statut, tel que la console l'affiche. */
export const STATUTS_SUIVI = { prevu: 'Prévu', ouvert: 'Ouvert aux inscriptions', en_cours: 'En cours', termine: 'Terminé', annule: 'Annulé' };

/** Types dont les réponses s'affichent en barres. */
const A_BARRES = ['quiz', 'sondage', 'vrai_faux'];
/** Types notés à la main par l'animateur. */
const NOTATION_MANUELLE = ['defi', 'question_ouverte'];

/**
 * L'événement suivi, d'après l'adresse (/evenements-admin/<id>), ou null.
 * @param {string} chemin
 * @returns {number | null}
 */
export function evenementDe(chemin) {
  const m = chemin.match(/\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
}

/**
 * L'adresse que les participants ouvrent (et que le QR code porte).
 * @param {string} origine  location.origin
 * @param {string} code
 */
export function lienRejoindre(origine, code) {
  return origine + '/evenement?code=' + encodeURIComponent(code);
}

/**
 * Une couleur d'équipe utilisable telle quelle dans un style, ou null.
 * @param {unknown} couleur
 * @returns {string | null}
 */
export function couleurSure(couleur) {
  return typeof couleur === 'string' && /^#[0-9a-f]{3,8}$/i.test(couleur) ? couleur : null;
}

/**
 * Le déroulé se retouche-t-il encore ? Seulement avant le démarrage. Le
 * serveur applique la règle complète (il regarde aussi les réponses reçues) ;
 * ici on décide seulement quoi montrer.
 * @param {{ statut: string, supprime: boolean }} evt
 */
export function derouleOuvert(evt) {
  return ['prevu', 'ouvert'].includes(evt.statut) && !evt.supprime;
}

/**
 * La zone des réponses est-elle utile pour cette slide ? Les types notés à la
 * main s'affichent même sans réponse (un défi ne se répond pas depuis le
 * téléphone), les barres dès la question posée, à zéro.
 * @param {{ type: string } | null} slide
 * @param {number} nbReponses
 */
export function montrerResultats(slide, nbReponses) {
  if (!slide) return false;
  return nbReponses > 0 || NOTATION_MANUELLE.includes(slide.type) || A_BARRES.includes(slide.type);
}

/**
 * La carte affiche-t-elle un classement vivant (à suivre à chaque sondage) ?
 * @param {{ type: string, contenu?: any } | null} slide
 */
export function slideAvecClassement(slide) {
  if (!slide) return false;
  return slide.type === 'classement' || (slide.type === 'fin' && !!(slide.contenu || {}).afficher_classement);
}

/**
 * @typedef {object} Resultats  Réponse de animation.php?action=resultats.
 * @property {string} type
 * @property {any} contenu
 * @property {number} points
 * @property {{ participant_id: number, nom: string, equipe_id: number | null, reponse: any, points: number, correct: boolean | null }[]} reponses
 * @property {Record<string, number>} repartition
 *
 * @typedef {{ libelle: string, nb: number, pct: number, juste: boolean, tete: boolean }} Barre
 */

/**
 * Les barres d'un quiz, d'un vrai/faux ou d'un sondage. Le pourcentage est
 * celui des RÉPONDANTS, pas des voix : à plusieurs bonnes réponses, une
 * personne coche plusieurs cases, et la somme dépasse alors 100 % — c'est le
 * chiffre utile (« 80 % ont coché les épluchures »).
 * @param {Resultats} d
 * @returns {{ repondants: number, multi: boolean, barres: Barre[] } | null}
 */
export function barresResultats(d) {
  if (!A_BARRES.includes(d.type)) return null;
  const contenu = d.contenu || {};
  const options = d.type === 'vrai_faux' ? ['Faux', 'Vrai'] : (contenu.options || []);
  // Les clés de répartition sont normalisées en '0', '1'… côté serveur.
  const nbs = options.map((/** @type {unknown} */ _o, /** @type {number} */ i) => (d.repartition || {})[String(i)] || 0);
  const repondants = (d.reponses || []).length;
  const multi = Array.isArray(contenu.correct);
  const max = Math.max(0, ...nbs);
  const barres = options.map((/** @type {unknown} */ o, /** @type {number} */ i) => {
    const nb = nbs[i];
    const juste = d.type === 'vrai_faux' ? Boolean(contenu.correct) === (i === 1)
      : multi ? contenu.correct.includes(i)
      : contenu.correct === i;
    return {
      libelle: String(o),
      nb,
      pct: repondants ? Math.round(nb / repondants * 100) : 0,
      // Un sondage n'a pas de bonne réponse : on distingue l'option en tête.
      juste: d.type !== 'sondage' && juste,
      tete: d.type === 'sondage' && nb > 0 && nb === max,
    };
  });
  return { repondants, multi, barres };
}

/**
 * Heure d'arrivée d'un participant, « 14:05 ».
 * @param {string} sql
 */
export function heureArrivee(sql) {
  return new Date(String(sql).replace(' ', 'T')).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
