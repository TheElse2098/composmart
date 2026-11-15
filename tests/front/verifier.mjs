#!/usr/bin/env node
/* ============================================================================
   verifier.mjs — contrôle statique du front (services/web/front/ui).

   Le site ne tourne pas sur la machine de développement : une erreur de
   structure ne se verrait qu'en production, souvent sans message (une page
   blanche, un composant qui ne s'affiche pas, une couleur fausse en sombre).
   Ce script attrape avant le déploiement celles qui se lisent dans les
   fichiers :

     modules      syntaxe ; imports relatifs, existants, à la casse exacte
                  (Windows tolère « Outils.js », le serveur Linux non) ;
                  aucune boîte native ; ni innerHTML ni fetch hors du socle
     composants   balise conforme au nom du fichier, unique, enregistrée ;
                  feuilles de style déclarées présentes
     styles       variables utilisées = variables définies ; règles d'un
                  composant limitées à sa balise ; mode sombre par variables
     pages        aucune ligne de CSS ou de JS dans une page migrée ; en-tête
                  type ; fichiers cités présents ; chaque balise <cs-…>
                  utilisée est définie par un module que la page charge
     transition   syntaxe des scripts historiques (assets/js) et présence des
                  fichiers de ui/ auxquels ils passent la main

   Il affiche aussi l'avancement de la migration.

   Usage :  node tests/front/verifier.mjs      (code de sortie 1 s'il y a une erreur)
   Les règles elles-mêmes sont expliquées dans docs/front.md.
   ============================================================================ */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));

/** Racine du dépôt. Les tests du vérificateur en passent une autre : une copie
 *  temporaire dans laquelle ils introduisent des fautes. */
export const RACINE = resolve(ICI, '../..');

/**
 * Les emplacements du front sous une racine donnée.
 * @param {string} racine
 */
function lieux(racine) {
  const front = join(racine, 'services', 'web', 'front');
  const ui = join(front, 'ui');
  return {
    front,
    ui,
    jetons: join(ui, 'styles', 'jetons.css'),
    socleComposant: join(ui, 'socle', 'composant.js'),
    socleApi: join(ui, 'socle', 'api.js'),
    amorce: join(ui, 'socle', 'amorce.js'),
    /** Dossiers où vivent des pages : le site public et les coquilles d'administration. */
    dossiersPages: [
      front,
      join(racine, 'services', 'courses-api', 'admin-pages', 'vues'),
      join(racine, 'services', 'games-api', 'admin-pages', 'vues'),
      join(racine, 'services', 'evenements-api', 'admin-pages', 'vues'),
    ],
  };
}

// ── Fichiers ────────────────────────────────────────────────────────────────

/** @param {string} fichier */
const lire = (fichier) => readFileSync(fichier, 'utf8').replace(/\r\n/g, '\n');

/**
 * Tous les fichiers d'une extension sous un dossier.
 * @param {string} dossier @param {string} extension @param {boolean} [recursif]
 * @returns {string[]}
 */
function lister(dossier, extension, recursif = true) {
  if (!existsSync(dossier)) return [];
  /** @type {string[]} */
  const trouves = [];
  for (const nom of readdirSync(dossier).sort()) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (recursif) trouves.push(...lister(chemin, extension));
    } else if (nom.endsWith(extension)) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

/**
 * Le fichier existe-t-il sous ce nom exact ? Windows répond oui à
 * « Outils.js » pour « outils.js » ; le serveur, sous Linux, répondra 404.
 * @param {string} chemin
 * @param {string} racine  dossier à partir duquel chaque segment est comparé
 * @returns {'ok' | 'absent' | 'casse'}
 */
export function presence(chemin, racine) {
  if (!existsSync(chemin)) return 'absent';
  let courant = racine;
  for (const segment of relative(racine, chemin).split(sep)) {
    if (!readdirSync(courant).includes(segment)) return 'casse';
    courant = join(courant, segment);
  }
  return 'ok';
}

