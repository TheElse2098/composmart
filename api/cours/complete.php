<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$slug   = preg_replace('/[^a-z0-9\-]/', '', strtolower($body['slug'] ?? ''));
$answers = $body['answers'] ?? [];  // tableau d'index sélectionnés par question
$user_id = intval($body['user_id'] ?? 0); // 0 = non connecté pour l'instant

if (!$slug) { http_response_code(400); echo json_encode(['error' => 'slug manquant']); exit; }

$host = getenv('DB_HOST') ?: 'db';
$user = getenv('DB_USER') ?: 'composmart';
$pass = getenv('DB_PASSWORD') ?: '';
$name = getenv('DB_NAME') ?: 'Composmart';
$c = mysqli_connect($host, $user, $pass, $name);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// Récupérer le cours et son quiz
$s   = mysqli_real_escape_string($c, $slug);
$res = mysqli_query($c, "SELECT xp_reward, nb_questions FROM cours WHERE slug='$s'");
$cours = mysqli_fetch_assoc($res);
if (!$cours) { http_response_code(404); echo json_encode(['error' => 'cours introuvable']); exit; }

// Valider le quiz si des réponses sont envoyées
$score = null;
$total = 0;
$correct = 0;
$quiz_file = "/var/www/html/content/cours/$slug/quiz.json";
if (file_exists($quiz_file) && !empty($answers)) {
    $quiz = json_decode(file_get_contents($quiz_file), true);
    $total = count($quiz);
    foreach ($quiz as $i => $q) {
        if (isset($answers[$i]) && intval($answers[$i]) === intval($q['correct'])) {
            $correct++;
        }
    }
    $score = ['correct' => $correct, 'total' => $total];
    // Refus si moins de 50% de bonnes réponses
    if ($total > 0 && $correct / $total < 0.5) {
        mysqli_close($c);
        echo json_encode(['success' => false, 'score' => $score, 'message' => 'Score insuffisant (minimum 50%)']);
        exit;
    }
}

$xp = intval($cours['xp_reward']);
$response = ['success' => true, 'xp_earned' => 0, 'score' => $score];

// Enregistrer la progression et créditer l'XP si utilisateur connecté
if ($user_id > 0) {
    mysqli_query($c, "INSERT IGNORE INTO user_progress (user_id, cours_id) VALUES ($user_id, '$s')");
    if (mysqli_affected_rows($c) > 0) {
        mysqli_query($c, "UPDATE users SET xp = xp + $xp WHERE id = $user_id");
        $response['xp_earned'] = $xp;
    }
}

mysqli_close($c);
echo json_encode($response, JSON_UNESCAPED_UNICODE);
