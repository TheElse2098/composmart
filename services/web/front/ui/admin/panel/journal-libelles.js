/* ============================================================================
   journal-libelles.js — le vocabulaire du journal d'activité.

   Ce que le serveur écrit en codes (`cours_modifie`, `en_attente`, `xp_reserve`)
   et ce que le journal en dit à l'écran. Aucun affichage ici : des tables et
   les fonctions qui les lisent, testées sous Node.

   Ajouter une action journalisée côté serveur (audit_log) :
     1. son libellé dans ACTIONS — sans lui elle s'affiche avec ❔ et son code ;
     2. son préfixe range l'action dans une catégorie du filtre (CATEGORIES) ;
     3. si elle est annulable, son endpoint dans ANNULATIONS.
   ============================================================================ */

/** @typedef {{ icone: string, texte: string }} Libelle */

/** Une entrée par action possible (tous les appels audit_log() des 5 services).
 *  @type {Record<string, Libelle>} */
export const ACTIONS = {
  compost_cree:            { icone: '📍', texte: 'Composteur ajouté' },
  compost_demande:         { icone: '🌱', texte: "Demande d'ajout" },
  compost_valide:          { icone: '✅', texte: 'Demande validée' },
  compost_refuse:          { icone: '⛔', texte: 'Demande refusée' },
  compost_modifie:         { icone: '✏️', texte: 'Composteur modifié' },
  compost_supprime:        { icone: '🗑️', texte: 'Composteur supprimé' },
  signalement_cree:        { icone: '🚩', texte: 'Signalement créé' },
  signalement_resolu:      { icone: '✔️', texte: 'Signalement résolu' },
  signalement_rejete:      { icone: '✖️', texte: 'Signalement rejeté' },
  user_promu:              { icone: '⬆️', texte: 'Utilisateur promu admin' },
  user_retrograde:         { icone: '⬇️', texte: 'Admin rétrogradé' },
  user_supprime:           { icone: '🚫', texte: 'Utilisateur supprimé' },
  compte_supprime:         { icone: '👋', texte: 'Compte supprimé par son titulaire' },
  compte_purge:            { icone: '🧹', texte: 'Compte purgé (RGPD)' },
  mdp_reinitialise:        { icone: '🔑', texte: 'Mot de passe réinitialisé' },
  email_modifie:           { icone: '📮', texte: 'Adresse email changée' },
  mail_envoye:             { icone: '📧', texte: 'Email envoyé' },
  cours_cree:              { icone: '📚', texte: 'Cours créé' },
  cours_modifie:           { icone: '📝', texte: 'Cours modifié' },
  cours_supprime:          { icone: '🗑️', texte: 'Cours supprimé' },
  cours_reorganises:       { icone: '🔀', texte: 'Cours réorganisés' },
  theme_cree:              { icone: '🗂️', texte: 'Thème créé' },
  theme_modifie:           { icone: '🖊️', texte: 'Thème modifié' },
  theme_supprime:          { icone: '🗑️', texte: 'Thème supprimé' },
  media_televerse:         { icone: '🖼️', texte: 'Média téléversé' },
  ticket_repondu:          { icone: '💬', texte: 'Réponse à un ticket' },
  ticket_rouvert:          { icone: '🔓', texte: 'Ticket rouvert' },
  ticket_clos:             { icone: '🔒', texte: 'Ticket clos' },
  ticket_ferme_definitif:  { icone: '⛔', texte: 'Ticket fermé définitivement' },
  evenement_cree:          { icone: '🎉', texte: 'Événement créé' },
  evenement_ouvert:        { icone: '📢', texte: 'Inscriptions ouvertes' },
  evenement_prevu:         { icone: '📅', texte: 'Événement reprévu' },
  evenement_en_cours:      { icone: '▶️', texte: 'Événement démarré' },
  evenement_termine:       { icone: '🏁', texte: 'Événement terminé' },
  evenement_annule:        { icone: '🚫', texte: 'Événement annulé' },
  evenement_supprime:      { icone: '🗑️', texte: 'Événement supprimé' },
  evenement_restaure:      { icone: '♻️', texte: 'Événement restauré' },
  evenement_parcours_affecte: { icone: '🧭', texte: 'Parcours affecté à un atelier' },
  evenement_parcours_ajoute:  { icone: '➕', texte: 'Parcours enchaîné dans un atelier' },
  evenement_equipes:       { icone: '👥', texte: 'Équipes définies' },
  evenement_repartition:   { icone: '🎲', texte: 'Équipes réparties au hasard' },
  evenement_image_ajoutee: { icone: '🖼️', texte: 'Image ajoutée à la banque' },
  evenement_image_supprimee: { icone: '🗑️', texte: 'Image supprimée de la banque' },
  parcours_cree:           { icone: '🧩', texte: 'Parcours créé' },
  parcours_modifie:        { icone: '✏️', texte: 'Parcours modifié' },
  parcours_duplique:       { icone: '📑', texte: 'Parcours dupliqué' },
  parcours_supprime:       { icone: '🗑️', texte: 'Parcours supprimé' },
  parcours_slide_modifiee: { icone: '📝', texte: 'Slide de parcours modifiée' },
  parcours_slide_supprimee: { icone: '🗑️', texte: 'Slide de parcours supprimée' },
  evenement_slide_modifiee: { icone: '📝', texte: "Slide d'atelier modifiée" },
  evenement_slide_supprimee: { icone: '🗑️', texte: "Slide d'atelier supprimée" },
  anecdote_modifiee:       { icone: '💡', texte: 'Anecdote modifiée' },
  anecdote_supprimee:      { icone: '🗑️', texte: 'Anecdote supprimée' },
  // Actions écrites par une annulation depuis le journal
  cours_restaure:          { icone: '⏪', texte: 'Cours remis à une version précédente' },
  cours_retabli:           { icone: '♻️', texte: 'Cours rétabli' },
  theme_retabli:           { icone: '♻️', texte: 'Thème rétabli' },
  compost_remis_en_attente: { icone: '⏳', texte: 'Demande remise en attente' },
  compost_retabli:         { icone: '♻️', texte: 'Composteur rétabli' },
  signalement_rouvert:     { icone: '🔁', texte: 'Signalement rouvert' },
  parcours_retabli:        { icone: '♻️', texte: 'Parcours rétabli' },
  parcours_slide_retablie: { icone: '♻️', texte: 'Slide de parcours rétablie' },
  evenement_slide_retablie: { icone: '♻️', texte: "Slide d'atelier rétablie" },
  anecdote_retablie:       { icone: '♻️', texte: 'Anecdote rétablie' },
  jeu_modifie:             { icone: '🕹️', texte: 'Jeu modifié' },
  jeu_restaure:            { icone: '⏪', texte: 'Version de jeu restaurée' },
  jeux_ordre:              { icone: '🔀', texte: 'Jeux réordonnés' },
};

