/* ============================================================================
   video.js — <cs-video> : une vidéo dans un cadre 16/9.

   Une adresse YouTube ou Vimeo ne se lit pas avec <video> : il faut l'iframe
   de la plateforme. Mais l'iframe n'est PAS chargée d'office (RGPD) : on
   affiche une façade neutre, sans aucune requête vers la plateforme, pas même
   la miniature, et l'iframe n'est créée qu'au clic — youtube-nocookie pour
   YouTube, dnt=1 pour Vimeo. Sans ça, chaque affichage de la page
   transmettrait l'IP du visiteur et déposerait des cookies de suivi sans
   consentement (cf. /confidentialite). Toute autre adresse est un fichier,
   lu par <video>.

   Reprend la façade de assets/js/media-embed.js, que les pages des ateliers
   utilisent encore (phase 10 de la refonte).

   Usage :
     <cs-video adresse="https://youtu.be/…"></cs-video>
   Le cadre prend toute la largeur ; arrondis et marges sont l'affaire de la
   page qui l'accueille.
   ============================================================================ */
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';
import { integration } from './integration.js';

export { integration };

export class Video extends Composant {
  static balise = 'cs-video';
  static styles = [new URL('./video.css', import.meta.url)];

  get #adresse() { return this.getAttribute('adresse') || ''; }

  monter() {
    this.ecouter('click', '.video-facade-btn', () => this.#lancer());
    this.rendre(this.gabarit(this.#adresse));
  }

  /** Le clic sur la façade : la vraie iframe prend sa place. */
  #lancer() {
    const cible = integration(this.#adresse);
    if (!cible) return;
    const cadre = document.createElement('iframe');
    cadre.src = cible.source;
    cadre.allowFullscreen = true;
    cadre.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    this.trouver('.video-facade').replaceWith(cadre);
  }

  /** @param {string} adresse */
  gabarit(adresse) {
    const cible = integration(adresse);
    if (!cible) return html`<video controls src="${adresse}"></video>`;
    return html`
      <div class="video-facade">
        <button type="button" class="video-facade-btn" aria-label="Lire la vidéo">▶</button>
        <p class="video-facade-txt">Vidéo hébergée par ${cible.plateforme}. En cliquant, elle est chargée depuis ${cible.plateforme}, qui applique ses propres règles de confidentialité. <a href="/confidentialite#tiers" target="_blank" rel="noopener">En savoir plus</a></p>
      </div>`;
  }
}

Video.definir();
