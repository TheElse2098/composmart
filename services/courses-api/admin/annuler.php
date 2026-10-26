<?php
/**
 * Annulation, depuis le journal, des actions dont les données vivent en db-core.
 *
 *   POST audit_id=<id de l'entrée>  → {ok} ou {error}
 *
 * L'état d'avant est lu dans l'entrée du journal, côté serveur (jamais dans ce
 * qu'envoie le navigateur). Règle commune : si l'élément a été retouché depuis
 * l'action, on refuse plutôt que d'écraser la modification plus récente.
 * Chaque annulation se journalise elle-même (snapshot.annule = id annulé) :
 * elle se lit, et pour une modification se défait, comme toute autre action.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin_guard.php';
$c = admin_connexion_ou_403();
ob_clean();
csrf_check();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}

$aid = audit_id_demande();
$e = audit_annulation_debut($c, $aid, [
    'cours_modifie', 'cours_restaure', 'cours_supprime', 'cours_reorganises',
    'theme_modifie', 'theme_supprime', 'user_promu', 'user_retrograde', 'ticket_clos', 'ticket_rouvert',
]);
$s = $e['snapshot'];
$echec = function ($message) use ($c, $aid) { audit_annulation_echec($c, $aid, $message); };
$ok = function () { echo json_encode(['ok' => true]); exit; };

/** Une version archivée d'un cours, métadonnées décodées ; null si absente. */
function version_lire($c, $vid) {
    $stmt = mysqli_prepare($c, 'SELECT id, cours_id, meta, texte, quiz, video, podcast FROM cours_versions WHERE id = ?');
    $stmt->bind_param('i', $vid);
    $stmt->execute();
    $v = $stmt->get_result()->fetch_assoc();
    if (!$v || !$v['meta']) return null;
    $v['meta'] = json_decode($v['meta'], true) ?: null;
    return $v['meta'] ? $v : null;
}

function theme_existe($c, $id) {
    $r = mysqli_query($c, 'SELECT id FROM themes WHERE id = ' . (int)$id);
    return $r && mysqli_num_rows($r) > 0;
}

/** Indicateurs du catalogue recalculés depuis le contenu (cf. cours_save.php). */
function indicateurs($v) {
    $m = metriques_contenu($v['texte'], json_decode($v['quiz'] ?? '', true) ?: []);
    return [$m['has_text'], $v['video'] ? 1 : 0, $v['podcast'] ? 1 : 0, $m['nb_questions']];
}

$action = $e['action'];

