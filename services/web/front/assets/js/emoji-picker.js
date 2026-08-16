/* ============================================================================
   emoji-picker.js — sélecteur d'emojis, sans dépendance externe.

   Usage :
     <input type="text" id="monEmoji">
     <script src="/assets/js/emoji-picker.js"></script>
     <script>attacherSelecteurEmoji(document.getElementById('monEmoji'));</script>

   Un bouton 😀 est ajouté à côté du champ ; il ouvre une grille classée par
   thème. La liste est volontairement CURÉE et non exhaustive : les emojis
   utiles au compostage et à l'animation d'atelier viennent en premier, ce qui
   évite de faire défiler 3000 pictogrammes pour trouver un ver de terre.
   ============================================================================ */
(function () {
  var CATEGORIES = [
    { nom: 'Compost & nature', liste: ['🌱','🌿','🍃','🌳','🌲','🪴','🍂','🍁','🌾','🌻','🌼','🌸','🌺','🌷','☘️','🍀','🌵','🎋','🏵️','🌰'] },
    { nom: 'Petites bêtes',    liste: ['🪱','🐛','🐌','🦋','🐝','🐞','🕷️','🦗','🐜','🦠','🐦','🦔','🐿️','🦇','🐁','🦎'] },
    { nom: 'Déchets & tri',    liste: ['♻️','🗑️','🚮','🧺','📦','🥫','🧴','🛍️','🧻','📰','🥡','🧃','🍾','🪥','🔋','📱'] },
    { nom: 'Aliments',         liste: ['🍎','🍌','🍊','🍋','🍐','🍓','🍇','🍉','🥝','🥕','🥔','🧅','🧄','🥬','🥦','🌽','🍅','🥑','🍄','🥚','🍞','🧀','🥩','🐟','☕','🍵','🍬','🥖'] },
    { nom: 'Science & faits',  liste: ['🔬','🧪','⚗️','🧫','📊','📈','📉','🌡️','⏳','⌛','🧠','💡','❓','❗','🔍','🔎','📏','⚖️'] },
    { nom: 'Terre & météo',    liste: ['🌍','🌎','🌏','☀️','🌤️','⛅','🌧️','⛈️','❄️','💧','🔥','💨','🌊','🏔️','🏞️','🌋'] },
    { nom: 'Réactions',        liste: ['😀','😃','😄','😁','😅','😂','🙂','😉','😊','😍','🤩','🤔','🤨','😐','😴','🤯','😱','🥳','😎','🤓','🧐','😮','🙌','👏','👍','👎','🤝','💪'] },
    { nom: 'Symboles',         liste: ['✅','❌','⚠️','⭐','🌟','✨','🎯','🏆','🥇','🥈','🥉','🎉','🎊','🎁','📌','📍','🔔','💚','💛','🧡','❤️','💙','💜','🕐','🚀','🧩','🎬','🎟️'] },
  ];

  var CSS = [
    '.emopick-wrap{position:relative;display:flex;gap:6px;align-items:center}',
    '.emopick-btn{background:#eef4ec;color:#1e6e3e;border:none;border-radius:9px;padding:7px 11px;font-size:1rem;cursor:pointer;line-height:1;flex:0 0 auto}',
    '.emopick-btn:hover{background:#dfeee3}',
    '.emopick-pan{position:absolute;top:calc(100% + 6px);left:0;z-index:900;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.18);padding:10px;width:300px;max-height:280px;overflow-y:auto;display:none}',
    '.emopick-pan.open{display:block}',
    '.emopick-cat{font-size:0.68rem;font-weight:800;color:#7aaa8a;text-transform:uppercase;letter-spacing:0.5px;margin:8px 2px 4px}',
    '.emopick-cat:first-child{margin-top:0}',
    '.emopick-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px}',
    '.emopick-grid button{background:none;border:none;font-size:1.15rem;padding:4px 0;cursor:pointer;border-radius:6px;line-height:1.3}',
    '.emopick-grid button:hover{background:#eef4ec}',
    '.emopick-vide{background:none;border:none;color:#c0392b;font-size:0.74rem;font-weight:700;cursor:pointer;padding:6px 2px;font-family:inherit}',
    'html.dark .emopick-pan{background:#1a2b1e;box-shadow:0 8px 30px rgba(0,0,0,0.5)}',
    'html.dark .emopick-btn{background:#16291c;color:#7fc99a}',
    'html.dark .emopick-grid button:hover{background:#1e2d22}',
  ].join('');

  var styleInjecte = false;
  function injecterStyle() {
    if (styleInjecte) return;
    styleInjecte = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  window.attacherSelecteurEmoji = function (input) {
    if (!input || input.dataset.emopick) return;   // déjà attaché
    input.dataset.emopick = '1';
    injecterStyle();

    // On enveloppe le champ pour positionner le panneau juste en dessous.
    var wrap = document.createElement('span');
    wrap.className = 'emopick-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emopick-btn';
    btn.textContent = input.value || '😀';
    btn.title = 'Choisir un emoji';
    wrap.appendChild(btn);

    var pan = document.createElement('div');
    pan.className = 'emopick-pan';
    var html = '';
    CATEGORIES.forEach(function (c) {
      html += '<div class="emopick-cat">' + c.nom + '</div><div class="emopick-grid">'
        + c.liste.map(function (e) { return '<button type="button" data-e="' + e + '">' + e + '</button>'; }).join('')
        + '</div>';
    });
    html += '<button type="button" class="emopick-vide">✕ Aucun emoji</button>';
    pan.innerHTML = html;
    wrap.appendChild(pan);

    function poser(valeur) {
      input.value = valeur;
      btn.textContent = valeur || '😀';
      // `input` et non `change` : les formulaires qui écoutent la saisie
      // doivent réagir au clic comme à une frappe clavier.
      input.dispatchEvent(new Event('input', { bubbles: true }));
      pan.classList.remove('open');
    }

    pan.querySelectorAll('[data-e]').forEach(function (b) {
      b.onclick = function () { poser(b.dataset.e); };
    });
    pan.querySelector('.emopick-vide').onclick = function () { poser(''); };

    btn.onclick = function (e) {
      e.stopPropagation();
      // Un seul panneau ouvert à la fois sur la page.
      document.querySelectorAll('.emopick-pan.open').forEach(function (p) { if (p !== pan) p.classList.remove('open'); });
      pan.classList.toggle('open');
    };
    input.addEventListener('input', function () { btn.textContent = input.value || '😀'; });
    document.addEventListener('click', function (ev) {
      if (!wrap.contains(ev.target)) pan.classList.remove('open');
    });
  };

  /** Attache le sélecteur à tous les champs portant data-emoji dans un conteneur. */
  window.attacherSelecteursEmoji = function (racine) {
    (racine || document).querySelectorAll('[data-emoji]').forEach(window.attacherSelecteurEmoji);
  };
})();
