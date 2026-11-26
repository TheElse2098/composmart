/* ============================================================================
   regles-jeux.js — les règles de chaque mini-jeu, telles que l'éditeur
   d'administration les présente : les champs du formulaire, la façon de les
   relire, et le score maximum d'une partie.

   Ajouter un jeu, ou un réglage à un jeu, ne touche que ce fichier (et
   contenu-jeux.js pour ses colonnes) : l'éditeur construit le formulaire à
   partir de ces descriptions.

   Le score maximum est calculé ici comme sur le serveur
   (games-api/jeux/_jeux.php, jeux_score_max), pour l'afficher en direct et
   prévenir avant une conversion des parties déjà jouées. C'est le serveur qui
   fait foi à l'enregistrement ; il valide aussi chaque valeur et renvoie une
   erreur nommée.

   Fonctions pures, sans DOM.
   ============================================================================ */

/**
 * Un champ de règle. `id` le désigne dans le formulaire ; `texte` : un champ
 * texte (sinon un nombre).
 * @typedef {object} ChampRegle
 * @property {string} id
 * @property {string} titre
 * @property {number | string} valeur
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [pas]
 * @property {string} [aide]
 * @property {boolean} [texte]
 * @property {number} [longueur]  longueur maximale d'un champ texte
 *
 * Un bloc du formulaire : un champ seul, ou une rangée de champs.
 * @typedef {ChampRegle | ChampRegle[]} BlocRegle
 *
 * Ce qu'il faut pour relire le formulaire : un nombre (NaN si vide), un texte.
 * @typedef {{ nombre: (id: string) => number, texte: (id: string) => string }} Lecteur
 *
 * @typedef {object} DescriptionRegles
 * @property {string} aide
 * @property {(r: any) => BlocRegle[]} blocs
 * @property {(l: Lecteur) => any} lire  les règles telles qu'envoyées au serveur
 * @property {(r: any) => number} max    score maximum d'une partie
 */

/** Limite court / long par défaut de « Combien de temps ? », en jours. */
export const SEUIL_COURT_DEFAUT = 365;

/** @type {Record<string, DescriptionRegles>} */
export const REGLES = {
  'mot-mystere': {
    aide: 'Chaque mot rapporte plus s\'il est trouvé du premier coup.',
    blocs: (r) => [
      { id: 'nb', titre: 'Mots par partie', valeur: r.nb_mots, min: 3, max: 20 },
      [
        { id: 'p0', titre: 'Points · 1er essai', valeur: r.points[0], min: 1, max: 50 },
        { id: 'p1', titre: '2e essai', valeur: r.points[1], min: 0, max: 50 },
        { id: 'p2', titre: '3e essai et +', valeur: r.points[2], min: 0, max: 50 },
      ],
    ],
    lire: (l) => ({ nb_mots: l.nombre('nb'), points: [l.nombre('p0'), l.nombre('p1'), l.nombre('p2')] }),
    max: (r) => r.nb_mots * r.points[0],
  },
  'compost-ou-pas': {
    aide: 'Les déchets d\'une partie sont tirés au hasard dans le contenu ; 1 point par bonne réponse.',
    blocs: (r) => [{ id: 'nb', titre: 'Déchets par partie', valeur: r.nb_items, min: 3, max: 30 }],
    lire: (l) => ({ nb_items: l.nombre('nb') }),
    max: (r) => r.nb_items,
  },
  'temps-decompo': {
    aide: 'Une partie mélange des déchets courts et longs (la limite se règle ici). Sur la ligne (échelle logarithmique, 1 jour → 1000 ans), plus l\'estimation est proche, plus elle rapporte.',
    blocs: (r) => {
      const noms = ['Palier 1 (le plus précis)', 'Palier 2', 'Palier 3 (le plus large)'];
      /** @type {BlocRegle[]} */
      const blocs = [
        [
          { id: 'courts', titre: 'Déchets courts', valeur: r.nb_courts, min: 0, max: 15 },
          { id: 'longs', titre: 'Déchets longs', valeur: r.nb_longs, min: 0, max: 15 },
        ],
        { id: 'seuil', titre: 'Limite court / long (jours)', valeur: r.seuil_court ?? SEUIL_COURT_DEFAUT, min: 7, max: 36500,
          aide: 'Un déchet est « court » s\'il se décompose en ce nombre de jours ou moins (365 = 1 an).' },
      ];
      r.seuils.forEach((/** @type {{ d: number, pts: number, label: string }} */ s, /** @type {number} */ i) => {
        blocs.push([
          { id: 'd' + i, titre: noms[i] + ' · tolérance %', valeur: Math.round(s.d * 100), min: 1, max: 50,
            aide: i === 0 ? 'Écart maximal, en % de la largeur de la ligne.' : '' },
          { id: 'pts' + i, titre: 'Points', valeur: s.pts, min: 0, max: 10 },
        ]);
        blocs.push({ id: 'label' + i, titre: 'Message du palier ' + (i + 1), valeur: s.label || '', texte: true, longueur: 60 });
      });
      return blocs;
    },
    lire: (l) => ({
      nb_courts: l.nombre('courts'),
      nb_longs: l.nombre('longs'),
      seuil_court: l.nombre('seuil'),
      seuils: [0, 1, 2].map((i) => ({ d: l.nombre('d' + i) / 100, pts: l.nombre('pts' + i), label: l.texte('label' + i) })),
    }),
    max: (r) => (r.nb_courts + r.nb_longs) * r.seuils[0].pts,
  },
  'tri-eclair': {
    aide: '1 point par déchet bien trié. Le chrono part de la durée de départ et se resserre à chaque manche, sans descendre sous le minimum.',
    blocs: (r) => [
      [
        { id: 'nb', titre: 'Manches', valeur: r.nb_items, min: 3, max: 40 },
        { id: 'vies', titre: 'Vies', valeur: r.vies, min: 1, max: 10 },
      ],
      [
        { id: 'debut', titre: 'Chrono départ (s)', valeur: r.duree_debut, min: 1, max: 15, pas: 0.05 },
        { id: 'pas', titre: 'Accélération (s/manche)', valeur: r.duree_pas, min: 0, max: 2, pas: 0.01 },
        { id: 'min', titre: 'Chrono minimum (s)', valeur: r.duree_min, min: 0.5, max: 15, pas: 0.05 },
      ],
    ],
    lire: (l) => ({ nb_items: l.nombre('nb'), vies: l.nombre('vies'), duree_debut: l.nombre('debut'), duree_pas: l.nombre('pas'), duree_min: l.nombre('min') }),
    max: (r) => r.nb_items,
  },
};

/**
 * Le score maximum d'une partie, ou NaN si une valeur manque.
 * @param {string} slug
 * @param {any} regles
 */
export function scoreMax(slug, regles) {
  const description = REGLES[slug];
  return description ? Number(description.max(regles)) : NaN;
}

/**
 * La phrase qui prévient d'une conversion des parties déjà jouées, ou vide.
 * @param {number} avant
 * @param {number} apres
 * @param {number} parties
 */
export function avisConversion(avant, apres, parties) {
  if (!Number.isFinite(apres) || apres <= 0 || apres === avant || parties <= 0) return '';
  return 'Il passera de ' + avant + ' à ' + apres + ' : les '
    + (parties > 1 ? parties + ' parties déjà jouées seront converties' : parties + ' partie déjà jouée sera convertie')
    + ' à la nouvelle échelle (' + avant + '/' + avant + ' → ' + apres + '/' + apres + ').';
}
