/* ============================================================================
   themes.js — <cs-admin-themes> : les thèmes et l'organisation des cours
   (/admin/themes).

   Une carte par thème, avec ses cours. On fait glisser un cours pour le
   déplacer dans son thème ou vers un autre, et un thème par son bandeau de
   couleur pour changer leur ordre. Rien n'est enregistré avant « Enregistrer
   l'organisation » ; quitter la page avant demande confirmation au
   navigateur.

   Le glisser-déposer est celui du navigateur (HTML5) : pas de bibliothèque
   à charger, et le besoin (réordonner, changer de conteneur) tient en peu de
   code. Il ne fonctionne pas au doigt sur téléphone, comme avant.

   Création, modification et suppression d'un thème : <cs-admin-theme-edition>.

   Usage :
     <cs-admin-themes></cs-admin-themes>
     <script type="module" src="/ui/admin/cours/themes.js"></script>
   ============================================================================ */
import { api, texteErreur } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { AdminThemeEdition } from './theme-edition.js';

/**
 * Réponse de /api/admin/themes_manage.php (GET).
 * @typedef {object} CoursResume
 * @property {number} id
 * @property {string} slug
 * @property {string} titre
 * @property {string | null} emoji
 * @property {number} xp
 * @property {string} statut         `publie`, `brouillon`, `archive`
 * @property {number} nb_questions
 * @property {number} termine_par    comptes qui l'ont terminé
 * @property {number} termine_anonyme visiteurs sans compte (un simple compteur)
 *
 * @typedef {object} Theme
 * @property {number} id
 * @property {string} slug
 * @property {string} nom
 * @property {string | null} emoji
 * @property {string | null} couleur      dégradé CSS
 * @property {string | null} description
 * @property {CoursResume[]} cours
 *
 * @typedef {{ top: number, left: number, width: number, height: number }} Boite
 */

/**
 * Préfixe des pages de l'éditeur de cours. Il deviendra /admin/themes-v2 le
 * temps de valider le nouvel éditeur, puis reviendra ici à la bascule.
 */
export const EDITEUR = '/admin/themes';

const COULEUR_PAR_DEFAUT = '#1e6e3e';

/**
 * La ligne sous le titre d'un cours : XP, questions, et combien de fois il a
 * été terminé (comptes et visiteurs sans compte, ces derniers n'étant qu'un
 * compteur, sans aucune donnée sur la personne).
 * @param {CoursResume} c
 */
export function ligneCours(c) {
  const anonymes = c.termine_anonyme || 0;
  const termine = c.termine_par + anonymes;
  return c.xp + ' XP · ' + c.nb_questions + ' question' + (c.nb_questions > 1 ? 's' : '')
    + (termine > 0 ? ' · terminé ' + termine + ' fois' + (anonymes > 0 ? ' (dont ' + anonymes + ' sans compte)' : '') : '');
}

/**
 * Devant quel cours insérer celui qu'on fait glisser : le premier dont le
 * milieu est sous le curseur. Les boîtes sont celles des AUTRES cours de la
 * liste, sinon la carte déplacée se compare à elle-même et l'insertion oscille.
 * @param {Boite[]} boites
 * @param {number} y
 * @returns {number}  index dans `boites`, ou -1 pour la fin de la liste
 */
export function rangSous(boites, y) {
  let meilleur = -1;
  let distance = Number.NEGATIVE_INFINITY;
  boites.forEach((b, i) => {
    const ecart = y - b.top - b.height / 2;
    if (ecart < 0 && ecart > distance) { distance = ecart; meilleur = i; }
  });
  return meilleur;
}

