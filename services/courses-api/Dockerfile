# courses-api — api/cours/* + api/admin/* — contenu éditorial + back-office.
# Embarque content/ (cours, thèmes) et les seeds cours.
# Build depuis la racine du repo :
#   docker build -f services/courses-api/Dockerfile -t composmart/courses-api .
FROM php:8.3-apache

RUN docker-php-ext-install mysqli \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

COPY api/_guard.php   /var/www/html/api/_guard.php
COPY api/cours/       /var/www/html/api/cours/
COPY api/admin/       /var/www/html/api/admin/
COPY content/         /var/www/html/content/

RUN chown -R www-data:www-data /var/www/html
