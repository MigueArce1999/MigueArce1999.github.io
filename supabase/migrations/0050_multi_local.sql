-- 0050_multi_local.sql
-- Un proyecto Supabase, muchos negocios. Cada instalación (cualquier dominio) lleva
-- VITE_LOCAL_ID / header x-local-id. El aislamiento real es RLS restrictiva + local_id
-- en las filas. Auth comparte el proyecto: el email es único a nivel plataforma.

-- ---------------------------------------------------------------------------
-- 1. Local semilla (Claudia Patricia) — mismo UUID que documenta app/.env.example
-- ---------------------------------------------------------------------------
create table if not exists local (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text not null unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

insert into local (id, nombre, slug) values (
  'c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001',
  'Claudia Patricia',
  'claudia-patricia'
)
on conflict (id) do nothing;

comment on table local is 'Un negocio/salón. Todas las filas de operación cuelgan de local_id. El frontend no lista esta tabla: cada build lleva su UUID.';

-- ---------------------------------------------------------------------------
-- 2. Helpers (se recrean tras tener perfil.local_id; primero la columna)
-- ---------------------------------------------------------------------------
alter table perfil add column if not exists local_id uuid references local (id);

-- ---------------------------------------------------------------------------
-- 3. local_id en tablas de negocio
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  seed uuid := 'c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001';
begin
  foreach t in array array[
    'perfil', 'cliente', 'profesional',
    'categoria_servicio', 'servicio', 'servicio_profesional', 'producto',
    'horario_disponibilidad', 'bloqueo_ausencia', 'solicitud_horario',
    'reserva', 'reserva_evento',
    'atencion', 'atencion_servicio', 'atencion_producto', 'atencion_servicio_colaborador', 'pago',
    'regla_comision', 'comision', 'liquidacion', 'liquidacion_detalle',
    'regla_puntos', 'movimiento_puntos', 'recompensa', 'canje_recompensa', 'notificacion_fidelizacion',
    'promocion', 'promocion_servicio',
    'categoria_gasto', 'gasto', 'caja_sesion', 'caja_movimiento',
    'cuenta', 'cuenta_movimiento', 'proveedor',
    'plantilla_gasto_recurrente', 'plantilla_gasto_ocurrencia',
    'gasto_pago', 'gasto_pago_reversion', 'gasto_evento',
    'contenido_pagina', 'contenido_evento', 'resena',
    'campana', 'campana_destinatario',
    'auditoria_log', 'voice_entity_aliases',
    'configuracion_negocio', 'configuracion_homepage', 'configuracion_fidelizacion'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table %I add column if not exists local_id uuid references local (id)', t);
    execute format('update %I set local_id = $1 where local_id is null', t) using seed;
    execute format('alter table %I alter column local_id set not null', t);
    execute format('create index if not exists %I on %I (local_id)', t || '_local_id_idx', t);
  end loop;
end $$;

create or replace function fn_local_id() returns uuid
language sql stable security definer set search_path = public as $$
  select local_id from perfil where id = auth.uid()
$$;

create or replace function fn_local_id_request() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_headers text;
  v_raw text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null or v_headers = '' then
    return null;
  end if;
  begin
    v_raw := nullif(v_headers::json ->> 'x-local-id', '');
  exception when others then
    return null;
  end;
  if v_raw is null then
    return null;
  end if;
  begin
    return v_raw::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;

-- Autenticado: gana perfil. Anon: header. Tests/sandbox de un solo local: ese local.
create or replace function fn_local_efectivo() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v uuid;
  n int;
begin
  v := coalesce(fn_local_id(), fn_local_id_request());
  if v is not null then
    return v;
  end if;
  select count(*) into n from local where activo;
  if n = 1 then
    select id into v from local where activo limit 1;
    return v;
  end if;
  return null;
end;
$$;

create or replace function fn_local_publico() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(fn_local_id(), fn_local_id_request())
$$;

create or replace function fn_exigir_local() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v uuid;
begin
  v := fn_local_efectivo();
  if v is null then
    raise exception 'Falta el identificador del local (VITE_LOCAL_ID / x-local-id).';
  end if;
  if not exists (select 1 from local where id = v and activo) then
    raise exception 'Este local no está activo.';
  end if;
  return v;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'perfil', 'cliente', 'profesional',
    'categoria_servicio', 'servicio', 'servicio_profesional', 'producto',
    'horario_disponibilidad', 'bloqueo_ausencia', 'solicitud_horario',
    'reserva', 'reserva_evento',
    'atencion', 'atencion_servicio', 'atencion_producto', 'atencion_servicio_colaborador', 'pago',
    'regla_comision', 'comision', 'liquidacion', 'liquidacion_detalle',
    'regla_puntos', 'movimiento_puntos', 'recompensa', 'canje_recompensa', 'notificacion_fidelizacion',
    'promocion', 'promocion_servicio',
    'categoria_gasto', 'gasto', 'caja_sesion', 'caja_movimiento',
    'cuenta', 'cuenta_movimiento', 'proveedor',
    'plantilla_gasto_recurrente', 'plantilla_gasto_ocurrencia',
    'gasto_pago', 'gasto_pago_reversion', 'gasto_evento',
    'contenido_pagina', 'contenido_evento', 'resena',
    'campana', 'campana_destinatario',
    'auditoria_log', 'voice_entity_aliases',
    'configuracion_negocio', 'configuracion_homepage', 'configuracion_fidelizacion'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table %I alter column local_id set default fn_local_efectivo()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Singletons → una fila por local
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.configuracion_negocio') is not null then
    execute 'alter table configuracion_negocio drop constraint if exists configuracion_negocio_pkey';
    execute 'alter table configuracion_negocio drop constraint if exists configuracion_negocio_singleton';
    execute 'alter table configuracion_negocio drop column if exists id';
    if not exists (select 1 from pg_constraint where conrelid = 'public.configuracion_negocio'::regclass and contype = 'p') then
      execute 'alter table configuracion_negocio add primary key (local_id)';
    end if;
  end if;
  if to_regclass('public.configuracion_homepage') is not null then
    execute 'alter table configuracion_homepage drop constraint if exists configuracion_homepage_pkey';
    execute 'alter table configuracion_homepage drop constraint if exists configuracion_homepage_singleton';
    execute 'alter table configuracion_homepage drop column if exists id';
    if not exists (select 1 from pg_constraint where conrelid = 'public.configuracion_homepage'::regclass and contype = 'p') then
      execute 'alter table configuracion_homepage add primary key (local_id)';
    end if;
  end if;
  if to_regclass('public.configuracion_fidelizacion') is not null then
    execute 'alter table configuracion_fidelizacion drop constraint if exists configuracion_fidelizacion_pkey';
    execute 'alter table configuracion_fidelizacion drop constraint if exists configuracion_fidelizacion_id_check';
    execute 'alter table configuracion_fidelizacion drop column if exists id';
    if not exists (select 1 from pg_constraint where conrelid = 'public.configuracion_fidelizacion'::regclass and contype = 'p') then
      execute 'alter table configuracion_fidelizacion add primary key (local_id)';
    end if;
  end if;
  if to_regclass('public.contenido_pagina') is not null then
    execute 'alter table contenido_pagina drop constraint if exists contenido_pagina_pkey';
    if not exists (select 1 from pg_constraint where conrelid = 'public.contenido_pagina'::regclass and contype = 'p') then
      execute 'alter table contenido_pagina add primary key (local_id, clave)';
    end if;
  end if;
end $$;

-- Unicidades por local (solo si la tabla existe en este remoto)
do $$
begin
  if to_regclass('public.profesional') is not null then
    execute 'alter table profesional drop constraint if exists profesional_slug_key';
    execute 'create unique index if not exists profesional_slug_por_local_idx on profesional (local_id, slug)';
  end if;
  if to_regclass('public.categoria_servicio') is not null then
    execute 'alter table categoria_servicio drop constraint if exists categoria_servicio_nombre_key';
    execute 'create unique index if not exists categoria_servicio_nombre_por_local_idx on categoria_servicio (local_id, nombre)';
  end if;
  if to_regclass('public.producto') is not null then
    execute 'drop index if exists producto_nombre_unico_idx';
    execute 'create unique index if not exists producto_nombre_unico_idx on producto (local_id, lower(nombre))';
  end if;
  if to_regclass('public.cuenta') is not null then
    execute 'alter table cuenta drop constraint if exists cuenta_nombre_key';
    execute 'create unique index if not exists cuenta_nombre_por_local_idx on cuenta (local_id, nombre)';
  end if;
  if to_regclass('public.categoria_gasto') is not null then
    execute 'alter table categoria_gasto drop constraint if exists categoria_gasto_nombre_key';
    execute 'create unique index if not exists categoria_gasto_nombre_por_local_idx on categoria_gasto (local_id, nombre)';
  end if;
  if to_regclass('public.proveedor') is not null then
    execute 'drop index if exists proveedor_nombre_unq_idx';
    execute 'create unique index if not exists proveedor_nombre_unq_idx on proveedor (local_id, lower(nombre))';
  end if;
  if to_regclass('public.regla_puntos') is not null then
    execute 'drop index if exists regla_puntos_vigente_unica_idx';
    execute 'create unique index if not exists regla_puntos_vigente_unica_idx on regla_puntos (local_id) where vigente_hasta is null and activa';
  end if;
  if to_regclass('public.voice_entity_aliases') is not null then
    execute 'drop index if exists voice_entity_aliases_unicidad_idx';
    execute 'create unique index if not exists voice_entity_aliases_unicidad_idx on voice_entity_aliases (local_id, entity_type, normalized_alias)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS restrictiva (AND con las políticas permisivas existentes)
-- ---------------------------------------------------------------------------
alter table local enable row level security;
grant select on local to anon, authenticated;
drop policy if exists local_select_propio on local;
create policy local_select_propio on local for select
  using (id = fn_local_publico() or id = fn_local_id());

do $$
declare
  t text;
begin
  foreach t in array array[
    'categoria_servicio', 'servicio', 'servicio_profesional', 'producto',
    'profesional', 'horario_disponibilidad',
    'promocion', 'promocion_servicio',
    'contenido_pagina', 'contenido_evento', 'resena',
    'regla_puntos', 'recompensa',
    'configuracion_negocio', 'configuracion_homepage', 'configuracion_fidelizacion'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on %I', t || '_local_publico', t);
    execute format(
      'create policy %I on %I as restrictive for all to public using (local_id = fn_local_publico()) with check (local_id = coalesce(fn_local_id(), fn_local_publico()))',
      t || '_local_publico', t
    );
  end loop;

  foreach t in array array[
    'perfil', 'cliente',
    'bloqueo_ausencia', 'solicitud_horario',
    'reserva', 'reserva_evento',
    'atencion', 'atencion_servicio', 'atencion_producto', 'atencion_servicio_colaborador', 'pago',
    'regla_comision', 'comision', 'liquidacion', 'liquidacion_detalle',
    'movimiento_puntos', 'canje_recompensa', 'notificacion_fidelizacion',
    'categoria_gasto', 'gasto', 'caja_sesion', 'caja_movimiento',
    'cuenta', 'cuenta_movimiento', 'proveedor',
    'plantilla_gasto_recurrente', 'plantilla_gasto_ocurrencia',
    'gasto_pago', 'gasto_pago_reversion', 'gasto_evento',
    'campana', 'campana_destinatario',
    'auditoria_log', 'voice_entity_aliases'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on %I', t || '_local_privado', t);
    execute format(
      'create policy %I on %I as restrictive for all to public using (local_id = fn_local_id()) with check (local_id = coalesce(fn_local_id(), fn_local_publico()))',
      t || '_local_privado', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Heredar local_id en tablas hijas
-- ---------------------------------------------------------------------------
create or replace function fn_heredar_local() returns trigger
language plpgsql as $$
declare
  v uuid;
begin
  if new.local_id is not null then
    return new;
  end if;
  execute format('select local_id from %I where id = $1', tg_argv[0])
    into v using (to_jsonb(new) ->> tg_argv[1])::uuid;
  new.local_id := coalesce(v, fn_local_efectivo());
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.reserva_evento') is not null then
    execute 'drop trigger if exists reserva_evento_heredar_local on reserva_evento';
    execute 'create trigger reserva_evento_heredar_local before insert on reserva_evento for each row execute function fn_heredar_local(''reserva'', ''reserva_id'')';
  end if;
  if to_regclass('public.atencion_servicio') is not null then
    execute 'drop trigger if exists atencion_servicio_heredar_local on atencion_servicio';
    execute 'create trigger atencion_servicio_heredar_local before insert on atencion_servicio for each row execute function fn_heredar_local(''atencion'', ''atencion_id'')';
  end if;
  if to_regclass('public.atencion_producto') is not null then
    execute 'drop trigger if exists atencion_producto_heredar_local on atencion_producto';
    execute 'create trigger atencion_producto_heredar_local before insert on atencion_producto for each row execute function fn_heredar_local(''atencion'', ''atencion_id'')';
  end if;
  if to_regclass('public.pago') is not null then
    execute 'drop trigger if exists pago_heredar_local on pago';
    execute 'create trigger pago_heredar_local before insert on pago for each row execute function fn_heredar_local(''atencion'', ''atencion_id'')';
  end if;
  if to_regclass('public.servicio_profesional') is not null then
    execute 'drop trigger if exists servicio_profesional_heredar_local on servicio_profesional';
    execute 'create trigger servicio_profesional_heredar_local before insert on servicio_profesional for each row execute function fn_heredar_local(''servicio'', ''servicio_id'')';
  end if;
  if to_regclass('public.promocion_servicio') is not null then
    execute 'drop trigger if exists promocion_servicio_heredar_local on promocion_servicio';
    execute 'create trigger promocion_servicio_heredar_local before insert on promocion_servicio for each row execute function fn_heredar_local(''promocion'', ''promocion_id'')';
  end if;
  if to_regclass('public.campana_destinatario') is not null then
    execute 'drop trigger if exists campana_destinatario_heredar_local on campana_destinatario';
    execute 'create trigger campana_destinatario_heredar_local before insert on campana_destinatario for each row execute function fn_heredar_local(''campana'', ''campana_id'')';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Signup: metadata.local_id (o el único local activo en sandbox)
-- ---------------------------------------------------------------------------
create or replace function fn_manejar_usuario_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_local uuid;
  v_n int;
begin
  v_nombre := coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1));
  begin
    v_local := nullif(new.raw_user_meta_data ->> 'local_id', '')::uuid;
  exception when invalid_text_representation then
    v_local := null;
  end;
  if v_local is null then
    v_local := fn_local_id_request();
  end if;
  if v_local is null then
    select count(*) into v_n from local where activo;
    if v_n = 1 then
      select id into v_local from local where activo limit 1;
    end if;
  end if;
  if v_local is null or not exists (select 1 from local where id = v_local and activo) then
    raise exception 'Falta el identificador del local para crear la cuenta.';
  end if;

  insert into perfil (id, nombre, rol, local_id) values (new.id, v_nombre, 'cliente', v_local);
  insert into cliente (usuario_id, nombre, email, telefono, local_id)
  values (new.id, v_nombre, new.email, new.raw_user_meta_data ->> 'telefono', v_local);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPCs que leían configuración singleton o catálogo global
-- ---------------------------------------------------------------------------
create or replace function fn_registrar_cliente_publico(
  p_nombre text,
  p_telefono text,
  p_email text default null,
  p_acepta_marketing boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_telefono text;
  v_solo_digitos text;
  v_existente uuid;
  v_local uuid;
begin
  v_local := fn_exigir_local();
  if p_nombre is null or length(trim(p_nombre)) < 2 then
    raise exception 'Ingresa tu nombre completo.';
  end if;

  v_telefono := regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g');
  v_solo_digitos := regexp_replace(v_telefono, '[^0-9]', '', 'g');
  if length(v_solo_digitos) < 7 then
    raise exception 'Ingresa un número de WhatsApp válido.';
  end if;

  select id into v_existente from cliente
  where local_id = v_local
    and right(regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g'), 10) = right(v_solo_digitos, 10)
  limit 1;

  if v_existente is not null then
    return;
  end if;

  insert into cliente (
    nombre, telefono, email, consentimiento_marketing, activo, origen_registro,
    consentimiento_marketing_fecha, consentimiento_marketing_version, local_id
  ) values (
    trim(p_nombre), v_telefono, nullif(trim(coalesce(p_email, '')), ''),
    coalesce(p_acepta_marketing, false), true, 'publico',
    case when coalesce(p_acepta_marketing, false) then now() else null end,
    case when coalesce(p_acepta_marketing, false) then 'registro-publico-v1' else null end,
    v_local
  );
end;
$$;

grant execute on function fn_registrar_cliente_publico to anon, authenticated;

create or replace function fn_disponibilidad(
  p_servicio_id uuid,
  p_profesional_id uuid,
  p_fecha date
) returns table (inicio timestamptz, fin timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_duracion int;
  v_dow int;
  v_margen int;
  v_anticipo int;
  v_horizonte int;
  v_local uuid;
begin
  perform fn_liberar_reservas_pendientes_vencidas();

  select duracion_minutos, local_id into v_duracion, v_local from servicio where id = p_servicio_id;
  if not found then
    raise exception 'Servicio % no existe', p_servicio_id;
  end if;
  if v_duracion is null then
    return;
  end if;
  if fn_local_publico() is not null and v_local is distinct from fn_local_publico() then
    raise exception 'Servicio no pertenece a este local';
  end if;

  select margen_entre_citas_minutos, anticipacion_minima_reserva_minutos, horizonte_reservas_dias
    into v_margen, v_anticipo, v_horizonte
  from configuracion_negocio
  where local_id = v_local;

  if p_fecha > (current_date + v_horizonte) then
    return;
  end if;

  v_dow := extract(dow from p_fecha);

  return query
  with version as (
    select max(vigente_desde) as v
    from horario_disponibilidad
    where profesional_id = p_profesional_id and vigente_desde <= p_fecha
  ),
  horarios as (
    select
      (p_fecha::timestamp + h.hora_inicio) at time zone 'America/Bogota' as inicio_jornada,
      (p_fecha::timestamp + h.hora_fin) at time zone 'America/Bogota' as fin_jornada
    from horario_disponibilidad h, version v
    where h.profesional_id = p_profesional_id
      and h.dia_semana = v_dow
      and h.activo
      and h.vigente_desde = v.v
  ),
  slots as (
    select
      gs as inicio,
      gs + make_interval(mins => v_duracion) as fin
    from horarios,
      lateral generate_series(inicio_jornada, fin_jornada - make_interval(mins => v_duracion), interval '15 min') as gs
  )
  select s.inicio, s.fin
  from slots s
  where s.inicio >= now() + make_interval(mins => v_anticipo)
    and not exists (
      select 1 from bloqueo_ausencia b
      where b.profesional_id = p_profesional_id
        and b.estado = 'aprobada'
        and b.rango && tstzrange(s.inicio, s.fin)
    )
    and not exists (
      select 1 from reserva r
      where r.profesional_id = p_profesional_id
        and r.estado not in ('cancelada', 'no_asistio')
        and tstzrange(lower(r.rango) - make_interval(mins => v_margen), upper(r.rango) + make_interval(mins => v_margen))
            && tstzrange(s.inicio, s.fin)
    )
  order by s.inicio;
end;
$$;

grant execute on function fn_disponibilidad to anon, authenticated;

create or replace function fn_crear_reserva(
  p_cliente_id uuid,
  p_servicio_id uuid,
  p_profesional_id uuid,
  p_inicio timestamptz,
  p_origen origen_reserva default 'cliente'
) returns reserva
language plpgsql security definer set search_path = public as $$
declare
  v_duracion int;
  v_precio numeric(12,2);
  v_tipo_precio tipo_precio_servicio;
  v_modo modo_confirmacion_reserva;
  v_fin timestamptz;
  v_estado estado_reserva;
  v_reserva reserva;
  v_margen int;
  v_anticipo int;
  v_horizonte int;
  v_local uuid;
begin
  perform fn_liberar_reservas_pendientes_vencidas();

  if p_origen = 'cliente' then
    if not fn_es_mi_cliente(p_cliente_id) then
      raise exception 'No puedes reservar a nombre de otra clienta';
    end if;
  elsif not fn_es_admin() and not fn_tiene_permiso('puede_ver_agenda_equipo') and fn_rol_actual() <> 'empleada' then
    raise exception 'No autorizada para crear una reserva con ese origen';
  end if;

  select duracion_minutos, precio, tipo_precio, local_id into v_duracion, v_precio, v_tipo_precio, v_local
  from servicio where id = p_servicio_id and activo;
  if v_duracion is null then
    raise exception 'Servicio no disponible';
  end if;
  if not exists (select 1 from cliente where id = p_cliente_id and local_id = v_local) then
    raise exception 'La clienta no pertenece a este local';
  end if;
  if not exists (select 1 from profesional where id = p_profesional_id and local_id = v_local) then
    raise exception 'La profesional no pertenece a este local';
  end if;

  select modo_confirmacion, margen_entre_citas_minutos, anticipacion_minima_reserva_minutos, horizonte_reservas_dias
    into v_modo, v_margen, v_anticipo, v_horizonte
  from configuracion_negocio
  where local_id = v_local;

  v_fin := p_inicio + make_interval(mins => v_duracion);
  v_estado := case when v_modo = 'automatica' then 'confirmada' else 'pendiente' end;

  if p_origen = 'cliente' then
    if p_inicio < now() + make_interval(mins => v_anticipo) then
      raise exception 'Este horario ya no cumple la anticipación mínima requerida (% minutos)', v_anticipo;
    end if;
    if p_inicio::date > current_date + v_horizonte then
      raise exception 'Esta fecha está fuera del horizonte de reservas permitido (% días)', v_horizonte;
    end if;
  end if;

  if exists (
    select 1 from reserva
    where profesional_id = p_profesional_id
      and estado not in ('cancelada', 'no_asistio')
      and tstzrange(lower(rango) - make_interval(mins => v_margen), upper(rango) + make_interval(mins => v_margen))
          && tstzrange(p_inicio, v_fin)
  ) then
    raise exception 'El horario seleccionado ya no está disponible' using errcode = '23P01';
  end if;

  insert into reserva (cliente_id, servicio_id, profesional_id, rango, precio_estimado, estado, origen, creado_por, local_id)
  values (p_cliente_id, p_servicio_id, p_profesional_id, tstzrange(p_inicio, v_fin), v_precio, v_estado, p_origen, auth.uid(), v_local)
  returning * into v_reserva;

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_nuevo, local_id)
  values (v_reserva.id, 'creada', auth.uid(), to_jsonb(v_reserva), v_local);

  return v_reserva;
end;
$$;

grant execute on function fn_crear_reserva to authenticated;

create or replace function fn_cancelar_reserva(
  p_reserva_id uuid,
  p_motivo text
) returns reserva
language plpgsql security definer set search_path = public as $$
declare
  v_reserva reserva;
  v_limite_horas int;
  v_anterior jsonb;
begin
  select r.* into v_reserva from reserva r where r.id = p_reserva_id for update;
  if v_reserva is null then raise exception 'Reserva no encontrada'; end if;
  v_anterior := to_jsonb(v_reserva);

  select cancelacion_horas_limite into v_limite_horas from configuracion_negocio where local_id = v_reserva.local_id;
  if not fn_es_admin() and not fn_tiene_permiso('puede_saltar_politica_cancelacion') then
    if lower(v_reserva.rango) - now() < make_interval(hours => v_limite_horas) then
      raise exception 'Fuera de la ventana permitida para cancelar (% horas antes)', v_limite_horas;
    end if;
  end if;

  update reserva set estado = 'cancelada', actualizado_en = now() where id = p_reserva_id
  returning * into v_reserva;

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_anterior, valor_nuevo, motivo, local_id)
  values (p_reserva_id, 'cancelada', auth.uid(), v_anterior, to_jsonb(v_reserva), p_motivo, v_reserva.local_id);

  return v_reserva;
end;
$$;

grant execute on function fn_cancelar_reserva to authenticated;

create or replace function fn_liberar_reservas_pendientes_vencidas() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_afectadas int;
begin
  with vencidas as (
    update reserva r
    set estado = 'cancelada', actualizado_en = now()
    from configuracion_negocio cn
    where r.local_id = cn.local_id
      and r.estado = 'pendiente'
      and r.creado_en + make_interval(mins => cn.reserva_pendiente_expira_minutos) < now()
    returning r.id, r.local_id
  )
  select count(*) into v_afectadas from vencidas;

  insert into reserva_evento (reserva_id, tipo, motivo, local_id)
  select r.id, 'cancelada', 'vencida_sin_confirmar', r.local_id
  from reserva r
  where r.estado = 'cancelada' and r.actualizado_en > now() - interval '1 minute'
    and not exists (
      select 1 from reserva_evento e
      where e.reserva_id = r.id and e.tipo = 'cancelada' and e.motivo = 'vencida_sin_confirmar'
        and e.creado_en > now() - interval '1 minute'
    );

  return v_afectadas;
end;
$$;

create or replace function fn_reprogramar_reserva(
  p_reserva_id uuid,
  p_nuevo_inicio timestamptz,
  p_nuevo_profesional_id uuid default null
) returns reserva
language plpgsql security definer set search_path = public as $$
declare
  v_reserva reserva;
  v_duracion int;
  v_nuevo_fin timestamptz;
  v_limite_horas int;
  v_anterior jsonb;
  v_profesional_destino uuid;
begin
  perform fn_liberar_reservas_pendientes_vencidas();

  select r.* into v_reserva from reserva r where r.id = p_reserva_id for update;
  if v_reserva is null then raise exception 'Reserva no encontrada'; end if;
  v_anterior := to_jsonb(v_reserva);

  v_profesional_destino := coalesce(p_nuevo_profesional_id, v_reserva.profesional_id);

  select duracion_minutos into v_duracion from servicio where id = v_reserva.servicio_id;
  select cancelacion_horas_limite into v_limite_horas from configuracion_negocio where local_id = v_reserva.local_id;

  if not fn_es_admin() and not fn_tiene_permiso('puede_saltar_politica_cancelacion') then
    if p_nuevo_profesional_id is not null and p_nuevo_profesional_id <> v_reserva.profesional_id then
      raise exception 'No autorizada para reasignar esta cita a otra profesional';
    end if;
    if lower(v_reserva.rango) - now() < make_interval(hours => v_limite_horas) then
      raise exception 'Fuera de la ventana permitida para reprogramar (% horas antes)', v_limite_horas;
    end if;
  end if;

  if p_nuevo_profesional_id is not null and not exists (
    select 1 from servicio_profesional
    where servicio_id = v_reserva.servicio_id and profesional_id = p_nuevo_profesional_id
  ) then
    raise exception 'Esa profesional no realiza el servicio de esta cita';
  end if;

  v_nuevo_fin := p_nuevo_inicio + make_interval(mins => v_duracion);

  update reserva
  set rango = tstzrange(p_nuevo_inicio, v_nuevo_fin), profesional_id = v_profesional_destino, actualizado_en = now()
  where id = p_reserva_id
  returning * into v_reserva;

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_anterior, valor_nuevo, local_id)
  values (p_reserva_id, 'reprogramada', auth.uid(), v_anterior, to_jsonb(v_reserva), v_reserva.local_id);

  return v_reserva;
end;
$$;

grant execute on function fn_reprogramar_reserva to authenticated;

create or replace function fn_crear_servicio_rapido(p_nombre text, p_precio numeric default null)
returns servicio
language plpgsql security definer set search_path = public as $$
declare
  v_categoria_id uuid;
  v_existente servicio;
  v_nuevo servicio;
  v_local uuid;
begin
  if fn_rol_actual() is null or fn_rol_actual() not in ('admin', 'empleada') then
    raise exception 'No autorizada para crear servicios';
  end if;
  v_local := fn_exigir_local();

  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'El nombre del servicio es obligatorio';
  end if;

  select * into v_existente from servicio
  where local_id = v_local and lower(nombre) = lower(trim(p_nombre)) limit 1;
  if found then
    return v_existente;
  end if;

  select id into v_categoria_id from categoria_servicio where nombre = 'Otros servicios' and local_id = v_local;
  if v_categoria_id is null then
    insert into categoria_servicio (nombre, orden_visualizacion, local_id)
    values ('Otros servicios', 99, v_local)
    returning id into v_categoria_id;
  end if;

  insert into servicio (categoria_id, nombre, duracion_minutos, tipo_precio, precio, local_id)
  values (
    v_categoria_id,
    trim(p_nombre),
    null,
    case when p_precio is not null and p_precio > 0 then 'fijo' else 'a_valorar' end::tipo_precio_servicio,
    case when p_precio is not null and p_precio > 0 then p_precio else null end,
    v_local
  )
  returning * into v_nuevo;

  return v_nuevo;
end;
$$;

grant execute on function fn_crear_servicio_rapido to authenticated;

create or replace function fn_crear_producto_rapido(p_nombre text, p_categoria text default null, p_precio numeric default null)
returns producto
language plpgsql security definer set search_path = public as $$
declare
  v_existente producto;
  v_nuevo producto;
  v_local uuid;
begin
  if fn_rol_actual() is null or fn_rol_actual() not in ('admin', 'empleada') then
    raise exception 'No autorizada para crear productos';
  end if;
  v_local := fn_exigir_local();

  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'El nombre del producto es obligatorio';
  end if;

  select * into v_existente from producto where local_id = v_local and lower(nombre) = lower(trim(p_nombre)) limit 1;
  if found then
    return v_existente;
  end if;

  insert into producto (nombre, categoria, precio, local_id)
  values (trim(p_nombre), nullif(trim(coalesce(p_categoria, '')), ''), p_precio, v_local)
  returning * into v_nuevo;

  return v_nuevo;
end;
$$;

grant execute on function fn_crear_producto_rapido to authenticated;

create or replace function fn_mi_fidelizacion(p_cliente_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_saldo numeric;
  v_meta recompensa;
  v_config configuracion_fidelizacion;
  v_local uuid;
begin
  if not (fn_es_admin() or fn_es_mi_cliente(p_cliente_id) or fn_rol_actual() = 'empleada') then
    raise exception 'No autorizada para consultar esta fidelización';
  end if;
  select local_id into v_local from cliente where id = p_cliente_id;
  select * into v_config from configuracion_fidelizacion where local_id = v_local;
  v_saldo := fn_saldo_puntos(p_cliente_id);
  select r.* into v_meta from cliente c join recompensa r on r.id = c.meta_recompensa_id
  where c.id = p_cliente_id;
  if v_meta is null then
    select r.* into v_meta from recompensa r
    where r.local_id = v_local and r.activa and (r.stock_ilimitado or coalesce(r.cantidad_disponible, 0) > 0)
    order by r.costo_puntos asc limit 1;
  end if;
  return jsonb_build_object(
    'saldo', v_saldo,
    'acumulacion_activa', coalesce(v_config.acumulacion_activa, false),
    'canjes_activo', coalesce(v_config.canjes_activo, false),
    'texto_programa', v_config.texto_programa,
    'meta', case when v_meta is null then null else to_jsonb(v_meta) end,
    'progreso', case when v_meta is null or v_meta.costo_puntos <= 0 then null
      else least(greatest(v_saldo / v_meta.costo_puntos, 0), 1) end,
    'puntos_faltantes', case when v_meta is null then null else greatest(v_meta.costo_puntos - v_saldo, 0) end
  );
end;
$$;
grant execute on function fn_mi_fidelizacion to authenticated;

create or replace function fn_autocanjear_recompensa(
  p_cliente_id uuid,
  p_recompensa_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ya_procesado canje_recompensa;
  v_config configuracion_fidelizacion;
  v_recompensa recompensa;
  v_saldo_anterior numeric(12,2);
  v_saldo_nuevo numeric(12,2);
  v_canje_id uuid;
  v_local uuid;
begin
  if not (fn_es_admin() or fn_es_mi_cliente(p_cliente_id)) then
    raise exception 'No autorizada para canjear a nombre de esta clienta';
  end if;

  select local_id into v_local from cliente where id = p_cliente_id;

  select * into v_ya_procesado from canje_recompensa where idempotency_key = p_idempotency_key;
  if found then
    return fn_resultado_autocanje(v_ya_procesado.id);
  end if;

  perform 1 from cliente where id = p_cliente_id for update;

  select * into v_config from configuracion_fidelizacion where local_id = v_local;
  if coalesce(v_config.canjes_activo, false) is not true then
    raise exception 'Los canjes de fidelización están pausados por ahora.';
  end if;

  select * into v_recompensa from recompensa where id = p_recompensa_id and local_id = v_local for update;
  if v_recompensa is null or not v_recompensa.activa then
    raise exception 'Esa recompensa ya no está disponible.';
  end if;
  if not v_recompensa.stock_ilimitado and coalesce(v_recompensa.cantidad_disponible, 0) <= 0 then
    raise exception 'Esa recompensa se agotó.';
  end if;

  v_saldo_anterior := fn_saldo_puntos(p_cliente_id);
  if v_saldo_anterior < v_recompensa.costo_puntos then
    raise exception 'No tienes suficientes puntos para esta recompensa.';
  end if;

  insert into canje_recompensa (cliente_id, recompensa_id, atencion_id, costo_puntos_snapshot, condiciones_snapshot, empleada_id, idempotency_key, local_id)
  values (
    p_cliente_id, v_recompensa.id, null, v_recompensa.costo_puntos,
    jsonb_build_object('nombre', v_recompensa.nombre, 'tipo', v_recompensa.tipo, 'condiciones', v_recompensa.condiciones,
                        'servicio_id', v_recompensa.servicio_id, 'monto_descuento', v_recompensa.monto_descuento),
    null, p_idempotency_key, v_local
  )
  returning id into v_canje_id;

  insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, referencia_id, canje_id, clave_idempotencia, creado_por, local_id)
  values (p_cliente_id, 'canje', -v_recompensa.costo_puntos, 'canje', v_canje_id, v_canje_id, 'canje:' || v_canje_id, auth.uid(), v_local);

  if not v_recompensa.stock_ilimitado then
    update recompensa set cantidad_disponible = cantidad_disponible - 1 where id = v_recompensa.id;
  end if;

  update cliente set meta_recompensa_id = null where id = p_cliente_id and meta_recompensa_id = v_recompensa.id;

  v_saldo_nuevo := fn_saldo_puntos(p_cliente_id);

  update canje_recompensa set saldo_anterior = v_saldo_anterior, saldo_posterior = v_saldo_nuevo where id = v_canje_id;

  insert into notificacion_fidelizacion (cliente_id, tipo, titulo, mensaje, origen_tipo, origen_id, datos, local_id)
  values (
    p_cliente_id, 'canje_confirmado', '¡Disfruta tu recompensa!',
    'Usaste ' || v_recompensa.costo_puntos || ' puntos en "' || v_recompensa.nombre || '".',
    'canje', v_canje_id,
    jsonb_build_object(
      'canje_id', v_canje_id,
      'recompensa_nombre', v_recompensa.nombre,
      'recompensa_imagen_url', v_recompensa.imagen_url,
      'recompensa_tipo', v_recompensa.tipo,
      'costo_puntos', v_recompensa.costo_puntos,
      'saldo_anterior', v_saldo_anterior,
      'saldo_posterior', v_saldo_nuevo,
      'puntos_ganados_en_esta_atencion', 0
    ),
    v_local
  )
  on conflict do nothing;

  return fn_resultado_autocanje(v_canje_id);
end;
$$;

grant execute on function fn_autocanjear_recompensa to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Vistas: local_id al final (CREATE OR REPLACE no inserta columnas a mitad)
-- ---------------------------------------------------------------------------
create or replace view vista_profesional with (security_invoker = true) as
select
  p.id, p.slug, p.especialidades, p.bio, p.foto_url, p.activo, p.orden_visualizacion,
  pf.nombre, p.mostrar_en_home, p.local_id
from profesional p
join perfil pf on pf.id = p.id;

create or replace view vista_reserva with (security_invoker = true) as
select
  r.id, r.cliente_id, c.nombre as cliente_nombre,
  r.servicio_id, s.nombre as servicio_nombre, s.duracion_minutos,
  r.profesional_id, vp.nombre as profesional_nombre,
  r.rango, lower(r.rango) as inicio, upper(r.rango) as fin,
  r.precio_estimado, r.estado, r.origen, r.notas, r.creado_en, r.actualizado_en, r.local_id
from reserva r
join cliente c on c.id = r.cliente_id
join servicio s on s.id = r.servicio_id
join vista_profesional vp on vp.id = r.profesional_id;

create or replace view vista_atencion with (security_invoker = true) as
select
  a.id, a.reserva_id, a.cliente_id, c.nombre as cliente_nombre,
  a.estado, a.notas, a.creado_en, a.completado_en,
  coalesce((select sum((ase.precio_snapshot - ase.descuento) * ase.cantidad) from atencion_servicio ase where ase.atencion_id = a.id), 0)
    + coalesce((select sum(ap.precio_unitario * ap.cantidad) from atencion_producto ap where ap.atencion_id = a.id), 0) as total_vendido,
  coalesce((select sum(pg.monto) from pago pg where pg.atencion_id = a.id), 0) as total_pagado,
  a.local_id
from atencion a
join cliente c on c.id = a.cliente_id;

create or replace view vista_atencion_servicio with (security_invoker = true) as
select
  ase.id, ase.atencion_id, ase.servicio_id, ase.nombre_snapshot, ase.precio_snapshot,
  ase.descuento, ase.cantidad, ase.profesional_id, vp.nombre as profesional_nombre,
  a.reserva_id, a.estado as atencion_estado, a.creado_en as atencion_creado_en,
  a.completado_en as atencion_completado_en, a.cliente_id, c.nombre as cliente_nombre,
  coalesce((select sum(co.valor) from comision co where co.atencion_servicio_id = ase.id), 0) as comision_total,
  ase.es_colaboracion, a.local_id
from atencion_servicio ase
join vista_profesional vp on vp.id = ase.profesional_id
join atencion a on a.id = ase.atencion_id
join cliente c on c.id = a.cliente_id;

-- ---------------------------------------------------------------------------
-- 10. Alta de un negocio nuevo (vender el software)
-- ---------------------------------------------------------------------------
create or replace function fn_provisionar_local(p_nombre text, p_slug text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into local (nombre, slug) values (trim(p_nombre), trim(p_slug)) returning id into v_id;
  insert into configuracion_negocio (local_id) values (v_id);
  insert into configuracion_homepage (local_id) values (v_id);
  insert into configuracion_fidelizacion (local_id) values (v_id);
  insert into categoria_servicio (nombre, orden_visualizacion, local_id)
  values ('Otros servicios', 99, v_id);
  return v_id;
end;
$$;

comment on function fn_provisionar_local is
  'Crear un salón nuevo en el mismo Supabase. El UUID devuelto va en VITE_LOCAL_ID de esa instalación. Ejecutar con un rol de plataforma (SQL editor), no desde el frontend.';

grant select on local to anon, authenticated;
