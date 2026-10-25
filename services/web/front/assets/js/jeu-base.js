/* ============================================================================
   jeu-base.js — socle commun des pages jeu-<slug>.html.

   Le contenu et les règles des jeux vivent en base (db-games) et s'éditent
   depuis /jeux-admin : chaque page n'est plus qu'une mécanique, qui reçoit son
   jeu de /api/jeux/catalogue.php?action=jeu. Ce fichier regroupe ce que les
   quatre pages faisaient chacune de leur côté, à l'identique :

     JeuBase.lancer(slug, fn)        charge le jeu puis appelle fn(jeu) ; en cas
                                     d'échec, affiche un message et n'appelle rien
     JeuBase.melanger(tableau)       copie mélangée (Fisher-Yates)
     JeuBase.afficherFin(jeu, score, suffixe)
                                     écran de fin : score / max, emoji et message
                                     du palier atteint (messages édités en admin)
     JeuBase.sauvegarder(slug, score) enregistre le score, affiche record, XP, top 5
     JeuBase.reinitialiserFin()      masque ce que la partie précédente a affiché

   Tout texte venant de la base est posé en textContent : il est saisi dans
   l'admin, il ne doit jamais être interprété comme du HTML.
   ============================================================================ */
window.JeuBase = (function () {
  function $(id) { return document.getElementById(id); }

  function melanger(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Encadré d'état posé en tête de la carte de jeu (chargement, erreur). */
  function encadre() {
    let el = $('jeuEtat');
    if (!el) {
      el = document.createElement('div');
      el.id = 'jeuEtat';
      el.style.cssText = 'text-align:center;padding:36px 12px;font-weight:700;color:#4a7a5a;line-height:1.6';
      const carte = document.querySelector('.game-card');
      if (carte) carte.insertBefore(el, carte.firstChild);
    }
    return el;
  }

  function lancer(slug, fn) {
    const zone = $('gameZone');
    if (zone) zone.style.display = 'none';
    const etat = encadre();
    etat.textContent = 'Chargement…';

    fetch('/api/jeux/catalogue.php?action=jeu&slug=' + encodeURIComponent(slug))
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || !d || !d.jeu) throw new Error('indisponible');
        const jeu = d.jeu;
        etat.remove();

        const badge = document.querySelector('.hero-badge');
        if (badge) badge.textContent = (jeu.emoji ? jeu.emoji + ' ' : '') + jeu.nom;

        // Seul un administrateur reçoit un brouillon : on le lui rappelle.
        if (jeu.statut === 'brouillon') {
          const note = document.createElement('div');
          note.textContent = '🛠️ Brouillon : ce jeu n\'est visible que des administrateurs.';
          note.style.cssText = 'display:inline-block;margin-top:10px;background:#fff3e0;color:#b26a00;font-weight:800;font-size:0.8rem;padding:6px 14px;border-radius:14px';
          const hero = document.querySelector('.hero');
          if (hero) hero.appendChild(note);
        }

        fn(jeu);
      })
      .catch(() => {
        etat.textContent = '';
        etat.appendChild(document.createTextNode('Ce jeu n\'est pas disponible pour le moment.'));
        etat.appendChild(document.createElement('br'));
        const a = document.createElement('a');
        a.href = '/jeux';
        a.textContent = '🎮 Voir les autres jeux';
        a.style.cssText = 'color:#1e6e3e;font-weight:800';
        etat.appendChild(a);
      });
  }

  /** Palier de fin atteint : messages triés du plus exigeant au plus bas. */
  function palier(messages, pct) {
    const liste = (messages || []).slice().sort((a, b) => b.min - a.min);
    for (const m of liste) if (pct >= m.min) return m;
    return liste[liste.length - 1] || { emoji: '🎮', texte: '' };
  }

  function afficherFin(jeu, score, suffixe) {
    $('gameZone').style.display = 'none';
    $('endScreen').style.display = 'block';
    const max = jeu.score_max;
    $('endScore').textContent = score + ' / ' + max;
    const m = palier(jeu.messages, max > 0 ? score / max : 0);
    $('endEmoji').textContent = m.emoji || '🎮';
    $('endMsg').textContent = m.texte + (suffixe ? ' ' + suffixe : '');
  }

  function sauvegarder(slug, score) {
    fetch('/api/jeux/score.php', {
      method: 'POST',
      body: new URLSearchParams({ action: 'save', jeu_id: slug, score: score })
    })
    .then(r => r.json())
    .then(d => {
      if (d.error === 'not_logged_in') {
        $('saveInfo').style.display = 'block';
      } else if (d.ok && d.record && score > 0) {
        $('endRecord').style.display = 'inline-block';
      }
      if (d.ok && d.xp_gagne > 0) {
        const endXp = $('endXp');
        endXp.textContent = '⚡ +' + d.xp_gagne + ' XP';
        endXp.style.display = 'inline-block';
      }
      return fetch('/api/jeux/score.php?action=infos&jeu_id=' + encodeURIComponent(slug));
    })
    .then(r => r.json())
    .then(d => {
      if (!d || !d.top || !d.top.length) return;
      const rows = $('lbRows');
      rows.innerHTML = '';
      const medailles = ['🥇', '🥈', '🥉', '4.', '5.'];
      d.top.forEach((t, i) => {
        const row = document.createElement('div');
        row.className = 'lb-row';
        const nom = document.createElement('span');
        nom.textContent = medailles[i] + ' ' + t.username;
        const sc = document.createElement('span');
        sc.textContent = t.score;
        row.appendChild(nom); row.appendChild(sc);
        rows.appendChild(row);
      });
      $('leaderboard').style.display = 'block';
    })
    .catch(() => {});
  }

  function reinitialiserFin() {
    ['endRecord', 'endXp', 'leaderboard', 'saveInfo'].forEach(id => { $(id).style.display = 'none'; });
  }

  return { lancer, melanger, afficherFin, sauvegarder, reinitialiserFin };
})();
