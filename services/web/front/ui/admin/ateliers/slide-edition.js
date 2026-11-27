/* ============================================================================
   slide-edition.js — <cs-admin-slide-edition> : la fenêtre qui crée, modifie
   ou montre une slide, pour un parcours de la bibliothèque comme pour le
   déroulé d'un événement (seuls l'endpoint et la clé changent).

   Le formulaire de chaque type vient de formulaire-slide.js. La fenêtre y
   ajoute ce qui demande le réseau ou un geste : la banque d'anecdotes,
   l'import des éléments d'un jeu, les lignes qu'on ajoute ou retire.

   Usage, dans le gabarit du parent :
     <cs-admin-slide-edition></cs-admin-slide-edition>
     this.trouver('cs-admin-slide-edition', AdminSlideEdition).ouvrir({ type, slide, registre, modifiable, cible });
     this.ecouter('slide-enregistree', 'cs-admin-slide-edition', …);
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Fenetre } from '../../socle/fenetre.js';
import { html } from '../../socle/outils.js';
import {
  CHAMPS_PAR_SOURCE, basculerMulti, champDe, etatItems, etatOptions, gabaritChamps,
  gabaritLigneItem, gabaritLigneOption, jeuChoisi, lireChamps,
} from './formulaire-slide.js';

/**
 * @typedef {{ nom: string, icone?: string, note: false | 'auto' | 'manuel', repond: boolean }} TypeSlide
 * @typedef {Record<string, TypeSlide>} Registre
 * @typedef {object} Slide
 * @property {number} id
 * @property {string} type
 * @property {string | null} titre
 * @property {number} points
 * @property {import('./formulaire-slide.js').Contenu} contenu
 *
 * Où vont les slides : un parcours (parcours.php, clé parcours_id) ou le
 * déroulé d'un événement (admin.php, clé evenement_id).
 * @typedef {{ fichier: string, cle: string, id: number }} Cible
 *
 * @typedef {object} Ouverture
 * @property {string} type
 * @property {Slide | null} slide       null : nouvelle slide
 * @property {Registre} registre
 * @property {boolean} modifiable       faux : consultation seule
 * @property {Cible} cible
 */

/** Durée d'affichage d'une confirmation dans la fenêtre. */
const DUREE_CONFIRMATION = 2500;

export class AdminSlideEdition extends Fenetre {
  static balise = 'cs-admin-slide-edition';
  static styles = [...Fenetre.styles, new URL('./slide-edition.css', import.meta.url)];

  /** @type {Ouverture | null} */
  #ouverture = null;
  /** Les éléments des jeux, chargés une fois. @type {Record<string, { items?: any[] }> | null} */
  #pools = null;
  /** Numéro de l'ouverture : une banque arrivée trop tard ne remplit rien. */
  #numero = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #effacement;

