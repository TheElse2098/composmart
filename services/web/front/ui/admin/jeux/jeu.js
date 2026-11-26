/* ============================================================================
   jeu.js — <cs-admin-jeu> : l'éditeur d'un mini-jeu (/jeux-admin/<jeu>).

   Une seule page pour les quatre jeux : présentation, règles (formulaire
   propre à chaque jeu, regles-jeux.js), contenu (<cs-admin-jeu-contenu>),
   messages de fin par palier de score, et historique. La validation qui fait
   foi est celle du serveur (games-api/jeux/_jeux.php), qui renvoie une erreur
   nommée, affichée dans la barre d'enregistrement.

   Chaque enregistrement archive l'état précédent : l'historique permet d'y
   revenir. Deux confirmations avant d'enregistrer : un jeu publié qui repasse
   en brouillon, et un score maximum qui change alors que des parties ont déjà
   été jouées (elles seront converties à la nouvelle échelle).

   Le jeu est lu dans l'adresse ; le contrôleur de games-api a déjà vérifié
   qu'il existe (sinon : 404).

   Usage :
     <cs-admin-jeu></cs-admin-jeu>
     <script type="module" src="/ui/admin/jeux/jeu.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html, pluriel } from '../../socle/outils.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { ChoixEmoji } from '../../composants/choix-emoji/choix-emoji.js';
import { ADRESSE_JEUX } from './adresses.js';
import { dateFr } from './contenu-jeux.js';
import { AdminJeuContenu } from './jeu-contenu.js';
import { REGLES, avisConversion, scoreMax } from './regles-jeux.js';

/**
 * Réponse de /api/jeux/admin.php?action=jeu.
 * @typedef {object} Jeu
 * @property {string} slug
 * @property {string} nom
 * @property {string} emoji
 * @property {string} description
 * @property {'publie' | 'brouillon'} statut
 * @property {number} xp_reserve
 * @property {any} regles
 * @property {{ min: number, emoji: string, texte: string }[]} messages
 * @property {import('./contenu-jeux.js').Element[]} items
 * @property {number} score_max
 * @property {string | null} maj_at
 * @property {string | null} maj_par
 *
 * @typedef {{ id: number, auteur: string | null, date: string, nb_items: number, score_max: number, statut: string }} Version
 *
 * @typedef {object} Fiche
 * @property {Jeu} jeu
 * @property {{ categories?: Record<string, string> }} moteur
 * @property {Version[]} versions
 * @property {number} parties
 * @property {number} joueurs
 *
 * Un palier de message tel qu'en cours de saisie : le seuil reste un texte (en %).
 * @typedef {{ min: string, emoji: string, texte: string }} Palier
 */

const PALIERS_MIN = 2;
const PALIERS_MAX = 6;

/**
 * Le jeu désigné par l'adresse, ou vide.
 * @param {string} chemin
 */
export function slugDe(chemin) {
  const m = /^\/jeux-admin(?:\/v2)?\/([^/]+)\/?$/.exec(chemin);
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * Les paliers tels qu'envoyés au serveur : le seuil en fraction (0,5 pour
 * 50 %), vide s'il n'est pas rempli (le serveur le signale).
 * @param {Palier[]} paliers
 */
export function messagesDe(paliers) {
  return paliers.map((p) => ({ min: p.min === '' ? '' : Number(p.min) / 100, emoji: p.emoji, texte: p.texte }));
}

export class AdminJeu extends Composant {
  static balise = 'cs-admin-jeu';
  static styles = [new URL('./jeu.css', import.meta.url)];

  #slug = '';
  /** Le jeu tel qu'enregistré. @type {Fiche | null} */
  #fiche = null;
  /** @type {Palier[]} */
  #paliers = [];
  /** Des modifications ne sont pas enregistrées. */
  #sale = false;

