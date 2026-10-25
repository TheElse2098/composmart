# games-api — mini-jeux : contenu et règles (table jeux), scores, pages /jeux-admin.
# Sources : services/games-api/jeux/ + admin-pages/ + garde partagé shared/_guard.php.
# Build depuis la racine du repo :
#   docker build -f services/games-api/Dockerfile -t composmart/games-api .
FROM php:8.3.36-apache

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

# ── Pages d'administration (/jeux-admin) ───────────────────────────────────
# Contrôleur + gabarits hors racine web, cf. courses-api et evenements-api.
COPY services/games-api/admin-pages/controleur.php /var/www/html/jeux-admin-controleur.php
COPY services/games-api/admin-pages/vues/          /var/www/jeux-admin-vues/
COPY services/games-api/htaccess-racine            /var/www/html/.htaccess

RUN chown -R www-data:www-data /var/www/html /var/www/jeux-admin-vues
