/* Toggle thème clair/sombre. Utilise la délégation d'événement pour fonctionner
   même quand le bouton #themeToggle est injecté après le chargement (nav partagé). */
(function () {
    function sync() {
        var btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
    }

    // Délégation : on écoute au niveau du document, donc le bouton peut apparaître à tout moment.
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (t && (t.id === 'themeToggle' || (t.closest && t.closest('#themeToggle')))) {
            var dark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', dark ? 'dark' : 'light');
            sync();
        }
    });

    // Met à jour l'icône dès que possible, et après injection du nav.
    document.addEventListener('DOMContentLoaded', sync);
    window.initThemeToggle = sync;   // appelé par site-nav.js après injection
    sync();
})();
