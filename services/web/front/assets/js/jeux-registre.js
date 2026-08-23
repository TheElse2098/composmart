/* ============================================================================
   jeux-registre.js — liste canonique des mini-jeux du site.

   Source UNIQUE : jeux.html (le hub) et index.html (le chiffre "N mini-jeux"
   de la page d'accueil) lisent tous les deux ce fichier plutôt que de garder
   chacun leur propre copie de la liste. C'est justement une copie oubliée qui
   a fait afficher « 2 » sur l'accueil alors que le site en comptait déjà 4 —
   dupliquer la même connaissance à deux endroits garantit qu'elle finit par
   diverger le jour où on n'a mis à jour qu'un des deux.

   Pour ajouter un jeu : créer front/jeu-<slug>.html, ajouter le slug dans
   api/jeux/score.php ($JEUX_VALIDES/$JEUX_XP/$JEUX_MAX) et UNE entrée ici.
   ============================================================================ */
const JEUX = [
  {
    slug: 'mot-mystere',
    emoji: '🔤',
    nom: 'Mot mystère',
    desc: 'Reconstitue les mots du compostage à partir de lettres mélangées.',
    url: '/jeu-mot-mystere',
    scoreMax: 80
  },
  {
    slug: 'compost-ou-pas',
    emoji: '♻️',
    nom: 'Compost ou pas ?',
    desc: 'Décide si chaque déchet va au compost ou à la poubelle.',
    url: '/jeu-compost-ou-pas',
    scoreMax: 12
  },
  {
    slug: 'temps-decompo',
    emoji: '⏳',
    nom: 'Combien de temps ?',
    desc: 'Devine combien de temps chaque déchet met à se décomposer.',
    url: '/jeu-temps-decompo',
    scoreMax: 30
  },
  {
    slug: 'tri-eclair',
    emoji: '⚡',
    nom: 'Tri éclair',
    desc: 'Glisse chaque déchet dans le bon bac avant que le temps ne s\'écoule.',
    url: '/jeu-tri-eclair',
    scoreMax: 15
  }
];
