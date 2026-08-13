<?php
/**
 * Notifications groupées par mail : accumule des ids en base (table
 * notif_state, db-map) et déclenche un mail récapitulatif quand le seuil
 * est atteint (5 par défaut).
 *
 * Utilisé par sites.php (ajouts manuels de composteurs — les imports OSM
 * du cron ne passent pas par là, donc exclus) et signalement.php.
 */

const NOTIF_SEUIL = 5;

/**
 * Ajoute $id au lot $cle. Renvoie le tableau des ids si le seuil est
 * atteint (le lot est alors vidé), null sinon.
 */
function notif_batch_push($conn, $cle, $id) {
    mysqli_query($conn, "CREATE TABLE IF NOT EXISTS notif_state (
        cle VARCHAR(32) NOT NULL PRIMARY KEY,
        ids TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $k = mysqli_real_escape_string($conn, $cle);
    mysqli_query($conn, "INSERT IGNORE INTO notif_state (cle, ids) VALUES ('$k', '[]')");

    mysqli_query($conn, 'START TRANSACTION');
    $res = mysqli_query($conn, "SELECT ids FROM notif_state WHERE cle='$k' FOR UPDATE");
    $row = $res ? mysqli_fetch_assoc($res) : null;
    $ids = $row ? (json_decode($row['ids'], true) ?: []) : [];
    $ids[] = (int)$id;

    if (count($ids) >= NOTIF_SEUIL) {
        mysqli_query($conn, "UPDATE notif_state SET ids='[]' WHERE cle='$k'");
        mysqli_query($conn, 'COMMIT');
        return $ids;
    }
    $j = mysqli_real_escape_string($conn, json_encode($ids));
    mysqli_query($conn, "UPDATE notif_state SET ids='$j' WHERE cle='$k'");
    mysqli_query($conn, 'COMMIT');
    return null;
}

/** Remet un lot en attente (fusionné avec l'existant) si l'envoi a échoué. */
function notif_batch_restore($conn, $cle, $ids) {
    $k = mysqli_real_escape_string($conn, $cle);
    mysqli_query($conn, 'START TRANSACTION');
    $res = mysqli_query($conn, "SELECT ids FROM notif_state WHERE cle='$k' FOR UPDATE");
    $row = $res ? mysqli_fetch_assoc($res) : null;
    $courant = $row ? (json_decode($row['ids'], true) ?: []) : [];
    $j = mysqli_real_escape_string($conn, json_encode(array_values(array_unique(array_merge($ids, $courant)))));
    mysqli_query($conn, "UPDATE notif_state SET ids='$j' WHERE cle='$k'");
    mysqli_query($conn, 'COMMIT');
}

/** À appeler après chaque ajout manuel de composteur. Best-effort. */
function notif_compost_ajoute($conn, $id) {
    $lot = notif_batch_push($conn, 'composts', $id);
    if (!$lot) return;

    $in = implode(',', array_map('intval', $lot));
    $res = mysqli_query($conn,
        "SELECT id, latitude, longitude, type, publique, propose_par, created_at
         FROM composts WHERE id IN ($in) ORDER BY id");
    $lignes = [];
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $lignes[] = '#' . $r['id']
            . ' — ' . round((float)$r['latitude'], 5) . ', ' . round((float)$r['longitude'], 5)
            . ' — ' . ($r['type'] ?: 'type non renseigné')
            . ' (' . ($r['publique'] ?: 'accès non renseigné') . ')'
            . ' — par ' . ($r['propose_par'] ?: 'Anonyme')
            . ' — ' . $r['created_at'];
    }
    $n = count($lot);
    $sujet = "[SUPPORT] $n demandes d'ajout de composteurs";
    $corps = "$n nouvelles demandes d'ajout de composteurs sur Composmart :\n\n"
           . implode("\n", $lignes)
           . "\n\nÀ valider dans la page admin, onglet « Ajouts ».\n";
    $ok = send_mail('contact@composmart.fr', $sujet, $corps);
    // Déclenché par un ajout de composteur, pas une action admin explicite :
    // audit_log() attribue quand même à la session courante (l'auteur de
    // l'ajout qui a fait franchir le seuil), c'est correct comme traçabilité.
    audit_log($conn, 'mail_envoye', ($ok ? 'Envoyé' : 'Échec') . " — $sujet", [
        'target_type' => 'mail',
        'snapshot'    => [
            'to' => 'contact@composmart.fr', 'sujet' => $sujet, 'ok' => $ok, 'nb' => $n,
            'erreur' => $ok ? null : mb_substr(send_mail_last_error(), 0, 300),
        ],
    ]);
    if (!$ok) {
        notif_batch_restore($conn, 'composts', $lot);
    }
}

/** À appeler après chaque création de signalement. Best-effort. */
function notif_signalement_cree($conn, $id) {
    $lot = notif_batch_push($conn, 'signalements', $id);
    if (!$lot) return;

    $MOTIF_LABELS = [
        'position'   => 'Mauvaise position',
        'type_acces' => 'Mauvais type ou accès',
        'regles'     => 'Règles incorrectes',
        'inexistant' => "N'existe plus",
        'autre'      => 'Autre',
    ];
    $in = implode(',', array_map('intval', $lot));
    $res = mysqli_query($conn,
        "SELECT id, compost_id, motif, commentaire, reporter_username, created_at
         FROM signalements WHERE id IN ($in) ORDER BY id");
    $lignes = [];
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $lignes[] = 'Composteur #' . $r['compost_id']
            . ' — ' . ($MOTIF_LABELS[$r['motif']] ?? $r['motif'])
            . ' — par ' . ($r['reporter_username'] ?: 'Anonyme')
            . ' — ' . $r['created_at']
            . ($r['commentaire'] !== '' && $r['commentaire'] !== null ? "\n    « " . $r['commentaire'] . ' »' : '');
    }
    $n = count($lot);
    $sujet = "[SUPPORT] $n nouveaux signalements sur la carte";
    $corps = "$n nouveaux signalements sur la carte Composmart :\n\n"
           . implode("\n", $lignes)
           . "\n\nÀ traiter dans la page admin.\n";
    $ok = send_mail('contact@composmart.fr', $sujet, $corps);
    audit_log($conn, 'mail_envoye', ($ok ? 'Envoyé' : 'Échec') . " — $sujet", [
        'target_type' => 'mail',
        'snapshot'    => [
            'to' => 'contact@composmart.fr', 'sujet' => $sujet, 'ok' => $ok, 'nb' => $n,
            'erreur' => $ok ? null : mb_substr(send_mail_last_error(), 0, 300),
        ],
    ]);
    if (!$ok) {
        notif_batch_restore($conn, 'signalements', $lot);
    }
}

/**
 * Ouvre un ticket de suivi (db-core, via courses-api) pour une demande d'ajout
 * de composteur tout juste envoyée. Best-effort et silencieux : un ticket qui
 * échoue à s'ouvrir ne doit jamais faire échouer la demande elle-même — la
 * modération reste possible depuis /admin (page pending), le ticket n'est
 * qu'un canal de discussion en plus.
 *
 * $snapshot est celui déjà construit par le bloc appelant (type, accès, règles).
 */
function ouvrir_ticket_compost($compost_id, $lat, $lon, $snapshot) {
    $url = getenv('MAP_TICKET_URL') ?: '';
    if ($url === '' || empty($_SESSION['user_id'])) return;

    $sujet = 'Proposition de composteur #' . $compost_id;
    $regles = array_merge(
        array_map(fn($e) => "✅ $e", $snapshot['mettre'] ?? []),
        array_map(fn($e) => "❌ $e", $snapshot['pas_mettre'] ?? [])
    );
    $message = "Nouvelle proposition de composteur sur la carte.\n\n"
        . 'Type : ' . ($snapshot['type'] ?? '?') . "\n"
        . 'Accès : ' . ($snapshot['acces'] ?? '?') . "\n"
        . 'Position : ' . round($lat, 5) . ', ' . round($lon, 5) . "\n"
        . 'Carte : https://composmart.fr/carte#compost-' . $compost_id . "\n"
        . ($snapshot['gestion'] ? "Gestion : {$snapshot['gestion']}\n" : '')
        . ($regles ? "\nÉléments :\n- " . implode("\n- ", $regles) . "\n" : '')
        . "\nCe ticket permet d'échanger avec le proposant avant validation ou refus.";

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'uid'       => (int)$_SESSION['user_id'],
            'username'  => $_SESSION['username'] ?? '',
            'categorie' => 'suggestion',
            'sujet'     => $sujet,
            'message'   => $message,
        ]),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-Audit-Secret: ' . (getenv('AUDIT_SECRET') ?: '')],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
    ]);
    @curl_exec($ch);
    curl_close($ch);
}
