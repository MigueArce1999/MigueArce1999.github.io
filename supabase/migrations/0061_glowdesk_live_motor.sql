-- 0061_glowdesk_live_motor.sql
-- GlowDesk Live — motor de disponibilidad (fuente única de verdad, sección 7) y flujo de
-- solicitudes "¿puedes atenderme ahora?" (secciones 11-18). Todo en SECURITY DEFINER, igual que
-- el resto de la lógica sensible del proyecto (ver 0013_funciones.sql) — el frontend nunca
-- decide disponibilidad ni escribe estas tablas directamente.

-- ---------------------------------------------------------------------------
-- 1. Motor: estado de UNA profesional ahora mismo (opcionalmente filtrado por servicio).
--
-- Prioridad (sección 21, de mayor a menor):
--   1. Override manual explícito (profesional_estado_manual, si no venció)
--   2. Servicio activo ahora (atencion en_progreso)
--   3. Cita confirmada en curso ahora mismo
--   4. Horario laboral / bloqueos aprobados
--   5. Disponibilidad automática (ventana libre hasta el próximo evento o fin de jornada)
--
-- p_ahora es un parámetro (no siempre now()) para que el motor sea testeable de forma
-- determinista contra Postgres real (sección 53) sin depender del reloj de la máquina de test.
--
-- Limitación conocida: si una profesional tiene más de un bloque de horario el mismo día
-- (jornada partida, ej. mañana y tarde), esta función solo considera el primer bloque del día
-- al calcular la ventana libre — igual que hacía fn_disponibilidad original antes de esta
-- funcionalidad. No se corrige aquí para no tocar ese comportamiento existente sin pedirlo.
-- ---------------------------------------------------------------------------

