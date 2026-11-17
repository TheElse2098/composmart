/* ============================================================================
   barre-jeu.js — <cs-barre-jeu> : la barre du haut des pages de jeu.

   Pendant une partie, pas de bandeau complet : le logo, l'accès au compte,
   le bouton de thème et « ✕ Quitter », qui ramène à la liste des jeux. Moins
   de liens, moins de clics perdus au milieu d'une manche chronométrée.

   Usage, dans les pages jeu-<slug>.html :
     <cs-barre-jeu></cs-barre-jeu>
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { theme } from '../../socle/theme.js';

export class BarreJeu extends Composant {
  static balise = 'cs-barre-jeu';
  static styles = [new URL('./barre-jeu.css', import.meta.url)];

  monter() {
    this.rendre(this.gabarit());
    this.ecouter('click', '[data-action="theme"]', () => { theme.basculer(); });
    this.ecouterSur(document, 'themechange', () => this.#montrerTheme());
    this.#montrerTheme();
  }

  /** L'icône montre le thème vers lequel on basculera. */
  #montrerTheme() {
    this.trouver('[data-action="theme"]').textContent = theme.sombre ? '☀️' : '🌙';
  }

  gabarit() {
    return html`
      <nav class="barre-jeu">
        <a href="/" class="barre-jeu__logo">Compos<span>mart</span></a>
        <div class="barre-jeu__droite">
          <a href="/compte" class="barre-jeu__compte" aria-label="Mon compte">👤</a>
          <button type="button" class="barre-jeu__theme" data-action="theme" aria-label="Changer de thème">🌙</button>
          <a href="/jeux" class="barre-jeu__quitter">✕ Quitter</a>
        </div>
      </nav>`;
  }
}

BarreJeu.definir();
