/* ============================================================================
   L'éditeur de cours monté (<cs-admin-editeur> et ses quatre onglets) :
   ouverture d'un cours, aperçu, enregistrement, création, quiz, images,
   podcast, suppression, pannes.
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { FauxEvenement, fauxFetch, installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { routeEditeur } = await import('../../services/web/front/ui/admin/cours/editeur.js');
const { avertissements, historique } = await import('../../services/web/front/ui/admin/cours/editeur-fiche.js');
const { questionsDuServeur } = await import('../../services/web/front/ui/admin/cours/quiz-edition.js');

const g = /** @type {any} */ (globalThis);

const THEMES = [
  { id: 1, slug: 'bases', nom: 'Les bases', emoji: '🌱', couleur: null, description: null, cours: [] },
  { id: 2, slug: 'pratique', nom: 'Pratique', emoji: null, couleur: null, description: null, cours: [] },
];

const TEXTE = '# Les bruns\n\nIntro du cours.\n\n## Section A\n\nTexte A.\n\n### Sources\n\n- [ADEME](https://ademe.fr)';

const COURS = {
  id: 5, slug: 'les-bruns', theme_id: 1, theme_slug: 'bases', titre: 'Les bruns', description: 'Le carbone', emoji: '🍂',
  niveau: 'intermediaire', xp: 60, statut: 'publie', ordre: 0, texte: TEXTE,
  quiz: [{ question: 'Q1', options: ['a', 'b'], correct: 1 }, { question: 'Q2', options: ['a', 'b', 'c'], correct: [0, 2], multiple: true }],
  video: { url: 'https://youtu.be/abcdefgh', titre: 'La vidéo', auteur: 'ADEME', duree: '3:47', description: '' },
  podcast: null, maj_at: '2026-11-10 10:00:00', maj_par: 'lea', termine_par: 3,
};

/** La boîte de confirmation la plus récente. */
const boite = () => dom.document.querySelectorAll('cs-dialogue').at(-1);

/**
 * @param {{ sauver?: (corps: any) => any, supprimer?: (corps: any) => any, televerser?: (corps: FormData) => any }} [options]
 */
function serveur({
  sauver = () => ({ corps: { ok: true, id: 5, slug: 'les-bruns', statut: 'publie' } }),
  supprimer = () => ({ corps: { ok: true } }),
  televerser = () => ({ corps: { ok: true, id: 4, type: 'image', url: '/api/cours/media.php?id=4', nom: 'photo.png' } }),
} = {}) {
  return fauxFetch((adresse, options) => {
    const chemin = adresse.split('?')[0];
    if (chemin === '/api/admin/themes_manage.php') return { corps: { themes: structuredClone(THEMES) } };
    if (chemin === '/api/admin/cours_get.php') return { corps: structuredClone(COURS) };
    if (chemin === '/api/admin/cours_save.php') return sauver(JSON.parse(options.body));
    if (chemin === '/api/admin/cours_delete.php') return supprimer(JSON.parse(options.body));
    if (chemin === '/api/admin/media_upload.php') return televerser(options.body);
    return { statut: 404, corps: { error: 'Endpoint non prévu par le test : ' + adresse } };
  });
}

async function stabiliser() {
  for (let i = 0; i < 4; i++) await dom.stabiliser();
}

/** L'aperçu attend un quart de seconde après la dernière frappe. */
const apresApercu = () => new Promise((resoudre) => setTimeout(resoudre, 320));

/** @param {string} [adresse] @param {ReturnType<typeof serveur>} [reseau] */
async function ouvrir(adresse = '/admin/themes-v2/bases/les-bruns', reseau = serveur()) {
  dom.aller(adresse);
  const editeur = dom.monter('<cs-admin-editeur></cs-admin-editeur>');
  await stabiliser();
  return { editeur, reseau };
}

/** @param {ReturnType<typeof serveur>} reseau @param {string} fin */
const envois = (reseau, fin) => reseau.appels.filter((a) => a.adresse.split('?')[0].endsWith(fin));

/** @param {() => Promise<void>} action */
async function enSilence(action) {
  const origine = console.error;
  console.error = () => {};
  try {
    await action();
  } finally {
    console.error = origine;
  }
}

