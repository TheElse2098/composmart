import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Html, brut, echapper, html, pluriel } from '../../services/web/front/ui/socle/outils.js';

test('echapper neutralise les cinq caractères du HTML', () => {
  assert.equal(echapper(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('echapper : null et undefined donnent une chaîne vide, 0 reste 0', () => {
  assert.equal(echapper(null), '');
  assert.equal(echapper(undefined), '');
  assert.equal(echapper(0), '0');
});

test('html échappe ce qui est interpolé', () => {
  const pseudo = '<script>alert(1)</script>';
  assert.equal(String(html`<b>${pseudo}</b>`), '<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>');
});

test('html protège un attribut entre guillemets', () => {
  const titre = 'a" onmouseover="x';
  assert.equal(String(html`<i title="${titre}"></i>`), '<i title="a&quot; onmouseover=&quot;x"></i>');
});

test('html insère tel quel un gabarit imbriqué et une liste de gabarits', () => {
  const noms = ['Ana', '<Bob>'];
  const liste = html`<ul>${noms.map((n) => html`<li>${n}</li>`)}</ul>`;
  assert.equal(String(liste), '<ul><li>Ana</li><li>&lt;Bob&gt;</li></ul>');
});

test('html : une liste de textes est échappée élément par élément', () => {
  assert.equal(String(html`${['<a>', '<b>']}`), '&lt;a&gt;&lt;b&gt;');
});

test("html n'affiche ni null, ni undefined, ni false, mais affiche 0", () => {
  assert.equal(String(html`[${null}${undefined}${false}${0}]`), '[0]');
});

test('html renvoie un Html, pas une chaîne', () => {
  assert.ok(html`x` instanceof Html);
});

test('brut laisse passer du HTML déclaré sûr', () => {
  assert.equal(String(html`<p>${brut('<svg></svg>')}</p>`), '<p><svg></svg></p>');
});

test('pluriel accorde à partir de 2', () => {
  assert.equal(pluriel(0, 'message', 'messages'), '0 message');
  assert.equal(pluriel(1, 'message', 'messages'), '1 message');
  assert.equal(pluriel(2, 'message', 'messages'), '2 messages');
});
