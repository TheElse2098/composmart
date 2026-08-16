<?php
/**
 * Registre des types de slides — source unique partagée par parcours.php
 * (édition), admin.php (copie vers un événement), live.php (rendu participant)
 * et animation.php (correction, résultats).
 *
 * Trois responsabilités, volontairement réunies ici pour qu'un nouveau type de
 * slide se déclare à UN seul endroit :
 *   1. valider_contenu()  — refuse une slide mal formée à l'enregistrement ;
 *   2. slide_publique()   — retire la clé de correction avant envoi au
 *                           participant (sans quoi la bonne réponse est lisible
 *                           dans l'onglet Réseau du navigateur) ;
 *   3. corriger()         — calcule les points, EXCLUSIVEMENT côté serveur.
 */

/**
 * Registre : type => métadonnées.
 *  - 'nom'   : libellé affiché dans l'éditeur
 *  - 'note'  : 'auto'   = corrigé par le serveur (points automatiques)
 *              'manuel' = l'animateur attribue les points à la main
 *              false    = slide d'affichage, aucun point
 *  - 'repond': true si le participant a quelque chose à saisir/cliquer
 */
function slides_registre() {
    return [
        'titre'            => ['nom' => 'Titre de partie',      'note' => false,    'repond' => false],
        'texte'            => ['nom' => 'Texte',                'note' => false,    'repond' => false],
        'anecdote'         => ['nom' => 'Anecdote',             'note' => false,    'repond' => false],
        'sommaire'         => ['nom' => 'Sommaire',             'note' => false,    'repond' => false],
        'media'            => ['nom' => 'Média plein écran',    'note' => false,    'repond' => false],
        'classement'       => ['nom' => 'Classement',           'note' => false,    'repond' => false],
        'fin'              => ['nom' => 'Remerciement',         'note' => false,    'repond' => false],
        'quiz'             => ['nom' => 'Quiz (QCM)',           'note' => 'auto',   'repond' => true],
        'vrai_faux'        => ['nom' => 'Vrai / Faux',          'note' => 'auto',   'repond' => true],
        'estimation'       => ['nom' => 'Estimation',           'note' => 'auto',   'repond' => true],
        'jeu'              => ['nom' => 'Extrait de jeu',       'note' => 'auto',   'repond' => true],
        'sondage'          => ['nom' => 'Sondage',              'note' => false,    'repond' => true],
        'question_ouverte' => ['nom' => 'Question ouverte',     'note' => 'manuel', 'repond' => true],
        'defi'             => ['nom' => 'Défi terrain',         'note' => 'manuel', 'repond' => false],
    ];
}

function slide_type_valide($type) {
    return array_key_exists($type, slides_registre());
}

/** Jeux dont on peut extraire un morceau, et forme attendue de chaque item. */
function slides_jeux_valides() {
    return ['compost-ou-pas', 'temps-decompo', 'mot-mystere'];
}

/** Texte non vide, borné. Renvoie null si invalide. */
function _txt($v, $max) {
    if (!is_string($v)) return null;
    $v = trim($v);
    if ($v === '' || mb_strlen($v) > $max) return null;
    return $v;
}

/**
 * Valide et normalise le `contenu` d'une slide selon son type.
 * Renvoie ['ok' => true, 'contenu' => array] ou ['ok' => false, 'erreur' => '…'].
 * Ne fait jamais confiance à ce que le client envoie : tout champ non prévu
 * par le type est écarté, ce qui empêche d'injecter des données parasites dans
 * le JSON stocké.
 */
