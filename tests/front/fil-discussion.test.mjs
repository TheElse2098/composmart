/* ============================================================================
   <cs-fil-discussion> : la fenêtre de discussion d'un ticket, essayée avec un
   point de vue d'essai (aucun serveur : le composant ne connaît pas les
   endpoints, c'est son parent qui les lui donne).
   ============================================================================ */
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { installerFauxDom } from './faux-dom.mjs';

const dom = installerFauxDom();
const { FilDiscussion, dateMessage, gabaritStatut } = await import('../../services/web/front/ui/composants/fil-discussion/fil-discussion.js');
const { ErreurApi } = await import('../../services/web/front/ui/socle/api.js');

const STATUTS = { ouvert: 'Ouvert', clos: 'Clos', clos_definitif: 'Fermé' };

/**
 * Un point de vue d'essai et le « serveur » qu'il interroge.
 * @param {{ admin?: boolean, statut?: string }} [options]
 */
function essai({ admin = false, statut = 'ouvert' } = {}) {
  const serveur = {
    /** @type {Record<number, any>} */
    fils: {
      12: {
        ticket: { id: 12, sujet: 'La carte <plante>', statut, username: 'lea' },
        messages: [
          { auteur: 'lea', est_admin: false, corps: 'Bonjour,\nla carte ne charge plus <b>du tout</b>.', created_at: '2026-11-14T09:15:00' },
          { auteur: 'eliott', est_admin: true, corps: 'On regarde.', created_at: '2026-11-14 10:00:00' },
        ],
      },
      13: { ticket: { id: 13, sujet: 'Autre', statut: 'ouvert', username: 'sam' }, messages: [{ auteur: 'sam', est_admin: false, corps: 'Coucou', created_at: '2026-11-15 08:00:00' }] },
    },
    lectures: 0,
    /** @type {[number, string][]} */
    reponses: [],
    /** @type {[number, string][]} */
    actions: [],
    /** @type {Error | null} */
    panne: null,
    /** @type {string | null} */
    refus: null,
  };
  /** @type {import('../../services/web/front/ui/composants/fil-discussion/fil-discussion.js').PointDeVue} */
  const vue = {
    admin,
    statuts: STATUTS,
    invite: 'Écrire un message…',
    lire: async (id) => {
      serveur.lectures++;
      if (serveur.panne) throw serveur.panne;
      return structuredClone(serveur.fils[id]);
    },
    repondre: async (id, corps) => {
      if (serveur.refus) throw new ErreurApi(serveur.refus, { statut: 200 });
      serveur.reponses.push([id, corps]);
      serveur.fils[id].messages.push({ auteur: admin ? 'eliott' : 'lea', est_admin: admin, corps, created_at: '2026-11-16 12:00:00' });
    },
    agir: async (id, action) => {
      if (serveur.refus) throw new ErreurApi(serveur.refus, { statut: 200 });
      serveur.actions.push([id, action]);
      serveur.fils[id].ticket.statut = action === 'clore' ? 'clos' : action === 'rouvrir' ? 'ouvert' : 'clos_definitif';
    },
    titre: (ticket) => '#' + ticket.id + ' · ' + ticket.sujet,
    auteur: (message) => (message.est_admin ? message.auteur + ' · ADMIN' : 'Moi'),
    lectureSeule: (s) => (s === 'clos' ? 'Clos — rouvre-le pour répondre.' : 'Fermé pour de bon.'),
    actions: (s) => {
      if (s === 'ouvert') return [{ action: 'clore', libelle: '✓ Résolu' }, { action: 'fermer_definitif', libelle: '⛔ Fermer', danger: true, confirmation: { titre: 'Fermer pour de bon ?', valider: 'Fermer', danger: true } }];
      return s === 'clos' ? [{ action: 'rouvrir', libelle: '↺ Rouvrir' }] : [];
    },
  };
  return { vue, serveur };
}

/** Monte la fenêtre, lui donne son point de vue, l'ouvre sur un ticket. */
async function ouvrir(/** @type {ReturnType<typeof essai>} */ { vue }, id = 12) {
  const fil = /** @type {any} */ (dom.monter('<cs-fil-discussion></cs-fil-discussion>'));
  await dom.stabiliser();
  fil.configurer(vue);
  fil.ouvrir(id);
  await dom.stabiliser();
  return fil;
}

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

/** @param {any} fil  ses bulles : côté, auteur et date, texte */
const bulles = (fil) => fil.querySelectorAll('.bulle').map((/** @type {any} */ b) => [b.classList.contains('moi') ? 'moi' : 'autre', b.children[0].textContent, b.children[1].textContent]);

