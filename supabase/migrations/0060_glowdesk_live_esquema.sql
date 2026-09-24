-- 0060_glowdesk_live_esquema.sql
-- GlowDesk Live — disponibilidad en tiempo real. FASE 1 (esquema) + FASE 2 (motor).
--
-- Reutiliza el esquema de agenda existente (horario_disponibilidad, bloqueo_ausencia, reserva,
-- atencion/atencion_servicio) como única fuente de verdad para "qué está pasando ahora" — no se
-- duplica ninguna tabla de agenda. Lo nuevo es: (1) zonas y su asignación a profesionales
-- (estructura relacional, no texto libre), (2) un override manual de estado por profesional
-- ("Mi disponibilidad" — descanso/almuerzo/no disponible/ocupado temporal, con vencimiento),
-- (3) duración de servicio personalizada por profesional (opcional), y (4) las solicitudes
-- "¿puedes atenderme ahora?" del cliente hacia una profesional.
--
-- Genérico a propósito (sección 51 del pedido): "zonas", "profesionales", "servicios" — nunca
-- nombres de negocio específicos — para que sirva igual en peluquería, barbería, spa, uñas, etc.

-- ---------------------------------------------------------------------------
-- 1. Zonas del salón (áreas: Cabello, Manicure, Estética...) — CRUD de administración
-- ---------------------------------------------------------------------------

create table zona_salon (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null references local (id) default fn_local_efectivo(),
  nombre text not null,
  icono text,
  orden_visualizacion int not null default 0,
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (local_id, nombre)
);

create index zona_salon_local_idx on zona_salon (local_id);

-- Relación muchos-a-muchos: una profesional puede pertenecer a más de una zona (sección 23 —
-- estructura relacional, no un campo de texto en `profesional`).
create table profesional_zona (
  profesional_id uuid not null references profesional (id) on delete cascade,
  zona_id uuid not null references zona_salon (id) on delete cascade,
  local_id uuid not null references local (id) default fn_local_efectivo(),
  primary key (profesional_id, zona_id)
);

create index profesional_zona_zona_idx on profesional_zona (zona_id);
create index profesional_zona_local_idx on profesional_zona (local_id);

-- ---------------------------------------------------------------------------
-- 2. Duración de servicio por profesional (opcional) — sección 25. `servicio.duracion_minutos`
-- sigue siendo el valor por defecto; esta tabla solo guarda excepciones puntuales.
-- ---------------------------------------------------------------------------

create table profesional_servicio_duracion (
  profesional_id uuid not null references profesional (id) on delete cascade,
  servicio_id uuid not null references servicio (id) on delete cascade,
  duracion_minutos int not null check (duracion_minutos > 0),
  activo boolean not null default true,
  local_id uuid not null references local (id) default fn_local_efectivo(),
  primary key (profesional_id, servicio_id)
);

create index profesional_servicio_duracion_local_idx on profesional_servicio_duracion (local_id);

-- ---------------------------------------------------------------------------
-- 3. Estado manual de la profesional ("Mi disponibilidad") — sección 20/21.
-- Una sola fila activa por profesional (upsert); siempre tiene vencimiento (`hasta`), igual que
-- las opciones de la UI (15/30/45/60 min o personalizado) — nunca queda "pegado" para siempre.
-- Un día libre completo sigue siendo un `bloqueo_ausencia` (ya existente), no esto.
-- ---------------------------------------------------------------------------

create table profesional_estado_manual (
  profesional_id uuid primary key references profesional (id) on delete cascade,
  estado text not null check (estado in ('disponible', 'descanso', 'almuerzo', 'no_disponible', 'ocupado_temporal')),
  hasta timestamptz not null,
  motivo text,
  local_id uuid not null references local (id) default fn_local_efectivo(),
  actualizado_en timestamptz not null default now()
);

create index profesional_estado_manual_vigencia_idx on profesional_estado_manual (profesional_id, hasta);

-- ---------------------------------------------------------------------------
-- 4. Solicitudes de disponibilidad ("¿puedes atenderme ahora?") — secciones 11-18.
-- ---------------------------------------------------------------------------

