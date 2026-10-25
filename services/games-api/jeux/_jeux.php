<?php
/**
 * Registre des mini-jeux : forme des règles et du contenu de chacun,
 * validation de ce que l'éditeur envoie, calcul du score maximum.
 *
 * Les jeux eux-mêmes (textes, règles, éléments) vivent dans la table `jeux`
 * de db-games et s'éditent depuis /jeux-admin. Ce fichier ne décrit que ce qui
 * relève du CODE : chaque page jeu-<slug>.html est une mécanique qui attend
 * une forme précise, et on ne crée pas de nouveau jeu depuis l'admin.
 *
 * Rien de ce que le client envoie n'est repris tel quel : chaque champ est
 * relu, borné, et tout champ non prévu est écarté (cf. evenements/_slides.php,
 * même principe).
 */
require_once __DIR__ . '/../_guard.php';

/** Seuil court / long de « Combien de temps ? », en jours (≤ 1 an = court). */
const JEUX_TEMPS_SEUIL_COURT = 365;

function jeux_connexion() {
    mysqli_report(MYSQLI_REPORT_OFF);
    $c = mysqli_connect(
        getenv('DB_HOST') ?: 'db-games',
        getenv('DB_USER') ?: 'composmart',
        getenv('DB_PASSWORD') ?: '',
        getenv('DB_NAME') ?: 'Composmart'
    );
    if ($c) mysqli_set_charset($c, 'utf8mb4');
    return $c;
}

/**
 * Description de chaque jeu, pour la validation ET pour l'éditeur (qui
 * construit ses formulaires à partir de action=jeu → `moteur`).
 * `categories` : valeurs autorisées du champ `cat` des éléments.
 */
function jeux_moteurs() {
    return [
        'mot-mystere' => [
            'consigne' => 'Retrouve le mot à partir de l\'indice.',
        ],
        'compost-ou-pas' => [
            'consigne'   => 'Classe chaque déchet : au compost, avec prudence, ou poubelle.',
            'categories' => ['oui' => 'Au compost', 'attention' => 'Avec prudence', 'non' => 'Poubelle'],
        ],
        'temps-decompo' => [
            'consigne'    => 'Estime la durée de décomposition, en jours.',
            'seuil_court' => JEUX_TEMPS_SEUIL_COURT,
        ],
        'tri-eclair' => [
            'consigne'   => 'Glisse chaque déchet dans le bon bac avant la fin du chrono.',
            'categories' => ['compost' => 'Compost', 'recyclage' => 'Recyclage', 'poubelle' => 'Poubelle'],
        ],
    ];
}

function jeux_slug_valide($slug) {
    return is_string($slug) && array_key_exists($slug, jeux_moteurs());
}

// ── Petits validateurs ─────────────────────────────────────────────────────

/** Texte nettoyé et borné ; null si vide alors qu'obligatoire. */
function jeux_txt($v, $max, $obligatoire = true) {
    $v = is_scalar($v) ? trim((string)$v) : '';
    $v = mb_substr($v, 0, $max);
    return ($v === '' && $obligatoire) ? null : $v;
}

/** Entier borné ; null si absent ou hors bornes (l'éditeur affiche l'erreur). */
function jeux_int($v, $min, $max) {
    if (!is_numeric($v) || (float)$v != (int)$v) return null;
    $v = (int)$v;
    return ($v < $min || $v > $max) ? null : $v;
}

function jeux_num($v, $min, $max) {
    if (!is_numeric($v)) return null;
    $v = round((float)$v, 2);
    return ($v < $min || $v > $max) ? null : $v;
}

/** Mot mystère : majuscules sans accents, lettres seulement (ce sont les tuiles). */
function jeux_normaliser_mot($m) {
    $m = trim((string)$m);
    $t = @iconv('UTF-8', 'ASCII//TRANSLIT', $m);
    if ($t !== false) $m = $t;
    return strtoupper(preg_replace('/[^A-Za-z]/', '', $m));
}

// ── Règles ─────────────────────────────────────────────────────────────────

/**
 * Valide les règles d'un jeu. Renvoie [regles_normalisees, null] ou [null, erreur].
 */