// ── Cours : revenir à la version d'avant la sauvegarde ─────────────────────
if ($action === 'cours_modifie' || $action === 'cours_restaure') {
    $v = version_lire($c, (int)($s['version_id'] ?? 0));
    if (!$v) $echec("La version d'avant n'existe plus.");
    $cid = (int)$v['cours_id'];

    $stmt = mysqli_prepare($c,
        'SELECT slug, theme_id, titre, description, emoji, niveau, xp_reward, statut, ordre FROM cours WHERE id = ?');
    $stmt->bind_param('i', $cid);
    $stmt->execute();
    $ex = $stmt->get_result()->fetch_assoc();
    if (!$ex) $echec('Ce cours a été supprimé depuis.');

    // Toute sauvegarde archive une version : une version plus récente que
    // celle-ci (hors celle de la sauvegarde annulée) signale une retouche.
    $r = mysqli_query($c, "SELECT COUNT(*) FROM cours_versions WHERE cours_id = $cid AND id > " . (int)$v['id']);
    if ((int)(mysqli_fetch_row($r)[0] ?? 0) > 0) {
        $echec("Ce cours a été modifié depuis : l'annulation écraserait ces modifications. "
             . "Passe par l'entrée la plus récente du journal.");
    }

    $stmt = mysqli_prepare($c, 'SELECT texte, quiz, video, podcast FROM cours_contenu WHERE cours_id = ?');
    $stmt->bind_param('i', $cid);
    $stmt->execute();
    $contenu_avant = $stmt->get_result()->fetch_assoc() ?: [];

    $m = $v['meta'];
    // Un thème supprimé entre-temps : le cours reste dans son thème actuel.
    $theme_id = theme_existe($c, $m['theme_id'] ?? 0) ? (int)$m['theme_id'] : (int)$ex['theme_id'];
    [$has_text, $has_video, $has_podcast, $nb_q] = indicateurs($v);
    $xp = (int)$m['xp_reward'];

    // L'état actuel est archivé à son tour : l'annulation se défait comme une sauvegarde.
    $version_id = cours_archiver($c, $cid, $ex);

    $stmt = mysqli_prepare($c,
        'UPDATE cours SET theme_id = ?, titre = ?, description = ?, emoji = ?, niveau = ?, xp_reward = ?,
                          has_text = ?, has_video = ?, has_podcast = ?, nb_questions = ?, statut = ?
         WHERE id = ?');
    $stmt->bind_param('issssiiiiisi', $theme_id, $m['titre'], $m['description'], $m['emoji'], $m['niveau'], $xp,
                      $has_text, $has_video, $has_podcast, $nb_q, $m['statut'], $cid);
    if (!$stmt->execute()) $echec('La restauration a échoué.');

    $auteur = $_SESSION['username'] ?? '';
    $stmt = mysqli_prepare($c,
        'UPDATE cours_contenu SET texte = ?, quiz = ?, video = ?, podcast = ?, maj_par = ? WHERE cours_id = ?');
    $stmt->bind_param('sssssi', $v['texte'], $v['quiz'], $v['video'], $v['podcast'], $auteur, $cid);
    $stmt->execute();

    if ($m['statut'] === 'publie') cours_rattraper_admins($c, $ex['slug'], $m['titre'], $xp);

    $contenu_modifie = [];
    foreach (['texte', 'quiz', 'video', 'podcast'] as $k) {
        if ((string)($contenu_avant[$k] ?? '') !== (string)$v[$k]) $contenu_modifie[] = $k;
    }
    $apres = $m; $apres['theme_id'] = $theme_id;
    audit_log($c, 'cours_restaure', mb_substr($m['titre'], 0, 120) . ' (' . $m['statut'] . ')', [
        'target_type' => 'cours', 'target_id' => $cid, 'snapshot' => [
            'slug' => $ex['slug'], 'version_id' => $version_id, 'annule' => $aid,
            'changements' => audit_changements(cours_meta_lisible($c, $ex), cours_meta_lisible($c, $apres)),
            'contenu_modifie' => $contenu_modifie,
        ],
    ]);
    $ok();
}

// ── Cours supprimé : le recréer depuis sa dernière version ─────────────────
if ($action === 'cours_supprime') {
    $v = version_lire($c, (int)($s['version_id'] ?? 0));
    if (!$v) $echec("La dernière version de ce cours n'existe plus.");
    $m = $v['meta'];
    $slug = $m['slug'];

    $stmt = mysqli_prepare($c, 'SELECT id FROM cours WHERE slug = ?');
    $stmt->bind_param('s', $slug);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) $echec("L'adresse « $slug » a été reprise par un autre cours.");
    if (!theme_existe($c, $m['theme_id'] ?? 0)) {
        $echec('Le thème « ' . ($s['etat']['theme'] ?? '?') . ' » a été supprimé depuis : recrée-le d\'abord.');
    }

    // Même id qu'avant si possible : l'historique des versions s'y rattache.
    $cid = (int)$v['cours_id'];
    $r = mysqli_query($c, "SELECT id FROM cours WHERE id = $cid");
    if ($r && mysqli_num_rows($r) > 0) $cid = null;

    $theme_id = (int)$m['theme_id'];
    $r = mysqli_query($c, "SELECT COALESCE(MAX(ordre), -1) + 1 FROM cours WHERE theme_id = $theme_id");
    $ordre = $r ? (int)(mysqli_fetch_row($r)[0] ?? 0) : 0;
    [$has_text, $has_video, $has_podcast, $nb_q] = indicateurs($v);
    $xp = (int)$m['xp_reward'];

    $stmt = mysqli_prepare($c,
        'INSERT INTO cours (id, slug, theme_id, titre, description, emoji, niveau, xp_reward,
                            has_text, has_video, has_podcast, nb_questions, statut, ordre)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->bind_param('isissssiiiiisi', $cid, $slug, $theme_id, $m['titre'], $m['description'], $m['emoji'],
                      $m['niveau'], $xp, $has_text, $has_video, $has_podcast, $nb_q, $m['statut'], $ordre);
    if (!$stmt->execute()) $echec('La recréation a échoué.');
    $cid = (int)mysqli_insert_id($c) ?: $cid;

    $auteur = $_SESSION['username'] ?? '';
    $stmt = mysqli_prepare($c,
        'INSERT INTO cours_contenu (cours_id, texte, quiz, video, podcast, maj_par) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->bind_param('isssss', $cid, $v['texte'], $v['quiz'], $v['video'], $v['podcast'], $auteur);
    $stmt->execute();

    // La pierre tombale disait au seed d'ignorer ce slug : le cours est de retour.
    $stmt = mysqli_prepare($c, 'DELETE FROM cours_supprimes WHERE slug = ?');
    $stmt->bind_param('s', $slug);
    $stmt->execute();

    if ($m['statut'] === 'publie') cours_rattraper_admins($c, $slug, $m['titre'], $xp);

    audit_log($c, 'cours_retabli', mb_substr($m['titre'], 0, 120), [
        'target_type' => 'cours', 'target_id' => $cid,
        'snapshot'    => ['slug' => $slug, 'annule' => $aid, 'etat' => cours_meta_lisible($c, $m)],
    ]);
    $ok();
}

// ── Réorganisation du catalogue ─────────────────────────────────────────────
if ($action === 'cours_reorganises') {
    if (!is_array($s['avant'] ?? null)) $echec("L'organisation d'avant n'a pas été conservée.");
    $actuelle = cours_organisation($c);
    // Chaque cours déplacé doit encore être à la place où l'action l'avait mis.
    $par_titre = array_flip($actuelle['titres']);
    foreach ($s['changements'] ?? [] as $titre => $av_ap) {
        if ($titre === 'Ordre des thèmes') {
            if ($actuelle['noms_themes'] !== $av_ap[1]) $echec('Les thèmes ont été réordonnés depuis.');
            continue;
        }
        $cid = $par_titre[$titre] ?? null;
        if ($cid === null || ($actuelle['place'][$cid] ?? null) !== $av_ap[1]) {
            $echec("« $titre » a été déplacé, renommé ou supprimé depuis.");
        }
    }
    if (cours_appliquer_organisation($c, $s['avant']) === false) $echec('La remise en ordre a échoué.');
    $changements = cours_changements_organisation($actuelle, cours_organisation($c));
    audit_log($c, 'cours_reorganises', count($changements) . ' changement' . (count($changements) > 1 ? 's' : ''), [
        'target_type' => 'cours',
        'snapshot'    => ['changements' => $changements, 'avant' => $actuelle['themes'], 'annule' => $aid],
    ]);
    $ok();
}

// ── Thèmes ─────────────────────────────────────────────────────────────────
if ($action === 'theme_modifie') {
    $id = (int)$e['target_id'];
    $actuel = theme_lire($c, $id);
    if (!$actuel) $echec('Ce thème a été supprimé depuis.');
    [$t, $err] = audit_revenir($actuel, $s['changements'] ?? []);
    if ($err) $echec($err);
    $stmt = mysqli_prepare($c, 'UPDATE themes SET nom = ?, emoji = ?, couleur = ?, description = ? WHERE id = ?');
    $stmt->bind_param('ssssi', $t['nom'], $t['emoji'], $t['couleur'], $t['description'], $id);
    if (!$stmt->execute()) $echec("L'enregistrement a échoué.");
    audit_log($c, 'theme_modifie', $t['nom'], [
        'target_type' => 'theme', 'target_id' => $id,
        'snapshot'    => ['changements' => audit_changements($actuel, theme_lire($c, $id)), 'annule' => $aid],
    ]);
    $ok();
}

if ($action === 'theme_supprime') {
    $t = $s['etat'] ?? null;
    if (!$t) $echec("Le thème supprimé n'a pas été conservé.");
    $stmt = mysqli_prepare($c, 'SELECT id FROM themes WHERE slug = ?');
    $stmt->bind_param('s', $t['slug']);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) $echec("L'adresse « {$t['slug']} » a été reprise par un autre thème.");
    $r = mysqli_query($c, 'SELECT COALESCE(MAX(ordre), -1) + 1 FROM themes');
    $ordre = $r ? (int)(mysqli_fetch_row($r)[0] ?? 0) : 0;
    $stmt = mysqli_prepare($c,
        'INSERT INTO themes (slug, nom, emoji, couleur, description, ordre) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->bind_param('sssssi', $t['slug'], $t['nom'], $t['emoji'], $t['couleur'], $t['description'], $ordre);
    if (!$stmt->execute()) $echec('La recréation a échoué.');
    $id = (int)mysqli_insert_id($c);
    audit_log($c, 'theme_retabli', $t['nom'], [
        'target_type' => 'theme', 'target_id' => $id, 'snapshot' => ['etat' => theme_lire($c, $id), 'annule' => $aid],
    ]);
    $ok();
}

// ── Rôle administrateur ────────────────────────────────────────────────────
if ($action === 'user_promu' || $action === 'user_retrograde') {
    $uid = (int)$e['target_id'];
    $ch = $s['changements']['admin'] ?? null;
    if (!$ch) $echec("Le rôle d'avant n'a pas été conservé.");
    $stmt = mysqli_prepare($c, 'SELECT username, isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $u = $stmt->get_result()->fetch_assoc();
    if (!$u) $echec("Ce compte n'existe plus.");
    if (!audit_egal((int)$u['isAdmin'], $ch[1])) $echec('Le rôle de ce compte a changé depuis.');

    $vers = (int)$ch[0];
    // Mêmes garde-fous que users.php.
    if ($vers === 0) {
        if ($uid === (int)$_SESSION['user_id']) $echec('Tu ne peux pas te retirer toi-même les droits admin.');
        $n = (int)(mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM users WHERE isAdmin = 1'))[0] ?? 0);
        if ($n <= 1) $echec('Impossible : il doit rester au moins un administrateur.');
    }
    $stmt = mysqli_prepare($c, 'UPDATE users SET isAdmin = ? WHERE id = ?');
    $stmt->bind_param('ii', $vers, $uid);
    if (!$stmt->execute()) $echec('Le changement de rôle a échoué.');
    audit_log($c, $vers === 1 ? 'user_promu' : 'user_retrograde', 'id=' . $uid, [
        'target_type' => 'user', 'target_id' => $uid, 'snapshot' => [
            'username' => $u['username'], 'admin' => (bool)$vers, 'annule' => $aid,
            'changements' => audit_changements(['admin' => (int)$u['isAdmin']], ['admin' => $vers]),
        ],
    ]);
    $ok();
}

// ── Tickets : clos ↔ ouvert (une fermeture définitive ne se défait pas) ────
if ($action === 'ticket_clos' || $action === 'ticket_rouvert') {
    $id = (int)$e['target_id'];
    $ch = $s['changements']['statut'] ?? null;
    if (!$ch) $echec("Le statut d'avant n'a pas été conservé.");
    [$avant, $apres] = $ch;
    $stmt = mysqli_prepare($c,
        'UPDATE contact_messages SET statut = ?, derniere_activite = NOW() WHERE id = ? AND statut = ?');
    $stmt->bind_param('sis', $avant, $id, $apres);
    $stmt->execute();
    if (mysqli_stmt_affected_rows($stmt) !== 1) $echec('Le ticket a changé d\'état depuis.');
    audit_log($c, $avant === 'ouvert' ? 'ticket_rouvert' : 'ticket_clos', 'annulation sur « ' . mb_substr($s['sujet'] ?? '', 0, 80) . ' »', [
        'target_type' => 'ticket', 'target_id' => $id, 'snapshot' => [
            'sujet' => $s['sujet'] ?? '', 'annule' => $aid,
            'changements' => audit_changements(['statut' => $apres], ['statut' => $avant]),
        ],
    ]);
    $ok();
}

$echec('Action non prise en charge.');
