/* ============================================================================
   La page des thèmes et de l'organisation des cours (/admin/themes) :
   <cs-admin-themes> et la fenêtre <cs-admin-theme-edition>.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FauxEvenement, fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { ligneCours, rangSous, rangDansGrille, EDITEUR } = await import('../../services/web/front/ui/admin/cours/themes.js');
const { DEGRADE_PAR_DEFAUT } = await import('../../services/web/front/ui/admin/cours/theme-edition.js');

const g = /** @type {any} */ (globalThis);

/** @param {Partial<any>} [champs] */
const cours = (champs = {}) => ({ id: 1, slug: 'les-bruns', titre: 'Les bruns', emoji: '🍂', xp: 50, statut: 'publie', nb_questions: 3, termine_par: 0, termine_anonyme: 0, ...champs });

const THEMES = [
  { id: 1, slug: 'bases', nom: 'Les <bases>', emoji: '🌱', couleur: 'linear-gradient(135deg,#123456,#654321)', description: 'Pour débuter', cours: [
    cours({ id: 11, slug: 'les-bruns', titre: 'Les bruns' }),
    cours({ id: 12, slug: 'les-verts', titre: 'Les verts', statut: 'brouillon', emoji: null }),
  ] },
  { id: 2, slug: 'pratique', nom: 'Pratique', emoji: null, couleur: null, description: null, cours: [] },
];

/** La boîte de confirmation la plus récente. */
const boite = () => dom.document.querySelectorAll('cs-dialogue').at(-1);

/**
 * @param {{ themes?: any[], reorder?: any, manage?: (corps: any) => any }} [options]
 */
function serveur({ themes = THEMES, reorder = { corps: { ok: true, cours: 1 } }, manage = () => ({ corps: { ok: true, id: 3 } }) } = {}) {
  return fauxFetch((adresse, options) => {
    if (adresse === '/api/admin/themes_manage.php') {
      if (options.method === 'GET') return { corps: { themes: structuredClone(themes) } };
      return manage(JSON.parse(options.body));
    }
    if (adresse === '/api/admin/cours_reorder.php') return reorder;
    return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
  });
}

async function stabiliser() {
  for (let i = 0; i < 3; i++) await dom.stabiliser();
}

/** @param {ReturnType<typeof serveur>} [reseau] */
async function monter(reseau = serveur()) {
  const page = dom.monter('<cs-admin-themes></cs-admin-themes>');
  await stabiliser();
  return { page, reseau };
}

/**
 * Un évènement de glisser-déposer, à une position de l'écran.
 * @param {string} type
 * @param {{ x?: number, y?: number, vers?: any }} [position]
 */
function glisser(type, { x = 0, y = 0, vers = null } = {}) {
  const e = /** @type {any} */ (new FauxEvenement(type));
  e.clientX = x;
  e.clientY = y;
  e.relatedTarget = vers;
  e.dataTransfer = { donnees: '', effectAllowed: '', setData(/** @type {string} */ _t, /** @type {string} */ d) { this.donnees = d; } };
  return e;
}

/** @param {any} element @param {number} top @param {number} [left] */
function placer(element, top, left = 0) {
  element.rectangle = { left, top, right: left + 100, bottom: top + 40, width: 100, height: 40 };
}

/** @param {(adresse: string) => boolean} filtre @param {ReturnType<typeof serveur>} reseau */
const appels = (reseau, filtre) => reseau.appels.filter((a) => filtre(a.adresse));

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

// ── Fonctions pures ─────────────────────────────────────────────────────────

test('ligneCours : XP, questions, terminé par des comptes et sans compte', () => {
  assert.equal(ligneCours(cours({ nb_questions: 1 })), '50 XP · 1 question');
  assert.equal(ligneCours(cours({ nb_questions: 0 })), '50 XP · 0 question');
  assert.equal(ligneCours(cours({ termine_par: 4 })), '50 XP · 3 questions · terminé 4 fois');
  assert.equal(ligneCours(cours({ termine_par: 4, termine_anonyme: 2 })), '50 XP · 3 questions · terminé 6 fois (dont 2 sans compte)');
});

