# evenements-api — endpoints événements (ateliers B2B, inscription par code/QR).
# Sources : services/evenements-api/evenements/ + garde partagé shared/_guard.php.
# Embarque aussi les pages d'admin (contrôleur + vues, cf. courses-api pour le
# même principe : gabarits hors racine web, 404 indiscernable pour un non-admin).
# Build depuis la racine du repo :
#   docker build -f services/evenements-api/Dockerfile -t composmart/evenements-api .
FROM php:8.3.36-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-install mysqli curl \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && a2enmod rewrite \
    && sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# Téléversement des illustrations de la banque d'images.
# php:8.3-apache plafonne à 2 Mo par défaut : sans ces lignes, toute image plus
# lourde était refusée AVANT que le code ne la voie, quelle que soit la limite
# applicative annoncée. post_max_size doit rester au-dessus de
# upload_max_filesize : il englobe le fichier ET les autres champs du
# formulaire — et un POST qui le dépasse vide `$_FILES` autant que `$_POST`.
# Le plafond réel appliqué reste celui d'images.php (IMG_TAILLE_MAX) ; ces
# valeurs lui laissent simplement de la marge.
RUN printf 'upload_max_filesize=12M\npost_max_size=14M\nmemory_limit=192M\n' \
    > /usr/local/etc/php/conf.d/composmart-uploads.ini

COPY shared/_guard.php                   /var/www/html/api/_guard.php
COPY services/evenements-api/evenements/ /var/www/html/api/evenements/
# Purge nocturne RGPD (CronJob purge-rgpd-evenements) : hors racine web.
COPY services/evenements-api/cron/       /var/www/cron/
# (Les éléments des jeux importables dans une slide sont servis par games-api :
# /api/jeux/catalogue.php?action=pools.)

# ── Pages d'administration ─────────────────────────────────────────────────
COPY services/evenements-api/admin-pages/controleur.php /var/www/html/evenements-admin-controleur.php
COPY services/evenements-api/admin-pages/vues/          /var/www/evenements-admin-vues/
COPY services/evenements-api/htaccess-racine            /var/www/html/.htaccess

RUN chown -R www-data:www-data /var/www/html /var/www/evenements-admin-vues