function jeux_valider_regles($slug, $r) {
    $r = is_array($r) ? $r : [];
    switch ($slug) {
        case 'mot-mystere':
            $nb = jeux_int($r['nb_mots'] ?? null, 3, 20);
            if ($nb === null) return [null, 'Nombre de mots par partie : entre 3 et 20.'];
            $p = array_values((array)($r['points'] ?? []));
            $p = array_map(fn($x) => jeux_int($x, 0, 50), array_slice($p, 0, 3));
            if (count($p) !== 3 || in_array(null, $p, true)) return [null, 'Points : trois valeurs entre 0 et 50.'];
            if ($p[0] < 1 || $p[0] < $p[1] || $p[1] < $p[2]) {
                return [null, 'Points : du premier essai au troisième, chaque valeur doit être inférieure ou égale à la précédente (et le premier au moins 1).'];
            }
            return [['nb_mots' => $nb, 'points' => $p], null];

        case 'compost-ou-pas':
            $nb = jeux_int($r['nb_items'] ?? null, 3, 30);
            if ($nb === null) return [null, 'Nombre de déchets par partie : entre 3 et 30.'];
            return [['nb_items' => $nb], null];

        case 'temps-decompo':
            $c = jeux_int($r['nb_courts'] ?? null, 0, 15);
            $l = jeux_int($r['nb_longs'] ?? null, 0, 15);
            if ($c === null || $l === null) return [null, 'Déchets courts et longs par partie : entre 0 et 15 chacun.'];
            if ($c + $l < 3 || $c + $l > 25) return [null, 'Une partie compte entre 3 et 25 déchets au total.'];
            $seuils = [];
            foreach (array_slice(array_values((array)($r['seuils'] ?? [])), 0, 3) as $s) {
                $d = jeux_num($s['d'] ?? null, 0.01, 0.5);
                $pts = jeux_int($s['pts'] ?? null, 0, 10);
                if ($d === null || $pts === null) return [null, 'Paliers : tolérance entre 1 % et 50 %, points entre 0 et 10.'];
                $seuils[] = ['d' => $d, 'pts' => $pts];
            }
            if (count($seuils) !== 3) return [null, 'Il faut exactement trois paliers de précision.'];
            for ($i = 1; $i < 3; $i++) {
                if ($seuils[$i]['d'] <= $seuils[$i - 1]['d'] || $seuils[$i]['pts'] > $seuils[$i - 1]['pts']) {
                    return [null, 'Paliers : chaque palier doit être plus tolérant et rapporter au plus autant que le précédent.'];
                }
            }
            if ($seuils[0]['pts'] < 1) return [null, 'Le meilleur palier doit rapporter au moins 1 point.'];
            return [['nb_courts' => $c, 'nb_longs' => $l, 'seuils' => $seuils], null];

        case 'tri-eclair':
            $nb    = jeux_int($r['nb_items'] ?? null, 3, 40);
            $vies  = jeux_int($r['vies'] ?? null, 1, 10);
            $debut = jeux_num($r['duree_debut'] ?? null, 1, 15);
            $pas   = jeux_num($r['duree_pas'] ?? null, 0, 2);
            $min   = jeux_num($r['duree_min'] ?? null, 0.5, 15);
            if ($nb === null)   return [null, 'Nombre de manches : entre 3 et 40.'];
            if ($vies === null) return [null, 'Nombre de vies : entre 1 et 10.'];
            if ($debut === null || $pas === null || $min === null) {
                return [null, 'Chrono : départ entre 1 et 15 s, accélération entre 0 et 2 s, minimum entre 0,5 et 15 s.'];
            }
            if ($min > $debut) return [null, 'Le chrono minimum ne peut pas dépasser celui du départ.'];
            return [['nb_items' => $nb, 'vies' => $vies, 'duree_debut' => $debut, 'duree_pas' => $pas, 'duree_min' => $min], null];
    }
    return [null, 'Jeu inconnu.'];
}

/** Score maximum d'une partie, déduit des règles (jamais saisi). */
function jeux_score_max($slug, $r) {
    switch ($slug) {
        case 'mot-mystere':    return $r['nb_mots'] * $r['points'][0];
        case 'compost-ou-pas': return $r['nb_items'];
        case 'temps-decompo':  return ($r['nb_courts'] + $r['nb_longs']) * $r['seuils'][0]['pts'];
        case 'tri-eclair':     return $r['nb_items'];
    }
    return 0;
}

// ── Contenu ────────────────────────────────────────────────────────────────

/**
 * Valide les éléments d'un jeu ET vérifie qu'ils suffisent aux règles.
 * Renvoie [items_normalises, null] ou [null, erreur]. Une ligne invalide est
 * une erreur nommée (n° de ligne), pas un élément silencieusement perdu.
 */
