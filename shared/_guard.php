<?php
/**
 * Garde de sécurité partagé par tous les endpoints.
 *  - secure_session_start() : session avec cookie HttpOnly + SameSite=Lax
 *  - csrf_check()           : refuse les POST cross-origin (vérifie Origin / Sec-Fetch-Site)
 *  - rate_limit()           : limite d'appels par IP (fenêtre glissante, stockage fichier)
 */

/**
 * Écrit une ligne d'audit dans la table locale audit_log.
 * Silencieux si la table n'existe pas. Utilisé par les services qui ont la
 * table (db-core) et par l'endpoint récepteur api/auth/audit.php.
 */
function audit_log_write($conn, $uid, $uname, $action, $details, $ttype, $tid, $snap) {
    $details = mb_substr((string)$details, 0, 255);
    $ttype   = $ttype !== null ? mb_substr((string)$ttype, 0, 30) : null;
    $stmt = @mysqli_prepare($conn, 'INSERT INTO audit_log (user_id, username, action, details, target_type, target_id, snapshot) VALUES (?,?,?,?,?,?,?)');
    if (!$stmt) return;
    $stmt->bind_param('issssis', $uid, $uname, $action, $details, $ttype, $tid, $snap);
    @$stmt->execute();
}

/**
 * Journalise une action sensible (admin).
 * - Si AUDIT_REMOTE_URL est défini (services SANS table audit_log, ex. map-api),
 *   envoie l'événement en HTTP à auth-api (db-core). Échec silencieux : l'audit
 *   qui rate ne doit jamais casser l'action métier.
 * - Sinon écrit directement dans la table locale (services db-core).
 * $extra peut contenir : target_type, target_id, snapshot (array → JSON).
 */
function audit_log($conn, $action, $details = '', $extra = []) {
    $uid   = isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : 0;
    $uname = $_SESSION['username'] ?? '';
    $ttype = $extra['target_type'] ?? null;
    $tid   = isset($extra['target_id']) ? (int)$extra['target_id'] : null;
    $snap  = isset($extra['snapshot']) ? json_encode($extra['snapshot'], JSON_UNESCAPED_UNICODE) : null;

    $remote = getenv('AUDIT_REMOTE_URL') ?: '';
    if ($remote !== '') {
        $payload = json_encode(compact('uid', 'uname', 'action', 'details', 'ttype', 'tid', 'snap'));
        $ch = curl_init($remote);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-Audit-Secret: ' . (getenv('AUDIT_SECRET') ?: '')],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 2,
        ]);
        @curl_exec($ch);
        curl_close($ch);
        return;
    }

    audit_log_write($conn, $uid, $uname, $action, $details, $ttype, $tid, $snap);
}

/**
 * Envoie un email via SMTP authentifié (PHPMailer). Échec toujours silencieux
 * (ne doit jamais casser l'action utilisateur qui déclenche l'envoi — cf. audit_log()).
 *
 * Configuration par variables d'environnement (ex. OVH : ssl0.ovh.net) :
 *   SMTP_HOST     — ex. ssl0.ovh.net
 *   SMTP_PORT     — 465 (SMTP_SECURE=ssl) ou 587 (SMTP_SECURE=tls)
 *   SMTP_USER     — adresse d'envoi (ex. contact@composmart.fr)
 *   SMTP_PASSWORD — mot de passe du compte mail
 *   SMTP_SECURE   — 'ssl' ou 'tls' (défaut 'tls')
 *   MAIL_FROM     — adresse affichée en expéditeur (défaut = SMTP_USER)
 *
 * Si SMTP_HOST n'est pas défini, n'envoie rien (retourne false) : évite de
 * donner une fausse impression de succès tant que le SMTP n'est pas configuré.
 *
 * @return bool true si l'envoi a réussi
 */
/**
 * Raison du dernier échec d'envoi (diagnostic). L'appelant la joint à son
 * audit_log : sans ça, l'exception PHPMailer est perdue et un « Échec » dans
 * le journal n'indique pas si c'est l'auth, le port, le TLS ou le réseau.
 * Appeler sans argument pour lire, avec une chaîne pour écrire.
 */
function send_mail_last_error($set = null) {
    static $last = '';
    if ($set !== null) $last = (string)$set;
    return $last;
}