function valider_contenu($type, $d) {
    if (!is_array($d)) $d = [];
    $err = function ($m) { return ['ok' => false, 'erreur' => $m]; };
    $ok  = function ($c) { return ['ok' => true, 'contenu' => $c]; };

    switch ($type) {
        case 'titre':
            return $ok(['sous_titre' => is_string($d['sous_titre'] ?? null) ? trim($d['sous_titre']) : '']);

        case 'texte':
            $corps = _txt($d['corps'] ?? null, 5000);
            if ($corps === null) return $err('Le texte est vide ou trop long.');
            return $ok(['corps' => $corps]);

        case 'anecdote':
            $corps = _txt($d['corps'] ?? null, 2000);
            if ($corps === null) return $err("L'anecdote est vide ou trop longue.");
            $emoji = is_string($d['emoji'] ?? null) ? mb_substr(trim($d['emoji']), 0, 8) : '';
            return $ok(['corps' => $corps, 'emoji' => $emoji]);

        case 'sommaire':
            $sections = [];
            foreach ((array)($d['sections'] ?? []) as $s) {
                $nom = _txt($s['nom'] ?? null, 120);
                if ($nom === null) continue;
                $sections[] = ['nom' => $nom, 'slide_ordre' => (int)($s['slide_ordre'] ?? 0)];
            }
            if (!$sections) return $err('Le sommaire doit contenir au moins une section.');
            return $ok(['sections' => $sections]);

        case 'media':
            $mt = in_array($d['media_type'] ?? '', ['image', 'video', 'audio'], true) ? $d['media_type'] : null;
            if ($mt === null) return $err('Type de média invalide (image, video ou audio).');
            $url = _txt($d['url'] ?? null, 500);
            if ($url === null) return $err("L'adresse du média est vide.");
            return $ok([
                'media_type' => $mt,
                'url'        => $url,
                'legende'    => is_string($d['legende'] ?? null) ? mb_substr(trim($d['legende']), 0, 300) : '',
            ]);

        case 'classement':
            $p = in_array($d['portee'] ?? '', ['individuel', 'equipe', 'les_deux'], true) ? $d['portee'] : 'les_deux';
            return $ok(['portee' => $p]);

        case 'fin':
            return $ok([
                'message'            => is_string($d['message'] ?? null) ? mb_substr(trim($d['message']), 0, 1000) : 'Merci de votre participation !',
                'afficher_classement' => !empty($d['afficher_classement']),
            ]);

        case 'quiz':
            $q = _txt($d['question'] ?? null, 500);
            if ($q === null) return $err('La question est vide.');
            $options = [];
            foreach ((array)($d['options'] ?? []) as $o) {
                $o = _txt($o, 300);
                if ($o !== null) $options[] = $o;
            }
            if (count($options) < 2) return $err('Un quiz demande au moins deux réponses possibles.');
            $correct = (int)($d['correct'] ?? -1);
            if ($correct < 0 || $correct >= count($options)) return $err('La bonne réponse ne correspond à aucune option.');
            return $ok([
                'question'    => $q,
                'options'     => $options,
                'correct'     => $correct,
                'explication' => is_string($d['explication'] ?? null) ? mb_substr(trim($d['explication']), 0, 1000) : '',
            ]);

        case 'vrai_faux':
            $q = _txt($d['question'] ?? null, 500);
            if ($q === null) return $err('La question est vide.');
            return $ok([
                'question'    => $q,
                'correct'     => !empty($d['correct']),
                'explication' => is_string($d['explication'] ?? null) ? mb_substr(trim($d['explication']), 0, 1000) : '',
            ]);

        case 'estimation':
            $q = _txt($d['question'] ?? null, 500);
            if ($q === null) return $err('La question est vide.');
            if (!isset($d['valeur']) || !is_numeric($d['valeur'])) return $err('La valeur exacte doit être un nombre.');
            $tol = isset($d['tolerance']) && is_numeric($d['tolerance']) ? abs((float)$d['tolerance']) : 0.0;
            return $ok([
                'valeur'      => (float)$d['valeur'],
                'tolerance'   => $tol,
                'question'    => $q,
                'unite'       => is_string($d['unite'] ?? null) ? mb_substr(trim($d['unite']), 0, 30) : '',
                'explication' => is_string($d['explication'] ?? null) ? mb_substr(trim($d['explication']), 0, 1000) : '',
            ]);

        case 'sondage':
            $q = _txt($d['question'] ?? null, 500);
            if ($q === null) return $err('La question est vide.');
            $options = [];
            foreach ((array)($d['options'] ?? []) as $o) {
                $o = _txt($o, 300);
                if ($o !== null) $options[] = $o;
            }
            if (count($options) < 2) return $err('Un sondage demande au moins deux choix.');
            return $ok(['question' => $q, 'options' => $options]);

        case 'jeu':
            $jeu = in_array($d['jeu'] ?? '', slides_jeux_valides(), true) ? $d['jeu'] : null;
            if ($jeu === null) return $err('Jeu inconnu.');
            $items = [];
            foreach ((array)($d['items'] ?? []) as $it) {
                $nom = _txt($it['nom'] ?? null, 200);
                if ($nom === null) continue;
                $item = [
                    'nom'   => $nom,
                    'emoji' => is_string($it['emoji'] ?? null) ? mb_substr(trim($it['emoji']), 0, 8) : '',
                    'info'  => is_string($it['info'] ?? null) ? mb_substr(trim($it['info']), 0, 500) : '',
                ];
                // La clé de correction dépend du jeu d'origine.
                if ($jeu === 'compost-ou-pas') {
                    if (!in_array($it['cat'] ?? '', ['oui', 'attention', 'non'], true)) continue;
                    $item['cat'] = $it['cat'];
                } elseif ($jeu === 'temps-decompo') {
                    if (!isset($it['jours']) || !is_numeric($it['jours'])) continue;
                    $item['jours'] = (int)$it['jours'];
                } else { // mot-mystere
                    // `nom` porte l'indice (affiché), `mot` la réponse (masquée
                    // par slide_publique). Les confondre afficherait la solution.
                    $m = _txt($it['mot'] ?? null, 60);
                    if ($m === null) continue;
                    $item['mot'] = mb_strtoupper($m);
                }
                $items[] = $item;
            }
            if (!$items) return $err('Aucun élément valide pour ce jeu.');
            return $ok(['jeu' => $jeu, 'items' => $items]);

        case 'question_ouverte':
            $q = _txt($d['question'] ?? null, 500);
            if ($q === null) return $err('La question est vide.');
            $max = (int)($d['max_car'] ?? 300);
            return $ok(['question' => $q, 'max_car' => max(20, min(2000, $max))]);

        case 'defi':
            $c = _txt($d['consigne'] ?? null, 1000);
            if ($c === null) return $err('La consigne est vide.');
            return $ok(['consigne' => $c]);
    }
    return $err('Type de slide inconnu.');
}

