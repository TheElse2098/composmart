(function () {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;

    function sync() {
        btn.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
    }

    btn.addEventListener('click', function () {
        var dark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', dark ? 'dark' : 'light');
        sync();
    });

    sync();
})();
