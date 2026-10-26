<?php
/**
 * État complet d'un composteur, tel que le garde le journal d'audit :
 * avant une modification (pour en montrer l'avant/après) et avant une
 * suppression (pour pouvoir le recréer à l'identique, règles comprises).
 * Utilisé par sites.php et pending.php.
 */

/** Renvoie null si le composteur n'existe pas. */
function compost_etat($conn, $id) {
    $id = (int)$id;
    $stmt = mysqli_prepare($conn,
        'SELECT latitude, longitude, type, publique, gestion, info_gestion, statut, propose_par, created_at
         FROM composts WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $c = $stmt->get_result()->fetch_assoc();
    if (!$c) return null;

    $mettre = []; $pas_mettre = [];
    $res = mysqli_query($conn,
        "SELECT e.nom, r.autorise FROM regles r JOIN elements e ON e.id = r.id_element
         WHERE r.id_compost = $id ORDER BY e.nom");
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        if ((int)$r['autorise'] === 1) $mettre[] = $r['nom']; else $pas_mettre[] = $r['nom'];
    }

    return [
        'type'         => $c['type'],
        'acces'        => $c['publique'],
        'gestion'      => $c['gestion'],
        'info_gestion' => $c['info_gestion'],
        'mettre'       => $mettre,
        'pas_mettre'   => $pas_mettre,
        'lat'          => (double)$c['latitude'],
        'lon'          => (double)$c['longitude'],
        'statut'       => $c['statut'],
        'propose_par'  => $c['propose_par'],
        'created_at'   => $c['created_at'],
    ];
}

/** Les champs modifiables d'un composteur (ceux que compare l'avant/après). */
function compost_champs_modifiables($etat) {
    if (!$etat) return [];
    return array_intersect_key($etat, array_flip(['type', 'acces', 'gestion', 'info_gestion', 'mettre', 'pas_mettre']));
}