/**
 * Même chose pour un thème, dans une grille à deux colonnes : la ligne
 * compte d'abord, puis la colonne.
 * @param {Boite[]} boites
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function rangDansGrille(boites, x, y) {
  let meilleur = -1;
  let distance = Number.NEGATIVE_INFINITY;
  boites.forEach((b, i) => {
    const ecart = (y - b.top - b.height / 2) * 10000 + (x - b.left - b.width / 2);
    if (ecart < 0 && ecart > distance) { distance = ecart; meilleur = i; }
  });
  return meilleur;
}

export class AdminThemes extends Composant {
  static balise = 'cs-admin-themes';
  static styles = [new URL('./themes.css', import.meta.url)];

  /** @type {Theme[]} */
  #themes = [];
  /** L'organisation a changé et n'est pas encore enregistrée. */
  #modifie = false;
  /** Ce qu'on fait glisser. @type {HTMLElement | null} */
  #coursAttrape = null;
  /** @type {HTMLElement | null} */
  #themeAttrape = null;

  async monter() {
    this.rendre(this.gabarit());

    this.ecouter('click', '[data-action="nouveau-theme"]', () => this.#fiche().ouvrir(null));
    this.ecouter('click', '[data-editer]', (bouton) => {
      const theme = this.#themes.find((t) => t.id === Number(bouton.dataset.editer));
      if (theme) this.#fiche().ouvrir(theme);
    });
    this.ecouter('click', '[data-action="enregistrer"]', (bouton) => this.#enregistrer(bouton));
    this.ecouterSur(this, 'donnees-modifiees', () => this.#charger(true));

    // Glisser un cours.
    this.ecouter('dragstart', '.cours', (cours, e) => {
      this.#coursAttrape = cours;
      cours.classList.add('attrape');
      this.#preparerTransfert(e, cours.dataset.coursId || '');
    });
    this.ecouter('dragend', '.cours', (cours) => {
      cours.classList.remove('attrape');
      this.#coursAttrape = null;
      for (const liste of this.tous('.liste')) liste.classList.remove('survol');
    });
    this.ecouter('dragover', '.liste', (liste, e) => this.#survolerListe(liste, e));
    this.ecouter('dragleave', '.liste', (liste, e) => {
      // dragleave se déclenche aussi en passant sur un enfant : on ne retire
      // le surlignage que si le curseur quitte vraiment la liste.
      const vers = /** @type {DragEvent} */ (e).relatedTarget;
      if (!(vers instanceof Node && liste.contains(vers))) liste.classList.remove('survol');
    });
    this.ecouter('drop', '.liste', (liste, e) => {
      if (!this.#coursAttrape) return;
      e.preventDefault();
      liste.classList.remove('survol');
      this.#marquerModifie();
    });

    // Glisser un thème, par son bandeau.
    this.ecouter('dragstart', '.theme-tete', (tete, e) => {
      this.#themeAttrape = tete.closest('.theme');
      this.#preparerTransfert(e, 'theme');
    });
    this.ecouter('dragend', '.theme-tete', () => { this.#themeAttrape = null; });
    this.ecouter('dragover', '.grille', (grille, e) => this.#survolerGrille(grille, e));
    this.ecouter('drop', '.grille', (_grille, e) => {
      if (!this.#themeAttrape) return;
      e.preventDefault();
      this.#marquerModifie();
    });

    this.ecouterSur(window, 'beforeunload', (e) => {
      if (!this.#modifie) return;
      e.preventDefault();
      /** @type {BeforeUnloadEvent} */ (e).returnValue = '';
    });

    await this.#charger(false);
  }

  /** @returns {AdminThemeEdition} */
  #fiche() {
    return this.trouver('cs-admin-theme-edition', AdminThemeEdition);
  }

  /**
   * @param {boolean} rechargement  après une modification de thème : les
   *   déplacements pas encore enregistrés sont perdus, on le dit
   */
  async #charger(rechargement) {
    const grille = this.trouver('.grille');
    const perdus = rechargement && this.#modifie;
    try {
      /** @type {{ themes: Theme[] }} */
      const d = await api.admin.get('themes_manage.php');
      this.#themes = d.themes;
    } catch (erreur) {
      console.error('<cs-admin-themes>', erreur);
      this.afficherErreur(texteErreur(erreur, 'Chargement impossible.'), grille);
      return;
    }
    this.rendre(this.gabaritGrille(this.#themes), grille);
    // La couleur d'un thème est une donnée : posée par le style, jamais
    // écrite dans le HTML.
    for (const tete of this.tous('.theme-tete')) {
      const theme = this.#themes.find((t) => t.id === Number(tete.dataset.themeId));
      tete.style.background = (theme && theme.couleur) || COULEUR_PAR_DEFAUT;
    }
    if (rechargement) {
      this.#modifie = false;
      this.#bouton().disabled = true;
      this.#etat(perdus ? 'Organisation rechargée : les déplacements non enregistrés ont été annulés.' : '', perdus ? 'modifie' : '');
    }
  }

  #bouton() {
    return this.trouver('[data-action="enregistrer"]', HTMLButtonElement);
  }

  /** @param {string} texte @param {'' | 'modifie' | 'ok'} [sorte] */
  #etat(texte, sorte = '') {
    const etat = this.trouver('.etat');
    etat.textContent = texte;
    etat.className = 'etat' + (sorte ? ' ' + sorte : '');
  }

  #marquerModifie() {
    this.#modifie = true;
    this.#bouton().disabled = false;
    this.#etat('Organisation modifiée — pense à enregistrer', 'modifie');
  }

  /**
   * @param {Event} e
   * @param {string} donnee
   */
  #preparerTransfert(e, donnee) {
    const transfert = /** @type {DragEvent} */ (e).dataTransfer;
    if (!transfert) return;
    transfert.effectAllowed = 'move';
    // Firefox n'amorce pas le glisser sans données attachées.
    transfert.setData('text/plain', donnee);
  }

  /** @param {HTMLElement} liste @param {Event} e */
  #survolerListe(liste, e) {
    const cours = this.#coursAttrape;
    if (!cours) return;
    e.preventDefault();
    liste.classList.add('survol');
    const autres = [...liste.querySelectorAll('.cours')].filter((c) => c !== cours);
    const rang = rangSous(autres.map((a) => a.getBoundingClientRect()), /** @type {DragEvent} */ (e).clientY);
    liste.querySelector('.vide')?.remove();
    if (rang < 0) liste.appendChild(cours);
    else liste.insertBefore(cours, autres[rang]);
  }

  /** @param {HTMLElement} grille @param {Event} e */
  #survolerGrille(grille, e) {
    const theme = this.#themeAttrape;
    if (!theme) return;
    e.preventDefault();
    const autres = [...grille.querySelectorAll('.theme')].filter((t) => t !== theme);
    const glisse = /** @type {DragEvent} */ (e);
    const rang = rangDansGrille(autres.map((a) => a.getBoundingClientRect()), glisse.clientX, glisse.clientY);
    if (rang < 0) grille.appendChild(theme);
    else grille.insertBefore(theme, autres[rang]);
  }

  /** L'organisation telle qu'elle est affichée : l'ordre des thèmes, et de leurs cours. */
  organisation() {
    return this.tous('.theme').map((theme) => ({
      id: Number(theme.dataset.themeId),
      cours: [...theme.querySelectorAll('.cours')].map((c) => Number(/** @type {HTMLElement} */ (c).dataset.coursId)),
    }));
  }

  /** @param {HTMLElement} bouton */
  async #enregistrer(bouton) {
    if (!(bouton instanceof HTMLButtonElement)) return;
    bouton.disabled = true;
    this.#etat('Enregistrement…');
    try {
      await api.admin.postJson('cours_reorder.php', { themes: this.organisation() });
    } catch (erreur) {
      console.error('<cs-admin-themes>', erreur);
      this.#etat(texteErreur(erreur, 'Enregistrement impossible.'));
      bouton.disabled = false;
      return;
    }
    this.#modifie = false;
    await this.#charger(false);
    this.#etat('Organisation enregistrée ✓', 'ok');
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="entete">
        <nav class="liens">
          <a href="/admin">← Administration</a>
          <a href="/cours">Voir le catalogue</a>
        </nav>
        <h1>Thèmes et cours</h1>
        <p>Fais glisser un cours pour le déplacer dans son thème ou vers un autre. L'ordre des thèmes se change en attrapant leur bandeau de couleur.</p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-vert" data-action="nouveau-theme">＋ Nouveau thème</button>
        <button type="button" class="btn btn-clair" data-action="enregistrer" disabled>Enregistrer l'organisation</button>
        <span class="etat" role="status"></span>
      </div>
      <div class="grille"><p class="cs-etat">Chargement…</p></div>
      <cs-admin-theme-edition></cs-admin-theme-edition>`;
  }

  /** @param {Theme[]} themes */
  gabaritGrille(themes) {
    if (!themes.length) return html`<p class="cs-etat">Aucun thème pour l'instant.</p>`;
    return html`${themes.map((t) => this.gabaritTheme(t))}`;
  }

  /** @param {Theme} t */
  gabaritTheme(t) {
    return html`
      <section class="theme" data-theme-id="${t.id}">
        <div class="theme-tete" draggable="true" data-theme-id="${t.id}">
          <span class="theme-emoji">${t.emoji || '📂'}</span>
          <div class="theme-nom">
            ${t.nom}
            ${t.description && html`<div class="theme-desc">${t.description}</div>`}
          </div>
          <div class="theme-outils">
            <button type="button" class="mini" data-editer="${t.id}" title="Modifier le thème" aria-label="Modifier le thème">✎</button>
            <a class="mini" href="${EDITEUR}/${t.slug}/nouveau" draggable="false" title="Nouveau cours dans ce thème" aria-label="Nouveau cours dans ce thème">＋</a>
          </div>
        </div>
        <div class="liste" data-theme-id="${t.id}">
          ${t.cours.length
            ? t.cours.map((c) => this.gabaritCours(c, t.slug))
            : html`<div class="vide">Aucun cours — dépose-en un ici</div>`}
        </div>
      </section>`;
  }

  /**
   * @param {CoursResume} c
   * @param {string} theme  slug du thème, pour l'adresse de l'éditeur
   */
  gabaritCours(c, theme) {
    return html`
      <div class="cours" draggable="true" data-cours-id="${c.id}">
        <span class="cours-poignee" aria-hidden="true">⋮⋮</span>
        <span class="cours-emoji">${c.emoji || '📖'}</span>
        <div class="cours-corps">
          <div class="cours-titre">${c.titre}${c.statut !== 'publie' && html`<span class="puce ${c.statut}">${c.statut}</span>`}</div>
          <div class="cours-meta">${ligneCours(c)}</div>
        </div>
        <a class="cours-modifier" href="${EDITEUR}/${theme}/${c.slug}" draggable="false">Modifier</a>
      </div>`;
  }
}

AdminThemes.definir();
