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
        // `icone` : repère visuel du type, pour distinguer d'un coup d'œil les
        // lignes d'un déroulé long. Elle vit ICI et pas dans les vues : la
        // bibliothèque de parcours et la console d'animation l'affichent toutes
        // deux, et deux tables d'icônes finiraient par diverger — c'est déjà le
        // rôle de ce registre pour `nom`, `note` et `repond`.
        'titre'            => ['nom' => 'Titre de partie',      'icone' => '🔖', 'note' => false,    'repond' => false],
        'texte'            => ['nom' => 'Texte',                'icone' => '📄', 'note' => false,    'repond' => false],
        'anecdote'         => ['nom' => 'Anecdote',             'icone' => '💡', 'note' => false,    'repond' => false],
        'sommaire'         => ['nom' => 'Sommaire',             'icone' => '🗂️', 'note' => false,    'repond' => false],
        'media'            => ['nom' => 'Média plein écran',    'icone' => '🎬', 'note' => false,    'repond' => false],
        'classement'       => ['nom' => 'Classement',           'icone' => '🏆', 'note' => false,    'repond' => false],
        'fin'              => ['nom' => 'Remerciement',         'icone' => '🙏', 'note' => false,    'repond' => false],
        'encouragement'    => ['nom' => 'Encouragement',        'icone' => '🌱', 'note' => false,    'repond' => false],
        'quiz'             => ['nom' => 'Quiz (QCM)',           'icone' => '🧠', 'note' => 'auto',   'repond' => true],
        'vrai_faux'        => ['nom' => 'Vrai / Faux',          'icone' => '⚖️', 'note' => 'auto',   'repond' => true],
        'estimation'       => ['nom' => 'Estimation',           'icone' => '📏', 'note' => 'auto',   'repond' => true],
        'jeu'              => ['nom' => 'Extrait de jeu',       'icone' => '🎮', 'note' => 'auto',   'repond' => true],
        'sondage'          => ['nom' => 'Sondage',              'icone' => '📊', 'note' => false,    'repond' => true],
        'question_ouverte' => ['nom' => 'Question ouverte',     'icone' => '✍️', 'note' => 'manuel', 'repond' => true],
        'defi'             => ['nom' => 'Défi terrain',         'icone' => '🎯', 'note' => 'manuel', 'repond' => false],
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
            // Trois provenances possibles. 'libre' reste le défaut, ce qui
            // laisse valides les slides écrites avant la banque d'anecdotes.
            $source = in_array($d['source'] ?? 'libre', ['libre', 'banque', 'aleatoire'], true) ? $d['source'] : 'libre';
            $emoji  = is_string($d['emoji'] ?? null) ? mb_substr(trim($d['emoji']), 0, 8) : '';

            if ($source === 'banque') {
                $aid = (int)($d['anecdote_id'] ?? 0);
                if ($aid <= 0) return $err('Choisis une anecdote dans la banque.');
                return $ok(['source' => 'banque', 'anecdote_id' => $aid]);
            }
            if ($source === 'aleatoire') {
                return $ok([
                    'source' => 'aleatoire',
                    // Filtre facultatif : ne tirer que dans un thème donné.
                    'theme'  => is_string($d['theme'] ?? null) ? mb_substr(trim($d['theme']), 0, 60) : '',
                ]);
            }
            $corps = _txt($d['corps'] ?? null, 2000);
            if ($corps === null) return $err("L'anecdote est vide ou trop longue.");
            return $ok(['source' => 'libre', 'corps' => $corps, 'emoji' => $emoji]);

        case 'sommaire':
            // Aucun champ à saisir : le sommaire se construit tout seul à
            // partir des slides « Titre de partie » du parcours, et met en
            // valeur la partie en cours (cf. resoudre_sommaire).
            return $ok([]);

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

        case 'encouragement':
            // La progression et le score viennent du contexte au moment du
            // rendu : rien à saisir hormis le mot d'encouragement.
            $msg = _txt($d['message'] ?? null, 300);
            if ($msg === null) return $err("Le message d'encouragement est vide.");
            return $ok([
                'message'      => $msg,
                'sous_titre'   => is_string($d['sous_titre'] ?? null) ? mb_substr(trim($d['sous_titre']), 0, 200) : '',
                'montrer_score' => !empty($d['montrer_score']),
                // 'pousse' suit l'avancement du parcours, 'confettis' célèbre.
                'animation'    => in_array($d['animation'] ?? 'pousse', ['pousse', 'confettis'], true) ? $d['animation'] : 'pousse',
            ]);

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

            // « multiple » : la question porte plusieurs bonnes réponses. `correct`
            // devient alors un tableau d'index au lieu d'un entier — le même
            // discriminant de type que les quiz de cours (cours_save.php). Absent
            // par défaut : les slides existantes gardent leur forme d'origine.
            $multiple = !empty($d['multiple']);
            if ($multiple) {
                $bruts = is_array($d['correct'] ?? null) ? $d['correct'] : [];
                $correct = array_values(array_unique(array_filter(
                    array_map('intval', $bruts),
                    fn($n) => $n >= 0 && $n < count($options)
                )));
                if (!$correct) return $err('Coche au moins une bonne réponse.');
            } else {
                $correct = (int)($d['correct'] ?? -1);
                if ($correct < 0 || $correct >= count($options)) return $err('La bonne réponse ne correspond à aucune option.');
            }

            $item = [
                'question'    => $q,
                'options'     => $options,
                'correct'     => $correct,
                'explication' => is_string($d['explication'] ?? null) ? mb_substr(trim($d['explication']), 0, 1000) : '',
            ];
            if ($multiple) $item['multiple'] = true;
            return $ok($item);

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
 * Remplace une anecdote « banque » ou « aléatoire » par son texte réel.
 * À appeler AVANT slide_publique() : la slide repart ensuite avec un contenu
 * de forme 'libre' ({corps, emoji}), que le front sait déjà afficher — aucun
 * cas particulier à gérer côté navigateur.
 *
 * Le tirage aléatoire est dérivé de (participant, slide) plutôt que tiré à
 * chaque appel : l'écran du participant se rafraîchit toutes les 2,5 s, un
 * hasard recalculé ferait défiler les anecdotes sous ses yeux. Deux
 * participants obtiennent en revanche des anecdotes différentes, ce qui est
 * l'effet recherché.
 *
 * @param int|null $graine identifiant du participant, ou null côté animateur
 */
