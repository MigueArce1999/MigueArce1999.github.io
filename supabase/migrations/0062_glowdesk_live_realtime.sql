-- 0062_glowdesk_live_realtime.sql
-- GlowDesk Live — Fase 4: Supabase Realtime (sección 19 del pedido).
--
-- Problema de diseño: Supabase Realtime transmite cambios de FILAS de tabla, respetando RLS.
-- Pero la "Salón en vivo" pública debe funcionar para un visitante anónimo, y las tablas que
-- realmente determinan la disponibilidad (reserva, atencion, atencion_servicio,
-- bloqueo_ausencia, profesional_estado_manual) están protegidas por RLS estricta — un anónimo
-- nunca podría suscribirse a ellas sin exponer datos privados de la agenda (sección 26).
--
-- Solución: una tabla "pulso" mínima y pública (sin datos de negocio, solo un timestamp por
-- local) que un trigger actualiza cada vez que cambia algo relevante para la disponibilidad.
-- El cliente se suscribe SOLO a este pulso (nunca a las tablas reales) y, cuando cambia,
-- refresca fn_salon_en_vivo()/fn_estado_profesional_ahora() por RPC — el motor sigue siendo la
-- única fuente de verdad, Realtime solo avisa "algo cambió, vuelve a preguntar".
--
-- `solicitud_disponibilidad` es distinta: su RLS ya scoping por fila (cliente dueño, profesional
-- destinataria, o admin — 0060), así que ahí SÍ es seguro suscribirse directo a la tabla real.

create table pulso_disponibilidad (
  local_id uuid primary key references local (id),
  actualizado_en timestamptz not null default now()
);

comment on table pulso_disponibilidad is
  'Solo un timestamp por local. Ningún dato de negocio — existe únicamente para que Realtime avise "algo relevante para disponibilidad cambió" sin exponer agenda/atenciones a un visitante anónimo.';

alter table pulso_disponibilidad enable row level security;
create policy pulso_disponibilidad_select_publico on pulso_disponibilidad for select using (true);
-- Sin política de escritura para authenticated/anon: solo la escribe la función SECURITY
-- DEFINER de abajo, vía trigger.

create or replace function fn_marcar_pulso_disponibilidad() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid;
begin
  v_local := coalesce(new.local_id, old.local_id);
  insert into pulso_disponibilidad (local_id, actualizado_en) values (v_local, now())
  on conflict (local_id) do update set actualizado_en = excluded.actualizado_en;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'reserva', 'atencion', 'atencion_servicio', 'bloqueo_ausencia',
    'profesional_estado_manual', 'solicitud_disponibilidad'
  ]
  loop
    execute format('drop trigger if exists %I on %I', t || '_marcar_pulso_disponibilidad', t);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function fn_marcar_pulso_disponibilidad()',
      t || '_marcar_pulso_disponibilidad', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Publicación de Realtime: el pulso público (todo el mundo) y las solicitudes de
-- disponibilidad (ya protegidas por su propia RLS por fila).
-- ---------------------------------------------------------------------------

alter table solicitud_disponibilidad replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pulso_disponibilidad'
  ) then
    alter publication supabase_realtime add table pulso_disponibilidad;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'solicitud_disponibilidad'
  ) then
    alter publication supabase_realtime add table solicitud_disponibilidad;
  end if;
exception when undefined_object then
  -- En un Postgres local de pruebas (sin el proyecto Realtime de Supabase) la publicación
  -- supabase_realtime no existe; en un proyecto Supabase real siempre está creada de fábrica.
  raise notice 'Publicación supabase_realtime no existe en este entorno (esperado fuera de Supabase) — se omite.';
end $$;

-- ---------------------------------------------------------------------------
-- Corrección de seguridad: fn_resultado_solicitud_disponibilidad (0061) no valida quién la
-- llama — se creó solo como helper interno de las funciones que SÍ autorizan antes de invocarla
-- (fn_crear_solicitud_disponibilidad, fn_responder_solicitud_disponibilidad, etc.). Con
-- Realtime, el hook de la clienta necesita releer UNA solicitud por id de forma independiente
-- (sección 42: nunca confiar solo en el frontend) — se quita el grant directo del helper y se
-- agrega una función propia con el mismo chequeo de pertenencia que ya usa el resto del módulo.
-- ---------------------------------------------------------------------------

-- Postgres otorga EXECUTE a PUBLIC por defecto en toda función nueva, ADEMÁS del grant explícito
-- que 0061 le dio a "authenticated" — hay que revocar los dos; cualquiera de los dos que quede
-- sigue dejando la función abierta (cualquier rol hereda lo que tenga PUBLIC).
revoke execute on function fn_resultado_solicitud_disponibilidad from public;
revoke execute on function fn_resultado_solicitud_disponibilidad from authenticated;

create or replace function fn_obtener_solicitud_disponibilidad(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_solicitud solicitud_disponibilidad;
begin
  select * into v_solicitud from solicitud_disponibilidad where id = p_id;
  if v_solicitud is null then
    raise exception 'Solicitud no encontrada';
  end if;
  if not (fn_es_admin() or fn_es_mi_cliente(v_solicitud.cliente_id) or v_solicitud.profesional_id = auth.uid()) then
    raise exception 'No autorizada para ver esta solicitud';
  end if;
  return fn_resultado_solicitud_disponibilidad(p_id);
end;
$$;

grant execute on function fn_obtener_solicitud_disponibilidad to authenticated;
