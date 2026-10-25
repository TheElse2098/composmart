# map-api — endpoints carte (le service le plus lourd : Haversine sur ~5800 composts).
# Sources : services/map-api/carte/ + garde partagé shared/_guard.php.
# Reconstitue la structure /var/www/html/api/carte/ + /var/www/html/api/_guard.php
# attendue par les require '__DIR__/../_guard.php' (aucune modif PHP nécessaire).
#
# Build depuis la racine du repo :
#   docker build -f services/map-api/Dockerfile -t composmart/map-api .
FROM php:8.3.36-apache

# curl : l'extension PHP (curl_init) sert à envoyer l'audit à auth-api.
# libcurl4-openssl-dev est requise pour compiler l'extension.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev unzip \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-install mysqli curl \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite deflate \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# La conf deflate par défaut ne compresse pas le JSON : la liste France (~290 Ko)
# passe à ~60 Ko une fois gzippée.
RUN echo 'AddOutputFilterByType DEFLATE application/json' > /etc/apache2/conf-available/json-deflate.conf \
    && a2enconf json-deflate

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Garde partagé (sessions Redis, rate-limit, csrf) + endpoints carte uniquement.
COPY shared/_guard.php       /var/www/html/api/_guard.php
COPY services/map-api/carte/ /var/www/html/api/carte/

# PHPMailer (envoi SMTP des signalements) : installé à côté de _guard.php,
# qui charge vendor/autoload.php par chemin relatif.
COPY shared/composer.json    /var/www/html/api/composer.json
RUN cd /var/www/html/api && composer install --no-dev --no-interaction --optimize-autoloader

# Scripts seed (seed_map.php + imports) : utilisés par le Job seed-map (k8s)
# qui lance `php /docker-seeds/seed_map.php`. Embarqués dans l'image map-api.
COPY shared/seeds/           /docker-seeds/

RUN chown -R www-data:www-data /var/www/html
