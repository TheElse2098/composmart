# games-api — api/jeux/* — scores des mini-jeux.
# Build depuis la racine du repo :
#   docker build -f services/games-api/Dockerfile -t composmart/games-api .
FROM php:8.3-apache

RUN docker-php-ext-install mysqli \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

COPY api/_guard.php   /var/www/html/api/_guard.php
COPY api/jeux/        /var/www/html/api/jeux/

RUN chown -R www-data:www-data /var/www/html
