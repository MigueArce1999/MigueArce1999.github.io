-- 0070_glowdesk_live_forzar_disponible.sql
-- GlowDesk Live: además de marcar a alguien "no disponible" por un rato (descanso/almuerzo/no
-- disponible/ocupado_temporal, 0061), la admin necesita el caso contrario — forzarla a
-- "Disponible" ahora mismo aunque el motor la calcularía como no disponible por horario o por un
-- bloqueo/ausencia aprobados (ej.: llegó a cubrir un turno que no estaba en su horario cargado).
--
-- 'disponible_forzado' es un nuevo valor de profesional_estado_manual.estado, con una prioridad
-- deliberadamente distinta a los demás: NO gana sobre un servicio activo o una cita real en curso
-- (eso sigue siendo la verdad de lo que está pasando ahora mismo), pero SÍ salta por encima del
-- chequeo de horario/bloqueos — es exactamente lo que hace falta para el caso de uso real.

alter table profesional_estado_manual drop constraint if exists profesional_estado_manual_estado_check;
alter table profesional_estado_manual add constraint profesional_estado_manual_estado_check
  check (estado in ('disponible', 'descanso', 'almuerzo', 'no_disponible', 'ocupado_temporal', 'disponible_forzado'));

create or replace function fn_marcar_estado_manual(
  p_estado text, p_minutos int, p_motivo text default null, p_profesional_id uuid default null
)
returns profesional_estado_manual
language plpgsql security definer set search_path = public as $$
declare
  v_objetivo uuid := coalesce(p_profesional_id, auth.uid());
  v_local uuid;
  v_fila profesional_estado_manual;
begin
  if p_estado not in ('descanso', 'almuerzo', 'no_disponible', 'ocupado_temporal', 'disponible_forzado') then
    raise exception 'Estado manual inválido: %', p_estado;
  end if;
  if p_minutos is null or p_minutos <= 0 or p_minutos > 480 then
    raise exception 'La duración debe ser mayor a 0 y menor a 8 horas';
  end if;

  select local_id into v_local from profesional where id = v_objetivo;
  if v_local is null then
    raise exception 'Profesional no encontrada';
  end if;
  if v_objetivo <> auth.uid() and not (fn_es_admin() and v_local = fn_local_id()) then
    raise exception 'No autorizada para marcar la disponibilidad de esta profesional';
  end if;

  insert into profesional_estado_manual (profesional_id, estado, hasta, motivo, local_id)
  values (v_objetivo, p_estado, now() + make_interval(mins => p_minutos), p_motivo, v_local)
  on conflict (profesional_id) do update
    set estado = excluded.estado, hasta = excluded.hasta, motivo = excluded.motivo, actualizado_en = now()
  returning * into v_fila;

  return v_fila;
end;
$$;

-- fn_estado_profesional_ahora: se inserta el chequeo de disponible_forzado justo después de
-- "cita en curso" (prioridad 3) y antes de "horario laboral / bloqueos" (prioridad 4) — un
-- servicio o cita real siguen ganando siempre; el horario/bloqueo es lo único que se salta.
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
  v_forzada_disponible boolean := false;
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
  if found then
    if v_manual.estado <> 'disponible' and v_manual.estado <> 'disponible_forzado' then
      return jsonb_build_object(
        'status', 'unavailable', 'razon', v_manual.estado, 'disponible_ahora', false,
        'disponible_hasta', null, 'proxima_disponible_en', v_manual.hasta,
        'minutos_libres', null, 'puede_atender_servicio', false
      );
    elsif v_manual.estado = 'disponible_forzado' then
      v_forzada_disponible := true;
    end if;
  end if;

  -- Prioridad 2: servicio activo ahora (atención en progreso, sin importar si vino de una
  -- reserva o fue walk-in). Gana siempre, incluso sobre un "forzar disponible".
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
  -- También gana siempre sobre un "forzar disponible".
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

  -- Con "forzar disponible" activo y sin servicio/cita real en curso, se corta aquí: se salta
  -- por completo el chequeo de horario/bloqueos (prioridad 4) y la ventana automática
  -- (prioridad 5) — la ventana de disponibilidad es simplemente hasta que venza el override.
  if v_forzada_disponible then
    if p_servicio_id is not null then
      select coalesce(psd.duracion_minutos, s.duracion_minutos) into v_duracion_servicio
      from servicio s
      left join profesional_servicio_duracion psd
        on psd.profesional_id = p_profesional_id and psd.servicio_id = s.id and psd.activo
      where s.id = p_servicio_id;
      v_puede_atender := case when v_duracion_servicio is null then null
        else v_duracion_servicio <= extract(epoch from (v_manual.hasta - p_ahora)) / 60 end;
    else
      v_puede_atender := true;
    end if;
    return jsonb_build_object(
      'status', 'available', 'razon', null, 'disponible_ahora', true,
      'disponible_hasta', v_manual.hasta, 'proxima_disponible_en', null,
      'minutos_libres', greatest(0, round(extract(epoch from (v_manual.hasta - p_ahora)) / 60)),
      'puede_atender_servicio', v_puede_atender
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