  async monter() {
    this.#slug = slugDe(location.pathname);
    this.rendre(this.gabarit());

    this.ecouter('input', '[data-champ], [data-regle]', (champ) => {
      this.#marquerSale();
      if (champ.dataset.regle !== undefined) this.#majRegles();
    });
    this.ecouter('change', 'select[data-champ]', () => this.#marquerSale());
    this.ecouter('input', 'cs-choix-emoji', () => this.#marquerSale());
    this.ecouterSur(this, 'modifie', () => this.#marquerSale());
    this.ecouter('input', '[data-p]', (champ) => this.#saisirPalier(champ));
    this.ecouter('click', '[data-retirer-palier]', (b) => this.#retirerPalier(Number(b.dataset.retirerPalier)));
    this.ecouter('click', '[data-action="ajouter-palier"]', () => this.#ajouterPalier());
    this.ecouter('click', '[data-restaurer]', (b) => this.#restaurer(Number(b.dataset.restaurer)));
    this.ecouter('click', '[data-action="enregistrer"]', () => { this.#enregistrer(); });
    this.ecouterSur(window, 'beforeunload', (e) => {
      if (!this.#sale) return;
      e.preventDefault();
      /** @type {BeforeUnloadEvent} */ (e).returnValue = '';
    });

    if (!REGLES[this.#slug]) {
      this.afficherErreur('Jeu introuvable.', this.trouver('.chargement'));
      return;
    }
    await this.#charger();
  }

  #contenu() { return this.trouver('cs-admin-jeu-contenu', AdminJeuContenu); }

  async #charger() {
    try {
      /** @type {Fiche} */
      const d = await api.jeux.get('admin.php', { action: 'jeu', slug: this.#slug });
      this.#afficher(d);
    } catch (erreur) {
      console.error('<cs-admin-jeu>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), this.trouver('.chargement'));
    }
  }

  /** @param {Fiche} d */
  #afficher(d) {
    this.#fiche = d;
    const j = d.jeu;
    document.title = 'CompoSmart – ' + j.nom;
    this.trouver('.chargement').hidden = true;
    this.trouver('.page-jeu').hidden = false;
    this.rendre(this.gabaritTete(d), this.trouver('.tete'));

    this.#champ('nom').value = j.nom;
    this.#champ('description').value = j.description;
    this.#champ('statut').value = j.statut;
    this.#champ('xp').value = String(j.xp_reserve);
    this.trouver('cs-choix-emoji', ChoixEmoji).value = j.emoji;

    const regles = REGLES[this.#slug];
    this.trouver('.regles-aide').textContent = regles.aide;
    this.rendre(this.gabaritRegles(regles.blocs(j.regles)), this.trouver('.regles'));

    this.#contenu().configurer({ slug: this.#slug, items: j.items, categories: d.moteur.categories, regles: j.regles });

    this.#paliers = j.messages.map((m) => ({ min: String(Math.round((m.min || 0) * 100)), emoji: m.emoji || '', texte: m.texte || '' }));
    this.#dessinerPaliers();
    this.rendre(this.gabaritVersions(d.versions), this.trouver('.versions'));
    this.#majScoreMax(this.#lireRegles());
    this.#sale = false;
    this.#etat('Aucune modification.');
  }

  /** @param {'nom' | 'description' | 'statut' | 'xp'} nom @returns {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */
  #champ(nom) {
    const champ = this.trouver('[data-champ="' + nom + '"]');
    if (!(champ instanceof HTMLInputElement || champ instanceof HTMLTextAreaElement || champ instanceof HTMLSelectElement)) {
      throw new Error('<cs-admin-jeu> : « ' + nom + ' » n\'est pas un champ');
    }
    return champ;
  }

  /** @param {string} texte @param {'' | 'sale' | 'ok' | 'ko'} [sorte] */
  #etat(texte, sorte = '') {
    const etat = this.trouver('.barre-etat');
    etat.textContent = texte;
    etat.className = 'barre-etat' + (sorte ? ' ' + sorte : '');
  }

  #marquerSale() {
    if (this.#sale) return;
    this.#sale = true;
    this.#etat('Modifications non enregistrées.', 'sale');
  }

  // ── Règles ────────────────────────────────────────────────────────────────

  /** Les règles telles que saisies : un nombre vide ou invalide vaut NaN (le serveur le refusera, nommément). */
  #lireRegles() {
    /** @param {string} id */
    const champ = (id) => this.querySelector('[data-regle="' + id + '"]');
    return REGLES[this.#slug].lire({
      nombre: (id) => {
        const c = champ(id);
        const v = c instanceof HTMLInputElement ? c.value.trim() : '';
        return v === '' ? NaN : Number(v);
      },
      texte: (id) => {
        const c = champ(id);
        return c instanceof HTMLInputElement ? c.value : '';
      },
    });
  }

  #majRegles() {
    const regles = this.#lireRegles();
    this.#majScoreMax(regles);
    this.#contenu().majRegles(regles);
  }

  /** @param {any} regles */
  #majScoreMax(regles) {
    const fiche = this.#fiche;
    if (!fiche) return;
    const max = scoreMax(this.#slug, regles);
    const valide = Number.isFinite(max) && max > 0;
    const avis = valide ? avisConversion(fiche.jeu.score_max, max, fiche.parties) : '';
    this.rendre(html`Score max d'une partie : ${valide ? max : '—'}${avis && html`<span class="conv">${avis}</span>`}`, this.trouver('.score-max'));
  }

  // ── Messages de fin ───────────────────────────────────────────────────────

  #dessinerPaliers() {
    this.rendre(html`${this.#paliers.map((p, i) => this.gabaritPalier(p, i))}`, this.trouver('.paliers'));
  }

  /** @param {HTMLElement} champ */
  #saisirPalier(champ) {
    const palier = this.#paliers[Number(champ.dataset.palier)];
    const cle = /** @type {keyof Palier} */ (champ.dataset.p);
    if (!palier || !(champ instanceof HTMLInputElement)) return;
    palier[cle] = champ.value;
    this.#marquerSale();
  }

  #ajouterPalier() {
    if (this.#paliers.length >= PALIERS_MAX) { this.#etat('Six paliers au maximum.', 'ko'); return; }
    this.#paliers.push({ min: '50', emoji: '', texte: '' });
    this.#dessinerPaliers();
    this.#marquerSale();
  }

  /** @param {number} i */
  #retirerPalier(i) {
    if (this.#paliers.length <= PALIERS_MIN) { this.#etat('Il faut au moins deux paliers.', 'ko'); return; }
    this.#paliers.splice(i, 1);
    this.#dessinerPaliers();
    this.#marquerSale();
  }

  // ── Enregistrement ────────────────────────────────────────────────────────

  async #enregistrer() {
    const fiche = this.#fiche;
    if (!fiche) return;
    const xp = this.#champ('xp').value.trim();
    const corps = {
      slug: this.#slug,
      nom: this.#champ('nom').value,
      emoji: this.trouver('cs-choix-emoji', ChoixEmoji).value,
      description: this.#champ('description').value,
      statut: this.#champ('statut').value,
      xp_reserve: xp === '' ? NaN : Number(xp),
      regles: this.#lireRegles(),
      messages: messagesDe(this.#paliers),
      items: this.#contenu().elements(),
    };
    // Les nombres invalides partent tels quels : le serveur répond par une
    // erreur nommée, affichée dans la barre.
    const max = scoreMax(this.#slug, corps.regles);
    const avant = fiche.jeu;

    if (avant.statut === 'publie' && corps.statut === 'brouillon') {
      const ok = await confirmer({
        titre: 'Repasser ce jeu en brouillon ?',
        texte: 'Il disparaîtra du site pour les joueurs (page Jeux, accueil, profils) jusqu\'à sa republication. Les scores sont conservés.',
        valider: 'Passer en brouillon',
        danger: true,
      });
      if (!ok) return;
    }
    if (Number.isFinite(max) && max > 0 && max !== avant.score_max && fiche.parties > 0) {
      const ok = await confirmer({
        titre: 'Le score maximum change : ' + avant.score_max + ' → ' + max,
        texte: 'Les ' + (fiche.parties > 1 ? fiche.parties + ' parties déjà jouées seront converties' : fiche.parties + ' partie déjà jouée sera convertie')
          + ' à la nouvelle échelle dans les records et les classements (' + avant.score_max + '/' + avant.score_max + ' devient ' + max + '/' + max + '). Les scores enregistrés ne sont pas modifiés.',
        valider: 'Enregistrer',
      });
      if (!ok) return;
    }
    await this.#envoyer('sauver', corps, 'Enregistré ✓');
  }

  /** @param {number} id */
  async #restaurer(id) {
    const version = this.#fiche && this.#fiche.versions.find((v) => v.id === id);
    if (!version) return;
    const ok = await confirmer({
      titre: 'Restaurer la version du ' + dateFr(version.date) + ' ?',
      texte: 'L\'état actuel sera d\'abord archivé dans l\'historique : tu pourras y revenir.'
        + (this.#sale ? ' Les modifications non enregistrées de cette page seront perdues.' : ''),
      valider: 'Restaurer',
    });
    if (!ok) return;
    await this.#envoyer('restaurer', { slug: this.#slug, version_id: id }, 'Version restaurée ✓');
  }

  /**
   * @param {'sauver' | 'restaurer'} action
   * @param {unknown} corps
   * @param {string} messageOk
   */
  async #envoyer(action, corps, messageOk) {
    const bouton = this.trouver('[data-action="enregistrer"]', HTMLButtonElement);
    bouton.disabled = true;
    this.#etat('Enregistrement…');
    try {
      await api.jeux.postJson('admin.php', corps, { action });
      this.#sale = false;
      /** @type {Fiche} */
      const d = await api.jeux.get('admin.php', { action: 'jeu', slug: this.#slug });
      this.#afficher(d);
      this.#etat(messageOk, 'ok');
    } catch (erreur) {
      console.error('<cs-admin-jeu>', erreur);
      this.#etat(texteErreur(erreur, 'L\'enregistrement a échoué.'), 'ko');
    } finally {
      bouton.disabled = false;
    }
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <nav class="liens"><a href="/admin">← Administration</a><a href="${ADRESSE_JEUX}">Jeux</a></nav>
      <div class="chargement"><p class="cs-etat">Chargement…</p></div>
      <div class="page-jeu" hidden>
        <div class="tete"></div>
        <main class="editeur">
          <section class="carte carte-pres">
            <h2>Présentation</h2>
            <div class="carte-aide">Ce que voient les joueurs sur la page Jeux et en tête du jeu.</div>
            <div class="rangee">
              <div class="field field-emoji"><label>Emoji</label><cs-choix-emoji libelle="Emoji"></cs-choix-emoji></div>
              <div class="field"><label>Nom</label><input type="text" data-champ="nom" maxlength="80" aria-label="Nom"></div>
            </div>
            <div class="field"><label>Description</label><textarea data-champ="description" maxlength="300" rows="2" aria-label="Description"></textarea></div>
            <div class="rangee">
              <div class="field"><label>Statut</label>
                <select data-champ="statut" aria-label="Statut"><option value="publie">Publié</option><option value="brouillon">Brouillon (admins seulement)</option></select></div>
              <div class="field"><label>Réserve d'XP</label><input type="number" data-champ="xp" min="0" max="500" step="1" aria-label="Réserve d'XP">
                <div class="aide">XP gagnée au score parfait, par paliers.</div></div>
            </div>
          </section>

          <section class="carte carte-regles">
            <h2>Règles</h2>
            <div class="carte-aide regles-aide"></div>
            <div class="regles"></div>
            <div class="score-max"></div>
          </section>

          <section class="carte carte-contenu">
            <h2>Contenu</h2>
            <cs-admin-jeu-contenu></cs-admin-jeu-contenu>
          </section>

          <section class="carte carte-messages">
            <h2>Messages de fin</h2>
            <div class="carte-aide">Affichés en fin de partie selon le score obtenu : le palier le plus élevé atteint l'emporte. Un palier à 0 % est obligatoire.</div>
            <div class="paliers"></div>
            <button type="button" class="btn btn-clair btn-mini" data-action="ajouter-palier">➕ Ajouter un palier</button>
          </section>

          <section class="carte carte-histo">
            <h2>Historique</h2>
            <div class="carte-aide">Chaque enregistrement garde l'état précédent. Restaurer une version archive d'abord l'état actuel.</div>
            <div class="versions"></div>
          </section>
        </main>

        <div class="barre">
          <div class="barre-in">
            <div class="barre-etat" role="status">Aucune modification.</div>
            <button type="button" class="btn btn-vert" data-action="enregistrer">💾 Enregistrer</button>
          </div>
        </div>
      </div>`;
  }

  /** @param {Fiche} d */
  gabaritTete(d) {
    const j = d.jeu;
    return html`
      <div class="tete-emoji">${j.emoji}</div>
      <div class="tete-titre">
        <h1>${j.nom}</h1>
        <div class="tete-stats">${j.statut === 'publie' ? 'Publié' : 'Brouillon'} · ${pluriel(d.parties, 'partie jouée', 'parties jouées')} · ${pluriel(d.joueurs, 'joueur', 'joueurs')}${j.maj_at && ' · modifié le ' + dateFr(j.maj_at) + (j.maj_par ? ' par ' + j.maj_par : '')}</div>
      </div>
      <a class="btn btn-clair" href="/jeu-${this.#slug}" target="_blank" rel="noopener" title="Ouvre la version enregistrée du jeu dans un nouvel onglet">▶ Tester le jeu</a>`;
  }

  /** @param {import('./regles-jeux.js').BlocRegle[]} blocs */
  gabaritRegles(blocs) {
    /** @param {import('./regles-jeux.js').ChampRegle} c */
    const champ = (c) => html`
      <div class="field"><label>${c.titre}</label>
        ${c.texte
          ? html`<input type="text" data-regle="${c.id}" value="${c.valeur}" maxlength="${c.longueur}" aria-label="${c.titre}">`
          : html`<input type="number" data-regle="${c.id}" value="${c.valeur}" min="${c.min}" max="${c.max}" step="${c.pas || 1}" aria-label="${c.titre}">`}
        ${c.aide && html`<div class="aide">${c.aide}</div>`}
      </div>`;
    return html`${blocs.map((b) => (Array.isArray(b) ? html`<div class="rangee">${b.map(champ)}</div>` : champ(b)))}`;
  }

  /** @param {Palier} p @param {number} i */
  gabaritPalier(p, i) {
    return html`
      <div class="palier">
        <div class="p-min-wrap">≥<input type="number" data-palier="${i}" data-p="min" min="0" max="100" step="1" value="${p.min}" aria-label="Seuil en %">%</div>
        <div class="p-emoji"><input type="text" data-palier="${i}" data-p="emoji" maxlength="16" value="${p.emoji}" aria-label="Emoji"></div>
        <input type="text" class="p-texte" data-palier="${i}" data-p="texte" maxlength="200" value="${p.texte}" placeholder="Message" aria-label="Message">
        <button type="button" class="suppr" data-retirer-palier="${i}" title="Retirer ce palier" aria-label="Retirer ce palier">✕</button>
      </div>`;
  }

  /** @param {Version[]} versions */
  gabaritVersions(versions) {
    if (!versions.length) return html`<div class="vide">Aucune version antérieure : l'historique commence au premier enregistrement.</div>`;
    return html`${versions.map((v) => html`
      <div class="version">
        <div class="version-info">
          <div class="version-date">${dateFr(v.date)}${v.auteur && ' · ' + v.auteur}</div>
          <div class="version-det">${pluriel(v.nb_items, 'élément', 'éléments')} · score max ${v.score_max} · ${v.statut === 'publie' ? 'publié' : 'brouillon'}</div>
        </div>
        <button type="button" class="btn btn-clair btn-mini" data-restaurer="${v.id}">Restaurer</button>
      </div>`)}`;
  }
}

AdminJeu.definir();