function resoudre_anecdote($conn, $slide, $graine = null) {
    if (($slide['type'] ?? '') !== 'anecdote') return $slide;
    $c = json_decode($slide['contenu'] ?? '', true);
    if (!is_array($c)) return $slide;
    $source = $c['source'] ?? 'libre';
    if ($source === 'libre') return $slide;

    $trouvee = null;

    if ($source === 'banque') {
        $aid = (int)($c['anecdote_id'] ?? 0);
        $stmt = mysqli_prepare($conn, 'SELECT texte, emoji FROM anecdotes WHERE id = ?');
        if ($stmt) {
            $stmt->bind_param('i', $aid);
            $stmt->execute();
            $trouvee = $stmt->get_result()->fetch_assoc() ?: null;
        }
    } else { // aleatoire
        $theme = trim((string)($c['theme'] ?? ''));
        if ($theme !== '') {
            $stmt = mysqli_prepare($conn, 'SELECT texte, emoji FROM anecdotes WHERE theme = ? ORDER BY id');
            if ($stmt) { $stmt->bind_param('s', $theme); }
        } else {
            $stmt = mysqli_prepare($conn, 'SELECT texte, emoji FROM anecdotes ORDER BY id');
        }
        if ($stmt) {
            $stmt->execute();
            $res = $stmt->get_result();
            $toutes = [];
            while ($row = $res->fetch_assoc()) $toutes[] = $row;
            if ($toutes) {
                // crc32 mélange bien mieux qu'un modulo sur la somme des ids :
                // sans lui, des participants d'ids voisins tomberaient sur des
                // anecdotes voisines, et l'effet « chacun la sienne » serait raté.
                $cle = ($graine === null ? 'animateur' : (string)$graine) . '-' . (int)($slide['id'] ?? 0);
                $trouvee = $toutes[crc32($cle) % count($toutes)];
            }
        }
    }

    if ($trouvee) {
        $c = ['source' => 'libre', 'corps' => $trouvee['texte'], 'emoji' => $trouvee['emoji'] ?? ''];
    } else {
        // Banque vide ou anecdote supprimée : on ne casse pas l'atelier.
        $c = ['source' => 'libre', 'corps' => '(aucune anecdote disponible)', 'emoji' => '💡'];
    }
    $slide['contenu'] = json_encode($c, JSON_UNESCAPED_UNICODE);
    return $slide;
}

