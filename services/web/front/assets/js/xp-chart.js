/* ============================================================================
   xp-chart.js — courbe d'XP cumulée (SVG), extraite de compte.html.

   Partagée avec la fiche joueur de l'admin (tableau-de-bord.html) : c'est la
   MÊME courbe que celle qu'un joueur voit sur son propre profil, pas une
   réinterprétation — un admin qui compare ce qu'un utilisateur lui décrit doit
   voir exactement ce que cet utilisateur voit.
   ============================================================================ */
(function () {
  'use strict';

  // completed_at/created_at viennent en 'YYYY-MM-DD HH:MM:SS' (datetime MySQL,
  // sans fuseau) : on force le 'T' pour un parsing fiable cross-navigateur.
  function parseSqlDate(s) { return new Date(String(s).replace(' ', 'T')); }

  /**
   * Agrège xp_history (liste d'événements datés {delta, created_at}, triés
   * ASC) par jour civil pour obtenir l'XP cumulée jour par jour depuis le
   * premier gain, puis rend une courbe SVG (ligne + aire légère). Série
   * unique → pas de légende, dates réelles en axe X.
   */
  function buildXpChartHtml(history, emptyMessage) {
    if (!history.length) {
      return '<div class="xp-chart-empty">' + (emptyMessage || 'Pas encore assez de données pour tracer une courbe.') + '</div>';
    }
    const byDay = new Map();
    history.forEach(function (ev) {
      const day = String(ev.created_at).slice(0, 10); // 'YYYY-MM-DD'
      byDay.set(day, (byDay.get(day) || 0) + ev.delta);
    });
    const days = Array.from(byDay.keys()); // ASC (insertion suit history, déjà trié)

    // Cumul jour par jour depuis le tout premier événement, en comblant les
    // jours sans gain (sinon la courbe "saute" les jours creux au lieu de
    // rester plate).
    const start = parseSqlDate(days[0] + ' 00:00:00');
    const end = parseSqlDate(days[days.length - 1] + ' 00:00:00');
    const totalDays = Math.round((end - start) / 86400000);
    let cumul = 0;
    const points = []; // { n, xp, dateObj }
    for (let n = 0; n <= totalDays; n++) {
      const d = new Date(start.getTime() + n * 86400000);
      // Clé locale (pas toISOString(), qui convertit en UTC et peut décaler
      // le jour) — doit matcher le format 'YYYY-MM-DD' des clés de byDay.
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      cumul += byDay.get(key) || 0;
      points.push({ n: n, xp: cumul, dateObj: d });
    }

    // Marges réduites : aucun texte n'est dessiné dans le SVG, pas de
    // gouttière à réserver pour des libellés.
    const W = 300, H = 100, PAD_L = 4, PAD_R = 4, PAD_T = 8, PAD_B = 4;
    const maxXp = points[points.length - 1].xp || 1;
    const x = function (n) { return PAD_L + (n / Math.max(1, totalDays)) * (W - PAD_L - PAD_R); };
    const y = function (xp) { return PAD_T + (1 - xp / maxXp) * (H - PAD_T - PAD_B); };

    const linePath = points.map(function (p, i) { return (i === 0 ? 'M' : 'L') + x(p.n).toFixed(1) + ',' + y(p.xp).toFixed(1); }).join(' ');
    const areaPath = linePath + ' L' + x(points[points.length - 1].n).toFixed(1) + ',' + (H - PAD_B) + ' L' + x(0).toFixed(1) + ',' + (H - PAD_B) + ' Z';

    const last = points[points.length - 1];
    const fmtDate = function (d) { return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); };
    const dotsHtml = points.map(function (p) {
      // Cercle transparent plus grand que le point visible : cible de survol confortable.
      return '<circle cx="' + x(p.n).toFixed(1) + '" cy="' + y(p.xp).toFixed(1) + '" r="7" fill="transparent">'
        + '<title>' + fmtDate(p.dateObj) + ' — ' + p.xp + ' XP</title></circle>';
    }).join('');

    // Le SVG est étiré horizontalement (preserveAspectRatio="none" pour occuper
    // toute la largeur) : tout texte ou cercle dessiné dedans serait déformé
    // d'autant. Le total passe donc en HTML au-dessus du graphe, et le trait
    // garde une épaisseur constante grâce à vector-effect.
    return ''
      + '<div class="xp-curve-total">' + last.xp + ' XP <span>au total</span></div>'
      + '<svg class="xp-curve" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Courbe d\'XP cumulée du ' + fmtDate(points[0].dateObj) + ' au ' + fmtDate(last.dateObj) + ', de 0 à ' + maxXp + ' XP">'
      +   '<line class="xp-curve-grid" vector-effect="non-scaling-stroke" x1="' + PAD_L + '" y1="' + (H - PAD_B) + '" x2="' + (W - PAD_R) + '" y2="' + (H - PAD_B) + '" />'
      +   '<path class="xp-curve-area" d="' + areaPath + '" />'
      +   '<path class="xp-curve-line" vector-effect="non-scaling-stroke" d="' + linePath + '" />'
      +   dotsHtml
      + '</svg>'
      + '<div class="xp-curve-axis"><span>' + fmtDate(points[0].dateObj) + '</span><span>' + fmtDate(last.dateObj) + '</span></div>';
  }

  window.XpChart = { parseSqlDate: parseSqlDate, buildXpChartHtml: buildXpChartHtml };
})();
