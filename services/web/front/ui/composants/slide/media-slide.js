/* ============================================================================
   media-slide.js — le média d'une slide d'atelier (image, vidéo, son).

   Reprend assets/js/media-embed.js, mot pour mot dans ce qu'il produit : la
   console d'animation et l'écran des participants doivent montrer la même
   chose (cf. rendu-slide.js et son test d'équivalence).

   RGPD : une vidéo YouTube ou Vimeo n'est PAS chargée d'office. Une façade
   neutre s'affiche (aucune requête vers la plateforme, pas même la
   miniature) ; l'iframe n'est créée qu'au clic, par ouvrirFacade().
   ============================================================================ */
import { echapper as e } from '../../socle/outils.js';
import { integration } from '../video/integration.js';

/**
 * La façade d'une vidéo de plateforme, ou `null` si l'adresse n'en est pas une.
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function facadeVideo(url) {
  const cible = integration(url);
  if (!cible) return null;
  const p = cible.plateforme;
  return '<div class="video-facade" data-src="' + e(cible.source) + '">'
    + '<button type="button" class="video-facade-btn" aria-label="Lire la vidéo">▶</button>'
    + '<p class="video-facade-txt">Vidéo hébergée par ' + p + '. En cliquant, elle est chargée depuis '
    + p + ', qui applique ses propres règles de confidentialité. '
    + '<a href="/confidentialite#tiers" target="_blank" rel="noopener">En savoir plus</a></p>'
    + '</div>';
}

/**
 * Le HTML du média d'une slide : une image, un lecteur audio, la façade d'une
 * vidéo de plateforme, ou un lecteur vidéo pour un fichier.
 * @param {{ media_type?: string, url?: string, legende?: string } | null | undefined} c
 * @returns {string}
 */
export function mediaHtml(c) {
  const m = c || {};
  const url = m.url || '';
  if (!url) return '';
  if (m.media_type === 'image') {
    return '<img class="slide-media" src="' + e(url) + '" alt="' + e(m.legende || '') + '">';
  }
  if (m.media_type === 'audio') {
    return '<audio style="width:100%" controls src="' + e(url) + '"></audio>';
  }
  const facade = facadeVideo(url);
  if (facade) return '<div class="slide-embed">' + facade + '</div>';
  return '<video class="slide-media" controls src="' + e(url) + '"></video>';
}

/**
 * Au clic sur la façade : la vraie iframe prend sa place.
 * @param {Element} bouton  le bouton ▶ de la façade
 */
export function ouvrirFacade(bouton) {
  const facade = bouton.closest('.video-facade');
  if (!facade) return;
  const iframe = document.createElement('iframe');
  iframe.src = facade.getAttribute('data-src') || '';
  iframe.allowFullscreen = true;
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  facade.replaceWith(iframe);
}

/**
 * Donne au cadre média ses vraies proportions. Sans ça, le cadre prend toute
 * la hauteur restante et l'image est rognée : une photo verticale se retrouve
 * amputée, et le titre placé dessous est repoussé hors de la carte.
 * @param {HTMLElement} cadre
 * @param {number} ratio
 */
function appliquerRatio(cadre, ratio) {
  if (!ratio || !isFinite(ratio) || ratio <= 0) return;
  // Bornes : au-delà, un média très allongé ou très haut mangerait la carte.
  const borne = Math.max(0.62, Math.min(2.4, ratio));
  cadre.style.aspectRatio = String(borne);
  cadre.style.flex = 'none';
  cadre.dataset.mesure = 'ok';
}

/**
 * À appeler après insertion des slides dans la page.
 * @param {ParentNode} racine
 */
export function ajusterMedias(racine) {
  for (const cadre of racine.querySelectorAll('.sl__media')) {
    if (!(cadre instanceof HTMLElement) || cadre.dataset.mesure === 'ok') continue;
    // Vidéo de plateforme : dimensions inaccessibles (autre origine), mais
    // YouTube et Vimeo servent du 16/9 dans l'immense majorité des cas.
    if (cadre.querySelector('iframe, .video-facade')) { appliquerRatio(cadre, 16 / 9); continue; }
    const img = cadre.querySelector('img');
    if (img instanceof HTMLImageElement) {
      if (img.naturalWidth) appliquerRatio(cadre, img.naturalWidth / img.naturalHeight);
      else img.addEventListener('load', () => appliquerRatio(cadre, img.naturalWidth / img.naturalHeight), { once: true });
      continue;
    }
    const video = cadre.querySelector('video');
    if (video instanceof HTMLVideoElement) {
      if (video.videoWidth) appliquerRatio(cadre, video.videoWidth / video.videoHeight);
      else video.addEventListener('loadedmetadata', () => appliquerRatio(cadre, video.videoWidth / video.videoHeight), { once: true });
    }
  }
}
