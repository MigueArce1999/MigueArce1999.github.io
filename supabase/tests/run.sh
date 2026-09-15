#!/usr/bin/env bash
# Corre las migraciones + los criterios de aceptación contra un Postgres local (no Supabase),
# usando un esquema `auth` mínimo que imita lo que Supabase ya provee en un proyecto real.
# Uso: PGPASSWORD=postgres ./run.sh [host] [usuario]
set -euo pipefail

HOST="${1:-127.0.0.1}"
USUARIO="${2:-postgres}"
DB="salon_test"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRACIONES="$DIR/../migrations"

psql -h "$HOST" -U "$USUARIO" -c "DROP DATABASE IF EXISTS $DB;"
psql -h "$HOST" -U "$USUARIO" -c "CREATE DATABASE $DB;"
psql -h "$HOST" -U "$USUARIO" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/stub_auth_local.sql"
psql -h "$HOST" -U "$USUARIO" -d "$DB" -v ON_ERROR_STOP=1 -c "
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;"

for f in $(ls "$MIGRACIONES"/0*.sql | sort); do
  echo "-- aplicando $(basename "$f")"
  psql -h "$HOST" -U "$USUARIO" -d "$DB" -v ON_ERROR_STOP=1 -f "$f"
done

echo "=== Migraciones aplicadas. Corriendo criterios de aceptación... ==="
psql -h "$HOST" -U "$USUARIO" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/criterios_aceptacion.sql"

psql -h "$HOST" -U "$USUARIO" -c "DROP DATABASE IF EXISTS $DB;"
echo "=== OK: todos los criterios pasaron. Base de prueba eliminada. ==="
