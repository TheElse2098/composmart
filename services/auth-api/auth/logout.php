<?php
require_once __DIR__ . '/../_guard.php';
secure_session_start();
csrf_check();
$_SESSION = [];
setcookie(session_name(), '', time() - 3600, '/');
session_destroy();
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['ok' => true]);