  monter() {
    this.poserFenetre(html`
      <div class="fenetre__titre">Slide</div>
      <div class="msg slide-msg" role="status" hidden></div>
      <div class="field"><label for="slide-titre">Titre affiché (facultatif)</label>
        <input type="text" id="slide-titre" maxlength="200" placeholder="Laisse vide pour ne rien afficher"></div>
      <div class="slide-champs"></div>
      <div class="field slide-points" hidden><label for="slide-points">Points</label>
        <input type="number" id="slide-points" min="0" max="1000" value="10"></div>
      <div class="fenetre__actions">
        <button type="button" class="fenetre__annuler" data-action="fermer">Annuler</button>
        <button type="button" class="fenetre__valider" data-action="enregistrer">Enregistrer</button>
      </div>`);
    this.ecouter('click', '[data-action="enregistrer"]', (bouton) => this.#enregistrer(bouton));
    this.ecouter('click', '.rep-del', (bouton) => bouton.closest('.rep-row')?.remove());
    this.ecouter('click', '[data-ajouter]', (bouton) => this.#ajouterLigne(bouton.dataset.ajouter || ''));
    this.ecouter('change', '[data-cle="multiple"]', () => this.#redessinerOptions());
    this.ecouter('change', '[data-cle="jeu"]', () => this.#nouveauJeu());
    this.ecouter('change', '[data-cle="source"]', () => this.#selonSource());
    this.ecouter('click', '[data-action="importer"]', () => this.#importer());
    this.aLaFin(() => clearTimeout(this.#effacement));
  }

  /** @param {Ouverture} ouverture */
  ouvrir(ouverture) {
    this.apresMontage(() => {
      this.#ouverture = ouverture;
      const numero = ++this.#numero;
      const { type, slide, registre, modifiable } = ouverture;
      const reg = registre[type] || { nom: type, note: false, repond: false };
      const verbe = modifiable ? (slide ? 'Modifier' : 'Nouvelle slide') : 'Consulter';
      this.trouver('.fenetre__titre').textContent = (reg.icone ? reg.icone + '  ' : '') + verbe + ' — ' + reg.nom;
      this.#champ('#slide-titre').value = slide ? slide.titre || '' : '';
      this.#champ('#slide-points').value = String(slide ? slide.points : 10);
      this.trouver('.slide-points').hidden = !reg.note;
      // En consultation, la fenêtre sert d'aperçu : pas de bouton qui
      // échouerait une fois cliqué.
      this.trouver('[data-action="enregistrer"]').hidden = !modifiable;
      this.#effacerMessage();
      this.rendre(gabaritChamps(type, slide ? slide.contenu : null), this.#zone());
      if (type === 'anecdote') {
        this.#selonSource();
        this.#chargerBanque(numero);
      }
      this.montrer();
    });
  }

  /** Le contenu tel que le formulaire le donne en ce moment. */
  contenu() {
    return this.#ouverture ? lireChamps(this.#zone(), this.#ouverture.type) : {};
  }

  aLaFermeture() {
    this.#ouverture = null;
    this.#numero++;
    this.#effacerMessage();
  }

  #zone() {
    return this.trouver('.slide-champs');
  }

  /** @param {string} selecteur */
  #champ(selecteur) {
    return this.trouver(selecteur, HTMLInputElement);
  }

  /** @param {string} texte @param {boolean} [ok] */
  #message(texte, ok = false) {
    const zone = this.trouver('.slide-msg');
    clearTimeout(this.#effacement);
    zone.textContent = texte;
    zone.className = 'msg slide-msg ' + (ok ? 'ok' : 'error');
    zone.hidden = false;
    if (ok) this.#effacement = setTimeout(() => { zone.hidden = true; }, DUREE_CONFIRMATION);
  }

  #effacerMessage() {
    clearTimeout(this.#effacement);
    this.trouver('.slide-msg').hidden = true;
  }

  /** @param {string} cle */
  #liste(cle) {
    const liste = champDe(this.#zone(), cle);
    if (!(liste instanceof HTMLElement)) throw new Error('<cs-admin-slide-edition> : aucune liste « ' + cle + ' »');
    return liste;
  }

  /** Une ligne vide de plus, sans rien perdre de ce qui est saisi. @param {string} cle */
  #ajouterLigne(cle) {
    const liste = this.#liste(cle);
    if (liste.dataset.sorte === 'items_jeu') {
      const jeu = jeuChoisi(this.#zone());
      this.rendre(html`${[...etatItems(liste, jeu), {}].map((it) => gabaritLigneItem(it, jeu))}`, liste);
      return;
    }
    const avecCorrect = liste.dataset.sorte === 'options';
    const multi = avecCorrect && this.#multi();
    const etats = [...etatOptions(liste), { valeur: '', coche: false }];
    this.rendre(html`${etats.map((e) => gabaritLigneOption(e.valeur, e.coche, avecCorrect, multi))}`, liste);
  }

  #multi() {
    const case_ = champDe(this.#zone(), 'multiple');
    return case_ instanceof HTMLInputElement && case_.checked;
  }

  /** « Plusieurs bonnes réponses » change de marqueur (radio ↔ case à cocher). */
  #redessinerOptions() {
    const liste = this.#liste('options');
    const multi = this.#multi();
    const etats = basculerMulti(etatOptions(liste), multi);
    this.rendre(html`${etats.map((e) => gabaritLigneOption(e.valeur, e.coche, true, multi))}`, liste);
  }

  /** Changer de jeu change la forme des éléments : on repart d'une ligne vide. */
  #nouveauJeu() {
    this.rendre(gabaritLigneItem({}, jeuChoisi(this.#zone())), this.#liste('items'));
  }

  #selonSource() {
    const source = champDe(this.#zone(), 'source');
    const choisie = source instanceof HTMLSelectElement ? source.value : 'libre';
    /** @type {string[]} */
    const montres = CHAMPS_PAR_SOURCE[/** @type {keyof typeof CHAMPS_PAR_SOURCE} */ (choisie)] || [];
    for (const cle of ['corps', 'emoji', 'anecdote_id', 'theme']) {
      const bloc = this.#zone().querySelector('[data-champ="' + cle + '"]');
      if (bloc instanceof HTMLElement) bloc.hidden = !montres.includes(cle);
    }
  }

  /**
   * La banque d'anecdotes, rechargée à chaque ouverture : l'animateur peut en
   * ajouter dans un autre onglet. Une valeur enregistrée qui n'est plus dans
   * la banque reste choisie, signalée : la remplacer en silence par la
   * première anecdote venue changerait la slide sans que personne le voie.
   * @param {number} numero
   */
  async #chargerBanque(numero) {
    const choixAnecdote = champDe(this.#zone(), 'anecdote_id');
    const choixTheme = champDe(this.#zone(), 'theme');
    if (!(choixAnecdote instanceof HTMLSelectElement) || !(choixTheme instanceof HTMLSelectElement)) return;
    const anecdoteVoulue = choixAnecdote.dataset.valeur || '';
    const themeVoulu = choixTheme.dataset.valeur || '';
    /** @type {{ anecdotes?: { id: number, emoji: string | null, texte: string }[], themes?: string[] } | null} */
    let banque = null;
    try {
      banque = await api.evenements.get('anecdotes.php', { action: 'liste' });
    } catch (erreur) {
      if (numero !== this.#numero) return;
      console.error('<cs-admin-slide-edition>', erreur);
      this.#message(texteErreur(erreur, 'La banque d’anecdotes n’a pas pu être chargée.'));
    }
    if (numero !== this.#numero) return;
    const anecdotes = (banque && banque.anecdotes) || [];
    const themes = (banque && banque.themes) || [];
    const anecdoteAbsente = anecdoteVoulue !== '' && !anecdotes.some((a) => String(a.id) === anecdoteVoulue);
    const themeAbsent = themeVoulu !== '' && !themes.includes(themeVoulu);
    this.rendre(html`
      ${anecdoteAbsente && html`<option value="${anecdoteVoulue}" selected>⚠ Anecdote n° ${anecdoteVoulue} (absente de la banque)</option>`}
      ${anecdotes.map((a) => html`<option value="${a.id}"${String(a.id) === anecdoteVoulue && html` selected`}>${(a.emoji || '') + ' ' + a.texte.slice(0, 70)}</option>`)}
      ${!anecdotes.length && !anecdoteAbsente && html`<option value="">Banque vide — ajoute des anecdotes d'abord</option>`}`, choixAnecdote);
    this.rendre(html`
      <option value="">Tous les thèmes</option>
      ${themeAbsent && html`<option value="${themeVoulu}" selected>${themeVoulu}</option>`}
      ${themes.map((t) => html`<option value="${t}"${t === themeVoulu && html` selected`}>${t}</option>`)}`, choixTheme);
  }

  /** Recopie les éléments du jeu du site dans la slide. */
  async #importer() {
    const jeu = jeuChoisi(this.#zone());
    try {
      if (!this.#pools) {
        const d = await api.jeux.get('catalogue.php', { action: 'pools' });
        this.#pools = d.pools || {};
      }
    } catch (erreur) {
      console.error('<cs-admin-slide-edition>', erreur);
      this.#message(texteErreur(erreur, 'Les éléments du jeu n’ont pas pu être chargés.'));
      return;
    }
    const pool = this.#pools ? this.#pools[jeu] : null;
    if (!pool || !pool.items || !pool.items.length) {
      this.#message('Aucun élément disponible pour ce jeu.');
      return;
    }
    this.rendre(html`${pool.items.map((it) => gabaritLigneItem(it, jeu))}`, this.#liste('items'));
    this.#message(pool.items.length + ' éléments importés — retire ceux que tu ne veux pas.', true);
  }

  /** @param {HTMLElement} bouton */
  async #enregistrer(bouton) {
    const ouverture = this.#ouverture;
    if (!ouverture || !ouverture.modifiable || !(bouton instanceof HTMLButtonElement) || bouton.disabled) return;
    const { type, slide, cible } = ouverture;
    /** @type {Record<string, unknown>} */
    const corps = {
      titre: this.#champ('#slide-titre').value,
      points: Number(this.#champ('#slide-points').value || 0),
      contenu: lireChamps(this.#zone(), type),
    };
    if (slide) corps.id = slide.id;
    else {
      corps[cible.cle] = cible.id;
      corps.type = type;
    }
    bouton.disabled = true;
    try {
      await api.evenements.postJson(cible.fichier, corps, { action: slide ? 'slide_modifier' : 'slide_ajouter' });
      this.fermer();
      this.emettre('slide-enregistree');
    } catch (erreur) {
      console.error('<cs-admin-slide-edition>', erreur);
      this.#message(texteErreur(erreur, 'Erreur réseau.'));
    } finally {
      bouton.disabled = false;
    }
  }
}

AdminSlideEdition.definir();