afterEach(async () => {
  dom.vider();
  await dom.stabiliser();
});

test('routeEditeur : thème et cours lus dans l’adresse, adresse provisoire comprise', () => {
  assert.deepEqual(routeEditeur('/admin/themes/bases/les-bruns'), { prefixe: '/admin/themes', theme: 'bases', cours: 'les-bruns' });
  assert.deepEqual(routeEditeur('/admin/themes-v2/bases/nouveau'), { prefixe: '/admin/themes-v2', theme: 'bases', cours: null });
  assert.equal(routeEditeur('/admin/themes'), null);
  assert.equal(routeEditeur('/admin/themes/bases'), null);
});

test('fiche : phrases d’historique et d’avertissement', () => {
  assert.equal(historique('2026-11-10 10:00:00', 'lea'), 'Dernière modification le 2026-11-10 10:00:00 par lea');
  assert.equal(historique(null, null), "Jamais modifié depuis l'éditeur.");
  assert.equal(avertissements(0).xp, '');
  assert.match(avertissements(3).suppression, /^3 personne\(s\) ont terminé ce cours/);
});

test('un cours ouvert remplit les quatre onglets', async () => {
  const { editeur } = await ouvrir();
  assert.equal(editeur.querySelector('h1').textContent, 'Les bruns');
  assert.equal(editeur.querySelector('.fil-theme').textContent, 'Les bases');
  assert.equal(editeur.querySelector('.lien-public').getAttribute('href'), '/cours/les-bruns');
  assert.equal(editeur.querySelector('.lien-public').hidden, false);
  assert.equal(editeur.querySelector('.badge-statut').textContent, 'publie');
  assert.equal(editeur.querySelector('[data-action="publier"]').textContent, 'Repasser en brouillon');

  // Contenu : deux panneaux, sources séparées du texte.
  assert.equal(editeur.querySelectorAll('[data-corps]').length, 2);
  assert.equal(editeur.querySelector('[data-corps="0"]').value, '# Les bruns\n\nIntro du cours.');
  assert.equal(editeur.querySelector('[data-titre="1"]').value, 'Section A');
  assert.equal(editeur.querySelector('[data-corps="1"]').value, 'Texte A.');
  assert.equal(editeur.querySelector('[data-src-lib="1-0"]').value, 'ADEME');
  assert.equal(editeur.querySelector('[data-monter="0"]').disabled, true);

  // Quiz : réponse unique et réponses multiples.
  const quiz = editeur.querySelector('cs-admin-editeur-quiz');
  assert.equal(quiz.querySelectorAll('.carte').length, 2);
  assert.equal(quiz.querySelector('[data-q-correct="0-1"]').checked, true);
  assert.equal(quiz.querySelector('[data-q-correct="1-0"]').type, 'checkbox');
  assert.equal(quiz.querySelector('[data-q-multi="1"]').checked, true);

  // Médias et fiche.
  assert.equal(editeur.querySelector('[data-fiche="video"][data-champ="url"]').value, 'https://youtu.be/abcdefgh');
  assert.equal(editeur.querySelector('[data-fiche="podcast"][data-champ="url"]').value, '');
  const fiche = editeur.querySelector('cs-admin-editeur-fiche');
  assert.equal(fiche.querySelector('[data-champ="slug"]').disabled, true);
  assert.equal(fiche.querySelector('[data-champ="xp"]').value, '60');
  assert.equal(fiche.querySelector('[data-champ="niveau"]').value, 'intermediaire');
  assert.equal(fiche.querySelector('[data-champ="theme"]').value, '1');
  assert.equal(fiche.querySelector('[data-champ="statut"]').value, 'publie');
  assert.equal(fiche.querySelector('.historique').textContent, 'Dernière modification le 2026-11-10 10:00:00 par lea');
  assert.match(fiche.querySelector('.aide-xp').textContent, /3 personnes/);
  assert.equal(fiche.querySelector('.carte-suppression').hidden, false);
  assert.equal(editeur.querySelector('.etat').textContent, '', 'ouvrir n’est pas modifier');
});

