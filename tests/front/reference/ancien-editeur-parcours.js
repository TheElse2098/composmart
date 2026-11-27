/* ============================================================================
   ancien-editeur-parcours.js — copie GELÉE du formulaire de slide de l'ancien
   éditeur de parcours (evenements-api/admin-pages/vues/parcours.html, lignes
   274 à 615, reprises telles quelles), avec le strict nécessaire autour pour
   qu'elles tournent dans le faux DOM.

   Sert au test d'équivalence (admin-parcours.test.mjs) : une slide ouverte
   puis enregistrée sans changement doit donner le même `contenu` avec le
   nouvel éditeur qu'avec l'ancien. Ne pas corriger ce fichier : c'est la
   référence, défauts compris.
   ============================================================================ */
/* eslint-disable */
// @ts-nocheck

function echap(t) { const d = document.createElement('div'); d.textContent = (t == null ? '' : String(t)); return d.innerHTML; }
let REGISTRE = {};
/** Messages de la modale, notés au lieu d'être affichés. */
export const messages = [];
function afficher(zone, texte, ok) { messages.push({ zone, texte, ok }); }

/** @param {object} registre */
export function poserRegistre(registre) { REGISTRE = registre; }

    // ══════════ DÉCLARATION DES CHAMPS PAR TYPE ══════════
    // Un type = une liste de champs. Ajouter un type de slide ne demande donc
    // qu'une entrée ici (et l'entrée correspondante côté _slides.php).
    const CHAMPS = {
      titre:            [['sous_titre', 'Sous-titre', 'text']],
      texte:            [['corps', 'Texte', 'textarea']],
      anecdote:         [['source', 'Provenance', 'select', ['libre', 'banque', 'aleatoire']],
                         ['emoji', 'Emoji', 'emoji'],
                         ['corps', 'Anecdote', 'textarea'],
                         ['anecdote_id', 'Anecdote de la banque', 'select_anecdote'],
                         ['theme', 'Limiter au thème (facultatif)', 'select_theme']],
      // Le sommaire n'a rien à saisir : il liste les slides « Titre de partie »
      // du parcours et surligne celle en cours.
      sommaire:         [],
      media:            [['media_type', 'Type', 'select', ['image', 'video', 'audio']],
                         ['url', 'Adresse du média', 'text'],
                         ['legende', 'Légende', 'text']],
      classement:       [['portee', 'Afficher', 'select', ['les_deux', 'individuel', 'equipe']]],
      encouragement:    [['animation', 'Animation', 'select', ['pousse', 'confettis']],
                         ['message', 'Message', 'textarea'],
                         ['sous_titre', 'Précision (facultatif)', 'text'],
                         ['montrer_score', 'Afficher le score du participant', 'check']],
      fin:              [['message', 'Message de fin', 'textarea'],
                         ['afficher_classement', 'Afficher le classement final', 'check']],
      quiz:             [['question', 'Question', 'textarea'],
                         ['multiple', 'Plusieurs bonnes réponses possibles', 'check',
                          'Chaque bonne réponse cochée par le joueur rapporte 1/n du point de la question, '
                          + 'chaque mauvaise en retire 1/n (n = nombre de bonnes réponses) — jamais moins que 0, '
                          + 'jamais plus que le point plein.'],
                         ['options', 'Réponses possibles', 'options'],
                         ['explication', 'Explication (après réponse)', 'textarea']],
      vrai_faux:        [['question', 'Affirmation', 'textarea'],
                         ['correct', 'La bonne réponse est', 'select_vf'],
                         ['explication', 'Explication (après réponse)', 'textarea']],
      estimation:       [['question', 'Question', 'textarea'],
                         ['valeur', 'Valeur exacte', 'number'],
                         ['unite', 'Unité', 'text'],
                         ['tolerance', 'Tolérance (points pleins en deçà)', 'number'],
                         ['explication', 'Explication (après réponse)', 'textarea']],
      sondage:          [['question', 'Question', 'textarea'],
                         ['options', 'Choix proposés', 'options_simple']],
      jeu:              [['jeu', 'Jeu', 'select', ['compost-ou-pas', 'temps-decompo', 'mot-mystere']],
                         ['items', 'Éléments', 'items_jeu']],
      question_ouverte: [['question', 'Question', 'textarea'],
                         ['max_car', 'Longueur max de la réponse', 'number']],
      defi:             [['consigne', 'Consigne du défi', 'textarea']],
    };

    // ══════════ RENDU GÉNÉRIQUE DES CHAMPS ══════════
    function champHtml(cle, label, type, extra) {
      const id = 'ch_' + cle;
      if (type === 'emoji') return '<div class="field" data-champ="' + cle + '"><label>' + label + '</label><input type="text" maxlength="8" data-emoji id="' + id + '"></div>';
      if (type === 'select_anecdote') return '<div class="field" data-champ="' + cle + '"><label>' + label + '</label><select id="' + id + '"></select></div>';
      if (type === 'select_theme') return '<div class="field" data-champ="' + cle + '"><label>' + label + '</label><select id="' + id + '"></select></div>';
      if (type === 'textarea') return '<div class="field" data-champ="' + cle + '"><label>' + label + '</label><textarea id="' + id + '"></textarea></div>';
      if (type === 'number')   return '<div class="field"><label>' + label + '</label><input type="number" step="any" id="' + id + '"></div>';
      if (type === 'check')    return '<div class="field"><label class="check"><input type="checkbox" id="' + id + '"> ' + label + '</label>'
                                      + (extra ? '<div class="hint">' + extra + '</div>' : '') + '</div>';
      if (type === 'select')   return '<div class="field"><label>' + label + '</label><select id="' + id + '">'
                                      + extra.map(o => '<option value="' + o + '">' + o + '</option>').join('') + '</select></div>';
      if (type === 'select_vf') return '<div class="field"><label>' + label + '</label><select id="' + id + '"><option value="1">Vrai</option><option value="0">Faux</option></select></div>';
      if (type === 'options' || type === 'options_simple')
        return '<div class="field"><label>' + label + '</label><div id="' + id + '"></div>'
             + '<button type="button" class="rep-add" data-add="' + cle + '">+ Ajouter</button>'
             + (type === 'options' ? '<div class="hint">Coche la bonne réponse (ou les bonnes réponses si « Plusieurs bonnes réponses » est activé).</div>' : '') + '</div>';
      if (type === 'items_jeu')
        return '<div class="field"><label>' + label + '</label><div id="' + id + '"></div>'
             + '<button type="button" class="rep-add" data-add="' + cle + '">+ Ajouter</button> '
             + '<button type="button" class="rep-add" id="btnImportPool">📥 Importer depuis le jeu</button>'
             + '<div class="hint">L\'import recopie les éléments du jeu dans la slide : retire ensuite ceux dont tu ne veux pas. Modifier le jeu du site ne changera plus ce parcours.</div></div>';
      if (type === 'sections')
        return '<div class="field"><label>' + label + '</label><div id="' + id + '"></div>'
             + '<button type="button" class="rep-add" data-add="' + cle + '">+ Ajouter</button></div>';
      return '<div class="field"><label>' + label + '</label><input type="text" id="' + id + '"></div>';
    }

    // Lignes répétables ------------------------------------------------------
    // `multi` bascule le marqueur radio (une seule bonne réponse) en case à
    // cocher (plusieurs) — même bascule que l'éditeur de quiz des cours.
    function ligneOption(valeur, coche, avecCorrect, multi) {
      const div = document.createElement('div');
      div.className = 'rep-row';
      const typeMarque = multi ? 'checkbox' : 'radio';
      const nomMarque = multi ? '' : ' name="opt_correct"';
      div.innerHTML = '<input type="text" maxlength="300" value="' + echap(valeur || '') + '" placeholder="Réponse">'
        + (avecCorrect ? '<label class="rep-correct"><input type="' + typeMarque + '"' + nomMarque + (coche ? ' checked' : '') + '> juste</label>' : '')
        + '<button type="button" class="rep-del">✕</button>';
      div.querySelector('.rep-del').onclick = () => div.remove();
      return div;
    }

    function ligneSection(nom, ordre) {
      const div = document.createElement('div');
      div.className = 'rep-row';
      div.innerHTML = '<input type="text" maxlength="120" value="' + echap(nom || '') + '" placeholder="Nom de la partie">'
        + '<input type="number" min="0" style="max-width:90px" value="' + (ordre || 0) + '" title="Slide de départ">'
        + '<button type="button" class="rep-del">✕</button>';
      div.querySelector('.rep-del').onclick = () => div.remove();
      return div;
    }

    function ligneItemJeu(item, jeu) {
      item = item || {};
      const div = document.createElement('div');
      div.className = 'rep-row';
      let cle = '';
      // Le libellé principal change de rôle selon le jeu : pour mot-mystère
      // c'est l'INDICE qui s'affiche, et le mot à deviner est un champ à part
      // (sans quoi la réponse serait visible par le participant).
      let placeholderNom = 'Élément';
      if (jeu === 'compost-ou-pas') {
        cle = '<select style="max-width:120px">'
            + ['oui', 'attention', 'non'].map(c => '<option value="' + c + '"' + (item.cat === c ? ' selected' : '') + '>' + c + '</option>').join('')
            + '</select>';
      } else if (jeu === 'temps-decompo') {
        cle = '<input type="number" min="0" style="max-width:100px" value="' + (item.jours != null ? item.jours : '') + '" placeholder="jours">';
      } else {
        placeholderNom = 'Indice affiché';
        cle = '<input type="text" maxlength="60" style="max-width:130px" value="' + echap(item.mot || '') + '" placeholder="mot à deviner">';
      }
      div.innerHTML = '<input type="text" maxlength="60" style="max-width:70px" value="' + echap(item.emoji || '') + '" placeholder="emoji">'
        + '<input type="text" maxlength="200" value="' + echap(item.nom || '') + '" placeholder="' + placeholderNom + '">'
        + cle + '<button type="button" class="rep-del">✕</button>';
      // L'anecdote du jeu d'origine n'a pas de champ visible : elle voyage
      // avec la ligne pour être réaffichée au participant après sa réponse.
      div.dataset.info = item.info || '';
      div.querySelector('.rep-del').onclick = () => div.remove();
      return div;
    }

    function jeuChoisi() {
      const s = document.getElementById('ch_jeu');
      return s ? s.value : 'compost-ou-pas';
    }

    // Pools des jeux, chargés une seule fois et gardés en mémoire. Ils viennent
    // de games-api, où le contenu des jeux s'édite (/jeux-admin) : l'import
    // reprend donc toujours la version en ligne du jeu.
    let POOLS = null;
    function chargerPools() {
      if (POOLS) return Promise.resolve(POOLS);
      return fetch('/api/jeux/catalogue.php?action=pools')
        .then(r => r.json())
        .then(d => { POOLS = d.pools || {}; return POOLS; })
        .catch(() => ({}));
    }

    // Banque d'anecdotes. Rechargée à chaque ouverture de modale plutôt que
    // mise en cache : l'animateur peut en ajouter dans l'autre onglet.
    function chargerBanque() {
      return fetch('/api/evenements/anecdotes.php?action=liste')
        .then(r => r.json())
        .catch(() => ({ anecdotes: [], themes: [] }));
    }

    // Construit le formulaire d'un type et le pré-remplit --------------------
    function rendreChamps(type, contenu) {
      contenu = contenu || {};
      const zone = document.getElementById('champsType');
      zone.innerHTML = (CHAMPS[type] || []).map(c => champHtml(c[0], c[1], c[2], c[3])).join('');
      if (type === 'sommaire') {
        zone.innerHTML = '<div class="hint">Rien à saisir : le sommaire reprend automatiquement toutes les slides '
          + '« Titre de partie » du parcours, et met en valeur celle qui commence. '
          + 'Place-le juste avant chaque partie.</div>';
      }

      (CHAMPS[type] || []).forEach(([cle, , t]) => {
        const el = document.getElementById('ch_' + cle);
        if (!el) return;
        if (t === 'check') { el.checked = !!contenu[cle]; return; }
        if (t === 'select_vf') { el.value = contenu[cle] ? '1' : '0'; return; }
        if (t === 'options' || t === 'options_simple') {
          const avecCorrect = (t === 'options');
          const multi = avecCorrect && !!contenu.multiple;
          const correctSet = multi && Array.isArray(contenu.correct) ? contenu.correct : [];
          (contenu.options || ['', '']).forEach((o, i) => {
            const coche = avecCorrect && (multi ? correctSet.indexOf(i) !== -1 : contenu.correct === i);
            el.appendChild(ligneOption(o, coche, avecCorrect, multi));
          });
          return;
        }
        if (t === 'sections') {
          (contenu.sections || [{}]).forEach(s => el.appendChild(ligneSection(s.nom, s.slide_ordre)));
          return;
        }
        if (t === 'items_jeu') {
          (contenu.items || [{}]).forEach(it => el.appendChild(ligneItemJeu(it, contenu.jeu || jeuChoisi())));
          return;
        }
        if (contenu[cle] !== undefined && contenu[cle] !== null) el.value = contenu[cle];
      });

      // Boutons « + Ajouter » des widgets répétables
      zone.querySelectorAll('[data-add]').forEach(btn => {
        btn.onclick = () => {
          const cle = btn.dataset.add;
          const cont = document.getElementById('ch_' + cle);
          const def = (CHAMPS[type] || []).find(c => c[0] === cle);
          if (!def) return;
          if (def[2] === 'sections') cont.appendChild(ligneSection('', 0));
          else if (def[2] === 'items_jeu') cont.appendChild(ligneItemJeu({}, jeuChoisi()));
          else cont.appendChild(ligneOption('', false, def[2] === 'options'));
        };
      });

      // Bascule « Plusieurs bonnes réponses » : reconstruit les lignes avec le
      // bon type de marqueur (radio ↔ case à cocher), en gardant les textes déjà
      // saisis. Le passage multi → simple ne garde que la première coche.
      const selMulti = document.getElementById('ch_multiple');
      if (selMulti && type === 'quiz') selMulti.onchange = () => {
        const cont = document.getElementById('ch_options');
        if (!cont) return;
        const lignes = [...cont.querySelectorAll('.rep-row')];
        const etats = lignes.map(l => ({
          valeur: l.querySelector('input[type=text]').value,
          coche: !!l.querySelector('input[type=radio], input[type=checkbox]')?.checked,
        }));
        const multi = selMulti.checked;
        cont.innerHTML = '';
        let dejaCoche = false;
        etats.forEach(({ valeur, coche }) => {
          const c = multi ? coche : (coche && !dejaCoche);
          if (c && !multi) dejaCoche = true;
          cont.appendChild(ligneOption(valeur, c, true, multi));
        });
      };

      // Changer de jeu réinitialise la clé de correction de chaque ligne
      const selJeu = document.getElementById('ch_jeu');
      if (selJeu) selJeu.onchange = () => {
        const cont = document.getElementById('ch_items');
        cont.innerHTML = '';
        cont.appendChild(ligneItemJeu({}, selJeu.value));
      };

      // Import des éléments depuis le jeu du site
      const btnImport = document.getElementById('btnImportPool');
      if (btnImport) btnImport.onclick = () => {
        const jeu = jeuChoisi();
        chargerPools().then(pools => {
          const pool = pools[jeu];
          if (!pool || !pool.items) { afficher('msgModal', 'Aucun élément disponible pour ce jeu.', false); return; }
          const cont = document.getElementById('ch_items');
          cont.innerHTML = '';
          pool.items.forEach(it => cont.appendChild(ligneItemJeu(it, jeu)));
          afficher('msgModal', pool.items.length + ' éléments importés — retire ceux que tu ne veux pas.', true);
        });
      };

      // ── Anecdote : champs conditionnels selon la provenance ──
      if (type === 'anecdote') {
        const selS = document.getElementById('ch_source');
        selS.value = contenu.source || 'libre';

        chargerBanque().then(b => {
          const selA = document.getElementById('ch_anecdote_id');
          if (selA) {
            const liste = b.anecdotes || [];
            selA.innerHTML = liste.length
              ? liste.map(a => '<option value="' + a.id + '">' + echap((a.emoji || '') + ' ' + a.texte.slice(0, 70)) + '</option>').join('')
              : '<option value="">Banque vide — ajoute des anecdotes d\'abord</option>';
            if (contenu.anecdote_id) selA.value = contenu.anecdote_id;
          }
          const selT = document.getElementById('ch_theme');
          if (selT) {
            selT.innerHTML = '<option value="">Tous les thèmes</option>'
              + (b.themes || []).map(t => '<option value="' + echap(t) + '">' + echap(t) + '</option>').join('');
            if (contenu.theme) selT.value = contenu.theme;
          }
        });

        // N'afficher que les champs utiles à la provenance choisie : les trois
        // formulaires cohabitent dans le même bloc, seul l'un d'eux sert.
        const majSource = () => {
          const s = selS.value;
          const aff = (cle, on) => {
            const e = zone.querySelector('[data-champ="' + cle + '"]');
            if (e) e.style.display = on ? '' : 'none';
          };
          aff('corps', s === 'libre');
          aff('emoji', s === 'libre');
          aff('anecdote_id', s === 'banque');
          aff('theme', s === 'aleatoire');
        };
        selS.onchange = majSource;
        majSource();
      }

      // Sélecteur d'emoji sur les champs qui le déclarent
      if (window.attacherSelecteursEmoji) window.attacherSelecteursEmoji(zone);

      // Points : seulement pour les types qui en attribuent
      const noteType = (REGISTRE[type] || {}).note;
      document.getElementById('champPoints').style.display = noteType ? '' : 'none';
    }

    // Relit le formulaire et reconstruit l'objet `contenu` -------------------
    function lireChamps(type) {
      const out = {};
      (CHAMPS[type] || []).forEach(([cle, , t]) => {
        const el = document.getElementById('ch_' + cle);
        if (!el) return;
        if (t === 'check') { out[cle] = el.checked; return; }
        if (t === 'select_vf') { out[cle] = el.value === '1'; return; }
        if (t === 'number') { out[cle] = el.value === '' ? null : Number(el.value); return; }
        if (t === 'options' || t === 'options_simple') {
          const lignes = [...el.querySelectorAll('.rep-row')];
          out.options = lignes.map(l => l.querySelector('input[type=text]').value.trim()).filter(v => v !== '');
          if (t === 'options') {
            if (out.multiple) {
              out.correct = lignes
                .map((l, i) => (l.querySelector('input[type=checkbox]')?.checked ? i : -1))
                .filter(i => i !== -1);
            } else {
              out.correct = Math.max(0, lignes.findIndex(l => { const r = l.querySelector('input[type=radio]'); return r && r.checked; }));
            }
          }
          return;
        }
        if (t === 'sections') {
          out.sections = [...el.querySelectorAll('.rep-row')].map(l => {
            const champs = l.querySelectorAll('input');
            return { nom: champs[0].value.trim(), slide_ordre: Number(champs[1].value || 0) };
          }).filter(s => s.nom !== '');
          return;
        }
        if (t === 'items_jeu') {
          const jeu = jeuChoisi();
          out.items = [...el.querySelectorAll('.rep-row')].map(l => {
            const txt = l.querySelectorAll('input[type=text]');
            const it = { emoji: txt[0].value.trim(), nom: txt[1].value.trim(), info: l.dataset.info || '' };
            if (jeu === 'compost-ou-pas') it.cat = l.querySelector('select').value;
            else if (jeu === 'temps-decompo') it.jours = Number(l.querySelector('input[type=number]').value || 0);
            else it.mot = (txt[2] ? txt[2].value.trim() : '');   // 3e champ texte = mot à deviner
            return it;
          }).filter(i => i.nom !== '');
          return;
        }
        out[cle] = el.value;
      });
      return out;
    }

export { CHAMPS, rendreChamps, lireChamps };
