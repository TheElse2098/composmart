/* ============================================================================
   La carte de slide des ateliers : le nouveau module (ui/composants/slide/)
   doit dessiner EXACTEMENT la même carte que l'ancien slide-render.js, sur
   chaque type de slide et dans chaque état. C'est ce qui garantit que les
   téléphones et la projection montrent la même chose, même quand une page
   ancienne et une page nouvelle coexistent.

   L'ancien script (copie gelée dans reference/) tourne dans un contexte isolé.
   Son échappement passe par la même fonction que le nouveau : c'est la seule
   différence voulue (le nouveau protège aussi les guillemets, ce qui ne se
   voit pas à l'écran et rend les attributs sûrs).
   ============================================================================ */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { echapper } = await import('../../services/web/front/ui/socle/outils.js');
const { texteSlide, rendreSlide, rejouer, avecRangs } = await import('../../services/web/front/ui/composants/slide/rendu-slide.js');
const { mediaHtml, ouvrirFacade } = await import('../../services/web/front/ui/composants/slide/media-slide.js');

const REFERENCE = new URL('reference/', import.meta.url);

/**
 * L'ancien générateur, dans un contexte isolé. `papier` : le thème de la page
 * (l'ancien le lisait sur <body data-theme-slide>).
 * @param {boolean} papier
 * @returns {(s: any, o: any) => string}
 */
function ancien(papier) {
  /** @type {any} */
  const contexte = {
    Math, String, Number, Boolean, Array, Object, JSON, isFinite,
    document: {
      createElement: () => {
        let texte = '';
        return {
          set textContent(v) { texte = v; },
          get innerHTML() { return echapper(texte); },
        };
      },
      addEventListener: () => {},
      head: { appendChild: () => {} },
      body: { getAttribute: (/** @type {string} */ nom) => (nom === 'data-theme-slide' && papier ? 'papier' : null) },
    },
  };
  contexte.window = contexte;
  vm.createContext(contexte);
  vm.runInContext(readFileSync(new URL('media-embed.js', REFERENCE), 'utf8'), contexte);
  vm.runInContext(readFileSync(new URL('slide-render.js', REFERENCE), 'utf8'), contexte);
  return contexte.rendreSlideHtml;
}

const ANCIEN = ancien(false);
const ANCIEN_PAPIER = ancien(true);

// ── Les slides ──────────────────────────────────────────────────────────────

const CLASSEMENT = {
  joueurs: [
    { nom: 'Léa', points: 40 }, { nom: 'Marc', points: 30 }, { nom: 'Zoé', points: 30 },
    { nom: 'Ali', points: 20 }, { nom: 'Ben', points: 10 }, { nom: 'Cé<b>', points: 5 }, { nom: 'Dan', points: 0 },
  ],
  equipes: [{ nom: 'Les Vers', points: 70 }, { nom: 'Compost & co', points: 50 }, { nom: 'Bacs', points: 40 }, { nom: 'Pelles', points: 10 }],
  moi: { nom: 'Dan', points: 0, rang: 7 },
  mon_equipe: { nom: 'Pelles', points: 10, rang: 4 },
  nb_joueurs: 9,
  nb_equipes: 4,
};

