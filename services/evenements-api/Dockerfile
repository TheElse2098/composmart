# evenements-api — endpoints événements (ateliers B2B, inscription par code/QR).
# Sources : services/evenements-api/evenements/ + garde partagé shared/_guard.php.
# Embarque aussi les pages d'admin (contrôleur + vues, cf. courses-api pour le
# même principe : gabarits hors racine web, 404 indiscernable pour un non-admin).
# Build depuis la racine du repo :
#   docker build -f services/evenements-api/Dockerfile -t composmart/evenements-api .
FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-install mysqli curl \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

COPY shared/_guard.php                   /var/www/html/api/_guard.php
COPY services/evenements-api/evenements/ /var/www/html/api/evenements/

# ── Pages d'administration ─────────────────────────────────────────────────
COPY services/evenements-api/admin-pages/controleur.php /var/www/html/evenements-admin-controleur.php
COPY services/evenements-api/admin-pages/vues/          /var/www/evenements-admin-vues/
COPY services/evenements-api/htaccess-racine            /var/www/html/.htaccess

RUN chown -R www-data:www-data /var/www/html /var/www/evenements-admin-vues
