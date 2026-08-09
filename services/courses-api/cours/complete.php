<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }

$body    = json_decode(file_get_contents('php://input'), true) ?? [];
$slug    = preg_replace('/[^a-z0-9\-]/', '', strtolower($body['slug'] ?? ''));
$answers = $body['answers'] ?? [];
$user_id = isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : 0;

if (!$slug) { http_response_code(400); echo json_encode(['error' => 'slug manquant']); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

$s   = mysqli_real_escape_string($c, $slug);
// Le quiz est lu en base, comme le reste du contenu : un quiz écrit depuis
// l'éditeur d'admin n'a pas de fichier quiz.json, et la validation ne trouvait
// donc aucune question — le cours se validait sans qu'une seule réponse soit
// vérifiée.
$res = mysqli_query($c, "SELECT c.titre, c.xp_reward, c.nb_questions, k.quiz
                         FROM cours c
                         LEFT JOIN cours_contenu k ON k.cours_id = c.id
                         WHERE c.slug='$s'");
$cours = mysqli_fetch_assoc($res);
if (!$cours) { http_response_code(404); echo json_encode(['error' => 'cours introuvable']); exit; }

// Valider le quiz
$score   = null;
$total   = 0;
$correct = 0;
if (!empty($cours['quiz'])) {
    $quiz  = json_decode($cours['quiz'], true);
    $total = is_array($quiz) ? count($quiz) : 0;
    if ($total > 0) {
        // Un cours avec quiz exige des réponses : pas de validation « à vide »
        if (!is_array($answers) || empty($answers)) {
            mysqli_close($c);
            echo json_encode(['success' => false, 'message' => 'Réponses du quiz manquantes']);
            exit;
        }
        foreach ($quiz as $i => $q) {
            if (isset($answers[$i]) && intval($answers[$i]) === intval($q['correct'])) $correct++;
        }
        $score = ['correct' => $correct, 'total' => $total];
        if ($correct / $total < 0.5) {
            mysqli_close($c);
            echo json_encode(['success' => false, 'score' => $score, 'message' => 'Score insuffisant (minimum 50%)']);
            exit;
        }
    }
}

$xp_reward = intval($cours['xp_reward']);
$response  = ['success' => true, 'xp_earned' => 0, 'score' => $score];

if ($user_id > 0) {
    mysqli_query($c, "INSERT IGNORE INTO user_progress (user_id, cours_id) VALUES ($user_id, '$s')");
    if (mysqli_affected_rows($c) > 0) {
        mysqli_query($c, "UPDATE users SET xp = xp + $xp_reward WHERE id = $user_id");

        $stmt = mysqli_prepare($c, "INSERT INTO xp_log (user_id, delta, source, label) VALUES (?, ?, 'cours', ?)");
        $titre = $cours['titre'] ?? $slug;
        $stmt->bind_param('iis', $user_id, $xp_reward, $titre);
        $stmt->execute();

        // Recalculer et mettre à jour le niveau (100 XP par niveau)
        $row = mysqli_fetch_assoc(mysqli_query($c, "SELECT xp FROM users WHERE id = $user_id"));
        $new_xp     = (int)$row['xp'];
        $new_niveau = floor($new_xp / 100) + 1;
        mysqli_query($c, "UPDATE users SET niveau = $new_niveau WHERE id = $user_id");

        $response['xp_earned']  = $xp_reward;
        $response['xp_total']   = $new_xp;
        $response['niveau']     = $new_niveau;
    }
}

mysqli_close($c);
echo json_encode($response, JSON_UNESCAPED_UNICODE);
