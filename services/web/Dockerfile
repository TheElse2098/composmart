# web — sert le front statique. Les appels /api/* n'arrivent jamais ici :
# l'Ingress (helm/composmart/values.yaml, ingress.routes) les envoie
# directement au service concerné.
# Reste sur php:8.3-apache (et non nginx) pour l'instant : le front utilise un .htaccess
# avec des URLs propres non triviales (redirections .html, slugs /cours/<slug>). Garder
# Apache évite toute régression de routage. Migration nginx = optimisation ultérieure.
#
# Build depuis la racine du repo (fait par helm/deploy.sh) :
#   docker build -f services/web/Dockerfile -t composmart/web .
FROM php:8.3.36-apache

RUN a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# Front statique uniquement (pas d'API embarquée : elle vit dans les services dédiés).
COPY services/web/front/ /var/www/html/

# content/ (médias de cours : podcasts/vidéos déposés à côté du texte.md) servi
# tel quel en statique, pour que /content/cours/<slug>/<fichier> soit joignable
# (get.php, côté courses-api, construit cette URL — cf. content/README le cas échéant).
COPY content/ /var/www/html/content/

RUN chown -R www-data:www-data /var/www/html
