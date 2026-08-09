<?php
/**
 * Amorce les tables themes + cours + cours_contenu depuis content/cours/.
 * Appelé par le Job seed-core.
 *
 * ATTENTION — CE SCRIPT N'ÉCRASE JAMAIS UN COURS EXISTANT.
 * Depuis que les cours s'éditent depuis /admin/themes, la base fait autorité et
 * les fichiers content/ ne sont plus qu'une graine pour une base vierge. Un
 * `ON DUPLICATE KEY UPDATE` réécrirait ici le travail des administrateurs avec
 * la version figée dans l'image, à chaque `kubectl apply` de routine — et sans
 * le moindre message d'erreur. Le seul cas où les fichiers gagnent est celui où
 * le cours n'existe pas encore en base.
 */

// Ce script teste la valeur de retour de chaque requête ; sans ça, mysqli lève
// des exceptions depuis PHP 8.1 et une table absente ferait tout échouer.
mysqli_report(MYSQLI_REPORT_OFF);

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

// Slugs supprimés depuis l'interface d'admin. Sans cette liste, le dossier
// content/ resté sur place ferait revenir le cours au passage suivant du seed,
// et son adresse resterait éternellement réservée : supprimer deviendrait
// impossible autrement qu'en reconstruisant l'image.
$supprimes = [];
$res_sup = mysqli_query($c, 'SELECT slug FROM cours_supprimes');
while ($res_sup && ($r = mysqli_fetch_assoc($res_sup))) $supprimes[$r['slug']] = true;

foreach ($dirs as $meta_file) {
    $slug_dir = basename(dirname($meta_file));
    $meta = json_decode(file_get_contents($meta_file), true);
    if (!$meta) {
        echo "import_cours: meta.json invalide pour $slug_dir, ignoré.\n";
        continue;
    }

    // Test placé avant la création du thème : un cours supprimé ne doit pas non
    // plus ressusciter le thème qui n'existait que pour lui.
    if (isset($supprimes[$slug_dir])) {
        echo "import_cours: [$slug_dir] supprimé depuis l'admin, non réimporté.\n";
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
    $quiz_json = null;
    if (file_exists("$dir/quiz.json")) {
        $quiz = json_decode(file_get_contents("$dir/quiz.json"), true);
        $nb_questions = is_array($quiz) ? count($quiz) : 0;
        if (is_array($quiz)) $quiz_json = json_encode($quiz, JSON_UNESCAPED_UNICODE);
    }
    $texte_md  = $has_text  ? file_get_contents("$dir/texte.md")   : null;
    $video_json = $has_video ? file_get_contents("$dir/video.json") : null;

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
            // INSERT IGNORE : les thèmes s'éditent eux aussi depuis /admin/themes,
            // un renommage ne doit pas être annulé au prochain seed.
            mysqli_query($c, "INSERT IGNORE INTO themes (slug,nom,emoji,couleur,description,ordre)
                              VALUES ('$ts','$tn','$te','$tc',$td,$theme_ordre)");
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

    // INSERT IGNORE et non ON DUPLICATE KEY UPDATE : voir l'avertissement en
    // tête de fichier. Un cours déjà en base a pu être modifié depuis
    // l'interface d'admin, il est intouchable.
    $res_exist = mysqli_query($c, "SELECT id FROM cours WHERE slug='$cs'");
    $ligne_exist = $res_exist ? mysqli_fetch_assoc($res_exist) : null;

    if ($ligne_exist) {
        echo "import_cours: [$cours_slug] déjà en base, laissé tel quel.\n";
        $cours_id = (int)$ligne_exist['id'];
    } else {
        mysqli_query($c, "INSERT INTO cours
            (slug,theme_id,titre,description,emoji,niveau,xp_reward,has_text,has_video,has_podcast,nb_questions,statut,ordre)
            VALUES ('$cs',$theme_id,'$ct','$cd','$ce','$cn',$xp_reward,$has_text,$has_video,$has_podcast,$nb_questions,'publie',$ordre)");
        $cours_id = (int)mysqli_insert_id($c);
        echo "import_cours: [$cours_slug] créé (thème: $theme_slug)\n";
    }

    // Contenu : même règle, on ne remplit que si la ligne n'existe pas encore.
    // C'est ce qui verse les 9 cours historiques en base au premier passage
    // après la migration, sans jamais les réécrire ensuite.
    if ($cours_id > 0) {
        $res_k = mysqli_query($c, "SELECT cours_id FROM cours_contenu WHERE cours_id=$cours_id");
        if ($res_k && mysqli_num_rows($res_k) === 0) {
            $stmt_k = mysqli_prepare($c,
                'INSERT INTO cours_contenu (cours_id, texte, quiz, video, maj_par)
                 VALUES (?, ?, ?, ?, ?)');
            if ($stmt_k) {
                $auteur = 'import';
                $stmt_k->bind_param('issss', $cours_id, $texte_md, $quiz_json, $video_json, $auteur);
                @$stmt_k->execute();
                echo "import_cours: [$cours_slug] contenu versé en base.\n";
            }
        }
    }
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