test('rangSous / rangDansGrille : devant le premier élément dont le milieu est sous le curseur', () => {
  const boites = [0, 50, 100].map((top) => ({ top, left: 0, width: 100, height: 40 }));
  assert.equal(rangSous(boites, 10), 0);
  assert.equal(rangSous(boites, 30), 1);
  assert.equal(rangSous(boites, 125), -1, 'sous le dernier : à la fin');
  // Grille à deux colonnes : même ligne, la colonne départage.
  const grille = [{ top: 0, left: 0, width: 100, height: 40 }, { top: 0, left: 200, width: 100, height: 40 }, { top: 60, left: 0, width: 100, height: 40 }];
  assert.equal(rangDansGrille(grille, 120, 20), 1);
  assert.equal(rangDansGrille(grille, 10, 20), 0, 'à gauche du milieu de la première : devant elle');
  assert.equal(rangDansGrille(grille, 280, 20), 2, 'à droite de la deuxième : devant la ligne suivante');
  assert.equal(rangDansGrille(grille, 10, 95), -1, 'sous le milieu de la dernière ligne : à la fin');
});

// ── La page ─────────────────────────────────────────────────────────────────

test('thèmes : cartes, cours, statut, couleur posée par le style, liens vers l’éditeur', async () => {
  const { page } = await monter();
  const themes = page.querySelectorAll('.theme');
  assert.equal(themes.length, 2);
  assert.match(themes[0].querySelector('.theme-nom').textContent, /^\s*Les <bases>\s*Pour débuter\s*$/);
  assert.equal(themes[0].querySelector('.theme-tete').style.background, 'linear-gradient(135deg,#123456,#654321)');
  assert.equal(themes[1].querySelector('.theme-tete').style.background, '#1e6e3e', 'couleur par défaut');
  assert.equal(themes[1].querySelector('.theme-emoji').textContent, '📂');
  assert.equal(themes[1].querySelector('.vide').textContent, 'Aucun cours — dépose-en un ici');

  const [bruns, verts] = themes[0].querySelectorAll('.cours');
  assert.equal(bruns.querySelector('.puce'), null);
  assert.equal(verts.querySelector('.puce.brouillon').textContent, 'brouillon');
  assert.equal(verts.querySelector('.cours-emoji').textContent, '📖');
  assert.equal(bruns.querySelector('.cours-modifier').getAttribute('href'), EDITEUR + '/bases/les-bruns');
  assert.equal(themes[1].querySelector('a.mini').getAttribute('href'), EDITEUR + '/pratique/nouveau');
  assert.equal(page.querySelector('[data-action="enregistrer"]').disabled, true);
});

test('thèmes : panne au chargement, dite à la place de la grille', async () => {
  const origine = console.error;
  console.error = () => {};
  try {
    const reseau = fauxFetch(() => ({ statut: 403, corps: { error: 'Accès refusé.' } }));
    const { page } = await monter(/** @type {any} */ (reseau));
    assert.match(page.querySelector('.grille .cs-etat--erreur').textContent, /Accès refusé\./);
  } finally {
    console.error = origine;
  }
});

test('glisser un cours vers un autre thème, puis enregistrer l’organisation', async () => {
  const { page, reseau } = await monter();
  const [bases, pratique] = page.querySelectorAll('.liste');
  const verts = bases.querySelectorAll('.cours')[1];

  const depart = glisser('dragstart');
  verts.dispatchEvent(depart);
  assert.ok(verts.classList.contains('attrape'));
  assert.equal(depart.dataTransfer.donnees, '12');

  pratique.dispatchEvent(glisser('dragover', { y: 10 }));
  assert.ok(pratique.classList.contains('survol'));
  assert.equal(pratique.querySelector('.vide'), null, 'le message « aucun cours » laisse la place');
  assert.equal(verts.parentElement, pratique);
  pratique.dispatchEvent(glisser('drop'));
  verts.dispatchEvent(glisser('dragend'));
  assert.ok(!verts.classList.contains('attrape') && !pratique.classList.contains('survol'));

  assert.equal(page.querySelector('.etat').textContent, 'Organisation modifiée — pense à enregistrer');
  assert.equal(page.querySelector('[data-action="enregistrer"]').disabled, false);

  page.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  const envoi = appels(reseau, (a) => a.endsWith('cours_reorder.php'));
  assert.equal(envoi.length, 1);
  assert.deepEqual(JSON.parse(envoi[0].options.body), { themes: [{ id: 1, cours: [11] }, { id: 2, cours: [12] }] });
  assert.equal(page.querySelector('.etat').textContent, 'Organisation enregistrée ✓');
  assert.equal(page.querySelector('[data-action="enregistrer"]').disabled, true);
  assert.equal(appels(reseau, (a) => a.endsWith('themes_manage.php')).length, 2, 'rechargée après l’enregistrement');
});

