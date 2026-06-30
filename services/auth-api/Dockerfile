# auth-api — endpoints auth (login, register, me, profile, leaderboard, launchpad, audit).
# Sources : services/auth-api/auth/ + garde partagé shared/_guard.php.
# Build depuis la racine du repo :
#   docker build -f services/auth-api/Dockerfile -t composmart/auth-api .
FROM php:8.3-apache

RUN docker-php-ext-install mysqli \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

COPY shared/_guard.php        /var/www/html/api/_guard.php
COPY services/auth-api/auth/  /var/www/html/api/auth/

RUN chown -R www-data:www-data /var/www/html
