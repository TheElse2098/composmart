/* ============================================================================
   api.js — client HTTP unique des composants.

   Chaque composant parle à un service par son instance (`api.auth`,
   `api.carte`…) : le nom dit à quel service il s'adresse, et aucun chemin
   `/api/...` n'est écrit ailleurs que dans ce fichier.

   Une seule règle d'erreur, la même partout. Un appel échoue, en levant
   ErreurApi, si :
     - le serveur est injoignable ;
     - la réponse n'est pas du JSON ;
     - le code HTTP est une erreur (4xx, 5xx) ;
     - le corps contient `error`, ou `ok: false`, même avec un code 200.
   Un appel qui aboutit renvoie donc toujours des données exploitables : plus
   de `{ ok: true }` supposé, plus de page figée sur « Chargement… » parce
   qu'un `.catch(() => {})` a avalé la panne.

   Quand une erreur est un état normal (401 pour un visiteur non connecté),
   le composant la rattrape et lit `erreur.statut`.
   ============================================================================ */

/** Paramètres d'URL ou champs de formulaire ; `null` et `undefined` sont ignorés.
 *  @typedef {Record<string, string | number | boolean | null | undefined>} Champs */

export class ErreurApi extends Error {
  /**
   * @param {string} message  message du serveur (`error`), ou un message par défaut
   * @param {{ statut?: number, donnees?: unknown }} [details]
   */
  constructor(message, { statut = 0, donnees = null } = {}) {
    super(message);
    this.name = 'ErreurApi';
    /** Code HTTP ; 0 quand la requête n'a pas abouti (réseau). */
    this.statut = statut;
    /** Corps JSON renvoyé par le serveur, s'il y en avait un. */
    this.donnees = donnees;
  }
}

/**
 * Texte à montrer à l'utilisateur pour une erreur. Le message du serveur est
 * repris tel quel s'il s'agit d'une phrase ; un simple code (`db`,
 * `not_logged_in`) ou une erreur de programmation laissent place au message
 * par défaut — le détail reste dans la console.
 * @param {unknown} erreur
 * @param {string} [defaut]
 * @returns {string}
 */
export function texteErreur(erreur, defaut = "Ce contenu n'a pas pu être chargé.") {
  return erreur instanceof ErreurApi && /\s/.test(erreur.message) ? erreur.message : defaut;
}

/**
 * @param {Champs | undefined} champs
 * @returns {Record<string, string>}
 */
function sansVides(champs) {
  /** @type {Record<string, string>} */
  const propre = {};
  for (const [cle, valeur] of Object.entries(champs || {})) {
    if (valeur != null) propre[cle] = String(valeur);
  }
  return propre;
}

export class Api {
  #base;

  /** @param {string} base préfixe des endpoints du service, par exemple `/api/auth` */
  constructor(base) {
    this.#base = base.replace(/\/+$/, '');
  }

  /**
   * @param {string} fichier  nom de l'endpoint, par exemple `me.php`
   * @param {Champs} [parametres]  paramètres d'URL
   * @returns {Promise<any>} le JSON renvoyé par le serveur
   */
  get(fichier, parametres) {
    return this.#appeler(this.#adresse(fichier, parametres), { method: 'GET' });
  }

  /**
   * Envoi en formulaire (`$_POST` côté PHP). Un FormData passe tel quel, pour
   * les envois de fichiers.
   * @param {string} fichier
   * @param {Champs | FormData | URLSearchParams} [corps]
   * @param {Champs} [parametres]  paramètres d'URL (`?action=…`)
   * @returns {Promise<any>}
   */
  post(fichier, corps, parametres) {
    /** @type {RequestInit} */
    const options = { method: 'POST' };
    if (corps instanceof FormData || corps instanceof URLSearchParams) options.body = corps;
    else if (corps) options.body = new URLSearchParams(sansVides(corps));
    return this.#appeler(this.#adresse(fichier, parametres), options);
  }

  /**
   * Envoi en JSON, pour les endpoints qui lisent `php://input`.
   * @param {string} fichier
   * @param {unknown} donnees
   * @param {Champs} [parametres]
   * @returns {Promise<any>}
   */
  postJson(fichier, donnees, parametres) {
    return this.#appeler(this.#adresse(fichier, parametres), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(donnees),
    });
  }

  /**
   * @param {string} fichier
   * @param {Champs} [parametres]
   * @returns {string}
   */
  #adresse(fichier, parametres) {
    const requete = new URLSearchParams(sansVides(parametres)).toString();
    return this.#base + '/' + fichier + (requete ? '?' + requete : '');
  }

  /**
   * @param {string} adresse
   * @param {RequestInit} options
   * @returns {Promise<any>}
   */
  async #appeler(adresse, options) {
    let reponse;
    let texte;
    try {
      reponse = await fetch(adresse, options);
      texte = await reponse.text();
    } catch {
      throw new ErreurApi('Connexion au serveur impossible.');
    }

    let donnees = null;
    if (texte !== '') {
      try {
        donnees = JSON.parse(texte);
      } catch {
        throw new ErreurApi('Réponse inattendue du serveur (HTTP ' + reponse.status + ').', { statut: reponse.status });
      }
    }

    const corps = donnees !== null && typeof donnees === 'object' ? donnees : {};
    if (!reponse.ok || corps.error || corps.ok === false) {
      const message = typeof corps.error === 'string' && corps.error !== ''
        ? corps.error
        : 'Le serveur a refusé la demande (HTTP ' + reponse.status + ').';
      throw new ErreurApi(message, { statut: reponse.status, donnees });
    }
    return donnees;
  }
}

/** Une instance par service. Les préfixes sont ceux de l'Ingress
 *  (helm/composmart/values.yaml, `ingress.routes`). */
export const api = Object.freeze({
  auth: new Api('/api/auth'),
  cours: new Api('/api/cours'),
  contact: new Api('/api/contact'),
  admin: new Api('/api/admin'),
  carte: new Api('/api/carte'),
  jeux: new Api('/api/jeux'),
  evenements: new Api('/api/evenements'),
});
