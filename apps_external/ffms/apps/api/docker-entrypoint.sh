#!/bin/sh
set -eu

until php artisan migrate --force; do
  echo "RFMS API is waiting for MySQL..."
  sleep 3
done

php artisan db:seed --force
php artisan storage:link || true

exec apache2-foreground