/** @type {any[]} */
const SLIDES = [
  { id: 1, type: 'titre', titre: 'Le compost <en vrai>', contenu: { sous_titre: 'Partie 1 "intro"' } },
  { id: 2, type: 'titre', titre: 'Sans sous-titre', contenu: {} },
  { id: 3, type: 'fin', titre: '', contenu: { message: 'À bientôt', afficher_classement: true } },
  { id: 4, type: 'fin', titre: 'Fini', contenu: { message: 'Merci' } },
  { id: 5, type: 'texte', titre: 'À retenir', contenu: { corps: 'Le carbone & l\'azote' } },
  { id: 6, type: 'texte', titre: '', contenu: { corps: 'Sans titre' } },
  { id: 7, type: 'anecdote', titre: 'Les vers', contenu: { corps: 'Un ver mange son poids', emoji: '🪱' } },
  { id: 8, type: 'anecdote', titre: '', contenu: { corps: 'Emoji par défaut' } },
  { id: 9, type: 'sommaire', contenu: { sections: [{ nom: 'Intro', etat: 'passee' }, { nom: 'Bac', etat: 'courante' }, { nom: 'Fin' }] } },
  { id: 10, type: 'classement', titre: '', contenu: { portee: 'les_deux' } },
  { id: 11, type: 'classement', titre: 'Équipes', contenu: { portee: 'equipe' } },
  { id: 12, type: 'classement', titre: 'Joueurs', contenu: { portee: 'individuel' } },
  { id: 13, type: 'encouragement', contenu: { message: 'Bravo !', sous_titre: 'Continue', montrer_score: true } },
  { id: 14, type: 'encouragement', contenu: { message: 'Fête', animation: 'confettis' } },
  { id: 15, type: 'media', titre: 'Photo', contenu: { media_type: 'image', url: '/img/a "b".jpg', legende: 'Un bac' } },
  { id: 16, type: 'media', titre: 'Son', contenu: { media_type: 'audio', url: '/son.mp3', legende: 'Écoute' } },
  { id: 17, type: 'media', titre: '', contenu: { media_type: 'video', url: 'https://youtu.be/abcDEF_123' } },
  { id: 18, type: 'media', titre: 'Fichier', contenu: { media_type: 'video', url: '/video.mp4' } },
  { id: 19, type: 'media', titre: 'Vimeo', contenu: { media_type: 'video', url: 'https://vimeo.com/123456' } },
  { id: 20, type: 'defi', titre: '', points: 10, contenu: { consigne: 'Trouvez un ver' } },
  { id: 21, type: 'quiz', points: 5, contenu: { question: 'Le marc ?', options: ['Oui', 'Non', '<Peut-être>'], correct: 0, explication: 'Il aère' } },
  { id: 22, type: 'quiz', points: 5, contenu: { question: 'Bruns ?', options: ['Carton', 'Tonte', 'Feuilles'], correct: [0, 2], multiple: true } },
  { id: 23, type: 'vrai_faux', points: 3, contenu: { question: 'Les os ?', correct: false, explication: 'Non' } },
  { id: 24, type: 'sondage', contenu: { question: 'Tu composts ?', options: ['Oui', 'Non'] } },
  { id: 25, type: 'estimation', points: 4, contenu: { question: 'Combien ?', valeur: 30, unite: 'kg', tolerance: 5, explication: 'Environ' } },
  { id: 26, type: 'estimation', contenu: { question: 'Sans unité', valeur: 3 } },
  { id: 27, type: 'question_ouverte', points: 2, contenu: { question: 'Pourquoi ?', max_car: 200 } },
  { id: 28, type: 'jeu', points: 6, contenu: { jeu: 'compost-ou-pas', items: [{ emoji: '🍌', nom: 'Banane', cat: 'oui' }, { nom: 'Os', cat: 'non' }] } },
  { id: 29, type: 'jeu', contenu: { jeu: 'temps-decompo', items: [{ emoji: '🍎', nom: 'Pomme', jours: 60 }, { nom: 'Verre', jours: 1000000 }] } },
  { id: 30, type: 'jeu', titre: 'Mots', contenu: { jeu: 'mot-mystere', items: [{ emoji: '🪱', nom: 'Il creuse', mot: 'VER', lettres: ['R', 'V', 'E'] }] } },
  { id: 31, type: 'texte', titre: 'Illustrée', contenu: { corps: 'x', illustration: '/api/evenements/image.php?id=4' } },
  { id: 32, type: 'inconnu', titre: 'Type <inconnu>' },
];

/** Les réponses possibles d'un participant, par type. @type {Record<string, any[]>} */
const REPONSES = {
  quiz: [{ reponse: 1, points: 0, correct: false }, { reponse: 0, points: 5, correct: true }, { reponse: [0, 1], points: 2.5, correct: null }],
  vrai_faux: [{ reponse: 1, points: 0, correct: false }, { reponse: 0, points: 3, correct: true }],
  sondage: [{ reponse: 1 }],
  estimation: [{ reponse: 28, points: 4, correct: true }, { reponse: 'x<y', points: 0, correct: false }],
  question_ouverte: [{ reponse: 'Parce que <c\'est bon>', points: 0, correct: null }],
  jeu: [{ reponse: ['oui', 'attention'], points: 3, correct: null }, { reponse: [70, 'abc'], points: 0, correct: false }, { reponse: [' ver '], points: 6, correct: true }],
};