function send_mail($to, $subject, $body, $replyTo = null) {
    send_mail_last_error('');

    $host = getenv('SMTP_HOST');
    if (!$host) {
        send_mail_last_error('SMTP_HOST non défini : envoi désactivé.');
        return false;
    }

    $autoload = __DIR__ . '/vendor/autoload.php';
    if (!is_file($autoload)) {
        send_mail_last_error('PHPMailer absent de l\'image (vendor/autoload.php introuvable).');
        return false;
    }
    require_once $autoload;

    $from = getenv('MAIL_FROM') ?: getenv('SMTP_USER');

    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = $host;
        $mail->Port       = (int)(getenv('SMTP_PORT') ?: 587);
        $mail->SMTPAuth   = true;
        $mail->Username   = getenv('SMTP_USER');
        $mail->Password   = getenv('SMTP_PASSWORD');
        $mail->SMTPSecure = getenv('SMTP_SECURE') ?: \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mail->CharSet    = 'UTF-8';
        $mail->Timeout    = 10;   // défaut 300 s : bloquerait la requête utilisateur

        $mail->setFrom($from, 'Composmart');
        $mail->addAddress($to);
        if ($replyTo) { $mail->addReplyTo($replyTo); }

        $mail->isHTML(false);
        $mail->Subject = $subject;
        $mail->Body    = $body;

        if ($mail->send()) return true;
        // send() renvoie false sans lever : ErrorInfo porte alors le détail.
        send_mail_last_error($mail->ErrorInfo ?: 'échec inconnu');
        return false;
    } catch (\Throwable $e) {
        send_mail_last_error($e->getMessage() ?: ($mail->ErrorInfo ?: 'exception sans message'));
        return false;
    }
}

/* ─────────────────── JETONS À USAGE UNIQUE (email / mot de passe) ───────────────────
 * Deux usages : confirmer une adresse à l'inscription, et réinitialiser un mot
 * de passe oublié. Même mécanique dans les deux cas :
 *   - 48 octets tirés d'une source cryptographique, encodés en base64 URL-safe
 *     → 64 caractères, 384 bits d'entropie : impossible à deviner ou à énumérer ;
 *   - la base ne garde que le SHA-256 du jeton, jamais sa valeur en clair ;
 *   - usage unique (used_at) et durée de validité limitée (expire_at).
 * Le base64 URL-safe (A–Z a–z 0–9 - _) est retenu plutôt qu'un alphabet plus
 * exotique : tout autre caractère devrait être réencodé dans l'URL, ce qui
 * allongerait le lien sans rien ajouter à sa robustesse.
 */
function generer_token() {
    return rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
}

function hash_token($token) {
    return hash('sha256', $token);
}

/**
 * Crée un jeton pour $uid et renvoie sa valeur en clair (à mettre dans le mail).
 * Les jetons du même type encore en attente sont invalidés : un nouveau lien
 * demandé annule le précédent.
 */