create or replace function fn_estado_profesional_ahora(
  p_profesional_id uuid,
  p_servicio_id uuid default null,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_local uuid;
  v_config configuracion_negocio;
  v_manual profesional_estado_manual;
  v_atencion_id uuid;
  v_atencion_creado_en timestamptz;
  v_duracion_activa int;
  v_fin_estimado_actual timestamptz;
  v_reserva_fin timestamptz;
  v_fecha_local date;
  v_dow int;
  v_version date;
  v_inicio_jornada timestamptz;
  v_fin_jornada timestamptz;
  v_bloqueo bloqueo_ausencia;
  v_proximo_evento_inicio timestamptz;
  v_ventana_minutos numeric;
  v_status text;
  v_disponible_hasta timestamptz;
  v_duracion_servicio int;
  v_puede_atender boolean;
begin
  select local_id into v_local from profesional where id = p_profesional_id;
  if v_local is null then
    raise exception 'Profesional % no existe', p_profesional_id;
  end if;
  select * into v_config from configuracion_negocio where local_id = v_local;

  -- Prioridad 1: override manual.
  select * into v_manual from profesional_estado_manual
  where profesional_id = p_profesional_id and hasta > p_ahora;
  if found and v_manual.estado <> 'disponible' then
    return jsonb_build_object(
      'status', 'unavailable', 'razon', v_manual.estado, 'disponible_ahora', false,
      'disponible_hasta', null, 'proxima_disponible_en', v_manual.hasta,
      'minutos_libres', null, 'puede_atender_servicio', false
    );
  end if;

  -- Prioridad 2: servicio activo ahora (atención en progreso, sin importar si vino de una
  -- reserva o fue walk-in).
  select a.id, a.creado_en into v_atencion_id, v_atencion_creado_en
  from atencion a
  join atencion_servicio ase on ase.atencion_id = a.id
  where ase.profesional_id = p_profesional_id and a.estado = 'en_progreso'
  limit 1;

  if v_atencion_id is not null then
    select coalesce(sum(coalesce(psd.duracion_minutos, s.duracion_minutos, 30)), 30)
      into v_duracion_activa
    from atencion_servicio ase
    join servicio s on s.id = ase.servicio_id
    left join profesional_servicio_duracion psd
      on psd.profesional_id = ase.profesional_id and psd.servicio_id = ase.servicio_id and psd.activo
    where ase.atencion_id = v_atencion_id and ase.profesional_id = p_profesional_id;

    v_fin_estimado_actual := v_atencion_creado_en + make_interval(mins => v_duracion_activa);
    v_status := case when extract(epoch from (v_fin_estimado_actual - p_ahora)) / 60
      <= coalesce(v_config.live_umbral_termina_pronto_minutos, 20) then 'ending_soon' else 'busy' end;
    return jsonb_build_object(
      'status', v_status, 'razon', 'servicio_activo', 'disponible_ahora', false,
      'disponible_hasta', null,
      'proxima_disponible_en', v_fin_estimado_actual + make_interval(mins => coalesce(v_config.margen_entre_citas_minutos, 0)),
      'minutos_libres', null, 'puede_atender_servicio', false
    );
  end if;

  -- Prioridad 3: cita confirmada en curso ahora mismo (todavía no se registró la atención).
  select upper(r.rango) into v_reserva_fin
  from reserva r
  where r.profesional_id = p_profesional_id and r.estado in ('confirmada', 'en_atencion') and r.rango @> p_ahora
  limit 1;

  if v_reserva_fin is not null then
    v_status := case when extract(epoch from (v_reserva_fin - p_ahora)) / 60
      <= coalesce(v_config.live_umbral_termina_pronto_minutos, 20) then 'ending_soon' else 'busy' end;
    return jsonb_build_object(
      'status', v_status, 'razon', 'cita', 'disponible_ahora', false,
      'disponible_hasta', null,
      'proxima_disponible_en', v_reserva_fin + make_interval(mins => coalesce(v_config.margen_entre_citas_minutos, 0)),
      'minutos_libres', null, 'puede_atender_servicio', false
    );
  end if;

  -- Prioridad 4: horario laboral / bloqueos.
  v_fecha_local := (p_ahora at time zone 'America/Bogota')::date;
  v_dow := extract(dow from v_fecha_local);

  select max(vigente_desde) into v_version from horario_disponibilidad
  where profesional_id = p_profesional_id and vigente_desde <= v_fecha_local;

  select (v_fecha_local::timestamp + h.hora_inicio) at time zone 'America/Bogota',
         (v_fecha_local::timestamp + h.hora_fin) at time zone 'America/Bogota'
    into v_inicio_jornada, v_fin_jornada
  from horario_disponibilidad h
  where h.profesional_id = p_profesional_id and h.dia_semana = v_dow and h.activo and h.vigente_desde = v_version
  order by h.hora_inicio limit 1;

  if v_inicio_jornada is null or p_ahora < v_inicio_jornada or p_ahora >= v_fin_jornada then
    return jsonb_build_object(
      'status', 'unavailable', 'razon', 'fuera_de_horario', 'disponible_ahora', false,
      'disponible_hasta', null, 'proxima_disponible_en', null,
      'minutos_libres', null, 'puede_atender_servicio', false
    );
  end if;

  select * into v_bloqueo from bloqueo_ausencia
  where profesional_id = p_profesional_id and estado = 'aprobada' and rango @> p_ahora
  limit 1;
  if found then
    return jsonb_build_object(
      'status', 'unavailable',
      'razon', case v_bloqueo.tipo when 'ausencia_dia' then 'dia_libre' when 'ausencia_rango' then 'ausencia' else 'bloqueo' end,
      'disponible_ahora', false, 'disponible_hasta', null, 'proxima_disponible_en', upper(v_bloqueo.rango),
      'minutos_libres', null, 'puede_atender_servicio', false
    );
  end if;

  -- Prioridad 5: libre — ventana hasta el próximo evento (cita, bloqueo) o fin de jornada.
  select min(t) into v_proximo_evento_inicio from (
    select lower(rango) as t from reserva
    where profesional_id = p_profesional_id and estado in ('pendiente', 'confirmada', 'en_atencion') and lower(rango) > p_ahora
    union all
    select lower(rango) as t from bloqueo_ausencia
    where profesional_id = p_profesional_id and estado = 'aprobada' and lower(rango) > p_ahora
  ) eventos
  where t <= v_fin_jornada;

  -- Buffer entre citas (sección 7, "buffers si existen"): la ventana realmente reservable
  -- termina `margen_entre_citas_minutos` antes del próximo evento, igual que ya exige
  -- fn_crear_reserva/fn_disponibilidad al agendar. Sin próximo evento, no aplica margen.
  v_disponible_hasta := case when v_proximo_evento_inicio is null then v_fin_jornada
    else greatest(v_proximo_evento_inicio - make_interval(mins => coalesce(v_config.margen_entre_citas_minutos, 0)), p_ahora) end;
  v_ventana_minutos := extract(epoch from (v_disponible_hasta - p_ahora)) / 60;

  v_status := case
    when v_proximo_evento_inicio is not null
      and v_ventana_minutos <= coalesce(v_config.live_umbral_disponible_limitado_minutos, 45)
    then 'upcoming_appointment'
    else 'available'
  end;

  if p_servicio_id is not null then
    select coalesce(psd.duracion_minutos, s.duracion_minutos) into v_duracion_servicio
    from servicio s
    left join profesional_servicio_duracion psd
      on psd.profesional_id = p_profesional_id and psd.servicio_id = s.id and psd.activo
    where s.id = p_servicio_id;
    v_puede_atender := case when v_duracion_servicio is null then null else v_duracion_servicio <= v_ventana_minutos end;
  else
    v_puede_atender := true;
  end if;

  return jsonb_build_object(
    'status', v_status, 'razon', null, 'disponible_ahora', true,
    'disponible_hasta', v_disponible_hasta, 'proxima_disponible_en', null,
    'minutos_libres', round(v_ventana_minutos), 'puede_atender_servicio', v_puede_atender
  );
end;
$$;

grant execute on function fn_estado_profesional_ahora to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Motor: todo el salón de una vez (sección 27 — una sola llamada, sin N+1 desde el cliente).
-- ---------------------------------------------------------------------------

create or replace function fn_salon_en_vivo(p_servicio_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_local uuid := fn_exigir_local();
  v_config configuracion_negocio;
  v_zonas jsonb;
  v_profesionales jsonb := '[]'::jsonb;
  v_prof record;
  v_estado jsonb;
  v_disponibles int := 0;
  v_total int := 0;
  v_demanda text;
begin
  select * into v_config from configuracion_negocio where local_id = v_local;
  if coalesce(v_config.live_disponibilidad_activo, false) is not true then
    return jsonb_build_object('activo', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'nombre', z.nombre, 'icono', z.icono, 'orden', z.orden_visualizacion
  ) order by z.orden_visualizacion), '[]'::jsonb)
    into v_zonas
  from zona_salon z where z.local_id = v_local and z.activa;

  for v_prof in
    select p.id, pf.nombre, p.foto_url,
      coalesce((select jsonb_agg(pz.zona_id) from profesional_zona pz where pz.profesional_id = p.id), '[]'::jsonb) as zonas
    from profesional p
    join perfil pf on pf.id = p.id
    where p.local_id = v_local and p.activo
    order by p.orden_visualizacion
  loop
    v_estado := fn_estado_profesional_ahora(v_prof.id, p_servicio_id);
    v_total := v_total + 1;
    if v_estado ->> 'status' in ('available', 'upcoming_appointment') then
      v_disponibles := v_disponibles + 1;
    end if;
    v_profesionales := v_profesionales || jsonb_build_object(
      'profesional_id', v_prof.id, 'nombre', v_prof.nombre, 'foto_url', v_prof.foto_url,
      'zonas', v_prof.zonas, 'estado', v_estado
    );
  end loop;

  -- Heurística de demanda (sección 3): mitad o más disponibles = tranquilo; alguna disponible
  -- pero menos de la mitad = movimiento medio; ninguna disponible = alta demanda.
  v_demanda := case
    when v_total = 0 then 'tranquilo'
    when v_disponibles::numeric / v_total >= 0.5 then 'tranquilo'
    when v_disponibles > 0 then 'movimiento_medio'
    else 'alta_demanda'
  end;

  return jsonb_build_object(
    'activo', true, 'demanda', v_demanda, 'actualizado_en', now(),
    'zonas', v_zonas, 'profesionales', v_profesionales
  );
