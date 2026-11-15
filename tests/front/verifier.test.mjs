/* ============================================================================
   Tests du vérificateur lui-même.

   Un garde-fou qui ne signale rien ne prouve rien : ces tests copient le front
   dans un dossier temporaire, y introduisent une faute à la fois, et vérifient
   que le vérificateur la nomme. Rien n'est modifié dans le dépôt.
   ============================================================================ */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { RACINE, balisesDans, controler, erreurDeSyntaxe, importsDe, reglesCss, sansCommentairesJs } from './verifier.mjs';

// ── Lecture du JavaScript et du CSS ─────────────────────────────────────────

test('sansCommentairesJs retire les commentaires, garde chaînes et gabarits', () => {
  const code = sansCommentairesJs([
    '// <cs-fantome> cité en exemple',
    "const a = 'http://exemple.fr'; /* <cs-autre> */",
    'const b = html`<cs-vrai></cs-vrai> // pas un commentaire`;',
  ].join('\n'));
  assert.doesNotMatch(code, /cs-fantome|cs-autre/);
  assert.match(code, /http:\/\/exemple\.fr/);
  assert.match(code, /<cs-vrai><\/cs-vrai> \/\/ pas un commentaire/);
  assert.equal(code.split('\n').length, 3, 'les numéros de ligne sont conservés');
});

test('sansCommentairesJs suit les gabarits imbriqués, même avec une adresse dedans', () => {
  const code = sansCommentairesJs([
    'const x = html`<ul>${liens.map((l) => html`<li><a href="https://osm.org/${l}">x</a></li>`)}</ul>`; // fin',
    'import { suite } from "./suite.js";',
  ].join('\n'));
  assert.match(code, /https:\/\/osm\.org/);
  assert.doesNotMatch(code, /fin/);
  assert.deepEqual(importsDe(code), ['./suite.js']);
});

test('sansCommentairesJs ne prend pas une expression régulière pour une chaîne', () => {
  const code = sansCommentairesJs([
    'const propre = texte.replace(/[&<>"\']/g, echapper); // note',
    'const chemin = adresse.replace(/\\/+$/, "");',
    'import "./apres.js";',
  ].join('\n'));
  assert.doesNotMatch(code, /note/);
  assert.deepEqual(importsDe(code), ['./apres.js']);
});

test('importsDe : import nommé, import seul, réexport, import dynamique', () => {
  const code = [
    "import { a, b } from './a.js';",
    "import './effet.js';",
    "export { c } from '../c.js';",
    "const m = await import('./paresseux.js');",
    "const texte = 'import x from \"./faux.js\"';",
  ].join('\n');
  assert.deepEqual(importsDe(code).sort(), ['../c.js', './a.js', './effet.js', './paresseux.js']);
});

test('balisesDans ne retient que les balises cs-', () => {
  assert.deepEqual([...balisesDans('<cs-pied></cs-pied><div><cs-fil-discussion ticket="3">')], ['cs-pied', 'cs-fil-discussion']);
});

test('reglesCss : @media déplié, @keyframes ignoré, :not(a, b) non coupé', () => {
  const regles = reglesCss([
    'cs-x { display: block; }',
    '@media (min-width: 900px) { cs-x .a, cs-x .b:not(.c, .d) { color: red; } }',
    '@keyframes cs-x-tourne { from { opacity: 0; } to { opacity: 1; } }',
  ].join('\n'));
  assert.deepEqual(regles.map((r) => r.selecteurs), [['cs-x'], ['cs-x .a', 'cs-x .b:not(.c, .d)']]);
});

test('reglesCss refuse une accolade non refermée', () => {
  assert.throws(() => reglesCss('cs-x { color: red;'), /accolade non refermée/);
});

test('erreurDeSyntaxe : module correct, module fautif, script classique', () => {
  assert.equal(erreurDeSyntaxe('export const a = 1;', false), '');
  assert.match(erreurDeSyntaxe('export const a = ;', false), /SyntaxError/);
  assert.equal(erreurDeSyntaxe('(function () { var a = 1; })();', true), '');
});

// ── Sur le dépôt ────────────────────────────────────────────────────────────

test('le dépôt passe le contrôle', () => {
  assert.deepEqual(controler().erreurs, []);
});

// ── Fautes introduites dans une copie ───────────────────────────────────────

const UI = 'services/web/front/ui/';
const PAGE = 'services/web/front/classement.html';
/** @type {string} */
let copie;

