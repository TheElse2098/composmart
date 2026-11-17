/* ============================================================================
   ancien-editeur-cours.js — le découpage du texte d'un cours en panneaux et sa
   recomposition, tels qu'écrits dans l'ancien éditeur
   (courses-api/admin-pages/vues/cours.html, remplacé le 17/11/2026).

   Copie gelée, mot pour mot, qui sert de référence aux tests : le nouvel
   éditeur (ui/admin/cours/panneaux-markdown.js) doit produire le même texte
   sur tous les cours, à une correction près, documentée dans
   tests/front/admin-editeur.test.mjs. Script classique, exécuté par le test
   dans un contexte isolé ; composerMarkdown() lit la variable panneaux.
   À ne pas modifier.
   ============================================================================ */
var panneaux = [];

var RE_SOURCES = /^###\s+Sources?\s*$/i;

function parserMarkdown(md) {
  var res = [];
  var parts = String(md || '').split(/(?=^## )/m);
  parts.forEach(function (part) {
    var brut = part.replace(/^\s+|\s+$/g, '');
    if (!brut) return;
    var titre = '';
    var corps = brut;
    if (brut.indexOf('## ') === 0) {
      var saut = brut.indexOf('\n');
      titre = (saut === -1 ? brut : brut.slice(0, saut)).replace(/^##\s*/, '').trim();
      corps = saut === -1 ? '' : brut.slice(saut + 1).replace(/^\s+/, '');
    }
    res.push(extraireSources(titre, corps));
  });
  if (!res.length) res.push({ titre: '', corps: '', sources: [] });
  return res;
}

/* Isole le bloc « ### Sources » d'un panneau. Attention : « ### » sert AUSSI
   aux sous-titres ordinaires du cours (« ### La méthanisation »…). On ne
   capture donc que le titre exact Source/Sources, et on s'arrête au premier
   titre suivant, quel qu'il soit. */
function extraireSources(titre, corps) {
  var lignes = String(corps).split('\n');
  var sources = [];
  var reste = [];
  var dansSources = false;
  lignes.forEach(function (l) {
    if (RE_SOURCES.test(l.trim())) { dansSources = true; return; }
    if (dansSources && /^#{2,3}\s/.test(l.trim())) { dansSources = false; }
    if (dansSources) {
      var m = l.match(/^\s*-\s*\[([^\]]*)\]\(([^)]*)\)\s*$/);
      if (m) { sources.push({ libelle: m[1], url: m[2] }); return; }
      if (l.trim() === '') return;
      // Ligne non conforme dans le bloc sources : conservée telle quelle
      // plutôt que perdue silencieusement.
      sources.push({ libelle: l.trim(), url: '' });
      return;
    }
    reste.push(l);
  });
  return { titre: titre, corps: reste.join('\n').replace(/\s+$/, ''), sources: sources };
}

function composerMarkdown() {
  return panneaux.map(function (p) {
    var out = [];
    if (p.titre.trim()) out.push('## ' + p.titre.trim());
    if (p.corps.trim()) out.push(p.corps.trim());
    var src = p.sources.filter(function (s) { return (s.libelle || '').trim() || (s.url || '').trim(); });
    if (src.length) {
      out.push('### Sources');
      out.push(src.map(function (s) {
        var lib = (s.libelle || '').trim() || s.url;
        return (s.url || '').trim() ? '- [' + lib + '](' + s.url.trim() + ')' : '- ' + lib;
      }).join('\n'));
    }
    return out.join('\n\n');
  }).filter(function (b) { return b.trim(); }).join('\n\n');
}
