<?php
/**
 * Garde de sécurité partagé par tous les endpoints.
 *  - secure_session_start() : session avec cookie HttpOnly + SameSite=Lax
 *  - csrf_check()           : refuse les POST cross-origin (vérifie Origin / Sec-Fetch-Site)
 *  - rate_limit()           : limite d'appels par IP (fenêtre glissante, stockage fichier)
 */

function secure_session_start() {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
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
    $ip  = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
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
