# map-api — api/carte/* (le service le plus lourd : Haversine sur ~5800 composts).
# Reproduit la structure attendue par le code : api/carte/ + api/_guard.php un cran au-dessus,
# donc AUCUNE modif PHP nécessaire (les endpoints font require '__DIR__/../_guard.php').
#
# Build depuis la racine du repo :
#   docker build -f services/map-api/Dockerfile -t composmart/map-api .
FROM php:8.3-apache

# curl : l'extension PHP (curl_init) sert à envoyer l'audit à auth-api.
# libcurl4-openssl-dev est requise pour compiler l'extension.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-install mysqli curl \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# Garde partagé (sessions Redis, rate-limit, csrf) + endpoints carte uniquement.
COPY api/_guard.php   /var/www/html/api/_guard.php
COPY api/carte/       /var/www/html/api/carte/

RUN chown -R www-data:www-data /var/www/html

# Pas de seed ici : chaque base est peuplée par son propre Job (cf. étape 2).