/**
 * Version d'une slide envoyable à un participant qui n'a PAS encore répondu :
 * la clé de correction est retirée du contenu. C'est la garantie centrale du
 * jeu — sans elle, la bonne réponse est lisible côté navigateur avant même de
 * cliquer. L'explication est également retenue jusqu'à la réponse.
 */
function slide_publique($slide, $reponse_donnee = false) {
    $c = json_decode($slide['contenu'] ?? '', true);
    if (!is_array($c)) $c = [];

    if (!$reponse_donnee) {
        unset($c['explication']);
        switch ($slide['type']) {
            case 'quiz':
            case 'vrai_faux':
                unset($c['correct']);
                break;
            case 'estimation':
                unset($c['valeur'], $c['tolerance']);
                break;
            case 'jeu':
                // Les items gardent nom/emoji (nécessaires à l'affichage) mais
                // perdent la réponse et le commentaire qui la révèle.
                $c['items'] = array_map(function ($it) {
                    unset($it['cat'], $it['jours'], $it['mot'], $it['info']);
                    return $it;
                }, $c['items'] ?? []);
                break;
        }
    }

    return [
        'id'      => (int)$slide['id'],
        'ordre'   => (int)$slide['ordre'],
        'type'    => $slide['type'],
        'titre'   => $slide['titre'],
        'points'  => (int)$slide['points'],
        'contenu' => $c,
    ];
}

/**
 * Corrige une réponse et renvoie ['points' => int, 'correct' => bool|null].
 * `correct` vaut null quand le type n'a pas de bonne réponse (sondage) ou
 * demande une notation humaine (question ouverte, défi).
 */
function corriger($type, $contenu, $reponse, $points_max) {
    $points_max = max(0, (int)$points_max);

    switch ($type) {
        case 'quiz':
            $bon = ((int)$reponse === (int)($contenu['correct'] ?? -1));
            return ['points' => $bon ? $points_max : 0, 'correct' => $bon];

        case 'vrai_faux':
            $bon = ((bool)$reponse === (bool)($contenu['correct'] ?? false));
            return ['points' => $bon ? $points_max : 0, 'correct' => $bon];

        case 'estimation':
            if (!is_numeric($reponse)) return ['points' => 0, 'correct' => false];
            $ecart = abs((float)$reponse - (float)($contenu['valeur'] ?? 0));
            $tol   = (float)($contenu['tolerance'] ?? 0);
            // Points pleins dans la tolérance, puis dégressif linéairement
            // jusqu'à 0 à trois fois la tolérance : une estimation grossièrement
            // fausse ne rapporte rien, une approximation honnête rapporte encore.
            if ($ecart <= $tol) return ['points' => $points_max, 'correct' => true];
            if ($tol <= 0)      return ['points' => 0, 'correct' => false];
            $facteur = 1 - ($ecart - $tol) / (2 * $tol);
            $pts = (int)round($points_max * max(0.0, $facteur));
            return ['points' => $pts, 'correct' => false];

        case 'jeu':
            // Réponse attendue : un tableau aligné sur l'ordre des items.
            $items = $contenu['items'] ?? [];
            $rep   = is_array($reponse) ? array_values($reponse) : [];
            if (!$items) return ['points' => 0, 'correct' => false];
            $bons = 0;
            foreach ($items as $i => $it) {
                $r = $rep[$i] ?? null;
                if (isset($it['cat'])) {
                    if ($r === $it['cat']) $bons++;
                } elseif (isset($it['jours'])) {
                    // Même esprit que le jeu d'origine : ±50 % passe pour juste.
                    if (is_numeric($r) && abs((float)$r - $it['jours']) <= max(1, $it['jours'] * 0.5)) $bons++;
                } elseif (isset($it['mot'])) {
                    if (is_string($r) && mb_strtoupper(trim($r)) === $it['mot']) $bons++;
                }
            }
            $pts = (int)round($points_max * $bons / count($items));
            return ['points' => $pts, 'correct' => $bons === count($items)];

        case 'sondage':
            return ['points' => 0, 'correct' => null];

        case 'question_ouverte':
        case 'defi':
            // Notation humaine : la réponse est enregistrée, les points seront
            // posés par l'animateur (animation.php action=noter).
            return ['points' => 0, 'correct' => null];
    }
    return ['points' => 0, 'correct' => null];
}