/**
 * Catégories du filtre : 8 entrées au lieu d'une par action. Une action est
 * rangée par son préfixe, ce qui classe d'office une action future ; seule une
 * action au préfixe inconnu tombe dans « Autres », où elle se voit avec son
 * code brut au lieu de se perdre.
 * @type {{ id: string, icone: string, texte: string, prefixes: string[] }[]}
 */
export const CATEGORIES = [
  { id: 'carte',    icone: '🗺️', texte: 'Carte',    prefixes: ['compost_', 'signalement_'] },
  { id: 'cours',    icone: '📚', texte: 'Cours',    prefixes: ['cours_', 'theme_', 'media_'] },
  { id: 'jeux',     icone: '🎮', texte: 'Jeux',     prefixes: ['jeu_', 'jeux_'] },
  { id: 'ateliers', icone: '🎉', texte: 'Ateliers', prefixes: ['evenement_', 'parcours_', 'anecdote_'] },
  { id: 'comptes',  icone: '👤', texte: 'Comptes',  prefixes: ['user_', 'compte_', 'mdp_', 'email_'] },
  { id: 'support',  icone: '💬', texte: 'Support',  prefixes: ['ticket_'] },
  { id: 'emails',   icone: '📧', texte: 'Emails',   prefixes: ['mail_'] },
  { id: 'autres',   icone: '❔', texte: 'Autres',   prefixes: [] },
];

