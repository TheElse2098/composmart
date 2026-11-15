/* ============================================================================
   pied.js — <cs-pied> : le pied de page du site.

   Modifier le pied ici le répercute sur toutes les pages.

   Usage :
     <cs-pied></cs-pied>
     <script type="module" src="/ui/composants/pied/pied.js"></script>
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

export class Pied extends Composant {
  static balise = 'cs-pied';
  static styles = [new URL('./pied.css', import.meta.url)];

  monter() {
    this.rendre(this.gabarit());
  }

  gabarit() {
    return html`
      <footer class="pied">
        <div class="pied__colonnes">
          <div class="pied__colonne">
            <div class="pied__logo">Compos<span>mart</span></div>
            <p class="pied__accroche">Sensibilisation écologique au compostage : carte, cours, jeux et communauté.</p>
          </div>
          <div class="pied__colonne">
            <h5>Explorer</h5>
            <a href="/carte">Carte</a>
            <a href="/cours">Cours</a>
            <a href="/jeux">Jeux</a>
            <a href="/materiel">Matériel</a>
          </div>
          <div class="pied__colonne">
            <h5>Communauté</h5>
            <a href="/classement">Classement</a>
            <a href="/compte">Mon compte</a>
            <a href="/contact">Nous contacter</a>
          </div>
          <div class="pied__colonne">
            <h5>Contact</h5>
            <a href="mailto:contact@composmart.fr">contact@composmart.fr</a>
            <a href="https://www.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a>
          </div>
        </div>
        <div class="pied__legal">
          <a href="/mentions-legales">Mentions légales</a>
          <a href="/confidentialite">Confidentialité et cookies</a>
          <a href="/cgu">Conditions d'utilisation</a>
        </div>
        <div class="pied__bas">🌍 Composmart — Données ouvertes · Fait avec 💚 pour la planète</div>
      </footer>`;
  }
}

Pied.definir();
