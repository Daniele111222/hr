#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
api_schema_file=$(mktemp "${TMPDIR:-/tmp}/paylite-openapi.XXXXXX")
trap 'rm -f "$api_schema_file"' EXIT
../backend/.venv/bin/python -c 'import json,sys; from paylite.application import create_app; print(json.dumps(create_app().openapi()))' > "$api_schema_file"
./node_modules/.bin/openapi-typescript "$api_schema_file" -o src/shared/api/schema.d.ts
./node_modules/.bin/prettier --write src/shared/api/schema.d.ts
