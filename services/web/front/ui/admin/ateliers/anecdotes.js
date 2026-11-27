/* ============================================================================
   anecdotes.js — <cs-admin-anecdotes> : la banque d'anecdotes des ateliers
   (/evenements-admin/anecdotes), réutilisable dans tous les parcours.

   Un seul formulaire sert à ajouter et à modifier. Deux filtres se cumulent :
   le thème (un par anecdote, il restreint un tirage au hasard) et le mot-clé
   (libres et cumulables). Cliquer un mot-clé sous une anecdote filtre dessus.

   Usage :
     <cs-admin-anecdotes></cs-admin-anecdotes>
     <script type="module" src="/ui/admin/ateliers/anecdotes.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { ChoixEmoji } from '../../composants/choix-emoji/choix-emoji.js';
import { html } from '../../socle/outils.js';
import { ADRESSES } from './adresses.js';
import { motsDeSaisie } from './outils-ateliers.js';
import { PageAteliers } from './page-ateliers.js';

/**
 * Réponse de /api/evenements/anecdotes.php?action=liste.
 * @typedef {object} Anecdote
 * @property {number} id
 * @property {string} texte
 * @property {string | null} emoji
 * @property {string | null} theme
 * @property {string[]} [mots]
 *
 * @typedef {object} ListeAnecdotes
 * @property {Anecdote[]} anecdotes
 * @property {string[]} [themes]
 * @property {{ mot: string, n: number }[]} [mots]
 */

const TITRE_AJOUT = '➕ Nouvelle anecdote';
const TITRE_MODIFICATION = '✏️ Modifier l’anecdote';

export class AdminAnecdotes extends PageAteliers {
  static balise = 'cs-admin-anecdotes';
  static styles = [...PageAteliers.styles, new URL('./anecdotes.css', import.meta.url)];

  #theme = '';
  #mot = '';
  /** L'anecdote en cours de modification ; null pour un ajout. @type {number | null} */
  #edition = null;
  /** @type {Map<number, Anecdote>} */
  #anecdotes = new Map();
  #chargement = 0;

