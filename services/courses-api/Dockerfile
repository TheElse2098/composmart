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

# Téléversement des médias de cours (audio des podcasts, illustrations).
# php:8.3-apache plafonne à 2 Mo par défaut, ce qui rejetait tout podcast avant
# même que le code ne voie le fichier. post_max_size doit rester au-dessus de
# upload_max_filesize : il englobe le fichier ET les autres champs du formulaire.
RUN printf 'upload_max_filesize=25M\npost_max_size=27M\nmemory_limit=192M\n' \
    > /usr/local/etc/php/conf.d/composmart-uploads.ini

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY shared/_guard.php            /var/www/html/api/_guard.php
COPY services/courses-api/cours/   /var/www/html/api/cours/
COPY services/courses-api/admin/   /var/www/html/api/admin/
COPY services/courses-api/contact/ /var/www/html/api/contact/
COPY content/                     /var/www/html/content/
COPY shared/seeds/                /docker-seeds/

# ── Pages d'administration ─────────────────────────────────────────────────
# Le contrôleur est le SEUL fichier exposé : il vérifie la session en base puis
# lit le gabarit demandé. Les gabarits sont volontairement déposés hors de
# /var/www/html — sans quoi une URL du type /admin-vues/themes.html servirait
# l'interface à n'importe qui, ce que le contrôle de session est censé empêcher.
COPY services/courses-api/admin-pages/controleur.php /var/www/html/admin-controleur.php
COPY services/courses-api/admin-pages/vues/          /var/www/admin-vues/
COPY services/courses-api/htaccess-racine            /var/www/html/.htaccess

# PHPMailer (envoi SMTP des messages de contact) : installé à côté de _guard.php,
# qui charge vendor/autoload.php par chemin relatif.
COPY shared/composer.json    /var/www/html/api/composer.json
RUN cd /var/www/html/api && composer install --no-dev --no-interaction --optimize-autoloader

RUN chown -R www-data:www-data /var/www/html /var/www/admin-vues
