# 7. Plan de implementación por fases

## Fase 1 — Operación esencial (implementada en este repo)

Web pública (catálogo, promos, equipo, ubicación) · autenticación y roles · reservas con disponibilidad real
y bloqueo de solapamiento a nivel de base de datos · portal del cliente (citas + historial) · portal de
empleadas (agenda, registrar atención, ganancias) · administración (clientes, agenda, ventas, cobros,
comisiones) · puntos básicos con reglas configurables.

## Fase 2 — Control y crecimiento (diseñada, no implementada)

Caja con apertura/cierre y arqueo · gastos · liquidaciones con simulación previa · campañas con
segmentación y envío real (hoy: preparación de mensajes/enlaces, sin envíos simulados) · recompensas de
fidelización avanzadas · reportes avanzados exportables en PDF · productos e inventario · integración de
pagos en línea · facturación electrónica real.

En la interfaz, estos módulos aparecen bajo una etiqueta "Próximamente" o con la función deshabilitada y
explicada — nunca como un botón que aparenta funcionar y no hace nada.

## Cómo conectar un proyecto Supabase real

Esta sesión no tiene credenciales de Supabase, así que lo siguiente **no se ha ejecutado**; son las
instrucciones exactas para hacerlo:

1. Crear un proyecto en [supabase.com](https://supabase.com) (o usar uno existente — si ya existe,
   inspeccionar `supabase db pull` antes de aplicar nada, para no pisar datos).
2. Instalar la CLI de Supabase y enlazar el proyecto:
   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref <tu-project-ref>
   ```
3. Aplicar el esquema:
   ```bash
   supabase db push   # ejecuta todo supabase/migrations/*.sql en orden
   ```
4. (Opcional, solo para ver el sistema con datos de ejemplo) cargar el seed de demo, **nunca en producción**:
   ```bash
   psql "$SUPABASE_DB_URL" -f supabase/seed/demo.sql
   ```
5. Crear un bucket de Storage público llamado `media` (fotos de servicios, equipo, contenido web):
   ```bash
   supabase storage buckets create media --public
   ```
6. Copiar `app/.env.example` a `app/.env.local` y completar:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-key>          # la anon key es pública por diseño; la seguridad la da RLS
   ```
   **Nunca** poner la `service_role key` en el frontend ni en este repo.
7. Crear el primer usuario admin: registrarse normalmente desde `/registro`, luego en el SQL editor de
   Supabase:
   ```sql
   update perfil set rol = 'admin' where usuario_id = '<uuid del usuario creado>';
   ```
8. Sin este paso 7, no existe ningún admin y `/admin` es inaccesible — es la única configuración manual
   fuera de UI que este sistema requiere para arrancar.
9. `npm run build` en `app/` genera `app/dist`, publicado a GitHub Pages por
   `.github/workflows/deploy.yml` (ver ese archivo para los secrets que hay que configurar en el repo:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

## Qué pasa si nunca se conecta Supabase

La app detecta la ausencia de variables de entorno y entra en **modo demostración**: usa
`app/src/lib/demoData.ts` (datos ficticios, con IDs prefijados `demo-`) en vez de llamar a Supabase, y
muestra el `DemoBanner` en todas las pantallas. Ningún dato del modo demo se guarda entre sesiones ni se
puede confundir con datos reales — es solo para evaluar las pantallas y flujos.