test('glisser un cours dans son propre thème : placé devant le cours sous le curseur', async () => {
  const { page } = await monter();
  const liste = page.querySelectorAll('.liste')[0];
  const [bruns, verts] = liste.querySelectorAll('.cours');
  placer(bruns, 0);
  placer(verts, 50);
  verts.dispatchEvent(glisser('dragstart'));
  liste.dispatchEvent(glisser('dragover', { y: 5 }));
  liste.dispatchEvent(glisser('drop'));
  assert.deepEqual(liste.querySelectorAll('.cours').map((/** @type {any} */ c) => c.dataset.coursId), ['12', '11']);
});

test('glisser un thème par son bandeau change leur ordre', async () => {
  const { page } = await monter();
  const grille = page.querySelector('.grille');
  const [bases, pratique] = page.querySelectorAll('.theme');
  placer(bases, 0, 0);
  placer(pratique, 0, 200);
  pratique.querySelector('.theme-tete').dispatchEvent(glisser('dragstart'));
  grille.dispatchEvent(glisser('dragover', { x: 10, y: 10 }));
  grille.dispatchEvent(glisser('drop'));
  assert.deepEqual(page.querySelectorAll('.theme').map((/** @type {any} */ t) => t.dataset.themeId), ['2', '1']);
  assert.equal(page.querySelector('[data-action="enregistrer"]').disabled, false);
});

test('organisation non enregistrée : le navigateur demande confirmation avant de quitter', async () => {
  const { page } = await monter();
  const avant = /** @type {any} */ (new FauxEvenement('beforeunload'));
  g.dispatchEvent(avant);
  assert.equal(avant.returnValue, undefined, 'rien à perdre');
  const verts = page.querySelectorAll('.cours')[1];
  verts.dispatchEvent(glisser('dragstart'));
  page.querySelectorAll('.liste')[1].dispatchEvent(glisser('drop'));
  const apres = /** @type {any} */ (new FauxEvenement('beforeunload'));
  g.dispatchEvent(apres);
  assert.equal(apres.returnValue, '');
});

test('enregistrement refusé : la phrase du serveur, le bouton redevient actif', async () => {
  const origine = console.error;
  console.error = () => {};
  try {
    const { page } = await monter(serveur({ reorder: { corps: { error: 'Organisation manquante.' } } }));
    page.querySelectorAll('.cours')[1].dispatchEvent(glisser('dragstart'));
    page.querySelectorAll('.liste')[1].dispatchEvent(glisser('drop'));
    page.querySelector('[data-action="enregistrer"]').click();
    await stabiliser();
    assert.equal(page.querySelector('.etat').textContent, 'Organisation manquante.');
    assert.equal(page.querySelector('[data-action="enregistrer"]').disabled, false);
  } finally {
    console.error = origine;
  }
});

// ── La fenêtre d'un thème ───────────────────────────────────────────────────

/** @param {any} page @param {string} nom */
const champ = (page, nom) => page.querySelector('cs-admin-theme-edition [data-champ="' + nom + '"]');

test('nouveau thème : valeurs proposées, adresse libre, pas de suppression ; enregistré puis rechargé', async () => {
  const { page, reseau } = await monter();
  page.querySelector('[data-action="nouveau-theme"]').click();
  await stabiliser();
  const fenetre = page.querySelector('cs-admin-theme-edition');
  assert.ok(fenetre.querySelector('.fenetre__fond').classList.contains('ouverte'));
  assert.equal(fenetre.querySelector('.fenetre__titre').textContent, 'Nouveau thème');
  assert.equal(champ(page, 'emoji').value, '📂');
  assert.equal(champ(page, 'couleur').value, DEGRADE_PAR_DEFAUT);
  assert.equal(champ(page, 'slug').disabled, false);
  assert.equal(fenetre.querySelector('.theme-suppression').hidden, true);
  assert.equal(fenetre.querySelector('.apercu-couleur').style.background, DEGRADE_PAR_DEFAUT);
  assert.equal(dom.document.activeElement, champ(page, 'nom'));

  champ(page, 'nom').saisir('Aller plus loin');
  champ(page, 'couleur').saisir('');
  assert.equal(fenetre.querySelector('.apercu-couleur').style.background, '#1e6e3e');
  fenetre.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  const envoi = reseau.appels.filter((a) => a.options.method === 'POST');
  assert.deepEqual(JSON.parse(envoi[0].options.body), { action: 'save', id: 0, nom: 'Aller plus loin', slug: '', emoji: '📂', couleur: '', description: '' });
  assert.ok(!fenetre.querySelector('.fenetre__fond').classList.contains('ouverte'));
  assert.equal(appels(reseau, (a) => a.endsWith('themes_manage.php')).length, 3, 'GET, POST, puis GET');
});