function jeux_valider_items($slug, $items, $regles) {
    $items = array_values(is_array($items) ? $items : []);
    if (count($items) > 300) return [null, 'Pas plus de 300 éléments par jeu.'];
    $moteur = jeux_moteurs()[$slug];
    $propres = [];
    foreach ($items as $i => $it) {
        $n = $i + 1;
        $it = is_array($it) ? $it : [];
        $emoji = jeux_txt($it['emoji'] ?? '', 16, false);
        switch ($slug) {
            case 'mot-mystere':
                $mot = jeux_normaliser_mot($it['mot'] ?? '');
                $indice = jeux_txt($it['indice'] ?? null, 200);
                if (strlen($mot) < 3 || strlen($mot) > 12) return [null, "Ligne $n : le mot doit faire de 3 à 12 lettres."];
                if ($indice === null) return [null, "Ligne $n : l'indice est obligatoire."];
                $propres[] = ['mot' => $mot, 'indice' => $indice, 'emoji' => $emoji];
                break;

            case 'compost-ou-pas':
            case 'tri-eclair':
                $nom = jeux_txt($it['nom'] ?? null, 80);
                $cat = $it['cat'] ?? '';
                if ($nom === null) return [null, "Ligne $n : le nom du déchet est obligatoire."];
                if (!is_string($cat) || !array_key_exists($cat, $moteur['categories'])) return [null, "Ligne $n : catégorie inconnue."];
                $propres[] = ['nom' => $nom, 'emoji' => $emoji, 'cat' => $cat, 'info' => jeux_txt($it['info'] ?? '', 400, false)];
                break;

            case 'temps-decompo':
                $nom = jeux_txt($it['nom'] ?? null, 80);
                $jours = jeux_int($it['jours'] ?? null, 1, 365000);
                if ($nom === null) return [null, "Ligne $n : le nom du déchet est obligatoire."];
                if ($jours === null) return [null, "Ligne $n : la durée doit être un nombre entier de jours, entre 1 et 365 000."];
                $propres[] = ['nom' => $nom, 'emoji' => $emoji, 'jours' => $jours, 'info' => jeux_txt($it['info'] ?? '', 400, false)];
                break;
        }
    }

    // Assez d'éléments pour une partie complète (tirage sans remise).
    switch ($slug) {
        case 'mot-mystere':
            if (count($propres) < $regles['nb_mots']) return [null, 'Il faut au moins ' . $regles['nb_mots'] . ' mots pour une partie (' . count($propres) . ' actuellement).'];
            break;
        case 'compost-ou-pas':
        case 'tri-eclair':
            if (count($propres) < $regles['nb_items']) return [null, 'Il faut au moins ' . $regles['nb_items'] . ' déchets pour une partie (' . count($propres) . ' actuellement).'];
            break;
        case 'temps-decompo':
            $courts = count(array_filter($propres, fn($x) => $x['jours'] <= JEUX_TEMPS_SEUIL_COURT));
            $longs  = count($propres) - $courts;
            if ($courts < $regles['nb_courts']) return [null, "Il faut au moins {$regles['nb_courts']} déchets courts (1 an ou moins) : $courts actuellement."];
            if ($longs < $regles['nb_longs'])   return [null, "Il faut au moins {$regles['nb_longs']} déchets longs (plus d'1 an) : $longs actuellement."];
            break;
    }
    return [$propres, null];
}

/**
 * Messages de fin de partie : paliers {min (fraction du score max), emoji,
 * texte}, triés du plus exigeant au plus bas. Un palier à 0 est obligatoire,
 * sinon un petit score n'aurait aucun message.
 */
function jeux_valider_messages($m) {
    $propres = [];
    foreach (array_slice(array_values(is_array($m) ? $m : []), 0, 6) as $i => $x) {
        $x = is_array($x) ? $x : [];
        $min = jeux_num($x['min'] ?? null, 0, 1);
        $texte = jeux_txt($x['texte'] ?? null, 200);
        if ($min === null) return [null, 'Messages de fin : chaque seuil doit être entre 0 et 100 %.'];
        if ($texte === null) return [null, 'Messages de fin : le texte est obligatoire (palier ' . ($i + 1) . ').'];
        $propres[] = ['min' => $min, 'emoji' => jeux_txt($x['emoji'] ?? '', 16, false), 'texte' => $texte];
    }
    usort($propres, fn($a, $b) => $b['min'] <=> $a['min']);
    if (count($propres) < 2) return [null, 'Messages de fin : au moins deux paliers.'];
    if (end($propres)['min'] != 0) return [null, 'Messages de fin : il faut un palier à 0 % (petits scores).'];
    return [$propres, null];
}

// ── Lecture ────────────────────────────────────────────────────────────────

/** Ligne de `jeux` décodée, ou null. */
function jeux_charger($c, $slug) {
    $stmt = mysqli_prepare($c,
        'SELECT slug, nom, emoji, description, statut, ordre, regles, messages, items,
                score_max, xp_reserve, maj_at, maj_par
         FROM jeux WHERE slug = ?');
    if (!$stmt) return null;
    $stmt->bind_param('s', $slug);
    $stmt->execute();
    $j = $stmt->get_result()->fetch_assoc();
    if (!$j) return null;
    return jeux_decoder($j);
}

function jeux_decoder($j) {
    foreach (['regles', 'messages', 'items'] as $k) {
        if (array_key_exists($k, $j)) $j[$k] = json_decode((string)$j[$k], true) ?: [];
    }
    foreach (['ordre', 'score_max', 'xp_reserve'] as $k) {
        if (array_key_exists($k, $j)) $j[$k] = (int)$j[$k];
    }
    return $j;
}

/**
 * Paramètres de score de tous les jeux : slug => [score_max, xp_reserve, statut].
 * Utilisé par score.php à chaque partie : une seule requête, colonnes légères.
 */
function jeux_parametres($c) {
    $out = [];
    $res = mysqli_query($c, 'SELECT slug, score_max, xp_reserve, statut FROM jeux');
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $out[$r['slug']] = ['score_max' => (int)$r['score_max'], 'xp_reserve' => (int)$r['xp_reserve'], 'statut' => $r['statut']];
    }
    return $out;
}
