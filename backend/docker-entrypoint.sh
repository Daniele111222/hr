#!/usr/bin/env bash
set -euo pipefail

cd /app

if [[ -z "${PAYLITE_DATABASE_URL:-}" ]]; then
    export PAYLITE_DATABASE_URL="postgresql+psycopg://paylite:paylite_dev@postgres:5432/paylite"
fi

alembic -c alembic.ini upgrade head
exec uvicorn paylite.main:app --host 0.0.0.0 --port 8000
