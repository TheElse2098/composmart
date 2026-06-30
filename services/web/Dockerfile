# web — sert le front statique + route /api/* vers les services API (rôle Ingress en local).
# Reste sur php:8.3-apache (et non nginx) pour l'instant : le front utilise un .htaccess
# avec des URLs propres non triviales (redirections .html, slugs /cours/<slug>). Garder
# Apache évite toute régression de routage. Migration nginx = optimisation ultérieure.
#
# Build depuis la racine du repo :
#   docker build -f services/web/Dockerfile -t composmart/web .
FROM php:8.3-apache

RUN a2enmod rewrite proxy proxy_http \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# Front statique uniquement (pas d'API embarquée : elle vit dans les services dédiés).
COPY front/ /var/www/html/

# Reverse-proxy /api/<domaine> → service correspondant.
COPY services/web/api-proxy.conf /etc/apache2/conf-enabled/api-proxy.conf

RUN chown -R www-data:www-data /var/www/html