afterEach(async () => {
  mock.timers.reset();
  dom.vider();
  await dom.stabiliser();
});

// ── Fonctions ───────────────────────────────────────────────────────────────

test('gabaritStatut : libellé du point de vue, classe de l’état ; un état inconnu garde son code', () => {
  assert.equal(String(gabaritStatut('clos_definitif', STATUTS)), '<span class="fil-discussion-statut clos_definitif">Fermé</span>');
  assert.equal(String(gabaritStatut('ouvert', { ouvert: 'Ouvert' })), '<span class="fil-discussion-statut ouvert">Ouvert</span>');
  assert.equal(String(gabaritStatut('en <attente>', STATUTS)), '<span class="fil-discussion-statut">en &lt;attente&gt;</span>');
});

test('dateMessage : à la minute, sans le T', () => {
  assert.equal(dateMessage('2026-11-14T09:15:00'), '2026-11-14 09:15');
  assert.equal(dateMessage(null), '');
});

// ── Ouverture et affichage ──────────────────────────────────────────────────

test('ouvrir sans point de vue est une erreur de programmation, dite clairement', async () => {
  const fil = /** @type {any} */ (dom.monter('<cs-fil-discussion></cs-fil-discussion>'));
  await dom.stabiliser();
  assert.throws(() => fil.ouvrir(12), /configurer\(\) doit être appelé avant ouvrir\(\)/);
});

test('fil : titre, état, bulles dans l’ordre, texte échappé, zone de réponse', async () => {
  const e = essai();
  const fil = await ouvrir(e);

  assert.equal(fil.ouverte, true);
  assert.equal(fil.querySelector('.fil-titre').textContent, '#12 · La carte <plante>');
  assert.equal(fil.querySelector('.fil-discussion-statut').textContent, 'Ouvert');
  assert.deepEqual(bulles(fil), [
    ['moi', 'Moi · 2026-11-14 09:15', 'Bonjour,\nla carte ne charge plus <b>du tout</b>.'],
    ['autre', 'eliott · ADMIN · 2026-11-14 10:00', 'On regarde.'],
  ]);
  assert.equal(fil.querySelector('.fil-messages b'), null, 'le texte d’un message n’est jamais lu comme du HTML');
  assert.equal(fil.querySelector('.fil-saisie').hidden, false);
  assert.equal(fil.querySelector('textarea').placeholder, 'Écrire un message…');
  assert.equal(fil.querySelector('.fil-info').hidden, true);
  assert.equal(fil.querySelector('.fil-erreur').hidden, true);
  assert.deepEqual(fil.querySelectorAll('.fil-action').map((/** @type {any} */ b) => [b.textContent, b.classList.contains('danger')]), [['✓ Résolu', false], ['⛔ Fermer', true]]);
});

test('fil : vu par un administrateur, les côtés s’inversent', async () => {
  const fil = await ouvrir(essai({ admin: true }));
  assert.deepEqual(bulles(fil).map((b) => b[0]), ['autre', 'moi']);
});

test('fil : ticket clos, plus de zone de réponse mais une explication et « Rouvrir »', async () => {
  const fil = await ouvrir(essai({ statut: 'clos' }));
  assert.equal(fil.querySelector('.fil-saisie').hidden, true);
  assert.equal(fil.querySelector('.fil-info').hidden, false);
  assert.equal(fil.querySelector('.fil-info').textContent, 'Clos — rouvre-le pour répondre.');
  assert.deepEqual(fil.querySelectorAll('.fil-action').map((/** @type {any} */ b) => b.textContent), ['↺ Rouvrir']);
});

test('fil : ticket fermé pour de bon, lecture seule et aucune action', async () => {
  const fil = await ouvrir(essai({ statut: 'clos_definitif' }));
  assert.equal(fil.querySelector('.fil-info').textContent, 'Fermé pour de bon.');
  assert.equal(fil.querySelectorAll('.fil-action').length, 0);
  assert.equal(fil.querySelector('.fil-discussion-statut').classList.contains('clos_definitif'), true);
});

test('fil : passer d’un ticket à l’autre n’affiche que le dernier demandé', async () => {
  const e = essai();
  const fil = /** @type {any} */ (dom.monter('<cs-fil-discussion></cs-fil-discussion>'));
  await dom.stabiliser();
  fil.configurer(e.vue);
  fil.ouvrir(12);
  fil.ouvrir(13);
  await dom.stabiliser();
  assert.equal(fil.querySelector('.fil-titre').textContent, '#13 · Autre');
  assert.deepEqual(bulles(fil).map((b) => b[2]), ['Coucou']);
});

