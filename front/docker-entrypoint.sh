#!/bin/bash
set -e

echo "=== CompoSmart — démarrage ==="
php /docker-seeds/seed.php
echo "=== Lancement d'Apache ==="
exec apache2-foreground