test('l’aperçu montre les sections comme le lecteur', async () => {
  const { editeur } = await ouvrir();
  await apresApercu();
  await stabiliser();
  const cartes = editeur.querySelectorAll('.apercu-sections .lesson-card');
  assert.equal(cartes.length, 2);
  assert.equal(cartes[0].querySelector('.lesson-title'), null, 'introduction sans titre, le « # » retiré');
  assert.equal(cartes[1].querySelector('.lesson-title').textContent, 'Section A');
});

test('enregistrer sans rien toucher renvoie le cours tel qu’il a été lu', async () => {
  const { editeur, reseau } = await ouvrir();
  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  const [envoi] = envois(reseau, 'cours_save.php');
  assert.deepEqual(JSON.parse(envoi.options.body), {
    id: 5,
    video: { url: 'https://youtu.be/abcdefgh', titre: 'La vidéo', auteur: 'ADEME', duree: '3:47', description: '' },
    podcast: { url: '', titre: '', auteur: '', duree: '', description: '' },
    theme_id: 1, titre: 'Les bruns', slug: 'les-bruns', description: 'Le carbone', emoji: '🍂',
    niveau: 'intermediaire', xp: 60, statut: 'publie',
    texte: TEXTE,
    quiz: questionsDuServeur(COURS.quiz),
  });
  assert.equal(editeur.querySelector('.etat').textContent, 'Enregistré ✓');
});

