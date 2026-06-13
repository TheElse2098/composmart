<?php
/**
 * Garde de sécurité partagé par tous les endpoints.
 *  - secure_session_start() : session avec cookie HttpOnly + SameSite=Lax
 *  - csrf_check()           : refuse les POST cross-origin (vérifie Origin / Sec-Fetch-Site)
 *  - rate_limit()           : limite d'appels par IP (fenêtre glissante, stockage fichier)
 */

/**
 * Journalise une action sensible (admin) dans la table audit_log.
 * $extra peut contenir : target_type, target_id, snapshot (array → JSON).
 * Silencieux si la table n'existe pas encore (migration non appliquée).
 */
function audit_log($conn, $action, $details = '', $extra = []) {
    $uid   = isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : 0;
    $uname = $_SESSION['username'] ?? '';
    $details = mb_substr((string)$details, 0, 255);
    $ttype = isset($extra['target_type']) ? mb_substr((string)$extra['target_type'], 0, 30) : null;
    $tid   = isset($extra['target_id']) ? (int)$extra['target_id'] : null;
    $snap  = isset($extra['snapshot']) ? json_encode($extra['snapshot'], JSON_UNESCAPED_UNICODE) : null;
    $stmt = @mysqli_prepare($conn, 'INSERT INTO audit_log (user_id, username, action, details, target_type, target_id, snapshot) VALUES (?,?,?,?,?,?,?)');
    if (!$stmt) return;
    $stmt->bind_param('issssis', $uid, $uname, $action, $details, $ttype, $tid, $snap);
    @$stmt->execute();
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

function secure_session_start() {
    if (session_status() === PHP_SESSION_ACTIVE) return;
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
 * Stockage dans /tmp du container : remis à zéro au redémarrage, suffisant
 * pour casser le brute force et le spam.
 */
function rate_limit($action, $max, $window_sec) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ips = array_map('trim', explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']));
        $ip = $ips[0] ?? $ip;
    }
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
