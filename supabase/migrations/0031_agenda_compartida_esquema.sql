-- 0031_agenda_compartida_esquema.sql
-- Esquema para la agenda compartida entre clienta, empleada y administración: horario
-- habitual versionado por fecha de vigencia (nunca se borra el histórico), ausencias/bloqueos
-- con flujo de solicitud/aprobación, solicitudes de cambio de horario, y los parámetros de
-- configuración que le faltaban a la reserva (anticipación mínima, horizonte de reservas,
-- margen entre citas). Nada se borra ni se duplica: horario_disponibilidad, bloqueo_ausencia
-- y configuracion_negocio se amplían in place; toda la lógica de aprobación vive en las
-- funciones SECURITY DEFINER de 0032 (igual que el resto del proyecto — ver 0013_funciones.sql).

-- ---------------------------------------------------------------------------
-- Permiso: quién puede editar su propio horario/ausencias sin pasar por aprobación.
-- Por defecto nadie lo tiene (ni siquiera quien ya tenía otros permisos finos) — administración
-- lo activa fila por fila desde /admin/equipo, igual que el resto de columnas de `permiso`.
-- ---------------------------------------------------------------------------
alter table permiso add column puede_editar_horario_propio boolean not null default false;

-- ---------------------------------------------------------------------------
-- Configuración: conceptos que faltaban para calcular disponibilidad real. Se agregan a la
-- misma fila única en vez de crear una tabla de configuración paralela.
-- ---------------------------------------------------------------------------
alter table configuracion_negocio add column anticipacion_minima_reserva_minutos int not null default 0;
alter table configuracion_negocio add column horizonte_reservas_dias int not null default 60;
alter table configuracion_negocio add column margen_entre_citas_minutos int not null default 0;

-- ---------------------------------------------------------------------------
-- Horario habitual: versionado por fecha de vigencia. Un cambio de horario NUNCA borra las
-- filas anteriores (conserva el historial); inserta una nueva "versión" (mismo vigente_desde
-- para todas sus filas) que empieza a aplicar desde esa fecha. fn_disponibilidad (0032) siempre
-- usa la versión vigente más reciente para la fecha consultada, así que una fecha futura no
-- afecta reservas de fechas anteriores a vigente_desde.
-- ---------------------------------------------------------------------------
alter table horario_disponibilidad add column vigente_desde date not null default '2000-01-01';
create index horario_disponibilidad_vigencia_idx on horario_disponibilidad (profesional_id, vigente_desde);

-- ---------------------------------------------------------------------------
-- Ausencias y bloqueos: ahora con flujo de solicitud/aprobación. Solo una fila 'aprobada'
-- afecta disponibilidad (fn_disponibilidad la excluye); una 'pendiente' queda visible en el
-- panel de solicitudes sin tocar el horario publicado hasta que alguien con permiso la apruebe.
-- ---------------------------------------------------------------------------
create type estado_solicitud as enum ('pendiente', 'aprobada', 'rechazada', 'retirada');
create type tipo_bloqueo_ausencia as enum ('bloqueo', 'ausencia_dia', 'ausencia_rango');

alter table bloqueo_ausencia add column estado estado_solicitud not null default 'aprobada';
alter table bloqueo_ausencia add column tipo tipo_bloqueo_ausencia not null default 'bloqueo';
alter table bloqueo_ausencia add column todo_el_dia boolean not null default false;
alter table bloqueo_ausencia add column revisado_por uuid references perfil (id);
alter table bloqueo_ausencia add column revisado_en timestamptz;
alter table bloqueo_ausencia add column motivo_rechazo text;

-- El EXCLUDE original impedía solapar CUALQUIER fila, incluidas solicitudes pendientes que
-- todavía no deben afectar nada; se acota a las aprobadas (mismo patrón que ya usa `reserva`
-- para sus propios estados "activos" — ver 0004_agenda_reservas.sql). Es una condición más
-- estricta a más laxa: ningún dato existente puede violarla.
alter table bloqueo_ausencia drop constraint bloqueo_ausencia_profesional_id_rango_excl;
alter table bloqueo_ausencia add constraint bloqueo_ausencia_profesional_id_rango_excl
  exclude using gist (profesional_id with =, rango with &&) where (estado = 'aprobada');

create index bloqueo_ausencia_estado_idx on bloqueo_ausencia (profesional_id, estado);

-- ---------------------------------------------------------------------------
-- Solicitudes de cambio de horario habitual: mismo principio que bloqueo_ausencia — una
-- solicitud 'pendiente' no cambia nada hasta que fn_aprobar_solicitud_horario (0032) inserte
-- la nueva versión en horario_disponibilidad.
-- ---------------------------------------------------------------------------
create table solicitud_horario (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references profesional (id) on delete cascade,
  estado estado_solicitud not null default 'pendiente',
  intervalos jsonb not null, -- [{dia_semana, hora_inicio, hora_fin}, ...]
  vigente_desde date not null,
  motivo text,
  creado_por uuid references perfil (id),
  creado_en timestamptz not null default now(),
  revisado_por uuid references perfil (id),
  revisado_en timestamptz,
  motivo_rechazo text,
  constraint solicitud_horario_intervalos_no_vacio check (jsonb_array_length(intervalos) > 0)
);

create index solicitud_horario_profesional_idx on solicitud_horario (profesional_id, estado);

alter table solicitud_horario enable row level security;

-- Solo lectura directa (propia, admin, o quien puede ver la agenda del equipo); toda escritura
-- pasa por las funciones SECURITY DEFINER de 0032 — igual que el resto de la lógica sensible
-- del proyecto (ver comentario al inicio de 0013_funciones.sql).
create policy solicitud_horario_select on solicitud_horario for select
  using (profesional_id = auth.uid() or fn_es_admin() or fn_tiene_permiso('puede_ver_agenda_equipo'));

-- ---------------------------------------------------------------------------
-- RLS: antes cualquier profesional podía escribir su propio horario_disponibilidad y
-- bloqueo_ausencia directamente ("for all"). Por defecto esos cambios ahora requieren
-- aprobación: solo admin o quien tenga el permiso explícito puede_editar_horario_propio sigue
-- escribiendo directo (aplica de inmediato); el resto pasa por solicitud_horario /
-- bloqueo_ausencia con estado 'pendiente', vía las funciones de 0032.
-- ---------------------------------------------------------------------------
drop policy horario_propia_o_admin on horario_disponibilidad;
create policy horario_propia_o_admin on horario_disponibilidad for all
  using (fn_es_admin() or (profesional_id = auth.uid() and fn_tiene_permiso('puede_editar_horario_propio')))
  with check (fn_es_admin() or (profesional_id = auth.uid() and fn_tiene_permiso('puede_editar_horario_propio')));

drop policy bloqueo_propia_o_admin on bloqueo_ausencia;
create policy bloqueo_propia_o_admin on bloqueo_ausencia for all
  using (fn_es_admin() or (profesional_id = auth.uid() and fn_tiene_permiso('puede_editar_horario_propio')))
  with check (fn_es_admin() or (profesional_id = auth.uid() and fn_tiene_permiso('puede_editar_horario_propio')));
