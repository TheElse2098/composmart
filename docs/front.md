# Architecture du front

Le front est découpé en **composants** : chaque morceau d'interface (le
bandeau, le pied de page, le tableau du classement) est une classe JavaScript
avec sa feuille de style, dans son propre dossier. Une page HTML ne contient
plus ni CSS ni JavaScript : elle liste ses morceaux.

Tout repose sur ce que le navigateur fournit (éléments personnalisés, modules
ES). Il n'y a ni framework ni étape de build : les fichiers sont servis tels
qu'ils sont écrits.

La migration des anciennes pages est en cours, une page à la fois. Les deux
mondes cohabitent : `services/web/front/ui/` est le nouveau, `assets/css`,
`assets/js` et `partials/` sont l'ancien et se vident au fil des phases.
L'avancement s'obtient par `node tests/front/verifier.mjs`.

## Arborescence

```
services/web/front/ui/
  socle/        ce que tous les composants partagent
    composant.js   classe de base : cycle de vie, rendu, écoutes, minuteries
    api.js         client HTTP, une instance par service ; ErreurApi
    session.js     qui est connecté, demandé une fois par page
    theme.js       thème clair ou sombre
    outils.js      fonctions pures : html, echapper, pluriel
    amorce.js      pose le thème sombre avant le premier affichage
  styles/
    jetons.css     couleurs et polices, en clair et en sombre (variables seules)
    base.css       remise à zéro, corps de page, liseré, états des composants
  composants/   morceaux utilisés par au moins deux pages (bandeau/, pied/…)
  pages/        un dossier par page publique (classement/…)
  admin/        un dossier par espace d'administration (accueil/…)
tests/front/    contrôles : vérificateur, types, tests (hors des images Docker)
```

## Règles

1. **Un morceau = un fichier `.js` (une classe) + un fichier `.css` du même
   nom.** La balise porte le nom du fichier : `composants/pied/pied.js` définit
   `<cs-pied>`. Sous `admin/`, la balise commence par `cs-admin-`.
2. **Une page migrée ne contient ni `<style>`, ni script écrit dans la page,
   ni attribut `style` ou `onclick`.** Seule exception : un bloc
   `<script type="application/json">` pour des données de route.
3. **Un composant ne touche que ce qu'il a affiché.** Pas d'`id` global, pas
   de variable globale. Un parent parle à un enfant par ses méthodes ; un
   enfant prévient son parent par `emettre()`.
4. **Tout HTML passe par `rendre()` et un gabarit `html`.** Ce qui est
   interpolé est échappé d'office. `innerHTML` n'existe que dans le socle.
5. **Tout appel réseau passe par `api.*`.** Une erreur s'affiche dans la zone
   du composant ; elle n'est jamais avalée par un `catch` vide.
6. **Le mode sombre ne passe que par des variables.** Une règle `html.dark`
   ne fait que redéfinir des variables, en tête de fichier.
7. **Les règles CSS d'un composant sont préfixées par sa balise** (ou par une
   classe à son nom), pour ne pas déborder sur le reste de la page.
8. **Imports relatifs dans le code** (`../../socle/api.js`) ; les chemins
   absolus (`/ui/…`) ne s'écrivent que dans le HTML.
9. **Une classe seulement s'il y a un état et un cycle de vie.** Le reste est
   une fonction dans `outils.js`. Deux niveaux d'héritage au plus.
10. **Le contenu éditorial reste dans le HTML** (accueil, matériel, pages
    légales) : un composant sert à ce qui est dynamique ou partagé. Une page
    de texte n'a pas de composant : sa feuille est dans
    `ui/pages/<page>/<page>.css`, ses classes préfixées par le nom de la page
    (`ui/pages/legal/legal.css`, `ui/pages/introuvable/introuvable.css`).
    Si ce texte a besoin d'un comportement (des onglets, un nombre à jour),
    il est écrit à l'intérieur de la balise d'un composant dont `monter()`
    n'appelle pas `rendre()` : il pose ses écoutes et modifie ce qui est déjà
    là (`<cs-materiel>`, `<cs-accueil-chiffres>`). Le petit en-tête des
    rubriques (pastille, titre, phrase) est habillé par `styles/en-tete.css`.