test('modifier un thème : champs remplis, adresse figée ; refus du serveur affiché dans la fenêtre', async () => {
  const origine = console.error;
  console.error = () => {};
  try {
    const { page } = await monter(serveur({ manage: () => ({ corps: { error: 'Le nom est obligatoire (120 caractères maximum).' } }) }));
    page.querySelector('[data-editer="1"]').click();
    await stabiliser();
    const fenetre = page.querySelector('cs-admin-theme-edition');
    assert.equal(fenetre.querySelector('.fenetre__titre').textContent, 'Modifier « Les <bases> »');
    assert.equal(champ(page, 'nom').value, 'Les <bases>');
    assert.equal(champ(page, 'slug').value, 'bases');
    assert.equal(champ(page, 'slug').disabled, true);
    assert.equal(champ(page, 'description').value, 'Pour débuter');
    assert.equal(fenetre.querySelector('.theme-suppression').hidden, false);
    fenetre.querySelector('[data-action="enregistrer"]').click();
    await stabiliser();
    assert.equal(fenetre.querySelector('.fenetre__erreur').textContent, 'Le nom est obligatoire (120 caractères maximum).');
    assert.ok(fenetre.querySelector('.fenetre__fond').classList.contains('ouverte'));
  } finally {
    console.error = origine;
  }
});

test('supprimer un thème : confirmation, puis la phrase du serveur s’il refuse', async () => {
  const origine = console.error;
  console.error = () => {};
  try {
    /** @type {any[]} */
    const corps = [];
    const { page } = await monter(serveur({ manage: (c) => { corps.push(c); return { corps: { error: 'Ce thème contient encore 2 cours. Déplace-les avant de le supprimer.' } }; } }));
    page.querySelector('[data-editer="1"]').click();
    await stabiliser();
    const fenetre = page.querySelector('cs-admin-theme-edition');
    fenetre.querySelector('[data-action="supprimer"]').click();
    await stabiliser();
    assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Supprimer le thème « Les <bases> » ?');
    boite().querySelector('[data-reponse="non"]').click();
    await stabiliser();
    assert.equal(corps.length, 0, 'renoncer n’envoie rien');

    fenetre.querySelector('[data-action="supprimer"]').click();
    await stabiliser();
    boite().querySelector('[data-reponse="oui"]').click();
    await stabiliser();
    assert.deepEqual(corps, [{ action: 'delete', id: 1 }]);
    assert.equal(fenetre.querySelector('.fenetre__erreur').textContent, 'Ce thème contient encore 2 cours. Déplace-les avant de le supprimer.');
  } finally {
    console.error = origine;
  }
});

test('thème modifié pendant une organisation non enregistrée : rechargement annoncé', async () => {
  const { page } = await monter();
  page.querySelectorAll('.cours')[1].dispatchEvent(glisser('dragstart'));
  page.querySelectorAll('.liste')[1].dispatchEvent(glisser('drop'));
  page.querySelector('[data-editer="2"]').click();
  await stabiliser();
  page.querySelector('cs-admin-theme-edition [data-action="enregistrer"]').click();
  await stabiliser();
  assert.equal(page.querySelector('.etat').textContent, 'Organisation rechargée : les déplacements non enregistrés ont été annulés.');
  assert.equal(page.querySelector('[data-action="enregistrer"]').disabled, true);
  const apres = /** @type {any} */ (new FauxEvenement('beforeunload'));
  g.dispatchEvent(apres);
  assert.equal(apres.returnValue, undefined);
});