/**
 * Types de slides qui reçoivent une illustration de la banque d'images.
 *
 * Sont écartés : `media` (elle porte déjà son propre visuel, en ajouter un
 * second brouillerait le message), `classement` et `sommaire` (des listes qui
 * remplissent déjà la carte), et `jeu` (les items ont leurs propres emojis).
 */
function illustration_types() {
    return ['titre', 'texte', 'anecdote', 'encouragement', 'fin',
            'quiz', 'vrai_faux', 'estimation', 'sondage', 'question_ouverte', 'defi'];
}

/**
 * Pose une illustration sur la slide, tirée de la banque d'images parmi celles
 * portant AU MOINS UN des tags retenus pour l'événement.
 *
 * Réservé au thème « simpliste » : les deux autres chartes ont leur propre
 * décor (feuillage, papier à pois) et une vignette y ferait doublon.
 *
 * Le tirage est déterministe — crc32 de l'identifiant de slide — donc le
 * vidéoprojecteur et tous les téléphones de la salle montrent la MÊME image.
 * Un tirage par participant est possible techniquement, mais l'animateur
 * commente ce qui est projeté : la salle doit voir la même chose que lui.
 *
 * Toute impasse (pas de tag, aucune image éligible, banque vide) rend la slide
 * inchangée : une carte sans illustration reste une carte lisible, alors qu'une
 * erreur en pleine séance ne se rattrape pas.
 */
function resoudre_illustration($conn, $slide, $evt) {
    if (($evt['theme_slides'] ?? '') !== 'simpliste') return $slide;
    if (!in_array($slide['type'] ?? '', illustration_types(), true)) return $slide;

    $tags = [];
    foreach (preg_split('/[,;]+/u', (string)($evt['image_tags'] ?? '')) as $t) {
        $t = mb_strtolower(trim($t));
        if ($t !== '' && !in_array($t, $tags, true)) $tags[] = $t;
    }
    if (!$tags) return $slide;

    $in = implode(',', array_fill(0, count($tags), '?'));
    $stmt = mysqli_prepare($conn,
        'SELECT DISTINCT image_id FROM image_tags WHERE tag IN (' . $in . ') ORDER BY image_id');
    if (!$stmt) return $slide;
    $stmt->bind_param(str_repeat('s', count($tags)), ...$tags);
    $stmt->execute();
    $res = $stmt->get_result();
    $ids = [];
    while ($row = $res->fetch_assoc()) $ids[] = (int)$row['image_id'];
    if (!$ids) return $slide;

    $choisie = $ids[crc32('illu-' . (int)($slide['id'] ?? 0)) % count($ids)];

    // L'URL voyage DANS le contenu : slide_publique() reconstruit un tableau
    // avec des clés fixes, une clé posée à la racine de $slide serait perdue.
    $c = json_decode($slide['contenu'] ?? '', true);
    if (!is_array($c)) $c = [];
    $c['illustration'] = '/api/evenements/image.php?id=' . $choisie;
    $slide['contenu'] = json_encode($c, JSON_UNESCAPED_UNICODE);
    return $slide;
}

/**
 * Construit le sommaire à la volée : chaque slide « titre » du parcours est une
 * partie, et l'on marque celle où l'on se trouve — comme le sommaire de Beamer.
 *
 * Règle de position, calquée sur l'usage (un sommaire inséré juste avant
 * chaque partie) : les parties situées AVANT ce sommaire sont passées, la
 * première située après est celle qui commence, les autres sont à venir.
 * Rien n'est saisi à la main : ajouter une partie au parcours met tous les
 * sommaires à jour sans y toucher.
 */