function creer_token($conn, $uid, $type, $duree_minutes) {
    $uid = (int)$uid;
    $t = mysqli_real_escape_string($conn, $type);
    mysqli_query($conn, "UPDATE user_tokens SET used_at = NOW()
                         WHERE user_id = $uid AND type = '$t' AND used_at IS NULL");

    $token = generer_token();
    $hash  = hash_token($token);
    $stmt  = mysqli_prepare($conn,
        'INSERT INTO user_tokens (user_id, type, token_hash, expire_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))');
    $stmt->bind_param('issi', $uid, $type, $hash, $duree_minutes);
    return $stmt->execute() ? $token : null;
}

/**
 * Valide un jeton et le consomme. Renvoie l'id utilisateur, ou 0 si le jeton est
 * inconnu, déjà utilisé ou expiré — sans distinguer ces cas, pour ne pas
 * renseigner un attaquant sur ce qui a échoué.
 */
function consommer_token($conn, $token, $type) {
    if (!is_string($token) || $token === '') return 0;
    $hash = hash_token($token);
    $stmt = mysqli_prepare($conn,
        "SELECT id, user_id FROM user_tokens
         WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expire_at > NOW()");
    $stmt->bind_param('ss', $hash, $type);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) return 0;

    // Marqué utilisé immédiatement : deux clics simultanés sur le même lien ne
    // peuvent pas déclencher deux fois l'action.
    $id = (int)$row['id'];
    mysqli_query($conn, "UPDATE user_tokens SET used_at = NOW() WHERE id = $id AND used_at IS NULL");
    if (mysqli_affected_rows($conn) !== 1) return 0;

    return (int)$row['user_id'];
}

/** Base publique du site, pour construire les liens envoyés par mail. */
function site_url() {
    $base = getenv('SITE_URL') ?: '';
    if ($base !== '') return rtrim($base, '/');
    $proto = (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https')
          || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    return $proto . '://' . ($_SERVER['HTTP_HOST'] ?? 'composmart.fr');
}

/**
 * Renvoie un message d'erreur si le mot de passe est trop faible, '' sinon.
 * Règle : 8 caractères min, au moins une lettre et un chiffre.
 */
function password_policy_error($password) {
    if (strlen($password) < 8) {
        return 'Mot de passe trop court (8 caractères minimum).';
    }
    if (!preg_match('/[A-Za-z]/', $password) || !preg_match('/[0-9]/', $password)) {
        return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    }
    return '';
}

/**
 * Renvoie l'hôte Redis si l'extension phpredis est dispo ET qu'un REDIS_HOST
 * est configuré, sinon ''. Sert à décider du backend de session / rate-limit.
 */
function redis_target() {
    $host = getenv('REDIS_HOST') ?: '';
    if ($host === '' || !extension_loaded('redis')) return '';
    return $host;
}

/**
 * Vrai si l'utilisateur connecté est admin, d'après la session (renseignée au
 * login). Utilisé par les services qui n'ont PAS accès à la table users
 * (map-api, games-api). Suppose secure_session_start() déjà appelé.
 * Limite connue : un admin rétrogradé garde le flag jusqu'à sa reconnexion.
 */
function is_admin_session() {
    return !empty($_SESSION['isAdmin']);
}

function secure_session_start() {
    if (session_status() === PHP_SESSION_ACTIVE) return;

    // Sessions partagées entre pods via Redis (cf. MIGRATION-K8S.md §4).
    // Si Redis n'est pas configuré/dispo, on retombe sur les sessions fichier
    // (mode monolithe / dev) sans rien casser.
    $host = redis_target();
    if ($host !== '') {
        $port = getenv('REDIS_PORT') ?: '6379';
        ini_set('session.save_handler', 'redis');
        ini_set('session.save_path', "tcp://{$host}:{$port}");
    }

    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
           || (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => $secure,
    ]);
    session_start();
}

function csrf_check() {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') return;

    // Les navigateurs envoient toujours Origin sur un POST ; un outil sans
    // cookie de victime (curl...) n'est pas un vecteur CSRF, donc absence = ok.
    $host   = $_SERVER['HTTP_HOST'] ?? '';
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && $origin !== 'null') {
        $ohost = parse_url($origin, PHP_URL_HOST) ?? '';
        $oport = parse_url($origin, PHP_URL_PORT);
        $ohostport = $ohost . ($oport ? ':' . $oport : '');
        if (strcasecmp($ohostport, $host) !== 0) {
            http_response_code(403);
            echo json_encode(['error' => 'Requête cross-origin refusée.']);
            exit;
        }
    }
    $sfs = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($sfs !== '' && !in_array($sfs, ['same-origin', 'none'], true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Requête cross-site refusée.']);
        exit;
    }
}

/**
 * Renvoie false si l'IP a dépassé $max appels pour $action dans la fenêtre.
 * Compteur partagé entre pods via Redis (cf. MIGRATION-K8S.md §4) ; repli sur
 * stockage fichier /tmp si Redis indisponible (monolithe / dev). Dans les deux
 * cas, suffisant pour casser le brute force et le spam.
 */
function rate_limit($action, $max, $window_sec) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ips = array_map('trim', explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']));
        $ip = $ips[0] ?? $ip;
    }
    $key = 'rl:' . $action . '|' . $ip;

    // ── Backend Redis : fenêtre fixe via INCR + EXPIRE au 1er hit ──────────
    if (redis_target() !== '') {
        try {
            $r = new Redis();
            $r->connect(getenv('REDIS_HOST'), (int)(getenv('REDIS_PORT') ?: 6379), 0.5);
            $count = $r->incr($key);
            if ($count === 1) $r->expire($key, $window_sec);
            $r->close();
            return $count <= $max;
        } catch (\Throwable $e) {
            // Redis injoignable → on bascule sur le repli fichier ci-dessous.
        }
    }

    // ── Repli fichier (fenêtre glissante) ──────────────────────────────────
    $dir = sys_get_temp_dir() . '/cs_ratelimit';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $file = $dir . '/' . md5($action . '|' . $ip);
    $now  = time();

    $times = [];
    if (is_file($file)) {
        foreach (explode(',', (string)@file_get_contents($file)) as $t) {
            $t = (int)$t;
            if ($t > $now - $window_sec) $times[] = $t;
        }
    }
    if (count($times) >= $max) return false;

    $times[] = $now;
    @file_put_contents($file, implode(',', $times), LOCK_EX);
    return true;
}