before(() => {
  copie = mkdtempSync(join(tmpdir(), 'composmart-verificateur-'));
  // Le front sans ses bibliothèques (lourdes, et jamais lues par le contrôle),
  // et les coquilles d'administration.
  cpSync(join(RACINE, 'services', 'web', 'front'), join(copie, 'services', 'web', 'front'), {
    recursive: true,
    filter: (source) => !source.includes(join('assets', 'vendor')),
  });
  for (const service of ['courses-api', 'games-api', 'evenements-api']) {
    const vues = join('services', service, 'admin-pages', 'vues');
    cpSync(join(RACINE, vues), join(copie, vues), { recursive: true });
  }
});

after(() => {
  rmSync(copie, { recursive: true, force: true });
});

/**
 * Modifie un fichier de la copie, lance le contrôle, remet le fichier en état.
 * @param {string} fichier  chemin relatif au dépôt
 * @param {(contenu: string) => string} modifier
 * @returns {string[]} les messages d'erreur, préfixés par le fichier concerné
 */
function fautes(fichier, modifier) {
  const chemin = join(copie, ...fichier.split('/'));
  const origine = readFileSync(chemin, 'utf8');
  const modifie = modifier(origine);
  assert.notEqual(modifie, origine, 'la modification de test ne s’est pas appliquée à ' + fichier);
  writeFileSync(chemin, modifie);
  try {
    return controler(copie).erreurs.map((e) => e.fichier + ' → ' + e.message);
  } finally {
    writeFileSync(chemin, origine);
  }
}

/** @param {string[]} messages @param {RegExp} motif */
function attendre(messages, motif) {
  assert.ok(messages.some((m) => motif.test(m)), 'erreur attendue ' + motif + ', obtenu :\n  ' + (messages.join('\n  ') || '(aucune erreur)'));
}

test('la copie intacte passe le contrôle', () => {
  assert.deepEqual(controler(copie).erreurs, []);
});

test('faute : erreur de syntaxe dans un module', () => {
  attendre(fautes(UI + 'socle/session.js', (s) => s.replace('class Session {', 'class Session {{')), /session\.js → erreur de syntaxe/);
});

test('faute : import à la mauvaise casse', () => {
  attendre(fautes(UI + 'composants/pied/pied.js', (s) => s.replace('socle/outils.js', 'socle/Outils.js')), /pied\.js → import « \.\.\/\.\.\/socle\/Outils\.js » : la casse/);
});

test('faute : import d’un fichier qui n’existe pas', () => {
  attendre(fautes(UI + 'composants/pied/pied.js', (s) => s.replace('socle/outils.js', 'socle/utiles.js')), /pied\.js → import .* fichier introuvable/);
});

test('faute : import par chemin absolu', () => {
  attendre(fautes(UI + 'composants/pied/pied.js', (s) => s.replace("'../../socle/outils.js'", "'/ui/socle/outils.js'")), /seuls les chemins relatifs/);
});

test('faute : boîte native', () => {
  attendre(fautes(UI + 'pages/classement/classement.js', (s) => s.replace('this.#inviter();', "alert('Connecte-toi');")), /classement\.js → boîte native alert\(\)/);
  attendre(fautes(UI + 'pages/classement/classement.js', (s) => s.replace('this.#inviter();', "if (!window.confirm('?')) return;")), /boîte native confirm\(\)/);
});

test('un commentaire qui cite alert() ou innerHTML n’est pas une faute', () => {
  const messages = fautes(UI + 'composants/pied/pied.js', (s) => s + '\n// Ni alert() ni innerHTML ici : voir docs/front.md.\n');
  assert.deepEqual(messages, []);
});

test('faute : HTML inséré sans passer par rendre()', () => {
  attendre(fautes(UI + 'composants/pied/pied.js', (s) => s.replace('this.rendre(this.gabarit());', "this.innerHTML = '<footer></footer>';")), /pied\.js → innerHTML : tout HTML passe par rendre\(\)/);
});

test('faute : appel réseau sans passer par api.*', () => {
  attendre(fautes(UI + 'socle/session.js', (s) => s.replace("api.auth.get('me.php')", "fetch('/api/auth/me.php').then((r) => r.json())")), /session\.js → fetch\(\) : tout appel réseau passe par api/);
});

