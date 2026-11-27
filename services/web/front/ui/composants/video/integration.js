/* ============================================================================
   integration.js — reconnaître une vidéo YouTube ou Vimeo, et l'adresse de
   son lecteur « sans cookie ». Partagé par <cs-video> et par les slides des
   ateliers (ui/composants/slide/), qui doivent reconnaître les mêmes liens.
   ============================================================================ */

/**
 * L'iframe à charger pour une adresse de plateforme, ou `null` pour un fichier.
 * Les formes courtes (youtu.be), les Shorts et les lives sont reconnus en plus
 * du /watch classique : un lien copié depuis un téléphone est presque
 * toujours court. Seul l'identifiant est repris de l'adresse, derrière un
 * préfixe fixe.
 * @param {string | null | undefined} adresse
 * @returns {{ plateforme: string, source: string } | null}
 */
export function integration(adresse) {
  const texte = adresse || '';
  const youtube = texte.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (youtube) return { plateforme: 'YouTube', source: 'https://www.youtube-nocookie.com/embed/' + youtube[1] + '?autoplay=1' };
  const vimeo = texte.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { plateforme: 'Vimeo', source: 'https://player.vimeo.com/video/' + vimeo[1] + '?dnt=1&autoplay=1' };
  return null;
}