// ── Lecture du JavaScript ───────────────────────────────────────────────────

const AVANT_UNE_REGEX = /(^|[(,=:[!&|?{};+\-*%<>~^]|\b(return|typeof|case|in|of|void|delete|throw|new|else))\s*$/;

/**
 * Le source sans ses commentaires, chaînes et gabarits conservés. Sert à ne
 * pas prendre pour du code ce qu'un commentaire cite en exemple. Les sauts de
 * ligne sont gardés : les numéros de ligne restent justes.
 * @param {string} source
 * @returns {string}
 */
export function sansCommentairesJs(source) {
  let sortie = '';
  /** Contextes à retrouver en sortant d'un gabarit ou d'un `${…}`.
   *  @type {{ mode: 'code' | 'gabarit', accolades: number }[]} */
  const pile = [];
  /** @type {'code' | 'gabarit'} */
  let mode = 'code';
  let accolades = 0;
  const n = source.length;
  let i = 0;

  while (i < n) {
    const c = source[i];
    const d = source[i + 1];

    if (mode === 'gabarit') {
      if (c === '\\') { sortie += c + (d ?? ''); i += 2; continue; }
      if (c === '`') {
        sortie += c; i++;
        ({ mode, accolades } = pile.pop() ?? { mode: 'code', accolades: 0 });
        continue;
      }
      if (c === '$' && d === '{') {
        sortie += '${'; i += 2;
        pile.push({ mode: 'gabarit', accolades: 0 });
        mode = 'code'; accolades = 0;
        continue;
      }
      sortie += c; i++;
      continue;
    }

    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const fin = source.indexOf('*/', i + 2);
      const bloc = source.slice(i, fin < 0 ? n : fin + 2);
      sortie += bloc.replace(/[^\n]/g, ' ');
      i += bloc.length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      sortie += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') {
      sortie += c; i++;
      pile.push({ mode: 'code', accolades });
      mode = 'gabarit';
      continue;
    }
    if (c === '/' && AVANT_UNE_REGEX.test(sortie.slice(-40))) {
      // Expression régulière : jusqu'à la barre fermante, hors classe [ … ].
      let j = i + 1;
      let classe = false;
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '[') classe = true;
        else if (source[j] === ']') classe = false;
        else if (source[j] === '/' && !classe) break;
        j++;
      }
      sortie += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '{') accolades++;
    if (c === '}') {
      const dessus = pile[pile.length - 1];
      if (accolades === 0 && dessus && dessus.mode === 'gabarit') {
        sortie += c; i++;
        pile.pop();
        mode = 'gabarit';
        continue;
      }
      accolades--;
    }
    sortie += c; i++;
  }
  return sortie;
}

/**
 * Les modules importés par un source (déjà sans commentaires).
 * @param {string} code
 * @returns {string[]}
 */
