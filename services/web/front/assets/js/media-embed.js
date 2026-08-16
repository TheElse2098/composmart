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
