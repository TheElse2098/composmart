/* ============================================================================
   editeur-panneaux.js — <cs-admin-editeur-panneaux> : l'onglet « Contenu » de
   l'éditeur de cours.

   Chaque panneau devient une section du cours (un titre « ## » dans le texte
   final). Il a son titre, son texte en markdown avec une barre d'outils, et
   ses sources. À côté, l'aperçu : le texte recomposé, découpé et rendu
   EXACTEMENT comme le lecteur le fait (mêmes fonctions, même feuille
   styles/texte-cours.css).

   La saisie met à jour l'état sans redessiner les panneaux : le curseur reste
   où il est. Seuls ajouter, retirer ou déplacer redessinent.

   Prévient son parent par « modifie » à chaque changement.

   Usage, dans <cs-admin-editeur> :
     this.trouver('cs-admin-editeur-panneaux', AdminEditeurPanneaux).configurer(panneaux);
     … .markdown()            le texte du cours à enregistrer
     … .insererBloc(texte)    au curseur du dernier panneau touché (images)
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { chargerMoteur, finaliser, markdownEnHtml, sectionsDuCours } from '../../socle/markdown.js';
import { html } from '../../socle/outils.js';
import { confirmer } from '../../composants/dialogue/dialogue.js';
import { composerPanneaux, entourer, inserer, panneauVide } from './panneaux-markdown.js';
import { echanger } from './quiz-edition.js';

/** @typedef {import('./panneaux-markdown.js').Panneau} Panneau */

/** Insertions qui entourent la sélection. */
export const OUTILS = [
  { libelle: 'gras', avant: '**', apres: '**' },
  { libelle: 'italique', avant: '*', apres: '*' },
  { libelle: 'sous-titre', avant: '### ', apres: '' },
  { libelle: 'liste', avant: '- ', apres: '' },
  { libelle: 'lien', avant: '[', apres: '](https://)' },
  { libelle: 'formule', avant: '$', apres: '$' },
  { libelle: 'formule centrée', avant: '$$\n', apres: '\n$$' },
];

/** Blocs insérés tels quels à la place de la sélection. */
export const BLOCS = {
  tableau: '\n| Colonne A | Colonne B |\n| --- | --- |\n| valeur | valeur |\n',
  // Gabarit auto-porteur : styles en ligne, donc rendu identique côté
  // lecteur sans avoir à toucher à la feuille du texte des cours.
  schema: '\n<figure style="display:grid;gap:10px;margin:6px 0 14px">\n'
    + '  <div style="background:#f4f9f4;border-radius:14px;padding:14px;text-align:center">\n'
    + '    <div style="font-weight:900;color:#1e6e3e;margin-bottom:6px">Titre du bloc</div>\n'
    + '    <div style="font-size:0.9rem">Contenu du bloc</div>\n'
    + '  </div>\n'
    + '</figure>\n',
};

/** Délai de l'aperçu : KaTeX et DOMPurify sur un cours entier à chaque frappe rendraient la saisie saccadée. */
const DELAI_APERCU = 250;

export class AdminEditeurPanneaux extends Composant {
  static balise = 'cs-admin-editeur-panneaux';
  static styles = [new URL('../../styles/texte-cours.css', import.meta.url), new URL('./editeur-panneaux.css', import.meta.url)];

  /** @type {Panneau[]} */
  #panneaux = [panneauVide()];
  /** Le dernier panneau dont le texte a eu le focus : c'est là qu'une image s'insère. */
  #dernier = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #minuteur = undefined;