11. **Jamais de boîte native** (`alert`, `confirm`, `prompt`) : `confirmer()`
    et `informer()` de `composants/dialogue/dialogue.js` les remplacent.

    ```js
    import { confirmer, informer } from '../../composants/dialogue/dialogue.js';

    if (!await confirmer({ titre: 'Supprimer ?', texte: '…', valider: 'Supprimer', danger: true })) return;
    informer({ titre: 'Action impossible', texte: texteErreur(erreur) });
    ```

Le vérificateur contrôle les règles 1, 2, 4, 6, 7, 8 et 11, et pour la
règle 5 l'absence de `fetch` hors de `socle/api.js`.

## En-tête type d'une page migrée

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CompoSmart – Titre de la page</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" sizes="48x48" href="/assets/img/favicon-48.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/img/favicon-16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/img/apple-touch-icon.png">

  <script src="/ui/socle/amorce.js"></script>
  <link rel="stylesheet" href="/assets/css/fonts.css">
  <link rel="stylesheet" href="/ui/styles/jetons.css">
  <link rel="stylesheet" href="/ui/styles/base.css">

  <link rel="stylesheet" href="/ui/composants/bandeau/bandeau.css">
  <link rel="stylesheet" href="/ui/composants/pied/pied.css">
  <link rel="stylesheet" href="/ui/pages/ma-page/ma-page.css">
  <script type="module" src="/ui/composants/bandeau/bandeau.js"></script>
  <script type="module" src="/ui/pages/ma-page/ma-page.js"></script>
  <script type="module" src="/ui/composants/pied/pied.js"></script>
</head>
<body>
  <cs-bandeau></cs-bandeau>
  <cs-ma-page></cs-ma-page>
  <cs-pied></cs-pied>
  <div class="cs-lisere"></div>
</body>
</html>
```

- `amorce.js` vient avant les feuilles de style : c'est lui qui évite l'éclair
  blanc en thème sombre.
- Une balise personnalisée se ferme toujours : `<cs-pied></cs-pied>`, jamais
  `<cs-pied />`.
- Chaque composant charge sa feuille lui-même et attend qu'elle soit appliquée
  avant de s'afficher. La citer dans le `<head>` la fait seulement arriver
  plus tôt ; celle du bandeau y est toujours, pour réserver la bande verte.
- La page cite le module de chaque balise qu'elle écrit. Un composant importe
  lui-même les composants qu'il utilise dans ses gabarits.

## Écrire un composant

```js
import { api } from '../../socle/api.js';
import { Composant } from '../../socle/composant.js';
import { html } from '../../socle/outils.js';

export class Exemple extends Composant {
  static balise = 'cs-exemple';
  static styles = [new URL('./exemple.css', import.meta.url)];

  #page = 1;                                  // état privé

