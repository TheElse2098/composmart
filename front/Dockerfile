FROM php:8.3-apache

RUN docker-php-ext-install mysqli \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# front/ → racine web, api/ → /var/www/html/api/
COPY front/ /var/www/html/
COPY api/   /var/www/html/api/

RUN chown -R www-data:www-data /var/www/html