test('faute : balise qui ne porte pas le nom du fichier', () => {
  attendre(fautes(UI + 'composants/pied/pied.js', (s) => s.replace("'cs-pied'", "'cs-pied-de-page'")), /balise « cs-pied-de-page » : attendu « cs-pied »/);
  attendre(fautes(UI + 'admin/accueil/accueil.js', (s) => s.replace("'cs-admin-accueil'", "'cs-accueil'")), /attendu « cs-admin-accueil »/);
});

test('faute : composant jamais enregistré', () => {
  attendre(fautes(UI + 'composants/pied/pied.js', (s) => s.replace('Pied.definir();', '')), /pied\.js → composant jamais enregistré/);
});

test('faute : feuille de style déclarée mais absente', () => {
  attendre(fautes(UI + 'composants/pied/pied.js', (s) => s.replace("'./pied.css'", "'./pieds.css'")), /feuille de style « \.\/pieds\.css » introuvable/);
});

test('faute : variable CSS utilisée sans être définie', () => {
  attendre(fautes(UI + 'composants/pied/pied.css', (s) => s.replace('var(--menthe)', 'var(--menth)')), /pied\.css → variable --menth utilisée mais définie ni ici/);
});

test('faute : règle qui déborde du composant', () => {
  attendre(fautes(UI + 'pages/classement/classement.css', (s) => s + '\n.hero { padding: 0; }\n'), /classement\.css → sélecteur « \.hero » : préfixer par cs-classement/);
  attendre(fautes(UI + 'pages/classement/classement.css', (s) => s + '\n@media (min-width: 900px) { cs-classement .a, h1 { margin: 0; } }\n'), /sélecteur « h1 »/);
});

test('faute : balise personnalisée laissée en ligne', () => {
  attendre(fautes(UI + 'composants/pied/pied.css', (s) => s.replace('display: block; width: 100%; margin-top: auto;', 'width: 100%; margin-top: auto;')), /aucune règle « cs-pied \{ display: … \} »/);
});

test('faute : couleur écrite en dur dans une règle de mode sombre', () => {
  attendre(fautes(UI + 'composants/pied/pied.css', (s) => s + '\nhtml.dark cs-pied .pied__bas { color: #fff; }\n'), /en sombre on ne redéfinit que des variables \(trouvé : color\)/);
});

test('faute : jetons — variable sombre sans valeur claire, propriété ordinaire', () => {
  attendre(fautes(UI + 'styles/jetons.css', (s) => s.replace('--alerte-texte: #ef9a9a;', '--alerte-texte: #ef9a9a;\n  --orpheline: #000;')), /variable --orpheline définie en sombre mais pas en clair/);
  attendre(fautes(UI + 'styles/jetons.css', (s) => s + '\nbody { margin: 0; }\n'), /jetons\.css → sélecteur « body »/);
});

test('faute : CSS ou JavaScript écrits dans une page migrée', () => {
  attendre(fautes(PAGE, (s) => s.replace('</head>', '<style>body { margin: 0; }</style>\n</head>')), /classement\.html → bloc <style>/);
  attendre(fautes(PAGE, (s) => s.replace('</body>', '<script>console.log(1);</script>\n</body>')), /script écrit dans la page/);
  attendre(fautes(PAGE, (s) => s.replace('<cs-pied>', '<cs-pied style="margin: 0">')), /attribut style=/);
  attendre(fautes(PAGE, (s) => s.replace('<div class="cs-lisere">', '<div class="cs-lisere" onclick="x()">')), /attribut onclick=/);
});

test('une donnée de route en JSON reste admise dans une page migrée', () => {
  const messages = fautes(PAGE, (s) => s.replace('</body>', '<script type="application/json" id="route">{"id":3}</script>\n</body>'));
  assert.deepEqual(messages, []);
});

test('faute : script ou feuille historique dans une page migrée', () => {
  attendre(fautes(PAGE, (s) => s.replace('</body>', '<script src="/assets/js/theme.js"></script>\n</body>')), /script historique \/assets\/js\/theme\.js/);
  attendre(fautes(PAGE, (s) => s.replace('</head>', '<link rel="stylesheet" href="/assets/css/desktop.css">\n</head>')), /feuille historique \/assets\/css\/desktop\.css/);
});