end;
$$;

grant execute on function fn_salon_en_vivo to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Estado manual de la profesional ("Mi disponibilidad") — sección 20.
-- ---------------------------------------------------------------------------

create or replace function fn_marcar_estado_manual(p_estado text, p_minutos int, p_motivo text default null)
returns profesional_estado_manual
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid;
  v_fila profesional_estado_manual;
begin
  if p_estado not in ('descanso', 'almuerzo', 'no_disponible', 'ocupado_temporal') then
    raise exception 'Estado manual inválido: %', p_estado;
  end if;
  if p_minutos is null or p_minutos <= 0 or p_minutos > 480 then
    raise exception 'La duración debe ser mayor a 0 y menor a 8 horas';
  end if;
  select local_id into v_local from profesional where id = auth.uid();
  if v_local is null then
    raise exception 'No autorizada: no eres una profesional de este local';
  end if;

  insert into profesional_estado_manual (profesional_id, estado, hasta, motivo, local_id)
  values (auth.uid(), p_estado, now() + make_interval(mins => p_minutos), p_motivo, v_local)
  on conflict (profesional_id) do update
    set estado = excluded.estado, hasta = excluded.hasta, motivo = excluded.motivo, actualizado_en = now()
  returning * into v_fila;

  return v_fila;
end;
$$;