function resoudre_sommaire($conn, $slide, $evenement_id) {
    if (($slide['type'] ?? '') !== 'sommaire') return $slide;

    $stmt = mysqli_prepare($conn,
        "SELECT ordre, titre FROM evenement_slides
         WHERE evenement_id = ? AND type = 'titre' ORDER BY ordre, id");
    if (!$stmt) return $slide;
    $stmt->bind_param('i', $evenement_id);
    $stmt->execute();
    $res = $stmt->get_result();

    $mien = (int)($slide['ordre'] ?? 0);
    $sections = [];
    $couranteTrouvee = false;
    while ($row = $res->fetch_assoc()) {
        $ordre = (int)$row['ordre'];
        if ($ordre < $mien) {
            $etat = 'passee';
        } elseif (!$couranteTrouvee) {
            $etat = 'courante';
            $couranteTrouvee = true;
        } else {
            $etat = 'avenir';
        }
        $sections[] = ['nom' => $row['titre'] ?: 'Partie ' . (count($sections) + 1), 'etat' => $etat];
    }

    $slide['contenu'] = json_encode(['sections' => $sections], JSON_UNESCAPED_UNICODE);
    return $slide;
}

/**
 * Version d'une slide envoyable à un participant qui n'a PAS encore répondu :
 * la clé de correction est retirée du contenu. C'est la garantie centrale du
 * jeu — sans elle, la bonne réponse est lisible côté navigateur avant même de
 * cliquer. L'explication est également retenue jusqu'à la réponse.
 *
 * @param int|null $graine identifiant du participant, pour le tirage déterministe
 *                         des tuiles du mot-mystère (cf. plus bas) — null côté
 *                         animateur (qui reçoit de toute façon le contenu complet
 *                         ailleurs, jamais par cette fonction).
 */
function slide_publique($slide, $reponse_donnee = false, $graine = null) {
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
                //
                // Le mot-mystère est un cas particulier : le participant doit
                // pouvoir RÉARRANGER les lettres du mot, comme dans le jeu de
                // base (jeu-mot-mystere.html) — il lui faut donc les lettres,
                // seul leur ORDRE (la clé de correction) est secret. Le tirage
                // est dérivé du participant + de la slide + de l'item plutôt que
                // vraiment aléatoire : l'écran se rafraîchit toutes les 2,5 s
                // (chargerEtat en polling), un nouveau tirage à chaque appel
                // mélangerait les tuiles sous les doigts du joueur en pleine
                // partie. Même logique que resoudre_anecdote().
                $jeu_slide = $c['jeu'] ?? '';
                $sid = (int)($slide['id'] ?? 0);
                $c['items'] = array_map(function ($it, $i) use ($jeu_slide, $sid, $graine) {
                    if ($jeu_slide === 'mot-mystere' && isset($it['mot']) && is_string($it['mot'])) {
                        // mb_str_split, pas str_split : un mot accentué (ÉCOSYSTÈME)
                        // couperait un caractère UTF-8 en deux octets invalides.
                        $lettres = mb_str_split($it['mot']);
                        $cle = ($graine === null ? 'animateur' : (string)$graine) . '-' . $sid . '-' . $i;
                        for ($k = count($lettres) - 1; $k > 0; $k--) {
                            $j = crc32($cle . '-' . $k) % ($k + 1);
                            [$lettres[$k], $lettres[$j]] = [$lettres[$j], $lettres[$k]];
                        }
                        // Un tirage qui retombe sur l'ordre d'origine donnerait
                        // le mot tout cuit : permuter les deux premières tuiles.
                        if (count($lettres) > 1 && implode('', $lettres) === $it['mot']) {
                            [$lettres[0], $lettres[1]] = [$lettres[1], $lettres[0]];
                        }
                        $it['lettres'] = $lettres;
                    }
                    unset($it['cat'], $it['jours'], $it['mot'], $it['info']);
                    return $it;
                }, $c['items'] ?? [], array_keys($c['items'] ?? []));
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
            if (!empty($contenu['multiple']) && is_array($contenu['correct'] ?? null)) {
                // Crédit partiel, même formule que les quiz de cours
                // (complete.php) : 1/n par bonne réponse cochée, -1/n par
                // mauvaise, borné à [0, 1] (n = nombre de bonnes réponses).
                $bonnes = array_map('intval', $contenu['correct']);
                $n = count($bonnes);
                if ($n < 1) return ['points' => 0, 'correct' => false];
                $choisies = is_array($reponse) ? array_map('intval', $reponse) : [];
                $vrais = count(array_intersect($choisies, $bonnes));
                $faux  = count(array_diff($choisies, $bonnes));
                $credit = max(0, min(1, ($vrais - $faux) / $n));
                return ['points' => (int)round($points_max * $credit), 'correct' => $credit >= 1];
            }
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
