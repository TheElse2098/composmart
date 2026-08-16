/* ============================================================================
   media-embed.js — rendu d'un média de slide (image, vidéo, audio).

   Partagé entre l'écran participant (web) et la console d'animation
   (evenements-api) : les deux doivent afficher exactement la même chose, et
   dupliquer la détection d'URL garantissait qu'elles finiraient par diverger.

   Usage : rendreMediaHtml({ media_type, url, legende })  →  chaîne HTML
   ============================================================================ */
(function () {
  function echapper(t) {
    var d = document.createElement('div');
    d.textContent = (t == null ? '' : String(t));
    return d.innerHTML;
  }

  /**
   * Une URL YouTube ou Vimeo ne peut pas être lue par une balise <video> : il
   * faut passer par l'iframe d'intégration de la plateforme. On reconnaît les
   * formes courtes (youtu.be), les Shorts et les lives en plus du /watch
   * classique — un lien copié depuis un téléphone est presque toujours court.
   */
  window.rendreMediaHtml = function (c) {
    c = c || {};
    var url = c.url || '';
    if (!url) return '';

    if (c.media_type === 'image') {
      return '<img class="slide-media" src="' + echapper(url) + '" alt="' + echapper(c.legende || '') + '">';
    }
    if (c.media_type === 'audio') {
      return '<audio style="width:100%" controls src="' + echapper(url) + '"></audio>';
    }

    var yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (yt) {
      return '<div class="slide-embed"><iframe src="https://www.youtube.com/embed/' + echapper(yt[1])
        + '" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>';
    }
    var vi = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vi) {
      return '<div class="slide-embed"><iframe src="https://player.vimeo.com/video/' + echapper(vi[1])
        + '" allowfullscreen></iframe></div>';
    }
    return '<video class="slide-media" controls src="' + echapper(url) + '"></video>';
  };

  /**
   * Donne au cadre média ses vraies proportions.
   *
   * Sans ça le cadre prend toute la hauteur restante (flex:1) et l'image est
   * rognée pour la remplir : une photo verticale se retrouve amputée, et le
   * titre placé dessous est repoussé hors de la carte. On lit donc les
   * dimensions naturelles du média, on les applique en aspect-ratio, et le
   * cadre cesse de s'étirer — le texte récupère la place qu'il lui faut.
   *
   * À appeler après insertion du HTML dans le document.
   */
  function appliquerRatio(box, ratio) {
    if (!ratio || !isFinite(ratio) || ratio <= 0) return;
    // Bornes : au-delà, un média très allongé ou très haut mangerait la carte.
    // La hauteur reste par ailleurs plafonnée en CSS (max-height).
    ratio = Math.max(0.62, Math.min(2.4, ratio));
    box.style.aspectRatio = String(ratio);
    box.style.flex = 'none';
    box.dataset.mesure = 'ok';
  }

  window.ajusterMedias = function (racine) {
    (racine || document).querySelectorAll('.sl__media').forEach(function (box) {
      if (box.dataset.mesure === 'ok') return;

      // Vidéo intégrée : les dimensions sont inaccessibles (autre origine),
      // mais YouTube et Vimeo servent du 16/9 dans l'immense majorité des cas.
      if (box.querySelector('iframe')) { appliquerRatio(box, 16 / 9); return; }

      var img = box.querySelector('img');
      if (img) {
        if (img.naturalWidth) appliquerRatio(box, img.naturalWidth / img.naturalHeight);
        else img.addEventListener('load', function () {
          appliquerRatio(box, img.naturalWidth / img.naturalHeight);
        }, { once: true });
        return;
      }

      var vid = box.querySelector('video');
      if (vid) {
        if (vid.videoWidth) appliquerRatio(box, vid.videoWidth / vid.videoHeight);
        else vid.addEventListener('loadedmetadata', function () {
          appliquerRatio(box, vid.videoWidth / vid.videoHeight);
        }, { once: true });
      }
    });
  };

  /** Styles du conteneur d'iframe (ratio 16/9), injectés une seule fois. */
  var injecte = false;
  window.injecterStylesMedia = function () {
    if (injecte) return;
    injecte = true;
    var s = document.createElement('style');
    s.textContent = '.slide-embed{position:relative;width:100%;padding-bottom:56.25%;border-radius:14px;overflow:hidden;margin:8px 0;background:#000}'
      + '.slide-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}'
      + '.slide-media{width:100%;border-radius:14px;margin:8px 0;display:block}';
    document.head.appendChild(s);
  };
  window.injecterStylesMedia();
})();
