# games-api — endpoints jeux (scores des mini-jeux).
# Sources : services/games-api/jeux/ + garde partagé shared/_guard.php.
# Build depuis la racine du repo :
#   docker build -f services/games-api/Dockerfile -t composmart/games-api .
FROM php:8.3-apache

# curl : l'extension PHP sert à créditer l'XP des jeux via auth-api (xp.php).
# libcurl4-openssl-dev est requise pour compiler l'extension.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-install mysqli curl \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

COPY shared/_guard.php         /var/www/html/api/_guard.php
COPY services/games-api/jeux/  /var/www/html/api/jeux/

RUN chown -R www-data:www-data /var/www/html
