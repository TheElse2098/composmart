/* ============================================================================
   adresses.js — l'adresse des pages d'administration des jeux, en un seul
   endroit : la liste (`ADRESSE_JEUX`) et l'éditeur d'un jeu
   (`ADRESSE_JEUX + '/' + slug`).

   C'est l'adresse provisoire des nouvelles pages, le temps de les valider ;
   elle redevient /jeux-admin à la bascule. Provisoire SOUS /jeux-admin (et
   non /jeux-admin-v2) : seul ce préfixe est routé vers games-api.
   ============================================================================ */
export const ADRESSE_JEUX = '/jeux-admin/v2';