// ── Répondre ────────────────────────────────────────────────────────────────

test('répondre : le texte part sans ses blancs, la zone se vide, le fil se relit', async () => {
  const e = essai();
  const fil = await ouvrir(e);
  fil.querySelector('textarea').saisir('  Merci !  ');
  fil.querySelector('[data-action="envoyer"]').click();
  assert.equal(fil.querySelector('[data-action="envoyer"]').disabled, true, 'pas de double envoi');
  await dom.stabiliser();

  assert.deepEqual(e.serveur.reponses, [[12, 'Merci !']]);
  assert.equal(fil.querySelector('textarea').value, '');
  assert.equal(fil.querySelector('[data-action="envoyer"]').disabled, false);
  assert.deepEqual(bulles(fil).at(-1), ['moi', 'Moi · 2026-11-16 12:00', 'Merci !']);
});

test('répondre : un message vide ne part pas ; Ctrl+Entrée envoie, Entrée seule non', async () => {
  const e = essai();
  const fil = await ouvrir(e);
  const zone = fil.querySelector('textarea');

  zone.saisir('   ');
  fil.querySelector('[data-action="envoyer"]').click();
  await dom.stabiliser();
  assert.deepEqual(e.serveur.reponses, []);

  zone.saisir('Une ligne');
  zone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await dom.stabiliser();
  assert.deepEqual(e.serveur.reponses, [], 'Entrée seule va à la ligne');

  zone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
  await dom.stabiliser();
  assert.deepEqual(e.serveur.reponses, [[12, 'Une ligne']]);

  zone.saisir('Sur Mac');
  zone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
  await dom.stabiliser();
  assert.equal(e.serveur.reponses.length, 2);
});

test('répondre : refusé, la raison s’affiche sous le fil et le texte reste dans la zone', async () => {
  await enSilence(async () => {
    const e = essai();
    const fil = await ouvrir(e);
    e.serveur.refus = 'Le message doit faire entre 1 et 3000 caractères.';
    fil.querySelector('textarea').saisir('Trop long');
    fil.querySelector('[data-action="envoyer"]').click();
    await dom.stabiliser();

    assert.equal(fil.querySelector('.fil-erreur').hidden, false);
    assert.equal(fil.querySelector('.fil-erreur').textContent, 'Le message doit faire entre 1 et 3000 caractères.');
    assert.equal(fil.querySelector('textarea').value, 'Trop long');
    assert.equal(fil.querySelector('[data-action="envoyer"]').disabled, false);

    e.serveur.refus = null;
    fil.querySelector('[data-action="envoyer"]').click();
    await dom.stabiliser();
    assert.equal(fil.querySelector('.fil-erreur').hidden, true, 'l’erreur s’efface au succès suivant');
  });
});

// ── Actions sur le ticket ───────────────────────────────────────────────────

test('action : clore passe le ticket en lecture seule, rouvrir rend la zone de réponse', async () => {
  const e = essai();
  const fil = await ouvrir(e);
  fil.querySelector('[data-agir="clore"]').click();
  await dom.stabiliser();
  assert.deepEqual(e.serveur.actions, [[12, 'clore']]);
  assert.equal(fil.querySelector('.fil-discussion-statut').textContent, 'Clos');
  assert.equal(fil.querySelector('.fil-saisie').hidden, true);

  fil.querySelector('[data-agir="rouvrir"]').click();
  await dom.stabiliser();
  assert.deepEqual(e.serveur.actions.at(-1), [12, 'rouvrir']);
  assert.equal(fil.querySelector('.fil-saisie').hidden, false);
  assert.equal(fil.querySelector('.fil-info').hidden, true);
});

test('action à confirmer : rien ne part avant le oui, rien du tout après un non', async () => {
  const e = essai();
  const fil = await ouvrir(e);

  fil.querySelector('[data-agir="fermer_definitif"]').click();
  await dom.stabiliser();
  const refus = dom.document.querySelector('cs-dialogue');
  assert.equal(refus.querySelector('.dialogue__titre').textContent, 'Fermer pour de bon ?');
  assert.deepEqual(e.serveur.actions, []);
  refus.querySelector('[data-reponse="non"]').click();
  await dom.stabiliser();
  assert.deepEqual(e.serveur.actions, []);
  dom.document.querySelectorAll('cs-dialogue').forEach((/** @type {any} */ b) => b.remove());

  fil.querySelector('[data-agir="fermer_definitif"]').click();
  await dom.stabiliser();
  dom.document.querySelector('cs-dialogue [data-reponse="oui"]').click();
  await dom.stabiliser();
  assert.deepEqual(e.serveur.actions, [[12, 'fermer_definitif']]);
  assert.equal(fil.querySelectorAll('.fil-action').length, 0);
});