/** Noms lisibles des champs d'un avant/après. @type {Record<string, string>} */
export const CHAMPS = {
  titre: 'Titre', theme: 'Thème', emoji: 'Emoji', description: 'Description', niveau: 'Niveau',
  xp: 'XP', xp_reserve: "Réserve d'XP", score_max: 'Score max', statut: 'Statut', nom: 'Nom',
  couleur: 'Couleur', slug: 'Adresse', type: 'Type', acces: 'Accès', gestion: 'Gestionnaire',
  info_gestion: 'Contact du gestionnaire', mettre: 'Autorisé', pas_mettre: 'Interdit',
  admin: 'Administrateur', deroule: 'Déroulé', equipes: 'Équipes', ordre: 'Ordre', points: 'Points',
  texte: 'Texte', mots: 'Mots-clés', items: 'Contenu du jeu', regles: 'Règles', messages: 'Messages',
  lat: 'Latitude', lon: 'Longitude', propose_par: 'Proposé par', created_at: 'Créé le',
  cree_par: 'Créé par', mime: 'Format', taille: 'Taille (octets)', largeur: 'Largeur', hauteur: 'Hauteur',
  video: 'Vidéo', podcast: 'Podcast', quiz: 'Quiz', slides: 'Slides', parcours: 'Parcours',
  contenu: 'Contenu', url: 'Adresse', auteur: 'Auteur', duree: 'Durée', question: 'Question',
  options: 'Réponses proposées', evenement_id: 'Atelier', parcours_id: 'Parcours',
  supprime: 'Supprimé', slides_non_retablies: 'Slides non rétablies',
};

/** Valeurs codées des champs `statut` et `niveau`. @type {Record<string, string>} */
export const VALEURS = {
  prevu: 'Prévu', ouvert: 'Ouvert', en_cours: 'En cours', termine: 'Terminé', annule: 'Annulé',
  brouillon: 'Brouillon', publie: 'Publié', archive: 'Archivé', clos: 'Clos',
  clos_definitif: 'Fermé définitivement', resolu: 'Résolu', rejete: 'Rejeté', valide: 'Validé',
  refuse: 'Refusé', en_attente: 'En attente', debutant: 'Débutant', intermediaire: 'Intermédiaire',
  expert: 'Expert',
};

/** @typedef {'admin' | 'carte' | 'jeux' | 'evenements'} Service */

/**
 * Annulation : l'endpoint du service qui possède les données. Le serveur relit
 * l'entrée et décide de tout ; cette table dit seulement où envoyer la demande
 * et quand proposer le bouton.
 * @type {Record<string, { service: Service, fichier: string }>}
 */
export const ANNULATIONS = {};
/** @type {[Service, string, string[]][]} */
const OU_ANNULER = [
  ['admin', 'annuler.php', ['cours_modifie', 'cours_restaure', 'cours_supprime', 'cours_reorganises',
    'theme_modifie', 'theme_supprime', 'user_promu', 'user_retrograde', 'ticket_clos', 'ticket_rouvert']],
  ['carte', 'pending.php', ['compost_valide', 'compost_refuse', 'compost_modifie', 'compost_supprime']],
  ['carte', 'signalement.php', ['signalement_resolu', 'signalement_rejete']],
  ['jeux', 'admin.php', ['jeu_modifie', 'jeu_restaure', 'jeux_ordre']],
  ['evenements', 'admin.php', ['evenement_ouvert', 'evenement_prevu', 'evenement_en_cours', 'evenement_termine',
    'evenement_annule', 'evenement_supprime', 'evenement_restaure', 'evenement_slide_modifiee', 'evenement_slide_supprimee']],
  ['evenements', 'parcours.php', ['parcours_modifie', 'parcours_supprime', 'parcours_slide_modifiee', 'parcours_slide_supprimee']],
  ['evenements', 'anecdotes.php', ['anecdote_modifiee', 'anecdote_supprimee']],
];
for (const [service, fichier, actions] of OU_ANNULER) {
  for (const action of actions) ANNULATIONS[action] = { service, fichier };
}