  monter() {
    this.aLaFin(() => clearTimeout(this.#minuteur));
    this.rendre(this.gabarit());

    this.ecouter('input', '[data-titre]', (champ) => this.#saisir(champ, 'titre'));
    this.ecouter('input', '[data-corps]', (champ) => this.#saisir(champ, 'corps'));
    this.ecouter('focusin', '[data-corps]', (champ) => { this.#dernier = Number(champ.dataset.corps); });
    this.ecouter('input', '[data-src-lib]', (champ) => this.#saisirSource(champ, 'libelle'));
    this.ecouter('input', '[data-src-url]', (champ) => this.#saisirSource(champ, 'url'));

    this.ecouter('click', '[data-src-ajout]', (b) => {
      this.#panneaux[Number(b.dataset.srcAjout)].sources.push({ libelle: '', url: '' });
      this.#changer();
    });
    this.ecouter('click', '[data-src-sup]', (b) => {
      const [i, j] = (b.dataset.srcSup || '').split('-').map(Number);
      this.#panneaux[i].sources.splice(j, 1);
      this.#changer();
    });
    this.ecouter('click', '[data-monter]', (b) => this.#deplacer(Number(b.dataset.monter), -1));
    this.ecouter('click', '[data-descendre]', (b) => this.#deplacer(Number(b.dataset.descendre), 1));
    this.ecouter('click', '[data-supprimer]', (b) => this.#supprimer(Number(b.dataset.supprimer)));
    this.ecouter('click', '[data-action="ajouter-panneau"]', () => {
      this.#panneaux.push(panneauVide());
      this.#changer();
    });
    this.ecouter('click', '[data-outil]', (b) => {
      const outil = OUTILS[Number(b.dataset.outil)];
      this.#modifierTexte(Number(b.dataset.panneau), (t, d, f) => entourer(t, d, f, outil.avant, outil.apres));
    });
    this.ecouter('click', '[data-bloc]', (b) => {
      const bloc = BLOCS[/** @type {keyof typeof BLOCS} */ (b.dataset.bloc)];
      if (!bloc) return;
      this.#modifierTexte(Number(b.dataset.panneau), (t, d, f) => inserer(t, d, f, bloc));
    });

    this.#dessiner();
  }

  /** @param {Panneau[]} panneaux */
  configurer(panneaux) {
    this.apresMontage(() => {
      this.#panneaux = panneaux.length ? panneaux : [panneauVide()];
      this.#dernier = 0;
      this.#dessiner();
    });
  }

  /** Le texte du cours, recomposé. */
  markdown() {
    return composerPanneaux(this.#panneaux);
  }

  /**
   * Insère un bloc au curseur du dernier panneau touché (le premier, à
   * défaut : le bouton ne reste jamais sans effet).
   * @param {string} bloc
   */
  insererBloc(bloc) {
    this.apresMontage(() => {
      const i = Math.min(this.#dernier, this.#panneaux.length - 1);
      this.#modifierTexte(i, (t, d, f) => inserer(t, d, f, bloc));
    });
  }

  // ── Modifications ─────────────────────────────────────────────────────────

  /** @param {HTMLElement} champ @param {'titre' | 'corps'} cle */
  #saisir(champ, cle) {
    if (!(champ instanceof HTMLInputElement || champ instanceof HTMLTextAreaElement)) return;
    this.#panneaux[Number(champ.dataset[cle])][cle] = champ.value;
    this.#signaler();
  }

  /** @param {HTMLElement} champ @param {'libelle' | 'url'} cle */
  #saisirSource(champ, cle) {
    if (!(champ instanceof HTMLInputElement)) return;
    const repere = cle === 'libelle' ? champ.dataset.srcLib : champ.dataset.srcUrl;
    const [i, j] = (repere || '').split('-').map(Number);
    this.#panneaux[i].sources[j][cle] = champ.value;
    this.#signaler();
  }

  /** @param {number} i @param {-1 | 1} sens */
  #deplacer(i, sens) {
    this.#panneaux = echanger(this.#panneaux, i, sens);
    this.#changer();
  }

  /** @param {number} i */
  async #supprimer(i) {
    const panneau = this.#panneaux[i];
    if (!panneau) return;
    const ok = await confirmer({
      titre: 'Supprimer le panneau « ' + (panneau.titre || 'sans titre') + ' » ?',
      texte: "Il ne disparaît du cours qu'à l'enregistrement.",
      valider: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    this.#panneaux.splice(i, 1);
    if (!this.#panneaux.length) this.#panneaux.push(panneauVide());
    this.#dernier = 0;
    this.#changer();
  }

  /**
   * Modifie le texte d'un panneau à l'endroit de la sélection, et garde le
   * curseur là où l'opération le place.
   * @param {number} i
   * @param {(texte: string, debut: number, fin: number) => { texte: string, debut: number, fin: number }} operation
   */
  #modifierTexte(i, operation) {
    const zone = this.querySelector('[data-corps="' + i + '"]');
    if (!(zone instanceof HTMLTextAreaElement)) return;
    const r = operation(zone.value, zone.selectionStart, zone.selectionEnd);
    zone.value = r.texte;
    this.#panneaux[i].corps = r.texte;
    zone.focus();
    zone.selectionStart = r.debut;
    zone.selectionEnd = r.fin;
    this.#dernier = i;
    this.#signaler();
  }

  /** Changement de structure : on redessine les panneaux. */
  #changer() {
    this.#dessiner();
    this.emettre('modifie');
  }

  /** Saisie : l'état suit, l'aperçu aussi, les panneaux restent tels quels. */
  #signaler() {
    this.#apercu(DELAI_APERCU);
    this.emettre('modifie');
  }

  #dessiner() {
    this.rendre(html`${this.#panneaux.map((p, i) => this.gabaritPanneau(p, i, this.#panneaux.length))}`, this.trouver('.panneaux'));
    this.#apercu(DELAI_APERCU);
  }

  /** @param {number} delai */
  #apercu(delai) {
    clearTimeout(this.#minuteur);
    this.#minuteur = setTimeout(async () => {
      // Le moteur (marked, DOMPurify, KaTeX) n'est chargé qu'une fois ; sans
      // lui, l'aperçu montrerait du texte brut.
      await chargerMoteur();
      const zone = this.trouver('.apercu-sections');
      this.rendre(this.gabaritApercu(this.markdown()), zone);
      for (const corps of zone.querySelectorAll('.lesson-body')) finaliser(corps);
    }, delai);
  }

  // ── Gabarits ──────────────────────────────────────────────────────────────

  gabarit() {
    return html`
      <div class="aide">
        Chaque panneau devient une section du cours (un titre <code>##</code> dans le texte final,
        soit un écran pour le lecteur). Tu peux y écrire du markdown, coller un schéma en HTML,
        insérer une formule LaTeX entre <code>$…$</code> ou une image.
      </div>
      <div class="split">
        <div>
          <div class="panneaux"></div>
          <button type="button" class="btn btn-clair" data-action="ajouter-panneau">＋ Ajouter un panneau</button>
        </div>
        <div class="apercu">
          <div class="apercu-titre">Aperçu — rendu identique à la page de lecture</div>
          <div class="apercu-sections"></div>
        </div>
      </div>`;
  }

  /**
   * @param {Panneau} p
   * @param {number} i
   * @param {number} total
   */
  gabaritPanneau(p, i, total) {
    return html`
      <div class="carte">
        <div class="carte-tete">
          <div class="carte-titre">Panneau ${i + 1}</div>
          <button type="button" class="btn btn-clair btn-petit" data-monter="${i}"${i === 0 && html` disabled`} aria-label="Monter le panneau">↑</button>
          <button type="button" class="btn btn-clair btn-petit" data-descendre="${i}"${i === total - 1 && html` disabled`} aria-label="Descendre le panneau">↓</button>
          <button type="button" class="btn btn-clair btn-petit btn-retirer" data-supprimer="${i}">Supprimer</button>
        </div>
        <div class="champ champ-espace">
          <div class="champ-titre">Titre de la section</div>
          <input type="text" data-titre="${i}" maxlength="180" value="${p.titre}" placeholder="${i === 0 ? 'facultatif pour une introduction' : 'ex : Le bac de compostage'}" aria-label="Titre de la section ${i + 1}">
        </div>
        <div class="outils">
          ${OUTILS.map((o, k) => html`<button type="button" class="outil" data-outil="${k}" data-panneau="${i}">${o.libelle}</button>`)}
          <button type="button" class="outil" data-bloc="tableau" data-panneau="${i}">tableau</button>
          <button type="button" class="outil" data-bloc="schema" data-panneau="${i}">schéma HTML</button>
        </div>
        <div class="champ">
          <textarea class="corps" data-corps="${i}" placeholder="Texte du panneau, en markdown." aria-label="Texte du panneau ${i + 1}">${p.corps}</textarea>
        </div>
        <div class="champ champ-sources">
          <div class="champ-titre">Sources</div>
          ${p.sources.map((s, j) => html`
            <div class="source">
              <input type="text" data-src-lib="${i}-${j}" value="${s.libelle}" placeholder="Intitulé" aria-label="Intitulé de la source">
              <input type="text" data-src-url="${i}-${j}" value="${s.url}" placeholder="https://" aria-label="Adresse de la source">
              <button type="button" class="sup" data-src-sup="${i}-${j}" title="Retirer" aria-label="Retirer la source">✕</button>
            </div>`)}
          <button type="button" class="btn btn-clair btn-petit" data-src-ajout="${i}">＋ Ajouter une source</button>
        </div>
      </div>`;
  }

  /**
   * Le cours tel que le lecteur l'affichera : une carte par section.
   * @param {string} texte
   */
  gabaritApercu(texte) {
    return html`${sectionsDuCours(texte).map((s) => html`
      <div class="lesson-card">
        ${s.titre && html`<h2 class="lesson-title">${s.titre}</h2>`}
        <div class="lesson-body">${markdownEnHtml(s.contenu)}</div>
      </div>`)}`;
  }
}

AdminEditeurPanneaux.definir();
