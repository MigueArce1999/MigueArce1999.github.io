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

# Los roles de Supabase deben existir ANTES del stub (le da grants a anon/authenticated).
psql -h "$HOST" -U "$USUARIO" -v ON_ERROR_STOP=1 -c "
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;"

# crear_base <db> [archivo_sql_a_correr_justo_antes_de_0072]
crear_base() {
  local db="$1" antes_0072="${2:-}"
  psql -h "$HOST" -U "$USUARIO" -c "DROP DATABASE IF EXISTS $db;"
  psql -h "$HOST" -U "$USUARIO" -c "CREATE DATABASE $db;"
  psql -h "$HOST" -U "$USUARIO" -d "$db" -v ON_ERROR_STOP=1 -f "$DIR/stub_auth_local.sql"
  for f in $(ls "$MIGRACIONES"/0*.sql | sort); do
    if [ -n "$antes_0072" ] && [[ "$(basename "$f")" == 0072_* ]]; then
      echo "-- datos del modelo anterior: $(basename "$antes_0072")"
      psql -h "$HOST" -U "$USUARIO" -d "$db" -v ON_ERROR_STOP=1 -f "$antes_0072"
    fi
    echo "-- aplicando $(basename "$f")"
    psql -h "$HOST" -U "$USUARIO" -d "$db" -v ON_ERROR_STOP=1 -f "$f"
  done
}

crear_base "$DB"

echo "=== Migraciones aplicadas. Corriendo criterios de aceptación... ==="
psql -h "$HOST" -U "$USUARIO" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/criterios_aceptacion.sql"
echo "=== Membresías por local (0072)... ==="
psql -h "$HOST" -U "$USUARIO" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/membresias.sql"
psql -h "$HOST" -U "$USUARIO" -c "DROP DATABASE IF EXISTS $DB;"

echo "=== Backfill de 0072 sobre datos del modelo anterior... ==="
crear_base "$DB" "$DIR/legado_pre_0072.sql"
psql -h "$HOST" -U "$USUARIO" -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/legado_post_0072.sql"

psql -h "$HOST" -U "$USUARIO" -c "DROP DATABASE IF EXISTS $DB;"
echo "=== OK: todos los criterios pasaron. Base de prueba eliminada. ==="
