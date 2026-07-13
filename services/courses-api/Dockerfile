# courses-api — endpoints cours + admin + contenu éditorial.
# Sources : services/courses-api/{cours,admin}/ + content/ + garde partagé.
# Embarque aussi les seeds (le Job seed-core lance php /docker-seeds/seed_core.php).
# Build depuis la racine du repo :
#   docker build -f services/courses-api/Dockerfile -t composmart/courses-api .
FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-install mysqli \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY shared/_guard.php            /var/www/html/api/_guard.php
COPY services/courses-api/cours/   /var/www/html/api/cours/
COPY services/courses-api/admin/   /var/www/html/api/admin/
COPY services/courses-api/contact/ /var/www/html/api/contact/
COPY content/                     /var/www/html/content/
COPY shared/seeds/                /docker-seeds/

# PHPMailer (envoi SMTP des messages de contact) : installé à côté de _guard.php,
# qui charge vendor/autoload.php par chemin relatif.
COPY shared/composer.json    /var/www/html/api/composer.json
RUN cd /var/www/html/api && composer install --no-dev --no-interaction --optimize-autoloader

RUN chown -R www-data:www-data /var/www/html