  async monter() {                            // appelé à l'entrée dans la page
    this.ecouter('click', '[data-action="suite"]', () => this.#suite());
    await this.#charger();
  }

  async #charger() {
    const d = await api.cours.get('list.php', { page: this.#page });
    this.rendre(this.gabarit(d));
  }

  #suite() { this.#page++; this.#charger(); }

  gabarit(d) {                                // des données vers du HTML, rien d'autre
    return html`
      <ul>${d.cours.map((c) => html`<li>${c.titre}</li>`)}</ul>
      <button type="button" data-action="suite">Suite</button>`;
  }
}

Exemple.definir();
```

Ce que la classe de base fournit :

| Méthode | Rôle |
|---|---|
| `monter()` | à redéfinir : poser les écoutes, charger, afficher. Les écoutes d'abord, les `await` ensuite |
| `demonter()` | à redéfinir si besoin : le composant a quitté la page |
| `rendre(gabarit, zone?)` | remplace le contenu du composant ou d'une zone ; refuse une chaîne brute |
| `rendreSiChange(gabarit, zone?)` | pour un composant qui se rafraîchit : ne redessine ni un contenu identique, ni pendant une saisie |
| `ecouter(type, selecteur, reaction)` | écoute déléguée, valable pour les éléments des prochains `rendre()` ; ignore ce qui se passe dans un composant enfant |
| `ecouterSur(cible, type, reaction)` | écoute sur le document, la fenêtre, un élément placé sous `<body>` |
| `minuterie(ms, action)` | répétition, arrêtée d'office à la sortie de la page |
| `aLaFin(defaire)` | action à exécuter à la sortie de la page |
| `trouver(selecteur, Classe?)`, `tous(selecteur)` | éléments du composant ; `trouver` lève une erreur claire au lieu de renvoyer `null`. Avec une classe, il rend le composant enfant, prêt à recevoir un appel de méthode |
| `emettre(nom, detail)` | prévient les composants parents |
| `apresMontage(action)` | exécute l'action quand `monter()` est terminé (tout de suite s'il l'est). À utiliser dans toute méthode qu'un parent appelle sur son enfant (`configurer()`, `ouvrir()`) : la balise existe dès que le parent l'écrit, son contenu seulement après sa feuille de style |
| `afficherChargement()`, `afficherErreur(message)` | états standard |
| `surErreur(erreur)` | reçoit une erreur échappée de `monter()` ; par défaut l'affiche |

Un gabarit est une méthode qui ne lit que ses paramètres : elle se teste sous
Node sur une réponse d'API d'exemple (`tests/front/classement.test.mjs`).

Si `monter()` attend une réponse (`await`), poser les écoutes avant : elles
valent pour le contenu à venir, et un composant retiré de la page pendant
l'attente ne garde pas d'écoute orpheline.

Un composant qui a besoin d'une bibliothèque de `assets/vendor` la déclare ;
elle est chargée avant `monter()`, et la page n'a pas à le savoir :

```js
static scripts = [new URL('../../../assets/vendor/chartjs-4.6.1/chart.umd.min.js', import.meta.url)];
```

### Un composant fait d'autres composants

Le panneau d'administration (`ui/admin/panel/`) sert de modèle :

- le parent écrit la balise de l'enfant dans son gabarit et importe son
  module ;
- il le règle par une méthode, juste après l'affichage :
  `this.trouver('[data-graphe="parc"]', AdminGraphePeriode).configurer({ … })` ;
- l'enfant prévient le parent par un évènement : `this.emettre('donnees-modifiees')`,
  que le parent reçoit par `ecouterSur(this, 'donnees-modifiees', …)` ;
- ce qui est commun à plusieurs enfants est habillé par la feuille du parent,
  sous sa balise (`panel.css`, « Communs à tous les onglets » : titre de
  section et son compteur, message « rien à afficher », pagination, couleurs
  des boutons d'action) ; un gabarit commun est une fonction de `communs.js`
  (`gabaritPages()`), un vocabulaire commun une table (`carte-libelles.js`).

Un onglet du panneau expose `rafraichir()` : il est créé à sa première
ouverture, gardé ensuite (ses filtres survivent), et rechargé à chaque retour.

Un morceau trop gros pour un fichier se découpe par nature, pas par taille.
Le journal, par exemple :

| Fichier | Contenu | Sorte |
|---|---|---|
| `journal.js` | la liste, ses filtres, sa pagination | composant |
| `journal-detail.js` | la fenêtre de détail, l'annulation | composant |
| `journal-diff.js` | comparer un avant et un après | fonctions pures |
| `journal-libelles.js` | actions, catégories, noms des champs | tables |

Ajouter une action journalisée côté serveur ne touche que
`journal-libelles.js` (la marche à suivre est en tête du fichier).

### Une fenêtre

Une fenêtre (détail, formulaire) est un composant enfant qui hérite de
`Fenetre` (`socle/fenetre.js`) au lieu de `Composant`. La classe de base
apporte le cadre, l'ouverture, la fermeture (bouton `data-action="fermer"`,
clic à côté, Échap), la page figée derrière et l'habillage commun
(`styles/fenetre.css` : `.fenetre__titre`, `.fenetre__label`,
`.fenetre__champ`, `.fenetre__actions`, `.fenetre__valider`,
`.fenetre__annuler`, `.fenetre__erreur`).

```js
export class AdminAjoutEdition extends Fenetre {
  static balise = 'cs-admin-ajout-edition';
  static styles = [...Fenetre.styles, new URL('./ajout-edition.css', import.meta.url)];

  monter() {
    this.poserFenetre(this.gabarit());   // le contenu, dans le cadre commun
  }

  ouvrir(demande) {
    this.apresMontage(() => { /* remplir */ this.montrer(); });
  }
}
```

| Méthode | Rôle |
|---|---|
| `poserFenetre(gabarit)` | pose le cadre, fermé ; une fois, dans `monter()` |
| `poserFenetre(gabarit, { colonne: true })` | cadre sans marge pour un contenu long : en-tête fixe (`.fenetre__tete`, `.fenetre__titre`, `.fenetre__fermer`), puis un corps qui défile seul |
| `montrer()` / `fermer()` | ouvre, ferme |
| `ouverte`, `posee` | états |
| `aLaFermeture()` | à redéfinir : oublier ce que la fenêtre montrait |

Le parent pose la balise dans son gabarit et ouvre par une méthode :
`this.trouver('cs-admin-ajout-edition', AdminAjoutEdition).ouvrir(demande)`.

### Un même composant pour deux usages

Quand deux pages affichent le même morceau avec des mots, des droits ou un
service différents, le composant ne connaît ni l'un ni l'autre : son parent
lui donne un objet qui décrit son usage. `<cs-fil-discussion>` (la discussion
d'un ticket) sert ainsi à l'administrateur dans le panneau et au titulaire sur
sa page de compte :

```js
this.trouver('cs-fil-discussion', FilDiscussion).configurer({
  admin: true,                                         // quels messages sont « les miens »
  lire: (id) => api.admin.get('tickets.php', { id }),  // à quel service parler
  actions: (statut) => […],                            // quels boutons proposer
  …
});
```

Le type `PointDeVue`, en tête de `fil-discussion.js`, liste ce qu'il faut
fournir ; l'exemple complet est `VUE_ADMIN` dans `admin/panel/messages.js`.
Ne jamais ajouter au composant un `if (admin)` : ajouter un champ au point de
vue.

Quand seules des mesures changent d'une page à l'autre, le composant les
expose en variables CSS, que la page règle dans sa propre feuille.
`<cs-courbe-xp>` (la courbe d'XP, sur la page de compte et sur la fiche
joueur du panneau) :

```css
cs-admin-fiche-joueur cs-courbe-xp { --courbe-hauteur: 110px; --courbe-total: 1.3rem; }
```
Une feuille de fenêtre ne contient que ses écarts au cadre commun, sous sa
balise. Pour une question oui / non ou un message, c'est `confirmer()` et
`informer()` (règle 11), pas une fenêtre.

Types : chaque module est annoté en JSDoc. La forme d'une réponse d'API se
déclare par un `@typedef` à côté du composant qui la lit, avec le nom du
fichier PHP qui la produit.

## Styles

- `jetons.css` ne contient que des variables, chacune avec sa valeur claire
  (`:root`) et sombre (`html.dark`). N'y entre que ce qui sert à plusieurs
  composants.
- Une couleur ou une ombre propre à un composant se déclare en tête de sa
  feuille, sous la même forme :

  ```css
  cs-exemple { display: block; --exemple-fond: #e8f5e9; }
  html.dark cs-exemple { --exemple-fond: #16291c; }
  cs-exemple .carte { background: var(--exemple-fond); color: var(--texte); }
  ```

- La première règle donne un `display` à la balise : une balise personnalisée
  est en ligne par défaut.
- Mobile d'abord ; les grands écrans par `@media (min-width: …)`, en utilisant
  la largeur plutôt qu'une colonne étroite centrée.

## Appels réseau et erreurs

```js
const d = await api.auth.get('leaderboard.php', { periode: 'semaine' });
await api.contact.post('tickets.php', { action: 'repondre', id, corps });
await api.admin.postJson('cours_save.php', cours);
```

Une instance par service : `api.auth`, `api.cours`, `api.contact`,
`api.admin`, `api.carte`, `api.jeux`, `api.evenements`.

Un appel lève `ErreurApi` si le serveur est injoignable, si la réponse n'est
pas du JSON, si le code HTTP est une erreur, ou si le corps contient `error`
ou `ok: false`. `erreur.statut` porte le code HTTP (0 pour le réseau).

```js
try {
  …
} catch (erreur) {
  if (erreur instanceof ErreurApi && erreur.statut === 401) return this.#inviter();
  console.error('<cs-exemple>', erreur);
  this.afficherErreur(texteErreur(erreur, "La liste n'a pas pu être chargée."));
}
```

`texteErreur()` reprend le message du serveur s'il s'agit d'une phrase, et le
message par défaut sinon. `session.moi()` répond à « qui est connecté » sans
jamais lever, et ne questionne le serveur qu'une fois par page.

Un fichier à faire enregistrer (un export) ne passe pas par un lien direct :
une erreur deviendrait un fichier téléchargé qui contient le message.

```js
const fichier = await api.auth.telecharger('export.php');   // ErreurApi si refus
enregistrer(fichier.nom || 'export.json', fichier.contenu);  // socle/fichier.js
```

Les dates du serveur (« 2026-11-14 09:15:00 ») se lisent avec `dateSql()`,
s'écrivent avec `jourCourt()` (« 14 nov. ») et `moisAnnee()` (« novembre
2026 ») : `socle/outils.js`.

## Administration

L'interface d'administration vit dans `ui/admin/`, servie par `web` comme le
reste. Dans chaque service il ne reste qu'une **coquille** HTML (la liste des
morceaux de la page), servie par le contrôleur après vérification des droits.

- Les adresses `/admin`, `/jeux-admin`, `/evenements-admin` répondent toujours
  404 à un non-administrateur.
- Les données restent derrière les API, qui vérifient les droits côté serveur.
- Les fichiers de `ui/` sont publics : ils ne contiennent que du code. **Aucune
  donnée, aucun secret, aucune adresse interne en dur.**
- Modifier l'interface d'administration ne reconstruit que `web`.

## Transition : les pages pas encore migrées

Les pages historiques contiennent encore `<div id="site-nav"></div>` et
`<div id="site-footer"></div>`, et chargent `assets/js/site-nav.js`,
`site-footer.js` et `verif-banner.js`. Ces trois scripts sont des
**passerelles** : chacun remplace son conteneur par le composant
(`<cs-bandeau>`, `<cs-pied>`, `<cs-rappel-email>`) et charge son module. Toutes
les pages du site affichent donc le même bandeau et le même pied, sans avoir
été modifiées.

- **Identifiants conservés.** Posé par une passerelle, le bandeau reprend
  `id="site-nav"` et le pied `id="site-footer"` : des pages les visent encore
  (mode projection du suivi d'atelier, pied masqué pendant un parcours). Le
  burger garde `id="burgerBtn"`, que la carte guette pour quitter le plein
  écran. Ces identifiants disparaîtront avec la migration des pages concernées.
- **Ce que le socle apporte de lui-même.** Un composant charge les variables
  de couleur et les polices du site s'il arrive dans une page qui ne les
  référence pas (`/carte` n'a pas `fonts.css`).
- **Scripts laissés tels quels.** `theme.js` et `admin-badge.js` servent encore
  aux quatre pages de jeu, qui ont leur propre barre ; ailleurs ils ne trouvent
  rien à faire.
- **`partials/` reste en place pour l'instant.** Plus aucun script ne s'en
  sert, mais un navigateur peut garder plusieurs jours une copie de l'ancien
  `site-nav.js`, téléchargée avant l'en-tête `no-cache` : cette copie demande
  encore `/partials/site-nav` et n'afficherait plus de menu s'il avait
  disparu. Le dossier se supprime au ménage final.
- **Fin de la transition.** Une passerelle disparaît avec la dernière page
  qui la charge.

La page `404.html` n'existe qu'en un exemplaire, dans `web`. Les Dockerfile de
courses-api, games-api et evenements-api la copient : la réponse d'une adresse
d'administration à un non-administrateur est la même, au caractère près, que
celle d'une adresse inexistante.

## Contrôles

À lancer avant de livrer, depuis la racine du dépôt :

```bash
npm --prefix tests/front install     # une fois par machine
npm --prefix tests/front run controle
```

La commande enchaîne :

1. `node tests/front/verifier.mjs` : structure (imports à la casse exacte,
   balises définies, variables CSS, pages sans code en ligne, en-tête type) ;
2. `tsc --noEmit --checkJs` : types (propriété mal nommée, méthode
   inexistante, mauvais argument) ;
3. `node --test` :
   - le socle (`outils`, `api`, `session`, `composant`) ;
   - les gabarits, sur des réponses d'API d'exemple ;
   - le **montage** des composants (`montage.test.mjs`) : chaque composant est
     placé dans un faux navigateur (`faux-dom.mjs`), avec un faux serveur, et
     on vérifie ce qu'il affiche, ce qu'il demande et ce qu'il fait d'un clic.
     C'est là que se voit une faute de sélecteur entre un gabarit et le code
     qui s'en sert ;
   - le vérificateur lui-même, sur des fautes introduites dans une copie
     temporaire du front.

Ce que ces contrôles ne voient pas : le rendu réel (mise en page, couleurs,
CSS), un vrai navigateur, le comportement réel des API. Le faux navigateur lit
le HTML des gabarits et fait remonter les clics, rien de plus. Le reste se
vérifie sur le site déployé.

`typescript` est un outil de développement : il n'entre dans aucune image
Docker et rien n'est compilé.

## Cache

`services/web/front/.htaccess` envoie `Cache-Control: no-cache` pour les
`.html`, `.js` et `.css` : le navigateur redemande à chaque fois si le fichier
a changé (réponse 304 sinon). Une page faite de modules qui s'importent ne
supporte pas le mélange d'un fichier d'avant le déploiement avec un fichier
d'après. La convention `?v=N` n'a plus lieu d'être sur les fichiers de `ui/`.

## Migrer une page

1. Lire la page : repérer ses morceaux, ce qui est partagé avec d'autres pages,
   ce qui est du contenu statique.
2. Créer un composant par morceau, en reprenant le HTML et le CSS existants.
   Les couleurs passent par les variables ; ce qui diffère en sombre va en tête
   de la feuille.
3. Écrire les tests : les gabarits sur des réponses d'API d'exemple, puis le
   montage (ouverture, clics, erreur du serveur) dans `montage.test.mjs`.
4. Réduire la page à son squelette (en-tête type ci-dessus).
5. `npm --prefix tests/front run controle`.
6. Déployer et vérifier sur le site, en clair et en sombre, sur téléphone et
   sur ordinateur, connecté et non connecté.

Une page importante se reconstruit à côté de l'ancienne, à une adresse
provisoire (le panneau d'administration a été refait à `/admin/panel-v2`, la
page de compte à `/compte-v2.html`, avec `<meta name="robots"
content="noindex">`), qu'on compare à l'ancienne en production. Une fois
validée, elle prend l'adresse définitive et l'ancienne page est supprimée,
en une livraison à part : la bascule.

Plusieurs pages qui se ressemblent partagent une classe de base dans leur
dossier : les six pages d'authentification (`ui/pages/auth/`) héritent de
`CarteAuth` (`carte-auth.js` : la carte, les messages, le bouton 👁 des mots
de passe) et ne gardent que leur formulaire et leurs envois.

Exemple de page découpée en parties : `ui/pages/compte/` — la page
(`compte.js`) n'affiche que ce qui est simple ; chaque partie qui a son propre
comportement (`compte-tickets.js`, `compte-reglages.js`, `compte-sortie.js`)
est un composant que la page pose dans son gabarit et règle par
`configurer()`.

Le rendu ne change pas. Toute différence volontaire est décidée avant.