test('une saisie est signalée et protégée jusqu’à l’enregistrement', async () => {
  const { editeur, reseau } = await ouvrir();
  editeur.querySelector('[data-corps="1"]').saisir('Texte A modifié.');
  assert.equal(editeur.querySelector('.etat').textContent, 'Modifications non enregistrées');
  const avant = /** @type {any} */ (new FauxEvenement('beforeunload'));
  g.dispatchEvent(avant);
  assert.equal(avant.returnValue, '');

  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.match(JSON.parse(envois(reseau, 'cours_save.php')[0].options.body).texte, /## Section A\n\nTexte A modifié\./);
  const apres = /** @type {any} */ (new FauxEvenement('beforeunload'));
  g.dispatchEvent(apres);
  assert.equal(apres.returnValue, undefined);
});

test('barre d’outils et blocs autour de la sélection', async () => {
  const { editeur } = await ouvrir();
  const zone = editeur.querySelector('[data-corps="1"]');
  zone.selectionStart = 0;
  zone.selectionEnd = 5;
  editeur.querySelector('[data-outil="0"][data-panneau="1"]').click();
  assert.equal(zone.value, '**Texte** A.');
  assert.deepEqual([zone.selectionStart, zone.selectionEnd], [2, 7]);
  assert.equal(dom.document.activeElement, zone);
  zone.selectionStart = zone.value.length;
  zone.selectionEnd = zone.value.length;
  editeur.querySelector('[data-bloc="tableau"][data-panneau="1"]').click();
  assert.match(zone.value, /A\.\n\| Colonne A \| Colonne B \|/);
});

test('panneaux ajoutés, déplacés, supprimés après confirmation', async () => {
  const { editeur } = await ouvrir();
  editeur.querySelector('[data-action="ajouter-panneau"]').click();
  assert.equal(editeur.querySelectorAll('[data-corps]').length, 3);
  editeur.querySelector('[data-descendre="0"]').click();
  assert.equal(editeur.querySelector('[data-titre="0"]').value, 'Section A');
  editeur.querySelector('[data-supprimer="0"]').click();
  await stabiliser();
  assert.equal(boite().querySelector('.dialogue__titre').textContent, 'Supprimer le panneau « Section A » ?');
  boite().querySelector('[data-reponse="oui"]').click();
  await stabiliser();
  assert.equal(editeur.querySelectorAll('[data-corps]').length, 2);
  assert.equal(editeur.querySelector('[data-corps="0"]').value, '# Les bruns\n\nIntro du cours.');
});

test('quiz modifié, refus de descendre sous deux réponses', async () => {
  const { editeur, reseau } = await ouvrir();
  const quiz = editeur.querySelector('cs-admin-editeur-quiz');
  quiz.querySelector('[data-action="ajouter-question"]').click();
  assert.equal(quiz.querySelectorAll('.carte').length, 3);
  quiz.querySelector('[data-q-texte="2"]').saisir('Nouvelle ?');
  quiz.querySelector('[data-q-opt="2-0"]').saisir('oui');
  quiz.querySelector('[data-q-opt="2-1"]').saisir('non');
  quiz.querySelector('[data-q-correct="2-1"]').cocher(true);
  quiz.querySelector('[data-q-opt-sup="2-0"]').click();
  assert.equal(editeur.querySelector('.erreur').textContent, 'Une question doit garder au moins deux réponses.');
  assert.equal(editeur.querySelector('.erreur').hidden, false);
  quiz.querySelector('[data-q-multi="0"]').cocher(true);
  assert.equal(quiz.querySelector('[data-q-correct="0-1"]').type, 'checkbox');

  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  const envoye = JSON.parse(envois(reseau, 'cours_save.php')[0].options.body).quiz;
  assert.deepEqual(envoye[0], { question: 'Q1', options: ['a', 'b'], correct: [1], multiple: true });
  assert.deepEqual(envoye[2], { question: 'Nouvelle ?', options: ['oui', 'non'], correct: 1 });
});

test('« Publier » bascule le statut, le badge suit la réponse du serveur', async () => {
  const { editeur, reseau } = await ouvrir(undefined, serveur({ sauver: (c) => ({ corps: { ok: true, id: 5, slug: 'les-bruns', statut: c.statut } }) }));
  editeur.querySelector('[data-action="publier"]').click();
  await stabiliser();
  assert.equal(JSON.parse(envois(reseau, 'cours_save.php')[0].options.body).statut, 'brouillon');
  assert.equal(editeur.querySelector('.badge-statut').textContent, 'brouillon');
  assert.equal(editeur.querySelector('[data-action="publier"]').textContent, 'Publier');
  assert.equal(editeur.querySelector('cs-admin-editeur-fiche [data-champ="statut"]').value, 'brouillon');
});

test('nouveau cours : titre obligatoire, puis l’adresse devient celle du cours', async () => {
  const { editeur, reseau } = await ouvrir('/admin/themes-v2/bases/nouveau', serveur({ sauver: () => ({ corps: { ok: true, id: 9, slug: 'mon-cours', statut: 'brouillon' } }) }));
  assert.equal(envois(reseau, 'cours_get.php').length, 0);
  assert.equal(editeur.querySelector('h1').textContent, 'Nouveau cours');
  assert.equal(editeur.querySelectorAll('[data-corps]').length, 1);
  const fiche = editeur.querySelector('cs-admin-editeur-fiche');
  assert.equal(fiche.querySelector('.carte-suppression').hidden, true);
  assert.equal(fiche.querySelector('[data-champ="theme"]').value, '1');

  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.equal(envois(reseau, 'cours_save.php').length, 0);
  assert.equal(editeur.querySelector('.erreur').textContent, 'Le titre est obligatoire.');
  assert.ok(editeur.querySelector('[data-onglet="fiche"]').classList.contains('actif'));

  fiche.querySelector('[data-champ="titre"]').saisir('Mon cours');
  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  const corps = JSON.parse(envois(reseau, 'cours_save.php')[0].options.body);
  assert.equal(corps.id, 0);
  assert.equal(corps.theme_id, 1);
  assert.equal(corps.statut, 'brouillon');
  assert.equal(g.location.pathname, '/admin/themes-v2/bases/mon-cours');
  assert.equal(fiche.querySelector('[data-champ="slug"]').disabled, true);
  assert.equal(fiche.querySelector('.carte-suppression').hidden, false);
  assert.equal(editeur.querySelector('h1').textContent, 'Mon cours');
  assert.equal(editeur.querySelector('.lien-public').getAttribute('href'), '/cours/mon-cours');

  // Second enregistrement : c'est une modification du cours créé.
  editeur.querySelector('[data-action="enregistrer"]').click();
  await stabiliser();
  assert.equal(JSON.parse(envois(reseau, 'cours_save.php')[1].options.body).id, 9);
});

test('enregistrement refusé : la phrase du serveur en haut, les boutons reviennent', async () => {
  await enSilence(async () => {
    const { editeur } = await ouvrir(undefined, serveur({ sauver: () => ({ corps: { error: "L'adresse « x » est déjà prise par un autre cours." } }) }));
    editeur.querySelector('[data-action="enregistrer"]').click();
    await stabiliser();
    assert.equal(editeur.querySelector('.erreur').textContent, "L'adresse « x » est déjà prise par un autre cours.");
    assert.equal(editeur.querySelector('.etat').textContent, 'Échec');
    assert.equal(editeur.querySelector('[data-action="enregistrer"]').disabled, false);
  });
});

test('image téléversée puis insérée au curseur du dernier panneau touché', async () => {
  const { editeur, reseau } = await ouvrir();
  const zone = editeur.querySelector('[data-corps="1"]');
  zone.dispatchEvent(new FauxEvenement('focusin'));
  zone.selectionStart = zone.value.length;
  zone.selectionEnd = zone.value.length;

  const choix = editeur.querySelector('cs-admin-editeur-fiche input[type="file"]');
  choix.files = [new File(['x'], 'photo.png', { type: 'image/png' })];
  choix.dispatchEvent(new FauxEvenement('change'));
  await stabiliser();
  const corps = envois(reseau, 'media_upload.php')[0].options.body;
  assert.equal(corps.get('type'), 'image');
  assert.equal(corps.get('cours_id'), '5');
  assert.equal(editeur.querySelector('.etat').textContent, 'Fichier ajouté ✓');
  assert.equal(editeur.querySelector('.image-nom').textContent, 'photo.png');

  editeur.querySelector('[data-image="0"]').click();
  assert.ok(editeur.querySelector('[data-onglet="contenu"]').classList.contains('actif'));
  assert.equal(zone.value, 'Texte A.\n![photo.png](/api/cours/media.php?id=4)\n');
});

test('podcast téléversé : adresse et titre remplis, aperçu audio', async () => {
  const { editeur } = await ouvrir(undefined, serveur({ televerser: () => ({ corps: { ok: true, id: 7, type: 'audio', url: '/api/cours/media.php?id=7', nom: 'episode-1.mp3' } }) }));
  const choix = editeur.querySelector('cs-admin-editeur-medias input[type="file"]');
  choix.files = [new File(['x'], 'episode-1.mp3', { type: 'audio/mpeg' })];
  choix.dispatchEvent(new FauxEvenement('change'));
  await stabiliser();
  assert.equal(editeur.querySelector('[data-fiche="podcast"][data-champ="url"]').value, '/api/cours/media.php?id=7');
  assert.equal(editeur.querySelector('[data-fiche="podcast"][data-champ="titre"]').value, 'episode-1');
  assert.equal(editeur.querySelector('.apercu-audio audio').getAttribute('src'), '/api/cours/media.php?id=7');
  assert.equal(editeur.querySelector('.etat').textContent, 'Modifications non enregistrées');
});

test('suppression confirmée par l’adresse, retour à la page des thèmes', async () => {
  await enSilence(async () => {
    /** @type {any[]} */
    const demandes = [];
    const { editeur } = await ouvrir(undefined, serveur({
      supprimer: (c) => {
        demandes.push(c);
        return c.confirmation === 'les-bruns' ? { corps: { ok: true } } : { corps: { error: "Saisis l'adresse « les-bruns » pour confirmer." } };
      },
    }));
    const fiche = editeur.querySelector('cs-admin-editeur-fiche');
    fiche.querySelector('[data-champ="confirmation"]').saisir('les-brun');
    assert.equal(editeur.querySelector('.etat').textContent, '', 'la confirmation n’est pas une modification du cours');
    fiche.querySelector('[data-action="supprimer"]').click();
    await stabiliser();
    assert.equal(editeur.querySelector('.erreur').textContent, "Saisis l'adresse « les-bruns » pour confirmer.");

    fiche.querySelector('[data-champ="confirmation"]').saisir('les-bruns');
    fiche.querySelector('[data-action="supprimer"]').click();
    await stabiliser();
    assert.deepEqual(demandes.at(-1), { id: 5, confirmation: 'les-bruns' });
    assert.equal(g.location.href, '/admin/themes-v2');
  });
});

test('panne au chargement, dite en haut de la page', async () => {
  await enSilence(async () => {
    const reseau = fauxFetch(() => ({ statut: 403, corps: { error: 'Accès refusé.' } }));
    const { editeur } = await ouvrir(undefined, /** @type {any} */ (reseau));
    assert.equal(editeur.querySelector('.erreur').textContent, 'Accès refusé.');
  });
});
