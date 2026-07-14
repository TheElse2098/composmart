/* ============================================================================
   site-footer.js — injecte le footer partagé (partials/site-footer.html).

   Usage dans une page :
     <div id="site-footer"></div>
     <script src="/assets/js/site-footer.js"></script>
   (Le CSS du footer reste dans le <style> de la page, cf. index.html — à
   copier dans les pages qui ne l'ont pas encore.)
   ============================================================================ */
(function () {
  var mount = document.getElementById('site-footer');
  if (!mount) return;

  // Sans .html : la 301 du .htaccess (strip d'extension) génère un Location en
  // http:// derrière le proxy TLS → mixed content bloqué en HTTPS.
  fetch('/partials/site-footer')
    .then(function (r) {
      if (!r.ok) throw new Error('partial HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) { mount.innerHTML = html; })
    .catch(function () { /* échec silencieux : la page reste utilisable sans footer injecté */ });
})();
