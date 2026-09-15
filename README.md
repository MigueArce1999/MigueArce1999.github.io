# Claudia Patricia — Ecosistema digital del salón

Ecosistema de 4 experiencias conectadas a una misma base de datos (Supabase/Postgres) para el
salón de belleza Claudia Patricia (Cartagena, Colombia): web pública, portal de clientes,
portal de empleadas y dashboard administrativo.

**Empieza por `docs/00-resumen-ejecutivo.md`** — ahí está el estado real del proyecto, qué está
implementado, qué falta y los supuestos documentados.

## Estructura del repositorio

```
docs/                 Arquitectura, roles, flujos, modelo de datos, plan de fases
supabase/
  migrations/         Esquema real: tablas, RLS, funciones transaccionales
  seed/demo.sql        Datos de DEMOSTRACIÓN (opcional, claramente separados)
  tests/                Script de regresión que prueba los criterios de aceptación en Postgres real
app/                    SPA (React + Vite + TypeScript + Tailwind + Supabase JS)
legacy/podcast-site/    Sitio anterior de este repositorio (no relacionado), conservado sin usar
```

## Arrancar en local

```bash
cd app
npm install
npm run dev
```

Sin `app/.env.local` configurado (ver `app/.env.example`), la app corre en **modo demostración**
con datos de ejemplo — así se puede navegar todo el sitio y los 3 portales sin una base de datos real.

## Conectar un proyecto Supabase real

Ver `docs/07-plan-implementacion.md` → "Cómo conectar un proyecto Supabase real" para los pasos
exactos (aplicar migraciones, crear el primer admin, configurar variables de entorno).

## Probar el esquema de base de datos

```bash
cd supabase/tests
PGPASSWORD=<tu-password> ./run.sh
```

Corre las migraciones contra un Postgres local (simulando el `auth` schema de Supabase) y valida
los criterios de aceptación: doble reserva bloqueada, cobro idempotente, reprogramación,
devoluciones con trazabilidad, snapshot de reglas de comisión, límites de descuento por permiso, y RLS por rol.

## Despliegue

`.github/workflows/deploy.yml` construye `app/` y publica `app/dist` en GitHub Pages en cada push
a `main`. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` como secrets del repositorio
para publicar conectado a Supabase real (si no se configuran, el sitio publicado queda en modo
demostración). En Settings → Pages, la fuente debe ser "GitHub Actions".