grant execute on function fn_marcar_estado_manual to authenticated;

create or replace function fn_limpiar_estado_manual() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from profesional_estado_manual where profesional_id = auth.uid();
end;
$$;

grant execute on function fn_limpiar_estado_manual to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Solicitudes de disponibilidad — secciones 11-18.
-- ---------------------------------------------------------------------------

create or replace function fn_resultado_solicitud_disponibilidad(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', sd.id, 'estado', sd.estado, 'expira_en', sd.expira_en,
    'disponible_desde', sd.disponible_desde, 'llegada_minutos', sd.llegada_minutos,
    'profesional_id', sd.profesional_id, 'profesional_nombre', pf.nombre,
    'servicio_id', sd.servicio_id, 'servicio_nombre', s.nombre,
    'creado_en', sd.creado_en, 'respondido_en', sd.respondido_en
  )
  from solicitud_disponibilidad sd
  join perfil pf on pf.id = sd.profesional_id
  join servicio s on s.id = sd.servicio_id
  where sd.id = p_id
$$;

grant execute on function fn_resultado_solicitud_disponibilidad to authenticated;

create or replace function fn_expirar_solicitudes_vencidas() returns int
language sql security definer set search_path = public as $$
  with vencidas as (
    update solicitud_disponibilidad
    set estado = 'expirada', actualizado_en = now()
    where estado = 'pendiente' and expira_en < now()
    returning id
  )
  select count(*)::int from vencidas
$$;

