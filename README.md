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
cp .env.example .env.local   # completa URL, anon key y VITE_LOCAL_ID
npm run dev
```

Sin `app/.env.local` con URL y anon key, la app corre en **modo demostración**
con datos de ejemplo. Si hay URL/key pero falta `VITE_LOCAL_ID`, el arranque falla
a propósito: un mismo Supabase sirve a muchos locales y no se pueden mezclar.

El UUID semilla (Claudia Patricia) está en `supabase/migrations/0050_multi_local.sql`:
`c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001`.

## Conectar un proyecto Supabase real

Ver `docs/07-plan-implementacion.md` → "Cómo conectar un proyecto Supabase real" para los pasos
exactos (aplicar migraciones, crear el primer admin, configurar variables de entorno).

Límite: el email de Auth es único en todo el proyecto. La misma persona no puede tener dos
cuentas con el mismo correo en dos locales.

## Probar el esquema de base de datos

```bash
cd supabase/tests
PGPASSWORD=<tu-password> ./run.sh
```

Corre las migraciones contra un Postgres local (simulando el `auth` schema de Supabase) y valida
los criterios de aceptación: doble reserva bloqueada, cobro idempotente, reprogramación,
devoluciones con trazabilidad, snapshot de reglas de comisión, límites de descuento por permiso, y RLS por rol.

## Despliegue en Hostinger (hosting compartido)

El runtime es estático: Hostinger no corre `npm run dev`. Desde `app/`:

```bash
cd app
npm run deploy
```

El comando confirma los valores de `app/.env.local` (`VITE_SITE_URL`, `VITE_LOCAL_ID`, `FTP_HOST`, `FTP_USER`, `FTP_REMOTE`): Enter los acepta. Solo pide de nuevo la **contraseña FTP**. Construye con ese `VITE_LOCAL_ID` y sube el interior de `dist` (incluye `.htaccess`). `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` también salen de `.env.local`. La contraseña no se guarda.

Al terminar recuerda el patrón de **Redirect URL** de ese dominio. En el mismo proyecto Supabase, Authentication → URL Configuration:

- **Site URL:** un origen vuestro (p. ej. `https://saladebellezaclaudiapatricia.com`). Es el fallback; no uses GitHub Pages.
- **Redirect URLs:** una línea por dominio propio (`https://ese-dominio.com/**`) y, si hay white-label en subdominio, un wildcard (`https://*.tuplataforma.com/**`). También `http://localhost:5173/**` (salón) y `http://localhost:5174/**` (consola `adminpeluquerias`).

La consola de locales y el landing del producto viven en el repo hermano `adminpeluquerias` (mismo Supabase, sin `VITE_LOCAL_ID`). Este salón redirige a `VITE_PLATAFORMA_URL` si entra un `super_admin`.
- El correo de confirmación debe usar `{{ .ConfirmationURL }}`, no un enlace fijo a Site URL.

Cada cliente: mismo Supabase, distinto `VITE_LOCAL_ID` (`select fn_provisionar_local('Nombre', 'slug');` en el SQL editor).

Si un cliente va a una subcarpeta (`dominio.com/salon/`), hay que cambiar `base` en `app/vite.config.ts`. Por defecto se asume la raíz del dominio.

## GitHub Pages (demo)

`.github/workflows/deploy.yml` construye `app/` y publica `app/dist` en GitHub Pages en cada push
a `main`. Configura `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_LOCAL_ID` como secrets
del repositorio. En Settings → Pages, la fuente debe ser "GitHub Actions".
