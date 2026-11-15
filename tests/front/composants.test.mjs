/* Gabarits des composants partagés : bandeau, pied, rappel de confirmation. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installerFauxDom } from './faux-dom.mjs';

installerFauxDom();
const { Bandeau, dansAdmin, normaliser } = await import('../../services/web/front/ui/composants/bandeau/bandeau.js');
const { Pied } = await import('../../services/web/front/ui/composants/pied/pied.js');
const { RappelEmail } = await import('../../services/web/front/ui/composants/rappel-email/rappel-email.js');

/** Nombre d'occurrences d'un motif dans un texte. @param {string} texte @param {RegExp} motif */
const compter = (texte, motif) => (texte.match(motif) || []).length;

test('normaliser : la barre oblique finale ne compte pas', () => {
  assert.equal(normaliser('/classement/'), '/classement');
  assert.equal(normaliser('/'), '/');
  assert.equal(normaliser(''), '/');
});

test('dansAdmin : les trois espaces et leurs sous-pages, rien d’autre', () => {
  assert.equal(dansAdmin('/admin'), true);
  assert.equal(dansAdmin('/admin/panel'), true);
  assert.equal(dansAdmin('/jeux-admin/tri-eclair'), true);
  assert.equal(dansAdmin('/evenements-admin'), true);
  assert.equal(dansAdmin('/administration'), false);
  assert.equal(dansAdmin('/classement'), false);
});

test('bandeau : sept liens dans la barre, tous libellés, case Admin masquée', () => {
  const barre = String(new Bandeau().gabaritBarre('/'));
  assert.equal(compter(barre, /<li><a href=/g), 7);
  assert.doesNotMatch(barre, /undefined/);
  for (const libelle of ['Carte', 'Cours', 'Jeux', 'Matériel', 'Classement', 'Événements', 'Nous contacter']) {
    assert.ok(barre.includes('>' + libelle + '</a>'), 'lien « ' + libelle + ' » attendu');
  }
  assert.equal(compter(barre, /data-admin hidden/g), 2, 'les deux cases Admin de la barre partent masquées');
});

test('bandeau : le lien de la page courante est marqué actif, et lui seul', () => {
  const bandeau = new Bandeau();
  const barre = String(bandeau.gabaritBarre('/classement'));
  assert.match(barre, /<a href="\/classement" class="actif">Classement<\/a>/);
  assert.equal(compter(barre, /class="actif"/g), 1);

  const tiroir = String(bandeau.gabaritTiroir('/cours-detail.html'));
  assert.match(tiroir, /<a href="\/cours" class="actif">/);
  assert.equal(compter(tiroir, /class="actif"/g), 1);

  assert.equal(compter(String(bandeau.gabaritBarre('/admin')), /class="actif"/g), 0);
});

test('bandeau : neuf entrées dans le tiroir, dans l’ordre, précédées de l’entrée Admin masquée', () => {
  const tiroir = String(new Bandeau().gabaritTiroir('/'));
  const libelles = [...tiroir.matchAll(/<\/span> ([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(libelles, [
    'Admin', 'Accueil', 'Mon compte', 'Classement', 'Carte interactive', 'Les cours',
    'Jeux', 'Le matériel', 'Événements', 'Nous contacter',
  ]);
  assert.equal(compter(tiroir, /data-admin hidden/g), 2);
  assert.match(tiroir, /data-action="fermer"/);
});

test('pied : les liens légaux et les trois colonnes de liens sont là', () => {
  const pied = String(new Pied().gabarit());
  for (const adresse of ['/mentions-legales', '/confidentialite', '/cgu', '/carte', '/classement', '/compte', 'mailto:contact@composmart.fr']) {
    assert.ok(pied.includes('href="' + adresse + '"'), 'lien vers ' + adresse + ' attendu');
  }
  assert.equal(compter(pied, /<h5>/g), 3);
});

test('bandeau et pied : aucun lien interne ne porte « .html » (une redirection par clic sinon)', () => {
  const bandeau = new Bandeau();
  const sorties = [String(bandeau.gabaritBarre('/')), String(bandeau.gabaritTiroir('/')), String(new Pied().gabarit())];
  for (const sortie of sorties) assert.doesNotMatch(sortie, /href="\/[^"]*\.html"/);
});

test('rappel email : l’adresse est affichée échappée', () => {
  const rappel = String(new RappelEmail().gabarit('ana"><img src=x>@exemple.fr'));
  assert.ok(rappel.includes('<strong>ana&quot;&gt;&lt;img src=x&gt;@exemple.fr</strong>'));
  assert.match(rappel, /data-action="renvoyer"/);
});
