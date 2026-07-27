FROM composer:2 AS dependencies
WORKDIR /app
COPY composer.json composer.lock* ./
RUN composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader

FROM php:8.3-apache
RUN docker-php-ext-install pdo_mysql && a2enmod rewrite
WORKDIR /var/www/html
COPY . /var/www/html
COPY --from=dependencies /app/vendor /var/www/html/vendor
RUN sed -ri -e 's!/var/www/html!/var/www/html/public!g' /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
    && chown -R www-data:www-data storage bootstrap/cache \
    && chmod +x /var/www/html/docker-entrypoint.sh
ENTRYPOINT ["/var/www/html/docker-entrypoint.sh"]
