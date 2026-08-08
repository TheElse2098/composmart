# auth-api — endpoints auth (login, register, me, profile, leaderboard, launchpad, audit).
# Sources : services/auth-api/auth/ + garde partagé shared/_guard.php.
# Build depuis la racine du repo :
#   docker build -f services/auth-api/Dockerfile -t composmart/auth-api .
FROM php:8.3-apache

# curl : l'extension PHP sert à appeler les endpoints de purge des autres
# services lors d'une suppression de compte (delete_account.php).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev unzip \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-install mysqli curl \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY shared/_guard.php        /var/www/html/api/_guard.php
COPY services/auth-api/auth/  /var/www/html/api/auth/

# PHPMailer (vérification d'email, mot de passe oublié) : installé à côté de
# _guard.php, qui charge vendor/autoload.php par chemin relatif.
COPY shared/composer.json    /var/www/html/api/composer.json
RUN cd /var/www/html/api && composer install --no-dev --no-interaction --optimize-autoloader

RUN chown -R www-data:www-data /var/www/html
