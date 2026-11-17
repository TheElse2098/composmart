/* ============================================================================
   panneaux-markdown.js — le texte d'un cours ↔ les panneaux de l'éditeur.

   Le stockage reste du markdown : c'est ce que lit la page de lecture, et ce
   dans quoi sont écrits les cours historiques. L'éditeur ne fait que le
   découper à l'ouverture et le recomposer à l'enregistrement — aucune
   conversion de format, donc aucune perte possible sur un aller-retour.

   Reprise exacte de l'ancien éditeur, remplacé le 17/11/2026 et dont une
   copie gelée sert de référence : un test compare les deux sur tous les cours
   de content/cours/ (tests/front/admin-editeur.test.mjs). Fonctions pures,
   sans DOM.
   ============================================================================ */

/**
 * @typedef {{ libelle: string, url: string }} Source
 * @typedef {{ titre: string, corps: string, sources: Source[] }} Panneau
 */

/** Le titre qui ouvre le bloc des sources d'un panneau. */
const RE_SOURCES = /^###\s+Sources?\s*$/i;

/** @returns {Panneau} */
export function panneauVide() {
  return { titre: '', corps: '', sources: [] };
}

/**
 * Découpe le texte d'un cours en panneaux, un par titre « ## ». Il y a
 * toujours au moins un panneau, vide au besoin.
 * @param {string | null | undefined} md
 * @returns {Panneau[]}
 */
export function decouperPanneaux(md) {
  /** @type {Panneau[]} */
  const panneaux = [];
  for (const part of String(md || '').split(/(?=^## )/m)) {
    const bloc = part.replace(/^\s+|\s+$/g, '');
    if (!bloc) continue;
    let titre = '';
    let corps = bloc;
    if (bloc.indexOf('## ') === 0) {
      const saut = bloc.indexOf('\n');
      titre = (saut === -1 ? bloc : bloc.slice(0, saut)).replace(/^##\s*/, '').trim();
      corps = saut === -1 ? '' : bloc.slice(saut + 1).replace(/^\s+/, '');
    }
    panneaux.push(extraireSources(titre, corps));
  }
  if (!panneaux.length) panneaux.push(panneauVide());
  return panneaux;
}

/**
 * Isole le bloc « ### Sources » d'un panneau. Attention : « ### » sert AUSSI
 * aux sous-titres ordinaires du cours (« ### La méthanisation »…). On ne
 * capture donc que le titre exact Source/Sources, et on s'arrête au premier
 * titre suivant, quel qu'il soit.
 * @param {string} titre
 * @param {string} corps
 * @returns {Panneau}
 */
export function extraireSources(titre, corps) {
  /** @type {Source[]} */
  const sources = [];
  /** @type {string[]} */
  const reste = [];
  let dansSources = false;
  for (const ligne of String(corps).split('\n')) {
    if (RE_SOURCES.test(ligne.trim())) { dansSources = true; continue; }
    if (dansSources && /^#{2,3}\s/.test(ligne.trim())) dansSources = false;
    if (dansSources) {
      const m = ligne.match(/^\s*-\s*\[([^\]]*)\]\(([^)]*)\)\s*$/);
      if (m) { sources.push({ libelle: m[1], url: m[2] }); continue; }
      if (ligne.trim() === '') continue;
      // Ligne non conforme dans le bloc sources : conservée plutôt que
      // perdue silencieusement. Sa puce « - » est retirée, puisque la
      // recomposition la remet : l'ancien éditeur la gardait, et chaque
      // enregistrement ajoutait un tiret (« - - Antoine Doré… »).
      sources.push({ libelle: ligne.trim().replace(/^-\s+/, ''), url: '' });
      continue;
    }
    reste.push(ligne);
  }
  return { titre, corps: reste.join('\n').replace(/\s+$/, ''), sources };
}

/**
 * Recompose le texte du cours à partir des panneaux. Un panneau entièrement
 * vide disparaît ; une source sans intitulé prend son adresse pour intitulé.
 * @param {Panneau[]} panneaux
 * @returns {string}
 */
export function composerPanneaux(panneaux) {
  return panneaux.map((p) => {
    /** @type {string[]} */
    const blocs = [];
    if (p.titre.trim()) blocs.push('## ' + p.titre.trim());
    if (p.corps.trim()) blocs.push(p.corps.trim());
    const sources = p.sources.filter((s) => (s.libelle || '').trim() || (s.url || '').trim());
    if (sources.length) {
      blocs.push('### Sources');
      blocs.push(sources.map((s) => {
        const libelle = (s.libelle || '').trim() || s.url;
        return (s.url || '').trim() ? '- [' + libelle + '](' + s.url.trim() + ')' : '- ' + libelle;
      }).join('\n'));
    }
    return blocs.join('\n\n');
  }).filter((b) => b.trim()).join('\n\n');
}

/**
 * Entoure la sélection d'une zone de texte (gras, lien, formule…). La
 * sélection reste sur le texte entouré.
 * @param {string} texte   contenu de la zone
 * @param {number} debut   début de la sélection
 * @param {number} fin     fin de la sélection
 * @param {string} avant
 * @param {string} apres
 * @returns {{ texte: string, debut: number, fin: number }}
 */
export function entourer(texte, debut, fin, avant, apres) {
  const choisi = texte.slice(debut, fin);
  return {
    texte: texte.slice(0, debut) + avant + choisi + apres + texte.slice(fin),
    debut: debut + avant.length,
    fin: debut + avant.length + choisi.length,
  };
}

/**
 * Remplace la sélection par un bloc (tableau, schéma, image) ; le curseur se
 * place juste après.
 * @param {string} texte
 * @param {number} debut
 * @param {number} fin
 * @param {string} bloc
 * @returns {{ texte: string, debut: number, fin: number }}
 */
export function inserer(texte, debut, fin, bloc) {
  const position = debut + bloc.length;
  return { texte: texte.slice(0, debut) + bloc + texte.slice(fin), debut: position, fin: position };
}