export function importsDe(code) {
  const trouves = [];
  const motifs = [
    /(?:^|[\n;])\s*import\s+(?:[^'"`;()]*?\bfrom\s+)?['"]([^'"]+)['"]/g,
    /(?:^|[\n;])\s*export\s+[^'"`;()]*?\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const motif of motifs) for (const m of code.matchAll(motif)) trouves.push(m[1]);
  return trouves;
}

/** Résultats déjà obtenus, par source : un même fichier n'est analysé qu'une fois. @type {Map<string, string>} */
const syntaxesVues = new Map();

/**
 * Fait analyser un source par Node, sans l'exécuter.
 * @param {string} source
 * @param {boolean} classique  script ordinaire plutôt que module
 * @returns {string} chaîne vide si la syntaxe est correcte, sinon le message d'erreur
 */
export function erreurDeSyntaxe(source, classique) {
  const cle = (classique ? 'c:' : 'm:') + source;
  let resultat = syntaxesVues.get(cle);
  if (resultat === undefined) {
    const essai = spawnSync(process.execPath, classique ? ['--check', '-'] : ['--input-type=module', '--check', '-'], { input: source, encoding: 'utf8' });
    const lignes = essai.stderr.split('\n');
    resultat = essai.status === 0 ? '' : (lignes.find((l) => /Error/.test(l)) || lignes[0] || 'syntaxe refusée par Node').trim();
    syntaxesVues.set(cle, resultat);
  }
  return resultat;
}

/** Les balises `<cs-…>` écrites dans un texte. @param {string} texte @returns {Set<string>} */
export const balisesDans = (texte) => new Set([...texte.matchAll(/<(cs-[a-z0-9-]+)/g)].map((m) => m[1]));

// ── Lecture du CSS ──────────────────────────────────────────────────────────

/** @param {string} css */
const sansCommentairesCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (bloc) => bloc.replace(/[^\n]/g, ' '));

/**
 * Découpe une liste séparée par des virgules, sans couper dans les parenthèses.
 * @param {string} texte @returns {string[]}
 */
function decouper(texte) {
  const morceaux = [];
  let profondeur = 0;
  let debut = 0;
  for (let i = 0; i < texte.length; i++) {
    if (texte[i] === '(') profondeur++;
    else if (texte[i] === ')') profondeur--;
    else if (texte[i] === ',' && profondeur === 0) {
      morceaux.push(texte.slice(debut, i).trim());
      debut = i + 1;
    }
  }
  morceaux.push(texte.slice(debut).trim());
  return morceaux.filter(Boolean);
}

/**
 * Les règles d'une feuille, celles des @media comprises. Les blocs
 * @keyframes et @font-face sont ignorés : ils ne contiennent pas de sélecteurs.
 * @param {string} css  sans commentaires
 * @returns {{ selecteurs: string[], corps: string }[]}
 */
export function reglesCss(css) {
  /** @type {{ selecteurs: string[], corps: string }[]} */
  const regles = [];
  let i = 0;
  while (i < css.length) {
    const ouverture = css.indexOf('{', i);
    if (ouverture < 0) {
      if (css.slice(i).trim() !== '') throw new Error('texte hors de toute règle : « ' + css.slice(i).trim().slice(0, 40) + ' »');
      break;
    }
    let profondeur = 1;
    let fermeture = ouverture + 1;
    while (fermeture < css.length && profondeur > 0) {
      if (css[fermeture] === '{') profondeur++;
      else if (css[fermeture] === '}') profondeur--;
      fermeture++;
    }
    if (profondeur !== 0) throw new Error('accolade non refermée');

    const entete = css.slice(i, ouverture).trim();
    const corps = css.slice(ouverture + 1, fermeture - 1);
    if (/^@(media|supports)\b/.test(entete)) regles.push(...reglesCss(corps));
    else if (!entete.startsWith('@')) regles.push({ selecteurs: decouper(entete), corps });
    i = fermeture;
  }
  return regles;
}

/** Noms des propriétés déclarées dans un corps de règle. @param {string} corps @returns {string[]} */
const proprietes = (corps) => corps.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean);

/** Variables définies dans une feuille. @param {string} css @returns {Set<string>} */
const variablesDefinies = (css) => new Set([...css.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));

/** Variables utilisées sans valeur de repli. @param {string} css @returns {Set<string>} */
const variablesUtilisees = (css) => new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1]));

// ── Contrôle ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ fichier: string, message: string }} Constat
 * @typedef {{ erreurs: Constat[], avertissements: Constat[], bilan: string[] }} Rapport
 */

/**
 * @param {string} [racine]  racine du dépôt à contrôler
 * @returns {Rapport}
 */