  monter() {
    this.poserPage({
      retour: { adresse: ADRESSES.liste, libelle: 'Tous les événements' },
      badge: '💡 Anecdotes',
      titre: 'Banque d’anecdotes',
      sousTitre: 'Réutilisables dans tous les parcours. Une slide peut en piocher une au hasard — chaque participant voit alors la sienne.',
      corps: this.gabarit(),
    });
    this.ecouter('submit', '.anec-form', (_formulaire, evenement) => {
      evenement.preventDefault();
      this.#enregistrer();
    });
    this.ecouter('click', '[data-action="annuler-edition"]', () => this.#reinitialiser());
    this.ecouter('input', '[name="mots"]', () => this.#apercuMots());
    this.ecouter('click', '[data-theme]', (bouton) => {
      this.#theme = bouton.dataset.theme || '';
      this.#charger();
    });
    this.ecouter('click', '[data-mot]', (bouton) => {
      this.#mot = bouton.dataset.mot || '';
      // Depuis une anecdote, on remonte voir la liste filtrée depuis le haut.
      if (bouton.classList.contains('pastille')) window.scrollTo({ top: 0, behavior: 'smooth' });
      this.#charger();
    });
    this.ecouter('click', '[data-modifier]', (bouton) => {
      const a = this.#anecdotes.get(Number(bouton.dataset.modifier));
      if (a) this.#editer(a);
    });
    this.ecouter('click', '[data-supprimer]', (bouton) => this.#supprimer(Number(bouton.dataset.supprimer)));
    this.#charger();
  }

  async #charger() {
    const numero = ++this.#chargement;
    /** @type {ListeAnecdotes} */
    let d;
    try {
      d = await api.evenements.get('anecdotes.php', { action: 'liste', theme: this.#theme || null, mot: this.#mot || null });
    } catch (erreur) {
      if (numero !== this.#chargement) return;
      console.error('<cs-admin-anecdotes>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), this.trouver('.anec-liste'));
      return;
    }
    if (numero !== this.#chargement) return;
    const anecdotes = d.anecdotes || [];
    const themes = d.themes || [];
    const mots = d.mots || [];
    this.#anecdotes = new Map(anecdotes.map((a) => [a.id, a]));
    this.trouver('.anec-nb').textContent = '(' + anecdotes.length + ')';
    this.rendre(this.gabaritFiltresThemes(themes), this.trouver('.anec-filtres-themes'));
    this.trouver('.anec-ligne-mots').hidden = !mots.length;
    this.rendre(this.gabaritFiltresMots(mots), this.trouver('.anec-filtres-mots'));
    this.rendre(this.gabaritListe(anecdotes), this.trouver('.anec-liste'));
    this.rendre(html`${themes.map((t) => html`<option value="${t}"></option>`)}`, this.trouver('#anec-themes'));
    this.rendre(html`${mots.map((m) => html`<option value="${m.mot}"></option>`)}`, this.trouver('#anec-mots'));
  }

  #apercuMots() {
    this.rendre(html`${motsDeSaisie(this.champ('[name="mots"]')).map((m) => html`<span class="pastille">${m}</span>`)}`, this.trouver('.anec-apercu-mots'));
  }

  /** @param {Anecdote} a */
  #editer(a) {
    this.#edition = a.id;
    this.remplir('[name="texte"]', a.texte);
    this.trouver('cs-choix-emoji', ChoixEmoji).value = a.emoji || '';
    this.remplir('[name="theme"]', a.theme || '');
    this.remplir('[name="mots"]', (a.mots || []).join(', '));
    this.#apercuMots();
    this.trouver('.anec-titre-form').textContent = TITRE_MODIFICATION;
    this.trouver('.anec-form [type="submit"]').textContent = 'Enregistrer';
    this.trouver('[data-action="annuler-edition"]').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  #reinitialiser() {
    this.#edition = null;
    this.trouver('.anec-form', HTMLFormElement).reset();
    this.trouver('cs-choix-emoji', ChoixEmoji).value = '';
    this.#apercuMots();
    this.trouver('.anec-titre-form').textContent = TITRE_AJOUT;
    this.trouver('.anec-form [type="submit"]').textContent = 'Ajouter';
    this.trouver('[data-action="annuler-edition"]').hidden = true;
  }

  async #enregistrer() {
    const id = this.#edition;
    const liberer = this.occuper('.anec-form [type="submit"]', 'Envoi…');
    try {
      await api.evenements.post('anecdotes.php', {
        id,
        texte: this.champ('[name="texte"]'),
        emoji: this.trouver('cs-choix-emoji', ChoixEmoji).value.trim(),
        theme: this.champ('[name="theme"]'),
        mots: this.champ('[name="mots"]'),
      }, { action: id ? 'modifier' : 'creer' });
    } catch (erreur) {
      console.error('<cs-admin-anecdotes>', erreur);
      this.message(texteErreur(erreur, 'Erreur réseau.'));
      liberer();
      return;
    }
    liberer();
    this.message(id ? 'Anecdote modifiée.' : 'Anecdote ajoutée.', true);
    this.#reinitialiser();
    this.#charger();
  }

  /** @param {number} id */
  async #supprimer(id) {
    const ok = await confirmer({ titre: 'Supprimer cette anecdote ?', texte: 'Les slides qui la visaient afficheront un texte de repli.', valider: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      await api.evenements.post('anecdotes.php', { id }, { action: 'supprimer' });
    } catch (erreur) {
      console.error('<cs-admin-anecdotes>', erreur);
      this.message(texteErreur(erreur, 'Suppression impossible.'));
      return;
    }
    // Supprimée pendant sa modification : le formulaire ne vise plus rien.
    if (this.#edition === id) this.#reinitialiser();
    this.#charger();
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="section-titre anec-titre-form">${TITRE_AJOUT}</div>
      <div class="card">
        <form class="anec-form">
          <div class="field"><label for="anec-texte">Anecdote</label>
            <textarea id="anec-texte" name="texte" maxlength="1000" placeholder="Un seul mégot de cigarette pollue jusqu'à 500 litres d'eau." required></textarea></div>
          <div class="duo">
            <div class="field"><span class="field-titre">Emoji</span>
              <cs-choix-emoji libelle="Emoji de l’anecdote"></cs-choix-emoji></div>
            <div class="field"><label for="anec-theme">Thème (facultatif)</label>
              <input type="text" id="anec-theme" name="theme" maxlength="60" list="anec-themes" placeholder="compost, tri, biodiversité…">
              <datalist id="anec-themes"></datalist></div>
          </div>
          <div class="field"><label for="anec-mots-cles">Mots-clés (facultatif)</label>
            <input type="text" id="anec-mots-cles" name="mots" list="anec-mots" placeholder="chiffre-choc, démarrage, eau — séparés par des virgules">
            <datalist id="anec-mots"></datalist>
            <div class="chips anec-apercu-mots"></div></div>
          <div class="anec-boutons">
            <button type="submit" class="btn-p">Ajouter</button>
            <button type="button" class="btn-s" data-action="annuler-edition" hidden>Annuler</button>
          </div>
          <div class="hint">Le thème est unique et sert à restreindre un tirage aléatoire. Les mots-clés, eux, sont libres et cumulables : une même anecdote peut être à la fois « chiffre-choc » et « eau ».</div>
        </form>
      </div>

      <div class="section-titre">📚 Anecdotes <span class="compteur anec-nb"></span></div>
      <div class="anec-ligne"><span class="anec-ligne-titre">Thème</span><div class="filtres anec-filtres-themes"></div></div>
      <div class="anec-ligne anec-ligne-mots" hidden><span class="anec-ligne-titre">Mots-clés</span><div class="filtres anec-filtres-mots"></div></div>
      <div class="anec-liste"><p class="cs-etat">Chargement…</p></div>`;
  }

  /** @param {string[]} themes */
  gabaritFiltresThemes(themes) {
    return html`
      <button type="button" class="filtre${this.#theme === '' && ' actif'}" data-theme="">Toutes</button>
      ${themes.map((t) => html`<button type="button" class="filtre${this.#theme === t && ' actif'}" data-theme="${t}">${t}</button>`)}`;
  }

  /** Le compteur évite d'aller cliquer un mot qui ne ramènerait qu'une
   *  anecdote déjà sous les yeux. @param {{ mot: string, n: number }[]} mots */
  gabaritFiltresMots(mots) {
    return html`
      <button type="button" class="filtre${this.#mot === '' && ' actif'}" data-mot="">Tous</button>
      ${mots.map((m) => html`<button type="button" class="filtre${this.#mot === m.mot && ' actif'}" data-mot="${m.mot}">${m.mot} <span class="n">${m.n}</span></button>`)}`;
  }

  /** @param {Anecdote[]} anecdotes */
  gabaritListe(anecdotes) {
    if (!anecdotes.length) return html`<div class="empty-msg">Aucune anecdote. Ajoute la première ci-dessus.</div>`;
    return html`${anecdotes.map((a) => html`
      <div class="anec">
        <div class="anec-emoji">${a.emoji || '💡'}</div>
        <div class="anec-main">
          <div class="anec-texte">${a.texte}</div>
          ${a.theme && html`<span class="anec-theme">${a.theme}</span>`}
          ${(a.mots || []).map((m) => html`<button type="button" class="pastille" data-mot="${m}" title="Filtrer sur ce mot-clé">${m}</button>`)}
        </div>
        <div class="anec-btns">
          <button type="button" class="btn-mini" data-modifier="${a.id}" title="Modifier" aria-label="Modifier l’anecdote">✏️</button>
          <button type="button" class="btn-mini sup" data-supprimer="${a.id}" title="Supprimer" aria-label="Supprimer l’anecdote">🗑</button>
        </div>
      </div>`)}`;
  }
}

AdminAnecdotes.definir();
