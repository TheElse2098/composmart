<?php
/**
 * Parcourt content/cours/ et peuple les tables themes + cours en DB.
 * Appelé depuis seed.php au démarrage.
 */

$host = getenv('DB_HOST') ?: 'db';
$user = getenv('DB_USER') ?: 'composmart';
$pass = getenv('DB_PASSWORD') ?: '';
$name = getenv('DB_NAME') ?: 'Composmart';

$c = mysqli_connect($host, $user, $pass, $name);
if (!$c) die("import_cours: connexion DB impossible.\n");

$content_dir = '/var/www/html/content/cours';
if (!is_dir($content_dir)) {
    echo "import_cours: dossier $content_dir absent, import ignoré.\n";
    mysqli_close($c);
    exit(0);
}

$dirs = glob("$content_dir/*/meta.json");
if (empty($dirs)) {
    echo "import_cours: aucun cours trouvé dans $content_dir.\n";
    mysqli_close($c);
    exit(0);
}

$themes_cache = [];

foreach ($dirs as $meta_file) {
    $slug_dir = basename(dirname($meta_file));
    $meta = json_decode(file_get_contents($meta_file), true);
    if (!$meta) {
        echo "import_cours: meta.json invalide pour $slug_dir, ignoré.\n";
        continue;
    }

    $cours_slug   = $slug_dir;
    $theme_slug   = $meta['theme_slug'] ?? 'general';
    $titre        = $meta['titre']       ?? $slug_dir;
    $description  = $meta['description'] ?? '';
    $emoji        = $meta['emoji']       ?? '📖';
    $niveau       = in_array($meta['niveau'] ?? '', ['debutant','intermediaire','expert'])
                    ? $meta['niveau'] : 'debutant';
    $xp_reward    = intval($meta['xp']   ?? 50);
    $ordre        = intval($meta['ordre'] ?? 0);

    // Détecter les médias disponibles
    $dir = dirname($meta_file);
    $has_text    = (int) file_exists("$dir/texte.md");
    $has_video   = (int) file_exists("$dir/video.json");
    $has_podcast = (int) file_exists("$dir/podcast.json");
    $nb_questions = 0;
    if (file_exists("$dir/quiz.json")) {
        $quiz = json_decode(file_get_contents("$dir/quiz.json"), true);
        $nb_questions = is_array($quiz) ? count($quiz) : 0;
    }

    // Insérer ou retrouver le thème
    if (!isset($themes_cache[$theme_slug])) {
        $ts = mysqli_real_escape_string($c, $theme_slug);
        $res = mysqli_query($c, "SELECT id FROM themes WHERE slug='$ts'");
        if ($row = mysqli_fetch_assoc($res)) {
            $themes_cache[$theme_slug] = $row['id'];
        } else {
            $theme_meta_file = "$content_dir/../themes/$theme_slug.json";
            $theme_nom    = $theme_slug;
            $theme_emoji  = '📂';
            $theme_couleur = 'linear-gradient(135deg,#1e6e3e,#2d9959)';
            $theme_description = null;
            $theme_ordre  = 0;
            if (file_exists($theme_meta_file)) {
                $tm = json_decode(file_get_contents($theme_meta_file), true);
                $theme_nom    = $tm['nom']    ?? $theme_slug;
                $theme_emoji  = $tm['emoji']  ?? '📂';
                $theme_couleur = $tm['couleur'] ?? $theme_couleur;
                $theme_description = $tm['description'] ?? null;
                $theme_ordre  = intval($tm['ordre'] ?? 0);
            }
            $tn = mysqli_real_escape_string($c, $theme_nom);
            $te = mysqli_real_escape_string($c, $theme_emoji);
            $tc = mysqli_real_escape_string($c, $theme_couleur);
            $td = $theme_description !== null ? "'" . mysqli_real_escape_string($c, $theme_description) . "'" : 'NULL';
            mysqli_query($c, "INSERT INTO themes (slug,nom,emoji,couleur,description,ordre)
                              VALUES ('$ts','$tn','$te','$tc',$td,$theme_ordre)
                              ON DUPLICATE KEY UPDATE nom='$tn',emoji='$te',couleur='$tc',description=$td,ordre=$theme_ordre");
            $res2 = mysqli_query($c, "SELECT id FROM themes WHERE slug='$ts'");
            $themes_cache[$theme_slug] = mysqli_fetch_assoc($res2)['id'];
        }
    }
    $theme_id = $themes_cache[$theme_slug];

    // Insérer ou mettre à jour le cours
    $cs  = mysqli_real_escape_string($c, $cours_slug);
    $ct  = mysqli_real_escape_string($c, $titre);
    $cd  = mysqli_real_escape_string($c, $description);
    $ce  = mysqli_real_escape_string($c, $emoji);
    $cn  = mysqli_real_escape_string($c, $niveau);

    mysqli_query($c, "INSERT INTO cours
        (slug,theme_id,titre,description,emoji,niveau,xp_reward,has_text,has_video,has_podcast,nb_questions,ordre)
        VALUES ('$cs',$theme_id,'$ct','$cd','$ce','$cn',$xp_reward,$has_text,$has_video,$has_podcast,$nb_questions,$ordre)
        ON DUPLICATE KEY UPDATE
          theme_id=$theme_id, titre='$ct', description='$cd', emoji='$ce',
          niveau='$cn', xp_reward=$xp_reward, has_text=$has_text,
          has_video=$has_video, has_podcast=$has_podcast,
          nb_questions=$nb_questions, ordre=$ordre");

    echo "import_cours: [$cours_slug] OK (thème: $theme_slug)\n";
}

// ── Rattrapage des admins ───────────────────────────────────────────────────
// launchpad.php valide tous les cours d'office à la création du compte admin,
// mais une seule fois. Sans ce rattrapage, un cours ajouté ensuite reste
// « non terminé » pour les admins existants : leur profil affiche 8/9 et le
// badge « Expert compost » (terminer tous les cours) se reverrouille.
function table_existe($c, $nom) {
    $n = mysqli_real_escape_string($c, $nom);
    $r = mysqli_query($c, "SHOW TABLES LIKE '$n'");
    return $r && mysqli_num_rows($r) > 0;
}
$a_xp_log = table_existe($c, 'xp_log');

$res_admins = mysqli_query($c, 'SELECT id FROM users WHERE isAdmin = 1');
while ($res_admins && ($admin = mysqli_fetch_assoc($res_admins))) {
    $uid = (int)$admin['id'];

    // Cours pas encore validés pour cet admin
    $res_manq = mysqli_query($c,
        "SELECT c.slug, c.titre, c.xp_reward
         FROM cours c
         LEFT JOIN user_progress up ON up.cours_id = c.slug AND up.user_id = $uid
         WHERE up.id IS NULL");

    $valeurs = [];
    $xp_gain = 0;
    $journal = [];
    while ($res_manq && ($r = mysqli_fetch_assoc($res_manq))) {
        $slug      = mysqli_real_escape_string($c, $r['slug']);
        $titre     = mysqli_real_escape_string($c, $r['titre']);
        $xp        = (int)$r['xp_reward'];
        $valeurs[] = "($uid, '$slug')";
        $journal[] = "($uid, $xp, 'cours', '$titre')";
        $xp_gain  += $xp;
    }
    if (!$valeurs) continue;

    mysqli_query($c, 'INSERT IGNORE INTO user_progress (user_id, cours_id) VALUES ' . implode(',', $valeurs));
    // XP ajoutée et non écrasée : préserve celle gagnée par ailleurs (jeux).
    mysqli_query($c, "UPDATE users SET xp = xp + $xp_gain WHERE id = $uid");
    // Niveau recalculé sur la même règle que complete.php et xp.php (100 XP/niveau).
    mysqli_query($c, "UPDATE users SET niveau = FLOOR(xp / 100) + 1 WHERE id = $uid");
    // Journal d'XP : sans ces lignes, la courbe de progression du profil
    // n'expliquerait pas le saut du total.
    if ($a_xp_log) {
        mysqli_query($c, 'INSERT INTO xp_log (user_id, delta, source, label) VALUES ' . implode(',', $journal));
    }

    echo "import_cours: " . count($valeurs) . " cours validés d'office pour l'admin #$uid (+$xp_gain XP)\n";
}

mysqli_close($c);
echo "import_cours: terminé.\n";