test('action refusée : la raison s’affiche, l’état ne bouge pas', async () => {
  await enSilence(async () => {
    const e = essai();
    const fil = await ouvrir(e);
    e.serveur.refus = "Le ticket a changé d'état entre-temps.";
    fil.querySelector('[data-agir="clore"]').click();
    await dom.stabiliser();
    assert.equal(fil.querySelector('.fil-erreur').textContent, "Le ticket a changé d'état entre-temps.");
    assert.equal(fil.querySelector('.fil-discussion-statut').textContent, 'Ouvert');
    assert.equal(fil.querySelector('[data-agir="clore"]').disabled, false);
  });
});

// ── Relecture et fermeture ──────────────────────────────────────────────────

test('relecture : toutes les 8 secondes ; un fil inchangé n’est pas redessiné, un nouveau message apparaît', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const e = essai();
  const fil = await ouvrir(e);
  const premiere = fil.querySelector('.bulle');
  assert.equal(e.serveur.lectures, 1);

  mock.timers.tick(7999);
  assert.equal(e.serveur.lectures, 1);
  mock.timers.tick(1);
  await dom.stabiliser();
  assert.equal(e.serveur.lectures, 2);
  assert.equal(fil.querySelector('.bulle'), premiere, 'mêmes éléments : une sélection de texte en cours survit');

  e.serveur.fils[12].messages.push({ auteur: 'eliott', est_admin: true, corps: 'Corrigé.', created_at: '2026-11-16 09:00:00' });
  mock.timers.tick(8000);
  await dom.stabiliser();
  assert.deepEqual(bulles(fil).map((b) => b[2]).at(-1), 'Corrigé.');
});

test('relecture en panne : le fil reste, la panne se dit, et s’efface à la lecture suivante', async () => {
  await enSilence(async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const e = essai();
    const fil = await ouvrir(e);

    e.serveur.panne = new ErreurApi('Connexion au serveur impossible.');
    mock.timers.tick(8000);
    await dom.stabiliser();
    assert.equal(fil.querySelectorAll('.bulle').length, 2);
    assert.equal(fil.querySelector('.fil-erreur').textContent, 'Connexion au serveur impossible.');

    e.serveur.panne = null;
    mock.timers.tick(8000);
    await dom.stabiliser();
    assert.equal(fil.querySelector('.fil-erreur').hidden, true);
  });
});

test('première lecture en panne : pas de « Chargement… » éternel, un message', async () => {
  await enSilence(async () => {
    const e = essai();
    e.serveur.panne = new ErreurApi('Ticket introuvable.', { statut: 404 });
    const fil = await ouvrir(e);
    assert.equal(fil.querySelector('.fil-messages .cs-etat'), null);
    assert.equal(fil.querySelector('.fil-erreur').textContent, 'Ticket introuvable.');
  });
});

test('une réponse commencée survit à une fermeture par mégarde, mais ne suit pas dans un autre ticket', async () => {
  const fil = await ouvrir(essai());
  fil.querySelector('textarea').saisir('Je commence à répondre');
  dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(fil.ouverte, false);

  fil.ouvrir(12);
  assert.equal(fil.querySelector('textarea').value, 'Je commence à répondre');
  fil.fermer();
  fil.ouvrir(13);
  assert.equal(fil.querySelector('textarea').value, '');
});

test('fermeture : le parent est prévenu, la relecture s’arrête, la zone est vide à la réouverture', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const e = essai();
  const fil = await ouvrir(e);
  /** @type {string[]} */
  const signaux = [];
  fil.addEventListener('fil-ferme', () => signaux.push('fil-ferme'));
  fil.querySelector('textarea').saisir('Brouillon');

  fil.querySelector('.fil-fermer').click();
  assert.equal(fil.ouverte, false);
  assert.deepEqual(signaux, ['fil-ferme']);
  mock.timers.tick(30000);
  await dom.stabiliser();
  assert.equal(e.serveur.lectures, 1, 'plus de relecture, fenêtre fermée');

  fil.ouvrir(13);
  await dom.stabiliser();
  assert.equal(fil.querySelector('textarea').value, '');
  assert.equal(e.serveur.lectures, 2);
});

test('fenêtre retirée de la page : la relecture s’arrête', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const e = essai();
  const fil = await ouvrir(e);
  fil.remove();
  await dom.stabiliser();
  mock.timers.tick(30000);
  await dom.stabiliser();
  assert.equal(e.serveur.lectures, 1);
});
