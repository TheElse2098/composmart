/* ============================================================================
   materiel.js — <cs-materiel> : la page « Le Matériel » (/materiel).

   Tout le contenu est écrit dans la page (c'est du texte) : quatre onglets
   (compost en bac, lombricomposteur, point d'apport, commun), leurs fiches,
   et l'encadré « à ne jamais composter ». Ce composant n'ajoute que deux
   comportements :
     - les onglets : un clic montre la fiche correspondante ;
     - les fiches d'un objet qui s'achète (prix ni « Gratuit » ni « — ») :
       un clic cherche l'objet sur Ecosia, dans un nouvel onglet.

   Usage, dans materiel.html :
     <cs-materiel>
       <div class="tabs"><div class="tab active" data-tab="bac">…</div>…</div>
       <div class="tab-content active" id="tab-bac">…</div>
       …
     </cs-materiel>
   ============================================================================ */
import { Composant } from '../../socle/composant.js';

/** Prix d'un objet qui ne s'achète pas. */
const SANS_ACHAT = ['Gratuit', '—'];

/**
 * L'adresse de recherche d'un objet sur Ecosia. URLSearchParams écrit les
 * espaces en « + », la forme qu'Ecosia attend.
 * @param {string} nom
 */
export function rechercheAchat(nom) {
  return 'https://www.ecosia.org/shopping?' + new URLSearchParams({ q: nom });
}

export class Materiel extends Composant {
  static balise = 'cs-materiel';
  static styles = [new URL('./materiel.css', import.meta.url)];

  monter() {
    // Les fiches achetables le montrent au survol (panier) et au pointeur.
    for (const fiche of this.tous('.item-card')) {
      const prix = fiche.querySelector('.item-price');
      if (prix && !SANS_ACHAT.includes((prix.textContent || '').trim())) fiche.classList.add('achetable');
    }
    this.ecouter('click', '.item-card.achetable', (fiche) => {
      const nom = (fiche.querySelector('.item-name')?.textContent || '').trim();
      window.open(rechercheAchat(nom), '_blank', 'noopener');
    });
    this.ecouter('click', '[data-tab]', (onglet) => this.#montrerOnglet(onglet.dataset.tab || ''));
  }

  /** @param {string} cle  `bac`, `lombri`, `apport`, `commun` */
  #montrerOnglet(cle) {
    const fiche = this.querySelector('#tab-' + cle);
    if (!fiche) return;
    for (const onglet of this.tous('[data-tab]')) onglet.classList.toggle('active', onglet.dataset.tab === cle);
    for (const contenu of this.tous('.tab-content')) contenu.classList.toggle('active', contenu === fiche);
  }
}

Materiel.definir();