create table solicitud_disponibilidad (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null references local (id) default fn_local_efectivo(),
  cliente_id uuid not null references cliente (id) on delete restrict,
  profesional_id uuid not null references profesional (id) on delete restrict,
  servicio_id uuid not null references servicio (id) on delete restrict,
  llegada_minutos int not null check (llegada_minutos > 0),
  estado text not null default 'pendiente' check (estado in (
    'pendiente', 'aceptada', 'aceptada_luego', 'rechazada', 'expirada', 'cancelada',
    'cliente_en_camino', 'completada'
  )),
  expira_en timestamptz not null,
  disponible_desde timestamptz, -- solo cuando estado = 'aceptada_luego' (sección 18)
  respondido_en timestamptz,
  notas text,
  idempotency_key text unique,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index solicitud_disponibilidad_profesional_idx on solicitud_disponibilidad (profesional_id, estado);
create index solicitud_disponibilidad_cliente_idx on solicitud_disponibilidad (cliente_id, estado);
create index solicitud_disponibilidad_local_idx on solicitud_disponibilidad (local_id);
create index solicitud_disponibilidad_estado_idx on solicitud_disponibilidad (estado);

-- Antispam (sección 41): una clienta no puede tener dos solicitudes pendientes a la vez hacia
-- la misma profesional.
create unique index solicitud_disponibilidad_activa_unica_idx
  on solicitud_disponibilidad (cliente_id, profesional_id) where estado = 'pendiente';

-- ---------------------------------------------------------------------------
-- 5. Configuración: feature flag + umbrales configurables (secciones 6, 22, 45).
-- ---------------------------------------------------------------------------

alter table configuracion_negocio add column live_disponibilidad_activo boolean not null default false;
-- BUSY -> "Termina pronto" cuando el servicio activo termina en <= N minutos.
alter table configuracion_negocio add column live_umbral_termina_pronto_minutos int not null default 20;
-- Libre ahora, pero con una próxima cita a <= N minutos -> "Disponible por tiempo limitado"
-- en vez de "Disponible ahora" sin más (distinción visual de las secciones 4 y 6).
alter table configuracion_negocio add column live_umbral_disponible_limitado_minutos int not null default 45;
-- Sección 17: si la profesional no responde en N minutos, la solicitud expira sola.
alter table configuracion_negocio add column live_expiracion_solicitud_minutos int not null default 3;
-- Sección 16: al aceptar, cuánto dura el "soft hold" (cliente en camino) antes de liberarse solo.
alter table configuracion_negocio add column live_hold_minutos int not null default 20;

-- ---------------------------------------------------------------------------
-- 6. RLS — mismo patrón que categoria_servicio/servicio_profesional (0014) + el filtro
-- restrictivo multi-local (0050): catálogo público de solo-lectura para zonas/asignaciones,
-- y "solo mediante función SECURITY DEFINER" para todo lo que muta estado real-time (igual que
-- canje_recompensa/movimiento_puntos: hay política de SELECT, pero ninguna de INSERT/UPDATE
-- directa para authenticated — todas las escrituras pasan por las funciones de este archivo).
-- ---------------------------------------------------------------------------

alter table zona_salon enable row level security;
create policy zona_salon_select_publico on zona_salon for select using (true);
create policy zona_salon_admin_escribe on zona_salon for all
  using (fn_es_admin()) with check (fn_es_admin());
create policy zona_salon_local_publico on zona_salon as restrictive for all to public
  using (local_id = fn_local_publico())
  with check (local_id = coalesce(fn_local_id(), fn_local_publico()));

alter table profesional_zona enable row level security;
create policy profesional_zona_select_publico on profesional_zona for select using (true);
create policy profesional_zona_admin_escribe on profesional_zona for all
  using (fn_es_admin()) with check (fn_es_admin());
create policy profesional_zona_local_publico on profesional_zona as restrictive for all to public
  using (local_id = fn_local_publico())
  with check (local_id = coalesce(fn_local_id(), fn_local_publico()));

alter table profesional_servicio_duracion enable row level security;
create policy profesional_servicio_duracion_select on profesional_servicio_duracion for select
  using (fn_es_admin() or profesional_id = auth.uid());
create policy profesional_servicio_duracion_admin_escribe on profesional_servicio_duracion for all
  using (fn_es_admin()) with check (fn_es_admin());
create policy profesional_servicio_duracion_local on profesional_servicio_duracion as restrictive for all to public
  using (local_id = fn_local_id())
  with check (local_id = coalesce(fn_local_id(), fn_local_publico()));

alter table profesional_estado_manual enable row level security;
create policy profesional_estado_manual_select on profesional_estado_manual for select
  using (fn_es_admin() or profesional_id = auth.uid());
-- Sin política de INSERT/UPDATE directa: toda escritura pasa por fn_marcar_estado_manual /
-- fn_limpiar_estado_manual (más abajo), que validan que solo la propia profesional o admin
-- puedan tocar su fila.
create policy profesional_estado_manual_local on profesional_estado_manual as restrictive for all to public
  using (local_id = fn_local_id())
  with check (local_id = coalesce(fn_local_id(), fn_local_publico()));

alter table solicitud_disponibilidad enable row level security;
create policy solicitud_disponibilidad_select on solicitud_disponibilidad for select
  using (fn_es_admin() or fn_es_mi_cliente(cliente_id) or profesional_id = auth.uid());
-- Sin política de INSERT/UPDATE directa: todo pasa por fn_crear_solicitud_disponibilidad /
-- fn_responder_solicitud_disponibilidad / fn_marcar_cliente_en_camino / fn_cancelar_solicitud.
create policy solicitud_disponibilidad_local on solicitud_disponibilidad as restrictive for all to public
  using (local_id = fn_local_id())
  with check (local_id = coalesce(fn_local_id(), fn_local_publico()));

grant select on zona_salon, profesional_zona to anon, authenticated;
grant select, insert, update, delete on zona_salon, profesional_zona to authenticated;
grant select on profesional_servicio_duracion, profesional_estado_manual, solicitud_disponibilidad to authenticated;