/** Ce que la confirmation d'une annulation précise, au-delà de la règle commune.
 *  @type {Record<string, string>} */
export const PRECISIONS_ANNULATION = {
  cours_supprime: 'Le cours revient avec son texte et son quiz. La progression des lecteurs, effacée à la suppression, ne revient pas.',
  compost_supprime: 'Le composteur revient avec son numéro, sa position et ses règles.',
  compost_valide: 'Les composteurs repartent en attente et disparaissent de la carte publique.',
  parcours_supprime: 'Le parcours revient avec ses slides, sous un nouveau numéro.',
  anecdote_supprimee: "L'anecdote revient sous un nouveau numéro : les slides qui la visaient ne la retrouvent pas.",
  evenement_en_cours: "L'atelier quitte l'état « en cours » : les participants connectés le verront.",
  evenement_termine: "L'atelier redevient « en cours ».",
};

/** Actions dont une entrée récente porte un avant/après : sans lui, c'est une
 *  entrée écrite avant que le journal ne le conserve (26/10/2026). */
export const AVEC_AVANT_APRES = /^(cours_modifie|cours_reorganises|theme_modifie|compost_modifie|signalement_resolu|signalement_rejete|user_promu|user_retrograde|ticket_clos|ticket_rouvert|ticket_ferme_definitif|jeu_modifie|jeu_restaure|jeux_ordre|parcours_modifie|evenement_(ouvert|prevu|en_cours|termine|annule|equipes|parcours_affecte))$/;

/**
 * @param {string} action
 * @returns {Libelle} une action inconnue garde son code, précédé de ❔
 */
export function libelleAction(action) {
  return ACTIONS[action] || { icone: '❔', texte: action };
}

/**
 * @param {string} action
 * @returns {string} identifiant de sa catégorie
 */
export function categorieDe(action) {
  const categorie = CATEGORIES.find((c) => c.prefixes.some((p) => action.startsWith(p)));
  return categorie ? categorie.id : 'autres';
}

/**
 * `xp_reserve` → « Réserve d'XP » ; `video.url` → « Vidéo › Adresse ».
 * @param {string | number} cle
 * @returns {string}
 */
export function libelleChamp(cle) {
  const k = String(cle);
  const i = k.indexOf('.');
  if (i < 0) return CHAMPS[k] || k.replace(/_/g, ' ');
  const base = k.slice(0, i);
  const sous = k.slice(i + 1);
  return (CHAMPS[base] || base) + ' › ' + (CHAMPS[sous] || sous.replace(/_/g, ' '));
}

/** « 2026-10-26T14:03:12 » → « 2026-10-26 14:03 ». @param {string | null | undefined} date */
export function dateJournal(date) {
  return (date || '').replace('T', ' ').slice(0, 16);
}

/**
 * Le bouton d'annulation n'est proposé que si l'entrée porte de quoi revenir
 * en arrière : les entrées antérieures au 26/10/2026 ne l'ont pas.
 * @param {{ action: string, annule_at?: string | null, snapshot?: any }} entree
 * @returns {boolean}
 */
export function annulable(entree) {
  const s = entree.snapshot || {};
  return !!ANNULATIONS[entree.action] && !entree.annule_at && !!(s.version_id || s.changements || s.etat);
}