create or replace function fn_crear_solicitud_disponibilidad(
  p_cliente_id uuid,
  p_profesional_id uuid,
  p_servicio_id uuid,
  p_llegada_minutos int,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid;
  v_config configuracion_negocio;
  v_ya_procesada solicitud_disponibilidad;
  v_estado_actual jsonb;
  v_nueva solicitud_disponibilidad;
begin
  if not (fn_es_admin() or fn_es_mi_cliente(p_cliente_id)) then
    raise exception 'No autorizada para solicitar disponibilidad a nombre de esta clienta';
  end if;
  if p_llegada_minutos is null or p_llegada_minutos <= 0 or p_llegada_minutos > 180 then
    raise exception 'El tiempo de llegada no es válido';
  end if;

  select * into v_ya_procesada from solicitud_disponibilidad where idempotency_key = p_idempotency_key;
  if found then
    return fn_resultado_solicitud_disponibilidad(v_ya_procesada.id);
  end if;

  perform fn_expirar_solicitudes_vencidas();

  if exists (
    select 1 from solicitud_disponibilidad
    where cliente_id = p_cliente_id and profesional_id = p_profesional_id and estado = 'pendiente'
  ) then
    raise exception 'Ya tienes una solicitud pendiente con esta profesional.';
  end if;

  select local_id into v_local from cliente where id = p_cliente_id;
  select * into v_config from configuracion_negocio where local_id = v_local;
  if coalesce(v_config.live_disponibilidad_activo, false) is not true then
    raise exception 'La disponibilidad en vivo no está activa en este momento.';
  end if;

  -- Nunca confiar en lo que ya vio el frontend (sección 42): se revalida contra el motor.
  v_estado_actual := fn_estado_profesional_ahora(p_profesional_id, p_servicio_id);
  if v_estado_actual ->> 'status' = 'unavailable' then
    raise exception 'Esta profesional ya no está disponible en este momento.';
  end if;
  if (v_estado_actual ->> 'puede_atender_servicio') = 'false' then
    raise exception 'Esta profesional no alcanza a realizar ese servicio en su ventana libre actual.';
  end if;

  insert into solicitud_disponibilidad (
    local_id, cliente_id, profesional_id, servicio_id, llegada_minutos, expira_en, idempotency_key
  ) values (
    v_local, p_cliente_id, p_profesional_id, p_servicio_id, p_llegada_minutos,
    now() + make_interval(mins => coalesce(v_config.live_expiracion_solicitud_minutos, 3)),
    p_idempotency_key
  )
  returning * into v_nueva;

  return fn_resultado_solicitud_disponibilidad(v_nueva.id);
end;
$$;

grant execute on function fn_crear_solicitud_disponibilidad to authenticated;

-- p_respuesta: 'aceptar' | 'rechazar' | 'mas_tarde'
create or replace function fn_responder_solicitud_disponibilidad(
  p_solicitud_id uuid,
  p_respuesta text,
  p_disponible_en_minutos int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_solicitud solicitud_disponibilidad;
  v_config configuracion_negocio;
begin
  select * into v_solicitud from solicitud_disponibilidad where id = p_solicitud_id for update;
  if v_solicitud is null then
    raise exception 'Solicitud no encontrada';
  end if;
  if not (fn_es_admin() or v_solicitud.profesional_id = auth.uid()) then
    raise exception 'No autorizada para responder esta solicitud';
  end if;

  if v_solicitud.estado <> 'pendiente' then
    if v_solicitud.estado = 'expirada' then
      return fn_resultado_solicitud_disponibilidad(v_solicitud.id);
    end if;
    raise exception 'Esta solicitud ya fue respondida (%).', v_solicitud.estado;
  end if;

  if v_solicitud.expira_en < now() then
    update solicitud_disponibilidad set estado = 'expirada', actualizado_en = now() where id = p_solicitud_id;
    return fn_resultado_solicitud_disponibilidad(p_solicitud_id);
  end if;

  select * into v_config from configuracion_negocio where local_id = v_solicitud.local_id;

  if p_respuesta = 'aceptar' then
    update solicitud_disponibilidad
    set estado = 'aceptada', respondido_en = now(), actualizado_en = now()
    where id = p_solicitud_id;

    -- Soft hold (sección 16): mientras dura, el motor la muestra "no disponible" para que no
    -- lleguen nuevas solicitudes/lecturas de disponibilidad la den por libre.
    insert into profesional_estado_manual (profesional_id, estado, hasta, motivo, local_id)
    values (
      v_solicitud.profesional_id, 'ocupado_temporal',
      now() + make_interval(mins => coalesce(v_config.live_hold_minutos, 20)),
      'cliente_en_camino', v_solicitud.local_id
    )
    on conflict (profesional_id) do update
      set estado = excluded.estado, hasta = excluded.hasta, motivo = excluded.motivo, actualizado_en = now();

  elsif p_respuesta = 'rechazar' then
    update solicitud_disponibilidad
    set estado = 'rechazada', respondido_en = now(), actualizado_en = now()
    where id = p_solicitud_id;

  elsif p_respuesta = 'mas_tarde' then
    if p_disponible_en_minutos is null or p_disponible_en_minutos <= 0 then
      raise exception 'Indica en cuántos minutos podrías atender';
    end if;
    update solicitud_disponibilidad
    set estado = 'aceptada_luego', respondido_en = now(), actualizado_en = now(),
        disponible_desde = now() + make_interval(mins => p_disponible_en_minutos)
    where id = p_solicitud_id;

  else
    raise exception 'Respuesta inválida: %', p_respuesta;
  end if;

  return fn_resultado_solicitud_disponibilidad(p_solicitud_id);
end;
$$;

grant execute on function fn_responder_solicitud_disponibilidad to authenticated;

create or replace function fn_marcar_cliente_en_camino(p_solicitud_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_solicitud solicitud_disponibilidad;
begin
  select * into v_solicitud from solicitud_disponibilidad where id = p_solicitud_id for update;
  if v_solicitud is null then raise exception 'Solicitud no encontrada'; end if;
  if not fn_es_mi_cliente(v_solicitud.cliente_id) then
    raise exception 'No autorizada';
  end if;
  if v_solicitud.estado <> 'aceptada' then
    raise exception 'Esta solicitud no está aceptada (%).', v_solicitud.estado;
  end if;

  update solicitud_disponibilidad
  set estado = 'cliente_en_camino', actualizado_en = now()
  where id = p_solicitud_id;

  return fn_resultado_solicitud_disponibilidad(p_solicitud_id);
end;
$$;

grant execute on function fn_marcar_cliente_en_camino to authenticated;

create or replace function fn_cancelar_solicitud_disponibilidad(p_solicitud_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_solicitud solicitud_disponibilidad;
begin
  select * into v_solicitud from solicitud_disponibilidad where id = p_solicitud_id for update;
  if v_solicitud is null then raise exception 'Solicitud no encontrada'; end if;
  if not (fn_es_admin() or fn_es_mi_cliente(v_solicitud.cliente_id)) then
    raise exception 'No autorizada';
  end if;
  if v_solicitud.estado not in ('pendiente', 'aceptada', 'aceptada_luego') then
    raise exception 'Esta solicitud ya no se puede cancelar (%).', v_solicitud.estado;
  end if;

  update solicitud_disponibilidad set estado = 'cancelada', actualizado_en = now() where id = p_solicitud_id;
  return fn_resultado_solicitud_disponibilidad(p_solicitud_id);
end;
$$;

grant execute on function fn_cancelar_solicitud_disponibilidad to authenticated;

create or replace function fn_listar_solicitudes_profesional() returns setof jsonb
language sql security definer set search_path = public as $$
  select fn_expirar_solicitudes_vencidas();
  select fn_resultado_solicitud_disponibilidad(id)
  from solicitud_disponibilidad
  where profesional_id = auth.uid() and estado in ('pendiente', 'aceptada', 'cliente_en_camino')
  order by creado_en desc
$$;

grant execute on function fn_listar_solicitudes_profesional to authenticated;

create or replace function fn_listar_mis_solicitudes(p_cliente_id uuid) returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (fn_es_admin() or fn_es_mi_cliente(p_cliente_id)) then
    raise exception 'No autorizada';
  end if;
  perform fn_expirar_solicitudes_vencidas();
  return query
    select fn_resultado_solicitud_disponibilidad(id)
    from solicitud_disponibilidad
    where cliente_id = p_cliente_id
    order by creado_en desc
    limit 20;
end;
$$;

grant execute on function fn_listar_mis_solicitudes to authenticated;