/** Les états d'affichage : projection, participant avant et après réponse, correction. */
const ETATS = [
  {},
  { fixe: true },
  { fixe: true, correction: true, position: { index: 2, total: 9 }, classement: CLASSEMENT },
  { interactif: true, position: { index: 0, total: 1 }, classement: CLASSEMENT, moiPoints: 12 },
  { interactif: true, position: { index: 8, total: 9 }, classement: { joueurs: [], equipes: [] } },
];

/** Toutes les combinaisons slide × état × réponse. */
function* cas() {
  for (const s of SLIDES) {
    for (const o of ETATS) {
      yield { s, o };
      for (const r of REPONSES[s.type] || []) yield { s, o: { ...o, maReponse: r } };
    }
  }
}

test('slide : même HTML que l’ancien générateur, sur chaque type, chaque état, chaque réponse', () => {
  let n = 0;
  for (const { s, o } of cas()) {
    const attendu = ANCIEN(structuredClone(s), structuredClone(o));
    assert.equal(texteSlide(structuredClone(s), structuredClone(o)), attendu, s.type + ' ' + JSON.stringify(o).slice(0, 80));
    n++;
  }
  assert.ok(n > 250, n + ' cas comparés');
});

test('slide : thème papier (pétales, confettis) identique aussi', () => {
  for (const s of SLIDES.filter((x) => x.type === 'encouragement')) {
    for (const o of ETATS) {
      assert.equal(texteSlide(s, { ...o, papier: true }), ANCIEN_PAPIER(s, o), s.contenu.animation || 'plante');
    }
  }
});

test('slide : les confettis tombent pareil sur tous les écrans (tirage déterminé par la slide)', () => {
  const s = SLIDES.find((x) => x.contenu && x.contenu.animation === 'confettis');
  assert.equal(texteSlide(s, {}), texteSlide(s, {}));
  assert.notEqual(texteSlide(s, {}), texteSlide({ ...s, id: 99 }, {}));
});

test('slide : texte des données échappé, guillemets compris', () => {
  const carte = texteSlide({ type: 'texte', titre: '<img src=x onerror=alert(1)>', contenu: { corps: '"guillemets"', illustration: '/x" onerror="alert(1)' } }, {});
  assert.ok(!carte.includes('<img src=x'));
  assert.ok(carte.includes('src="/x&quot; onerror=&quot;alert(1)"'), 'un attribut ne peut pas être refermé');
  assert.equal(String(rendreSlide({ type: 'titre', titre: 'a', contenu: {} })), texteSlide({ type: 'titre', titre: 'a', contenu: {} }));
});

test('avecRangs : rang sportif (1, 2, 2, 4)', () => {
  assert.deepEqual(avecRangs([{ points: 9 }, { points: 5 }, { points: 5 }, { points: 1 }]).map((x) => x.rang), [1, 2, 2, 4]);
  assert.equal(avecRangs([{ points: 9, rang: 3 }])[0].rang, 3, 'un rang donné par le serveur l’emporte');
});

test('média : façade sans requête vers la plateforme, ouverte au clic', () => {
  assert.match(mediaHtml({ url: 'https://www.youtube.com/watch?v=abcDEF_123' }), /^<div class="slide-embed"><div class="video-facade" data-src="https:\/\/www\.youtube-nocookie\.com\/embed\/abcDEF_123\?autoplay=1">/);
  assert.equal(mediaHtml({ url: '' }), '');
  const cadre = dom.monter('<div>' + mediaHtml({ url: 'https://vimeo.com/42' }) + '</div>');
  ouvrirFacade(cadre.querySelector('.video-facade-btn'));
  assert.equal(cadre.querySelector('.video-facade'), null);
  assert.equal(cadre.querySelector('iframe').src, 'https://player.vimeo.com/video/42?dnt=1&autoplay=1');
});

test('rejouer : la scène est remplacée par un clone neuf, la carte marquée animée', () => {
  const carte = dom.monter('<div class="sl"><div data-scene><i class="sl__halo"></i></div><button data-rejouer>Rejouer</button></div>');
  const avant = carte.querySelector('[data-scene]');
  avant.cloneNode = () => { const neuf = dom.document.createElement('div'); neuf.setAttribute('data-scene', ''); return neuf; };
  rejouer(carte.querySelector('[data-rejouer]'));
  assert.notEqual(carte.querySelector('[data-scene]'), avant);
  assert.equal(carte.hasAttribute('data-anime'), true);
  dom.vider();
});
