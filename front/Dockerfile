FROM php:8.3-apache

RUN docker-php-ext-install mysqli \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# front/ → racine web, api/ → /var/www/html/api/
COPY front/   /var/www/html/
COPY api/     /var/www/html/api/
COPY content/ /var/www/html/content/

# Seeds (import initial de la DB)
COPY db/seeds/ /docker-seeds/

RUN chown -R www-data:www-data /var/www/html \
    && chmod +x /var/www/html/docker-entrypoint.sh

# Invoqué via `bash` explicitement : le script est bind-monté en dev depuis
# l'hôte (Windows/WSL), où le bit exécutable n'est pas toujours honoré.
ENTRYPOINT ["bash", "/var/www/html/docker-entrypoint.sh"]
