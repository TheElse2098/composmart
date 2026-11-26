/* ============================================================================
   choix-emoji.js — <cs-choix-emoji> : un champ emoji, avec une grille de choix.

   Le champ se tape comme un autre ; le bouton à côté ouvre une grille classée
   par thème. La liste est volontairement choisie et non exhaustive : les
   emojis utiles au compostage et aux ateliers viennent en premier, ce qui
   évite de faire défiler 3 000 pictogrammes pour trouver un ver de terre.

   Reprend assets/js/emoji-picker.js, que les vues des ateliers utilisent
   encore (phase 10 de la refonte).

   Le parent lit et pose la valeur par `.value`, et reçoit un évènement
   « input » à chaque changement, clic dans la grille compris :
     <cs-choix-emoji libelle="Emoji"></cs-choix-emoji>
     this.ecouter('input', 'cs-choix-emoji', (choix) => …);
     this.trouver('cs-choix-emoji', ChoixEmoji).value = '🌱';
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

export const CATEGORIES_EMOJI = [
  { nom: 'Compost & nature', liste: ['🌱', '🌿', '🍃', '🌳', '🌲', '🪴', '🍂', '🍁', '🌾', '🌻', '🌼', '🌸', '🌺', '🌷', '☘️', '🍀', '🌵', '🎋', '🏵️', '🌰'] },
  { nom: 'Petites bêtes', liste: ['🪱', '🐛', '🐌', '🦋', '🐝', '🐞', '🕷️', '🦗', '🐜', '🦠', '🐦', '🦔', '🐿️', '🦇', '🐁', '🦎'] },
  { nom: 'Déchets & tri', liste: ['♻️', '🗑️', '🚮', '🧺', '📦', '🥫', '🧴', '🛍️', '🧻', '📰', '🥡', '🧃', '🍾', '🪥', '🔋', '📱'] },
  { nom: 'Aliments', liste: ['🍎', '🍌', '🍊', '🍋', '🍐', '🍓', '🍇', '🍉', '🥝', '🥕', '🥔', '🧅', '🧄', '🥬', '🥦', '🌽', '🍅', '🥑', '🍄', '🥚', '🍞', '🧀', '🥩', '🐟', '☕', '🍵', '🍬', '🥖'] },
  { nom: 'Science & faits', liste: ['🔬', '🧪', '⚗️', '🧫', '📊', '📈', '📉', '🌡️', '⏳', '⌛', '🧠', '💡', '❓', '❗', '🔍', '🔎', '📏', '⚖️'] },
  { nom: 'Terre & météo', liste: ['🌍', '🌎', '🌏', '☀️', '🌤️', '⛅', '🌧️', '⛈️', '❄️', '💧', '🔥', '💨', '🌊', '🏔️', '🏞️', '🌋'] },
  { nom: 'Réactions', liste: ['😀', '😃', '😄', '😁', '😅', '😂', '🙂', '😉', '😊', '😍', '🤩', '🤔', '🤨', '😐', '😴', '🤯', '😱', '🥳', '😎', '🤓', '🧐', '😮', '🙌', '👏', '👍', '👎', '🤝', '💪'] },
  { nom: 'Symboles', liste: ['✅', '❌', '⚠️', '⭐', '🌟', '✨', '🎯', '🏆', '🥇', '🥈', '🥉', '🎉', '🎊', '🎁', '📌', '📍', '🔔', '💚', '💛', '🧡', '❤️', '💙', '💜', '🕐', '🚀', '🧩', '🎬', '🎟️'] },
];

/** Ce qu'affiche le bouton quand aucun emoji n'est choisi. */
const AUCUN = '😀';

export class ChoixEmoji extends Composant {
  static balise = 'cs-choix-emoji';
  static styles = [new URL('./choix-emoji.css', import.meta.url)];

  /** La valeur posée avant que le champ existe. */
  #valeur = '';

  get value() {
    const champ = this.querySelector('.choix-emoji__champ');
    return champ instanceof HTMLInputElement ? champ.value : this.#valeur;
  }

  set value(valeur) {
    this.#valeur = valeur || '';
    this.apresMontage(() => {
      this.trouver('.choix-emoji__champ', HTMLInputElement).value = this.#valeur;
      this.#majBouton();
    });
  }

  monter() {
    this.#valeur = this.#valeur || this.getAttribute('valeur') || '';
    this.rendre(this.gabarit(this.getAttribute('libelle') || 'Emoji'));
    this.trouver('.choix-emoji__champ', HTMLInputElement).value = this.#valeur;
    this.#majBouton();

    this.ecouter('click', '.choix-emoji__bouton', () => {
      const grille = this.trouver('.choix-emoji__grille');
      grille.hidden = !grille.hidden;
    });
    this.ecouter('click', '[data-emoji]', (b) => this.#poser(b.dataset.emoji || ''));
    this.ecouter('input', '.choix-emoji__champ', () => this.#majBouton());
    // Un clic ailleurs referme la grille : une seule ouverte à la fois.
    this.ecouterSur(document, 'click', (e) => {
      if (!(e.target instanceof Element) || !this.contains(e.target)) this.trouver('.choix-emoji__grille').hidden = true;
    });
  }

  #majBouton() {
    this.trouver('.choix-emoji__bouton').textContent = this.value || AUCUN;
  }

  /** @param {string} emoji  vide : aucun emoji */
  #poser(emoji) {
    this.trouver('.choix-emoji__champ', HTMLInputElement).value = emoji;
    this.#majBouton();
    this.trouver('.choix-emoji__grille').hidden = true;
    // Le parent réagit au clic dans la grille comme à une frappe.
    this.emettre('input');
  }

  /** @param {string} libelle */
  gabarit(libelle) {
    return html`
      <input type="text" class="choix-emoji__champ" maxlength="16" aria-label="${libelle}">
      <button type="button" class="choix-emoji__bouton" title="Choisir un emoji" aria-label="Choisir un emoji">${AUCUN}</button>
      <div class="choix-emoji__grille" hidden>
        ${CATEGORIES_EMOJI.map((c) => html`
          <div class="choix-emoji__categorie">${c.nom}</div>
          <div class="choix-emoji__liste">${c.liste.map((e) => html`<button type="button" data-emoji="${e}">${e}</button>`)}</div>`)}
        <button type="button" class="choix-emoji__aucun" data-emoji="">✕ Aucun emoji</button>
      </div>`;
  }
}

ChoixEmoji.definir();
