#!/bin/sh
# docker-entrypoint.sh pour delivery_api

set -e

echo "[delivery_api Entrypoint] Démarrage du conteneur Delivery API"
echo "[delivery_api Entrypoint] NODE_ENV: ${NODE_ENV}"

# Vérifier les variables de base de données
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_DATABASE" ]; then
    echo "[delivery_api Entrypoint] ERREUR: Variables DB manquantes."
    echo "DB_HOST: ${DB_HOST:-<vide>}, DB_USER: ${DB_USER:-<vide>}, DB_DATABASE: ${DB_DATABASE:-<vide>}"
    exit 1
fi

# Vérifier les variables Firebase essentielles
if [ -z "$FIREBASE_PROJECT_ID" ] || [ -z "$FIREBASE_PRIVATE_KEY" ]; then
    echo "[delivery_api Entrypoint] ERREUR: Variables Firebase manquantes (FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY)."
    exit 1
fi

echo "[delivery_api Entrypoint] DB: ${DB_HOST}:${DB_PORT:-5432}/${DB_DATABASE}"
echo "[delivery_api Entrypoint] Redis: ${REDIS_HOST}:${REDIS_PORT:-6379}"

# Exécuter les migrations AdonisJS
echo "[delivery_api Entrypoint] Exécution des migrations..."
node ace migration:run --force

if [ $? -eq 0 ]; then
    echo "[delivery_api Entrypoint] Migrations OK."
else
    echo "[delivery_api Entrypoint] ERREUR lors des migrations."
    exit 1
fi

# Lancer la commande principale (CMD du Dockerfile ou override Swarm)
echo "[delivery_api Entrypoint] Démarrage: $@"
exec "$@"
