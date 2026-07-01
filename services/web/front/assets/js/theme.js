/* Toggle thème clair/sombre. Robuste au nav injecté après le chargement :
   - délégation d'événement au niveau document (le bouton peut apparaître à tout moment)
   - + attache directe quand initThemeToggle() est appelé après injection (ceinture/bretelles) */
(function () {
    function sync() {
        var btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
    }

    function toggle() {
        var dark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', dark ? 'dark' : 'light');
        sync();
    }

    // Attache directe sur le bouton, une seule fois (dataset garde-fou anti-doublon).
    // Appelée maintenant ET par site-nav.js après injection du nav → couvre les deux cas
    // (bouton déjà en dur, ou bouton injecté plus tard).
    function bind() {
        var btn = document.getElementById('themeToggle');
        if (btn && !btn.dataset.themeBound) {
            btn.dataset.themeBound = '1';
            btn.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
        }
        sync();
    }

    document.addEventListener('DOMContentLoaded', bind);
    window.initThemeToggle = bind;   // appelé par site-nav.js après injection
    bind();
})();
