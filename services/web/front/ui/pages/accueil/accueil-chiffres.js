/* ============================================================================
   accueil-chiffres.js — <cs-accueil-chiffres> : les chiffres de l'accueil.

   Les cartes et leurs libellés sont écrits dans la page (c'est du texte) ;
   ce composant ne fait que remplacer les valeurs marquées `data-chiffre` par
   celles du jour : composteurs sur la carte, cours publiés, jeux publiés. Ces
   nombres changent sans déploiement (un cours se crée depuis l'administration) :
   écrits en dur, ils se périmaient — le nombre de jeux en est resté à 2 quand
   le site en comptait 4.

   Une source qui ne répond pas laisse la valeur écrite dans la page.

   Usage, dans index.html :
     <cs-accueil-chiffres class="stats">
       <div class="stat"><div class="stat-num" data-chiffre="composts">5 800+</div>…</div>
       …
     </cs-accueil-chiffres>
   ============================================================================ */
import { api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';

/**
 * Les trois nombres, chacun demandé à son service.
 * @type {Record<string, () => Promise<string>>}
 */
const SOURCES = {
  // « 5 812+ » : la carte n'a pas tout, le « + » le dit.
  composts: async () => (await api.carte.get('count.php')).composts.toLocaleString('fr-FR') + '+',
  cours: async () => String((await api.cours.get('count.php')).cours),
  // Un administrateur reçoit aussi les brouillons : ils ne comptent pas.
  jeux: async () => String((await api.jeux.get('catalogue.php', { action: 'liste' })).jeux
    .filter((/** @type {{ statut: string }} */ j) => j.statut === 'publie').length),
};

export class AccueilChiffres extends Composant {
  static balise = 'cs-accueil-chiffres';

  async monter() {
    await Promise.all(this.tous('[data-chiffre]').map(async (case_) => {
      const source = SOURCES[case_.dataset.chiffre || ''];
      if (!source) return;
      try {
        case_.textContent = await source();
      } catch (erreur) {
        console.error('<cs-accueil-chiffres>', erreur); // la valeur écrite dans la page reste
      }
    }));
  }
}

AccueilChiffres.definir();