test('faute : en-tête type incomplet ou dans le désordre', () => {
  attendre(fautes(PAGE, (s) => s.replace('  <script src="/ui/socle/amorce.js"></script>\n', '')), /amorce\.js"><\/script> manquant/);
  attendre(fautes(PAGE, (s) => s.replace('  <link rel="stylesheet" href="/ui/styles/jetons.css">\n', '')), /feuille \/ui\/styles\/jetons\.css manquante/);
  attendre(fautes(PAGE, (s) => s
    .replace('  <script src="/ui/socle/amorce.js"></script>\n', '')
    .replace('</head>', '<script src="/ui/socle/amorce.js"></script>\n</head>')), /amorce\.js doit précéder les feuilles de style/);
});

test('faute : fichier cité par la page, absent ou à la mauvaise casse', () => {
  attendre(fautes(PAGE, (s) => s.replace('/ui/composants/pied/pied.css', '/ui/composants/pied/Pied.css')), /Pied\.css : casse différente/);
  attendre(fautes(PAGE, (s) => s.replace('/ui/composants/pied/pied.css', '/ui/composants/pied/absent.css')), /absent\.css : fichier introuvable/);
});

test('faute : balise utilisée sans le module qui la définit', () => {
  attendre(fautes(PAGE, (s) => s.replace('  <script type="module" src="/ui/composants/pied/pied.js"></script>\n', '')), /<cs-pied> utilisée par la page mais aucun module chargé/);
});

test('faute : balise d’un composant enfant jamais importée', () => {
  const messages = fautes(UI + 'pages/classement/classement.js', (s) => s.replace('<main class="board"></main>', '<main class="board"></main><cs-courbe-xp></cs-courbe-xp>'));
  attendre(messages, /<cs-courbe-xp> utilisée par .*classement\.js mais aucun module chargé/);
});

test('faute : balise personnalisée non refermée', () => {
  attendre(fautes(PAGE, (s) => s.replace('<cs-pied></cs-pied>', '<cs-pied />')), /<cs-pied> : 1 ouverte\(s\), 0 fermée\(s\)/);
});

test('faute : module chargé sans type="module"', () => {
  attendre(fautes(PAGE, (s) => s.replace('<script type="module" src="/ui/composants/pied/pied.js">', '<script src="/ui/composants/pied/pied.js">')), /pied\.js chargé sans type="module"/);
});

test('faute : la coquille d’administration est contrôlée comme les autres pages', () => {
  const coquille = 'services/courses-api/admin-pages/vues/accueil.html';
  attendre(fautes(coquille, (s) => s.replace('<cs-admin-accueil></cs-admin-accueil>', '<cs-admin-acceuil></cs-admin-acceuil>')), /accueil\.html → <cs-admin-acceuil> utilisée par la page/);
});

test('faute : deux composants pour la même balise', () => {
  const origine = join(copie, ...(UI + 'composants/pied/pied.js').split('/'));
  const double = join(copie, ...(UI + 'pages/classement/pied.js').split('/'));
  cpSync(origine, double); // même profondeur sous ui/ : ses imports restent valides
  try {
    attendre(controler(copie).erreurs.map((e) => e.fichier + ' → ' + e.message), /balise « cs-pied » déjà définie par/);
  } finally {
    rmSync(double);
  }
});

test('un module que rien ne charge est signalé en avertissement, pas en erreur', () => {
  const orphelin = join(copie, ...(UI + 'composants/pied/ancien.js').split('/'));
  writeFileSync(orphelin, 'export const rien = 0;\n');
  try {
    const rapport = controler(copie);
    assert.deepEqual(rapport.erreurs, []);
    assert.ok(rapport.avertissements.some((a) => a.fichier.endsWith('pied/ancien.js') && /chargé par aucune page/.test(a.message)));
  } finally {
    rmSync(orphelin);
  }
});

// Sur Windows, le système de fichiers ne distingue pas la casse : c'est le cas
// que le contrôle doit attraper à la place du serveur.
test('renommer un fichier à la mauvaise casse est détecté depuis ses importateurs', () => {
  const dossier = join(copie, ...(UI + 'socle').split('/'));
  renameSync(join(dossier, 'theme.js'), join(dossier, 'Theme.js'));
  try {
    const messages = controler(copie).erreurs.map((e) => e.fichier + ' → ' + e.message);
    attendre(messages, /bandeau\.js → import « \.\.\/\.\.\/socle\/theme\.js » : (la casse|fichier introuvable)/);
  } finally {
    renameSync(join(dossier, 'Theme.js'), join(dossier, 'theme.js'));
  }
});