export function controler(racine = RACINE) {
  const { front: FRONT, ui: UI, jetons: JETONS, socleComposant: SOCLE_COMPOSANT, socleApi: SOCLE_API, amorce: AMORCE, dossiersPages: DOSSIERS_PAGES } = lieux(racine);
  /** Chemin lisible, relatif au dépôt. @param {string} chemin */
  const court = (chemin) => relative(racine, chemin).split(sep).join('/');

  /** @type {Constat[]} */
  const erreurs = [];
  /** @type {Constat[]} */
  const avertissements = [];
  /** @type {string[]} */
  const bilan = [];
  /** @param {string} fichier @param {string} message */
  const erreur = (fichier, message) => erreurs.push({ fichier: court(fichier), message });

  const modules = lister(UI, '.js');
  const feuilles = lister(UI, '.css');

  /** Source sans commentaires de chaque module. @type {Map<string, string>} */
  const codes = new Map(modules.map((f) => [f, sansCommentairesJs(lire(f))]));
  /** Modules importés par chaque module. @type {Map<string, string[]>} */
  const dependances = new Map();
  /** Composant défini par chaque module. @type {Map<string, string>} */
  const baliseDe = new Map();

  // ── Modules ──
  for (const fichier of modules) {
    const code = codes.get(fichier) ?? '';
    const syntaxe = erreurDeSyntaxe(lire(fichier), fichier === AMORCE);
    if (syntaxe) {
      erreur(fichier, 'erreur de syntaxe : ' + syntaxe);
      continue;
    }

    /** @type {string[]} */
    const cibles = [];
    for (const adresse of importsDe(code)) {
      if (!adresse.startsWith('./') && !adresse.startsWith('../')) {
        erreur(fichier, 'import « ' + adresse + ' » : seuls les chemins relatifs sont admis dans le code');
        continue;
      }
      const cible = resolve(dirname(fichier), adresse);
      const etat = presence(cible, racine);
      if (etat === 'absent') erreur(fichier, 'import « ' + adresse + ' » : fichier introuvable');
      else if (etat === 'casse') erreur(fichier, 'import « ' + adresse + ' » : la casse ne correspond pas au nom du fichier (introuvable sur le serveur)');
      else if (!cible.startsWith(UI + sep)) erreur(fichier, 'import « ' + adresse + ' » : sort du dossier ui/');
      else cibles.push(cible);
    }
    dependances.set(fichier, cibles);

    const natif = code.match(/(?:^|[^.\w$])(alert|confirm|prompt)\s*\(/) || code.match(/\bwindow\.(alert|confirm|prompt)\s*\(/);
    if (natif) erreur(fichier, 'boîte native ' + natif[1] + '() : utiliser le dialogue intégré');

    if (fichier !== SOCLE_COMPOSANT) {
      const brut = code.match(/\b(innerHTML|outerHTML|insertAdjacentHTML)\b|\bdocument\.write\b/);
      if (brut) erreur(fichier, brut[0] + ' : tout HTML passe par rendre() et un gabarit html`…`');
    }
    if (fichier !== SOCLE_API && /(?:^|[^.\w$])fetch\s*\(/.test(code)) {
      erreur(fichier, 'fetch() : tout appel réseau passe par api.* (socle/api.js)');
    }

    // Composant : une balise, au nom du fichier, enregistrée.
    const balises = [...code.matchAll(/\bstatic\s+balise\s*=\s*['"]([^'"]*)['"]/g)].map((m) => m[1]).filter(Boolean);
    if (balises.length > 1) erreur(fichier, 'plusieurs composants dans le même fichier : un fichier, un composant');
    if (balises.length === 1) {
      const balise = balises[0];
      const attendue = 'cs-' + (court(fichier).includes('/ui/admin/') ? 'admin-' : '') + basename(fichier, '.js');
      if (balise !== attendue) erreur(fichier, 'balise « ' + balise + ' » : attendu « ' + attendue + ' », d’après le nom du fichier');
      if (!/\.definir\(\)/.test(code)) erreur(fichier, 'composant jamais enregistré : appeler definir() sur la classe, en fin de fichier');
      for (const [autre, deja] of baliseDe) {
        if (deja === balise) erreur(fichier, 'balise « ' + balise + ' » déjà définie par ' + court(autre));
      }
      baliseDe.set(fichier, balise);
    }

    // Feuilles de style citées par le module (celles d'un composant, celles du socle).
    for (const m of code.matchAll(/new\s+URL\(\s*['"]([^'"]+\.css)['"]\s*,\s*import\.meta\.url\s*\)/g)) {
      const etat = presence(resolve(dirname(fichier), m[1]), racine);
      if (etat !== 'ok') erreur(fichier, 'feuille de style « ' + m[1] + ' » ' + (etat === 'casse' ? ': casse différente du nom du fichier' : 'introuvable'));
    }
  }

  // ── Styles ──
  const globales = existsSync(JETONS) ? variablesDefinies(sansCommentairesCss(lire(JETONS))) : new Set();
  if (!existsSync(JETONS)) erreur(JETONS, 'fichier manquant');

  for (const fichier of feuilles) {
    const css = sansCommentairesCss(lire(fichier));
    let regles;
    try {
      regles = reglesCss(css);
    } catch (e) {
      erreur(fichier, 'CSS mal formé : ' + (e instanceof Error ? e.message : e));
      continue;
    }

    const locales = variablesDefinies(css);
    for (const variable of variablesUtilisees(css)) {
      if (!globales.has(variable) && !locales.has(variable)) {
        erreur(fichier, 'variable ' + variable + ' utilisée mais définie ni ici ni dans styles/jetons.css');
      }
    }

    if (fichier === JETONS) {
      const clair = new Set();
      for (const regle of regles) {
        const cible = regle.selecteurs.join(', ');
        if (cible !== ':root' && cible !== 'html.dark') erreur(fichier, 'sélecteur « ' + cible + ' » : ce fichier ne définit que des variables, sous :root et html.dark');
        for (const p of proprietes(regle.corps)) {
          if (!p.startsWith('--')) erreur(fichier, 'propriété « ' + p + ' » : seules des variables sont admises ici');
          else if (cible === ':root') clair.add(p);
          else if (!clair.has(p)) erreur(fichier, 'variable ' + p + ' définie en sombre mais pas en clair');
        }
      }
      continue;
    }

    // Le mode sombre ne passe que par des variables.
    for (const regle of regles) {
      if (!regle.selecteurs.some((s) => /\.dark\b/.test(s))) continue;
      const autre = proprietes(regle.corps).find((p) => !p.startsWith('--'));
      if (autre) erreur(fichier, 'règle « ' + regle.selecteurs.join(', ') + ' » : en sombre on ne redéfinit que des variables (trouvé : ' + autre + ')');
    }

    // Feuille d'un composant : ses règles ne sortent pas de chez lui.
    const balise = baliseDe.get(fichier.replace(/\.css$/, '.js'));
    if (!balise) continue;
    const nom = balise.slice(3);
    const chezLui = new RegExp('(^|[^a-z0-9-])' + balise + '(?![a-z0-9-])|\\.' + nom + '(?![a-z0-9])');
    for (const regle of regles) {
      for (const selecteur of regle.selecteurs) {
        if (!chezLui.test(selecteur)) {
          erreur(fichier, 'sélecteur « ' + selecteur + ' » : préfixer par ' + balise + ' (ou une classe .' + nom + '…) pour ne pas déborder sur le reste de la page');
        }
      }
    }
    const pose = regles.some((r) => r.selecteurs.includes(balise) && proprietes(r.corps).includes('display'));
    if (!pose) erreur(fichier, 'aucune règle « ' + balise + ' { display: … } » : une balise personnalisée est en ligne par défaut');
  }

  // ── Pages ──
  /** @param {string} depart @returns {Set<string>} modules chargés à partir d'une entrée */
  const fermeture = (depart) => {
    const vus = new Set([depart]);
    const file = [depart];
    while (file.length) {
      for (const suivant of dependances.get(file.pop() ?? '') ?? []) {
        if (!vus.has(suivant)) { vus.add(suivant); file.push(suivant); }
      }
    }
    return vus;
  };

  /** @type {string[]} */
  const migrees = [];
  /** @type {string[]} */
  const historiques = [];
  /** Scripts historiques encore utilisés, et par combien de pages. @type {Map<string, number>} */
  const anciens = new Map();
  /** @type {Set<string>} */
  const modulesCharges = new Set();

  for (const dossier of DOSSIERS_PAGES) {
    for (const page of lister(dossier, '.html', false)) {
      const source = lire(page);
      const html = source.replace(/<!--[\s\S]*?-->/g, '');
      const entrees = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="(\/ui\/[^"]+)"/g)].map((m) => m[1]);

      if (!entrees.length) {
        historiques.push(page);
        for (const m of html.matchAll(/\bsrc="\/assets\/js\/([^"?]+)/g)) anciens.set(m[1], (anciens.get(m[1]) ?? 0) + 1);
        continue;
      }
      migrees.push(page);

      if (/<style\b/i.test(html)) erreur(page, 'bloc <style> : le CSS va dans la feuille du composant');
      for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
        if (!/\bsrc=/.test(m[1]) && !/type="application\/json"/.test(m[1])) erreur(page, 'script écrit dans la page : le code va dans un module de ui/');
        const adresse = m[1].match(/\bsrc="(\/ui\/[^"]+)"/);
        if (adresse && adresse[1] !== '/ui/socle/amorce.js' && !/\btype="module"/.test(m[1])) {
          erreur(page, adresse[1] + ' chargé sans type="module" : le navigateur refusera ses imports');
        }
      }
      if (/\sstyle="/i.test(html)) erreur(page, 'attribut style="…" : passer par une classe');
      const surClic = html.match(/\s(on[a-z]+)="/i);
      if (surClic) erreur(page, 'attribut ' + surClic[1] + '="…" : les écoutes se posent dans le composant');
      const ancien = html.match(/\bsrc="(\/assets\/js\/[^"]+)"/);
      if (ancien) erreur(page, 'script historique ' + ancien[1] + ' dans une page migrée');
      const ancienStyle = html.match(/\bhref="(\/assets\/css\/(?:dark|desktop|site-nav)\.css[^"]*)"/);
      if (ancienStyle) erreur(page, 'feuille historique ' + ancienStyle[1] + ' dans une page migrée');

      // En-tête type.
      const amorce = html.indexOf('<script src="/ui/socle/amorce.js"></script>');
      const premiereFeuille = html.search(/<link\b[^>]*rel="stylesheet"/);
      if (amorce < 0) erreur(page, 'en-tête : <script src="/ui/socle/amorce.js"></script> manquant');
      else if (premiereFeuille >= 0 && amorce > premiereFeuille) erreur(page, 'en-tête : amorce.js doit précéder les feuilles de style');
      for (const feuille of ['/ui/styles/jetons.css', '/ui/styles/base.css']) {
        if (!html.includes('<link rel="stylesheet" href="' + feuille + '">')) erreur(page, 'en-tête : feuille ' + feuille + ' manquante');
      }

      // Fichiers cités.
      for (const m of html.matchAll(/\b(?:src|href)="(\/(?:ui|assets)\/[^"?#]+)/g)) {
        const etat = presence(join(FRONT, ...m[1].split('/').filter(Boolean)), racine);
        if (etat !== 'ok') erreur(page, m[1] + (etat === 'casse' ? ' : casse différente du nom du fichier' : ' : fichier introuvable'));
      }

      // Balises : chacune fermée, chacune définie par un module chargé.
      const charges = new Set();
      for (const entree of entrees) {
        const fichier = join(FRONT, ...entree.split('/').filter(Boolean));
        if (codes.has(fichier)) for (const f of fermeture(fichier)) { charges.add(f); modulesCharges.add(f); }
      }
      const definies = new Set([...charges].map((f) => baliseDe.get(f)).filter(Boolean));
      const utilisees = new Map([...balisesDans(html)].map((b) => [b, 'la page']));
      for (const fichier of charges) {
        for (const b of balisesDans(codes.get(fichier) ?? '')) if (!utilisees.has(b)) utilisees.set(b, court(fichier));
      }
      for (const [balise, ou] of utilisees) {
        if (!definies.has(balise)) erreur(page, '<' + balise + '> utilisée par ' + ou + ' mais aucun module chargé par la page ne la définit');
      }
      for (const balise of balisesDans(html)) {
        const ouvertes = (html.match(new RegExp('<' + balise + '(?![a-z0-9-])', 'g')) || []).length;
        const fermees = (html.match(new RegExp('</' + balise + '>', 'g')) || []).length;
        if (ouvertes !== fermees) erreur(page, '<' + balise + '> : ' + ouvertes + ' ouverte(s), ' + fermees + ' fermée(s) — une balise personnalisée se ferme toujours par </' + balise + '>');
      }
    }
  }

  // ── Scripts historiques (assets/js) ──
  // Le temps de la transition, certains passent la main aux composants de
  // ui/ : leur syntaxe et les fichiers qu'ils citent sont contrôlés aussi.
  for (const script of lister(join(FRONT, 'assets', 'js'), '.js', false)) {
    const source = lire(script);
    const syntaxe = erreurDeSyntaxe(source, true);
    if (syntaxe) erreur(script, 'erreur de syntaxe : ' + syntaxe);
    for (const m of sansCommentairesJs(source).matchAll(/['"](\/ui\/[^'"]+\.(?:js|css))['"]/g)) {
      const cible = join(FRONT, ...m[1].split('/').filter(Boolean));
      const etat = presence(cible, racine);
      if (etat !== 'ok') erreur(script, m[1] + (etat === 'casse' ? ' : casse différente du nom du fichier' : ' : fichier introuvable'));
      else if (codes.has(cible)) for (const f of fermeture(cible)) modulesCharges.add(f);
    }
  }

  for (const fichier of modules) {
    if (fichier !== AMORCE && !modulesCharges.has(fichier)) {
      avertissements.push({ fichier: court(fichier), message: 'module chargé par aucune page' });
    }
  }

  // ── Bilan ──
  bilan.push(modules.length + ' modules, ' + feuilles.length + ' feuilles de style, ' + baliseDe.size + ' composants');
  bilan.push(migrees.length + ' page(s) migrée(s) sur ' + (migrees.length + historiques.length) + ' : ' + migrees.map(court).map((p) => p.replace(/^services\//, '')).join(', '));
  if (anciens.size) {
    const liste = [...anciens].sort((a, b) => b[1] - a[1]).map(([nom, n]) => nom + ' (' + n + ')').join(', ');
    bilan.push('scripts historiques encore utilisés, par nombre de pages : ' + liste);
  }
  return { erreurs, avertissements, bilan };
}

// ── Exécution directe ───────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { erreurs, avertissements, bilan } = controler();
  console.log('Contrôle du front — services/web/front/ui\n');
  for (const ligne of bilan) console.log('  • ' + ligne);

  /** @param {{ fichier: string, message: string }[]} constats */
  const afficher = (constats) => {
    let precedent = '';
    for (const { fichier, message } of constats) {
      if (fichier !== precedent) console.log('\n  ' + fichier);
      console.log('      ' + message);
      precedent = fichier;
    }
  };
  if (avertissements.length) {
    console.log('\n⚠ ' + avertissements.length + ' avertissement(s)');
    afficher(avertissements);
  }
  if (erreurs.length) {
    console.log('\n✖ ' + erreurs.length + ' erreur(s)');
    afficher(erreurs);
    process.exitCode = 1;
  } else {
    console.log('\n✔ aucune erreur');
  }
}
