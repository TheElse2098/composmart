# Composants de tiers

Le dépôt Composmart est sous droits réservés (voir [LICENSE](LICENSE)), à
l'exception des composants ci-dessous, qui restent soumis à leur propre
licence et appartiennent à leurs auteurs.

## Bibliothèques et polices embarquées

Hébergées dans `services/web/front/assets/vendor/` (servies localement plutôt
que par un CDN, pour ne transmettre aucune donnée de visiteur à un tiers).

| Composant | Version | Auteur | Licence |
|---|---|---|---|
| [Leaflet](https://leafletjs.com) | 1.9.4 | Volodymyr Agafonkin, CloudMade | BSD 2-Clause |
| [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) | 1.4.1 | Dave Leaver | MIT |
| [Leaflet.fullscreen](https://github.com/brunob/leaflet.fullscreen) | 1.4.5 | Bruno Bergot | MIT (fichier `LICENSE` inclus) |
| [Bootstrap](https://getbootstrap.com) (CSS) | 5.3.7 | The Bootstrap Authors | MIT |
| [KaTeX](https://katex.org) | 0.18.1 | Khan Academy et contributeurs | MIT |
| [marked](https://marked.js.org) | 15.0.12 | Christopher Jeffrey et contributeurs | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.1.6 | Cure53 et contributeurs | Apache 2.0 ou MPL 2.0 |
| [Chart.js](https://www.chartjs.org) | 4.6.1 | Chart.js contributors | MIT |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | Kazuhiko Arase | MIT |
| [Nunito](https://fonts.google.com/specimen/Nunito) (police) | — | Vernon Adams, Cyreal, Jacques Le Bailly | SIL Open Font License 1.1 |
| [Baloo 2](https://fonts.google.com/specimen/Baloo+2) (police) | — | Ek Type | SIL Open Font License 1.1 |

Les fichiers minifiés conservent l'en-tête de copyright de leurs auteurs.

## Dépendances installées à la construction des images

Non incluses dans le dépôt, téléchargées lors du `docker build` :

| Composant | Licence |
|---|---|
| [PHPMailer](https://github.com/PHPMailer/PHPMailer) (via Composer) | LGPL 2.1 |
| Images Docker `php:8.3-apache`, `mariadb:11`, `redis:7-alpine` | Licences respectives de PHP, MariaDB et Redis |

## Données

| Données | Source | Licence |
|---|---|---|
| Fond de carte, composteurs importés d'OpenStreetMap (`shared/seeds/import_osm.php`) | © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) |
| Composteurs de Montpellier (`shared/seeds/montpellier.json`) | Ville de Montpellier / Montpellier Méditerranée Métropole, portail open data | Licence ouverte du portail, réutilisation avec mention de la source |
| Composteurs de Rennes (`shared/seeds/rennes.json`) | Rennes Métropole, portail open data | Licence ouverte du portail, réutilisation avec mention de la source |
| Composteurs de Marseille (`shared/seeds/marseille.json`) | Ville de Marseille, portail open data | Licence ouverte du portail, réutilisation avec mention de la source |

Ces données sont fournies à titre indicatif ; la mention de leur source sur
le site figure dans les mentions légales (`/mentions-legales`).
