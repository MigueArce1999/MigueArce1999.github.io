-- 0032_agenda_compartida_funciones.sql
-- Funciones RPC de la agenda compartida: disponibilidad real (versión de horario vigente,
-- margen entre citas, anticipación mínima, horizonte de reservas, limpieza de pendientes
-- vencidas), reserva con "cualquier profesional" sin dejar reservas sin responsable,
-- confirmar/marcar inasistencia/reasignar, y el flujo completo de solicitudes de horario y
-- ausencias (crear, aprobar, rechazar, retirar) con revalidación de conflictos. Todo vía
-- funciones SECURITY DEFINER, igual que el resto del proyecto (ver 0013_funciones.sql):
-- el frontend nunca escribe horario_disponibilidad/bloqueo_ausencia/solicitud_horario
-- directamente salvo quien tenga permiso explícito (ver 0031).

-- ---------------------------------------------------------------------------
-- Disponibilidad: reescrita para usar la versión de horario vigente a la fecha consultada,
-- excluir solo bloqueos APROBADOS, aplicar margen entre citas, anticipación mínima y
-- horizonte de reservas, y purgar pendientes vencidas antes de calcular nada (así una
-- reserva pendiente vencida deja de bloquear el slot sin depender de que alguien la revise).
-- ---------------------------------------------------------------------------
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
begin
  perform fn_liberar_reservas_pendientes_vencidas();

  select duracion_minutos into v_duracion from servicio where id = p_servicio_id;
  if v_duracion is null then
    raise exception 'Servicio % no existe o no tiene duración configurada', p_servicio_id;
  end if;

  select margen_entre_citas_minutos, anticipacion_minima_reserva_minutos, horizonte_reservas_dias
    into v_margen, v_anticipo, v_horizonte
  from configuracion_negocio;

  if p_fecha > (current_date + v_horizonte) then
    return; -- fuera del horizonte de reservas permitido: ningún horario disponible
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

-- Disponibilidad agregada de un grupo de profesionales elegibles ("Cualquier profesional"):
-- un mismo horario puede aparecer una sola vez con la lista de quiénes lo tienen libre, para
-- que la clienta elija hora sin elegir persona — fn_crear_reserva_cualquier_profesional (abajo)
-- es quien de verdad asigna una responsable, de forma atómica, al confirmar.
create or replace function fn_disponibilidad_equipo(
  p_servicio_id uuid,
  p_profesional_ids uuid[],
  p_fecha date
) returns table (inicio timestamptz, fin timestamptz, profesionales_disponibles uuid[])
language plpgsql security definer set search_path = public as $$
begin
  return query
  select d.inicio, d.fin, array_agg(distinct d.profesional_id order by d.profesional_id) as profesionales_disponibles
  from (
    select f.inicio, f.fin, pid as profesional_id
    from unnest(p_profesional_ids) as pid
    cross join lateral fn_disponibilidad(p_servicio_id, pid, p_fecha) as f
  ) d
  group by d.inicio, d.fin
  order by d.inicio;
end;
$$;

grant execute on function fn_disponibilidad_equipo to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Crear reserva: agrega anticipación mínima/horizonte (solo para origen 'cliente' — recepción
-- y admin pueden agendar walk-ins sin esas restricciones pensadas para autoservicio), margen
-- entre citas en la verificación legible, y valida que el origen declarado corresponda a quien
-- realmente llama (antes de esto, `p_origen` no se validaba contra el rol de quien llamaba).
-- ---------------------------------------------------------------------------
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
begin
  perform fn_liberar_reservas_pendientes_vencidas();

  if p_origen = 'cliente' then
    if not fn_es_mi_cliente(p_cliente_id) then
      raise exception 'No puedes reservar a nombre de otra clienta';
    end if;
  elsif not fn_es_admin() and not fn_tiene_permiso('puede_ver_agenda_equipo') and fn_rol_actual() <> 'empleada' then
    raise exception 'No autorizada para crear una reserva con ese origen';
  end if;

  select duracion_minutos, precio, tipo_precio into v_duracion, v_precio, v_tipo_precio
  from servicio where id = p_servicio_id and activo;
  if v_duracion is null then
    raise exception 'Servicio no disponible';
  end if;

  select modo_confirmacion, margen_entre_citas_minutos, anticipacion_minima_reserva_minutos, horizonte_reservas_dias
    into v_modo, v_margen, v_anticipo, v_horizonte
  from configuracion_negocio;

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

  -- Verificación explícita (con margen) solo para un mensaje de error legible; el EXCLUDE
  -- constraint de `reserva` sigue siendo la garantía definitiva anti-solapamiento exacto —
  -- ninguna condición de carrera puede saltárselo, con o sin margen calculado aquí.
  if exists (
    select 1 from reserva
    where profesional_id = p_profesional_id
      and estado not in ('cancelada', 'no_asistio')
      and tstzrange(lower(rango) - make_interval(mins => v_margen), upper(rango) + make_interval(mins => v_margen))
          && tstzrange(p_inicio, v_fin)
  ) then
    raise exception 'El horario seleccionado ya no está disponible' using errcode = '23P01';
  end if;

  insert into reserva (cliente_id, servicio_id, profesional_id, rango, precio_estimado, estado, origen, creado_por)
  values (p_cliente_id, p_servicio_id, p_profesional_id, tstzrange(p_inicio, v_fin), v_precio, v_estado, p_origen, auth.uid())
  returning * into v_reserva;

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_nuevo)
  values (v_reserva.id, 'creada', auth.uid(), to_jsonb(v_reserva));

  return v_reserva;
end;
$$;

grant execute on function fn_crear_reserva to authenticated;

-- "Cualquier profesional": intenta cada candidata elegible en orden hasta que una consiga
-- reservar de verdad (el EXCLUDE constraint decide con certeza absoluta si sigue libre en
-- este instante); nunca crea una reserva sin profesional asignada.
create or replace function fn_crear_reserva_cualquier_profesional(
  p_cliente_id uuid,
  p_servicio_id uuid,
  p_profesional_ids uuid[],
  p_inicio timestamptz,
  p_origen origen_reserva default 'cliente'
) returns reserva
language plpgsql security definer set search_path = public as $$
declare
  v_profesional_id uuid;
  v_reserva reserva;
begin
  if p_profesional_ids is null or array_length(p_profesional_ids, 1) is null then
    raise exception 'No hay profesionales elegibles para este servicio';
  end if;

  foreach v_profesional_id in array p_profesional_ids loop
    begin
      v_reserva := fn_crear_reserva(p_cliente_id, p_servicio_id, v_profesional_id, p_inicio, p_origen);
      return v_reserva;
    exception
      when exclusion_violation then
        continue; -- esa profesional ya no tiene ese horario libre; intenta con la siguiente
    end;
  end loop;

  raise exception 'Ese horario ya no está disponible con ninguna profesional. Elige otro horario.' using errcode = '23P01';
end;
$$;

grant execute on function fn_crear_reserva_cualquier_profesional to authenticated;

-- ---------------------------------------------------------------------------
-- Reprogramar (y opcionalmente reasignar en el mismo movimiento atómico): se reemplaza la
-- función completa porque cambia su firma (parámetro nuevo con default, agregado al final —
-- los llamados existentes que solo pasan los dos primeros parámetros siguen funcionando igual).
-- ---------------------------------------------------------------------------
drop function if exists fn_reprogramar_reserva(uuid, timestamptz);

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
  select cancelacion_horas_limite into v_limite_horas from configuracion_negocio;

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

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_anterior, valor_nuevo)
  values (p_reserva_id, 'reprogramada', auth.uid(), v_anterior, to_jsonb(v_reserva));

  return v_reserva;
end;
$$;

grant execute on function fn_reprogramar_reserva to authenticated;

-- Envoltorio delgado sobre fn_reprogramar_reserva para el caso "solo cambiar de profesional,
-- misma hora" — reutiliza toda su validación (elegibilidad, política de cancelación) en vez
-- de duplicarla.
create or replace function fn_reasignar_reserva(
  p_reserva_id uuid,
  p_nuevo_profesional_id uuid
) returns reserva
language plpgsql security definer set search_path = public as $$
declare
  v_inicio timestamptz;
begin
  select lower(rango) into v_inicio from reserva where id = p_reserva_id;
  if v_inicio is null then raise exception 'Reserva no encontrada'; end if;
  return fn_reprogramar_reserva(p_reserva_id, v_inicio, p_nuevo_profesional_id);
end;
$$;

grant execute on function fn_reasignar_reserva to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmar (modo manual) / marcar inasistencia: acciones de administración/recepción que
-- faltaban como RPC explícita (antes solo existía el UPDATE implícito dentro de otras
-- funciones). Confirmar siempre purga vencidas primero, así nunca se confirma una reserva que
-- ya venció sin que nadie la haya revisado desde entonces.
-- ---------------------------------------------------------------------------
create or replace function fn_confirmar_reserva_pendiente(p_reserva_id uuid) returns reserva
language plpgsql security definer set search_path = public as $$
declare
  v_reserva reserva;
  v_anterior jsonb;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_ver_agenda_equipo') then
    raise exception 'No autorizada para confirmar reservas';
  end if;

  perform fn_liberar_reservas_pendientes_vencidas();

  select * into v_reserva from reserva where id = p_reserva_id for update;
  if v_reserva is null then raise exception 'Reserva no encontrada'; end if;
  if v_reserva.estado <> 'pendiente' then
    raise exception 'Esta reserva ya no está pendiente (estado actual: %). Puede haber vencido o ya haber sido gestionada.', v_reserva.estado;
  end if;
  v_anterior := to_jsonb(v_reserva);

  update reserva set estado = 'confirmada', actualizado_en = now() where id = p_reserva_id
  returning * into v_reserva;

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_anterior, valor_nuevo)
  values (p_reserva_id, 'confirmada', auth.uid(), v_anterior, to_jsonb(v_reserva));

  return v_reserva;
end;
$$;

grant execute on function fn_confirmar_reserva_pendiente to authenticated;

create or replace function fn_marcar_no_asistio(p_reserva_id uuid) returns reserva
language plpgsql security definer set search_path = public as $$
declare
  v_reserva reserva;
  v_anterior jsonb;
begin
  select * into v_reserva from reserva where id = p_reserva_id for update;
  if v_reserva is null then raise exception 'Reserva no encontrada'; end if;

  if not fn_es_admin() and not fn_tiene_permiso('puede_ver_agenda_equipo') and v_reserva.profesional_id <> auth.uid() then
    raise exception 'No autorizada para marcar esta cita';
  end if;
  if v_reserva.estado not in ('pendiente', 'confirmada') then
    raise exception 'Solo se puede marcar inasistencia en una cita pendiente o confirmada (estado actual: %)', v_reserva.estado;
  end if;

  v_anterior := to_jsonb(v_reserva);
  update reserva set estado = 'no_asistio', actualizado_en = now() where id = p_reserva_id
  returning * into v_reserva;

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_anterior, valor_nuevo)
  values (p_reserva_id, 'no_asistio', auth.uid(), v_anterior, to_jsonb(v_reserva));

  return v_reserva;
end;
$$;

grant execute on function fn_marcar_no_asistio to authenticated;

-- ---------------------------------------------------------------------------
-- Conflictos: reservas activas que un bloqueo/ausencia o un cambio de horario dejarían mal
-- paradas. Se exponen como funciones propias (no solo como sub-consulta interna) para que la
-- UI pueda mostrarlos ANTES de guardar/aprobar y exigir resolverlos explícitamente.
-- ---------------------------------------------------------------------------
create or replace function fn_reservas_afectadas_bloqueo(
  p_profesional_id uuid,
  p_rango tstzrange
) returns setof reserva
language plpgsql stable security definer set search_path = public as $$
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_ver_agenda_equipo') and auth.uid() <> p_profesional_id then
    raise exception 'No autorizada para consultar la agenda de esta profesional';
  end if;
  return query
  select * from reserva
  where profesional_id = p_profesional_id
    and estado not in ('cancelada', 'no_asistio')
    and rango && p_rango
  order by rango;
end;
$$;

grant execute on function fn_reservas_afectadas_bloqueo to authenticated;

-- Reservas activas desde p_desde en adelante cuyo día/hora ya NO quedaría cubierto por
-- ningún intervalo de la propuesta de horario nueva.
create or replace function fn_reservas_afectadas_horario(
  p_profesional_id uuid,
  p_intervalos jsonb,
  p_desde date
) returns setof reserva
language plpgsql stable security definer set search_path = public as $$
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_ver_agenda_equipo') and auth.uid() <> p_profesional_id then
    raise exception 'No autorizada para consultar la agenda de esta profesional';
  end if;
  return query
  select r.*
  from reserva r
  where r.profesional_id = p_profesional_id
    and r.estado not in ('cancelada', 'no_asistio')
    and lower(r.rango) >= (p_desde::timestamp at time zone 'America/Bogota')
    and not exists (
      select 1
      from jsonb_to_recordset(p_intervalos) as iv(dia_semana int, hora_inicio time, hora_fin time)
      where iv.dia_semana = extract(dow from (lower(r.rango) at time zone 'America/Bogota'))
        and (lower(r.rango) at time zone 'America/Bogota')::time >= iv.hora_inicio
        and (upper(r.rango) at time zone 'America/Bogota')::time <= iv.hora_fin
    )
  order by r.rango;
end;
$$;

grant execute on function fn_reservas_afectadas_horario to authenticated;

-- ---------------------------------------------------------------------------
-- Aplicar horario: helper interno puro (sin control de autorización propio — lo hacen sus
-- llamadoras). Reemplaza únicamente la versión con ese vigente_desde exacto (permite corregir
-- una propuesta futura sin duplicarla); nunca toca versiones de otras fechas, preservando el
-- historial. Se revoca EXECUTE de PUBLIC para que solo pueda invocarse desde dentro de otra
-- función SECURITY DEFINER (que corre con los privilegios del dueño, no de quien llama).
-- ---------------------------------------------------------------------------
create or replace function fn_aplicar_horario(
  p_profesional_id uuid,
  p_intervalos jsonb,
  p_vigente_desde date
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_iv record;
begin
  delete from horario_disponibilidad where profesional_id = p_profesional_id and vigente_desde = p_vigente_desde;

  for v_iv in select * from jsonb_to_recordset(p_intervalos) as x(dia_semana int, hora_inicio time, hora_fin time) loop
    if v_iv.dia_semana is null or v_iv.dia_semana < 0 or v_iv.dia_semana > 6 then
      raise exception 'Día de la semana inválido: %', v_iv.dia_semana;
    end if;
    if v_iv.hora_inicio is null or v_iv.hora_fin is null or v_iv.hora_fin <= v_iv.hora_inicio then
      raise exception 'Intervalo inválido: % - %', v_iv.hora_inicio, v_iv.hora_fin;
    end if;
    insert into horario_disponibilidad (profesional_id, dia_semana, hora_inicio, hora_fin, activo, vigente_desde)
    values (p_profesional_id, v_iv.dia_semana, v_iv.hora_inicio, v_iv.hora_fin, true, p_vigente_desde);
  end loop;
end;
$$;

revoke execute on function fn_aplicar_horario(uuid, jsonb, date) from public;

-- ---------------------------------------------------------------------------
-- Solicitudes de horario: si quien llama es admin o tiene puede_editar_horario_propio, se
-- aplica de inmediato (y aun así queda registrada, para conservar el historial completo);
-- si no, queda 'pendiente' sin tocar el horario publicado.
-- ---------------------------------------------------------------------------
create or replace function fn_solicitar_horario(
  p_profesional_id uuid,
  p_intervalos jsonb,
  p_vigente_desde date,
  p_motivo text
) returns solicitud_horario
language plpgsql security definer set search_path = public as $$
declare
  v_solicitud solicitud_horario;
  v_puede_directo boolean;
  v_estado estado_solicitud;
  v_afectadas int;
begin
  if not fn_es_admin() and auth.uid() <> p_profesional_id then
    raise exception 'No autorizada para cambiar el horario de otra profesional';
  end if;
  if p_vigente_desde < current_date then
    raise exception 'La fecha de vigencia no puede ser en el pasado';
  end if;

  v_puede_directo := fn_es_admin() or fn_tiene_permiso('puede_editar_horario_propio');
  v_estado := case when v_puede_directo then 'aprobada' else 'pendiente' end;

  if v_puede_directo then
    select count(*) into v_afectadas from fn_reservas_afectadas_horario(p_profesional_id, p_intervalos, p_vigente_desde);
    if v_afectadas > 0 then
      raise exception 'Este cambio afecta % cita(s) existente(s). Reprograma, reasigna o cancélalas antes de continuar.', v_afectadas;
    end if;
    perform fn_aplicar_horario(p_profesional_id, p_intervalos, p_vigente_desde);
  end if;

  insert into solicitud_horario (profesional_id, estado, intervalos, vigente_desde, motivo, creado_por, revisado_por, revisado_en)
  values (
    p_profesional_id, v_estado, p_intervalos, p_vigente_desde, p_motivo, auth.uid(),
    case when v_puede_directo then auth.uid() else null end,
    case when v_puede_directo then now() else null end
  )
  returning * into v_solicitud;

  return v_solicitud;
end;
$$;

grant execute on function fn_solicitar_horario to authenticated;

create or replace function fn_aprobar_solicitud_horario(p_id uuid) returns solicitud_horario
language plpgsql security definer set search_path = public as $$
declare
  v_solicitud solicitud_horario;
  v_afectadas int;
begin
  if not fn_es_admin() then
    raise exception 'Solo administración puede aprobar solicitudes';
  end if;

  select * into v_solicitud from solicitud_horario where id = p_id for update;
  if v_solicitud is null then raise exception 'Solicitud no encontrada'; end if;
  if v_solicitud.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue gestionada (estado actual: %)', v_solicitud.estado;
  end if;

  -- Revalida: pudieron crearse citas nuevas desde que se envió la solicitud.
  select count(*) into v_afectadas
  from fn_reservas_afectadas_horario(v_solicitud.profesional_id, v_solicitud.intervalos, v_solicitud.vigente_desde);
  if v_afectadas > 0 then
    raise exception 'Este cambio ahora afecta % cita(s). Revísalas antes de aprobar.', v_afectadas;
  end if;

  perform fn_aplicar_horario(v_solicitud.profesional_id, v_solicitud.intervalos, v_solicitud.vigente_desde);

  update solicitud_horario
  set estado = 'aprobada', revisado_por = auth.uid(), revisado_en = now()
  where id = p_id
  returning * into v_solicitud;

  return v_solicitud;
end;
$$;

grant execute on function fn_aprobar_solicitud_horario to authenticated;

create or replace function fn_rechazar_solicitud_horario(p_id uuid, p_motivo text) returns solicitud_horario
language plpgsql security definer set search_path = public as $$
declare
  v_solicitud solicitud_horario;
begin
  if not fn_es_admin() then raise exception 'Solo administración puede rechazar solicitudes'; end if;
  select * into v_solicitud from solicitud_horario where id = p_id for update;
  if v_solicitud is null then raise exception 'Solicitud no encontrada'; end if;
  if v_solicitud.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue gestionada (estado actual: %)', v_solicitud.estado;
  end if;
  update solicitud_horario
  set estado = 'rechazada', revisado_por = auth.uid(), revisado_en = now(), motivo_rechazo = p_motivo
  where id = p_id
  returning * into v_solicitud;
  return v_solicitud;
end;
$$;

grant execute on function fn_rechazar_solicitud_horario to authenticated;

create or replace function fn_retirar_solicitud_horario(p_id uuid) returns solicitud_horario
language plpgsql security definer set search_path = public as $$
declare
  v_solicitud solicitud_horario;
begin
  select * into v_solicitud from solicitud_horario where id = p_id for update;
  if v_solicitud is null then raise exception 'Solicitud no encontrada'; end if;
  if not fn_es_admin() and v_solicitud.profesional_id <> auth.uid() then
    raise exception 'No autorizada para retirar esta solicitud';
  end if;
  if v_solicitud.estado <> 'pendiente' then
    raise exception 'Solo se puede retirar una solicitud pendiente (estado actual: %)', v_solicitud.estado;
  end if;
  update solicitud_horario set estado = 'retirada' where id = p_id returning * into v_solicitud;
  return v_solicitud;
end;
$$;

grant execute on function fn_retirar_solicitud_horario to authenticated;

-- ---------------------------------------------------------------------------
-- Solicitudes de bloqueo/ausencia: mismo principio — directo y aprobado si hay permiso,
-- pendiente si no. Un bloqueo directo revalida conflictos ANTES de guardarse (nunca cancela
-- ni mueve nada solo); una solicitud pendiente no revisa conflictos porque no afecta
-- disponibilidad todavía (se revisan al aprobar).
-- ---------------------------------------------------------------------------
create or replace function fn_solicitar_bloqueo(
  p_profesional_id uuid,
  p_tipo tipo_bloqueo_ausencia,
  p_desde timestamptz,
  p_hasta timestamptz,
  p_todo_el_dia boolean,
  p_motivo text
) returns bloqueo_ausencia
language plpgsql security definer set search_path = public as $$
declare
  v_bloqueo bloqueo_ausencia;
  v_puede_directo boolean;
  v_estado estado_solicitud;
  v_afectadas int;
begin
  if not fn_es_admin() and auth.uid() <> p_profesional_id then
    raise exception 'No autorizada para crear una ausencia de otra profesional';
  end if;
  if p_hasta <= p_desde then
    raise exception 'La fecha/hora final debe ser posterior a la inicial';
  end if;

  v_puede_directo := fn_es_admin() or fn_tiene_permiso('puede_editar_horario_propio');
  v_estado := case when v_puede_directo then 'aprobada' else 'pendiente' end;

  if v_puede_directo then
    select count(*) into v_afectadas from fn_reservas_afectadas_bloqueo(p_profesional_id, tstzrange(p_desde, p_hasta));
    if v_afectadas > 0 then
      raise exception 'Este bloqueo afecta % cita(s) existente(s). Reprograma, reasigna o cancélalas antes de continuar.', v_afectadas;
    end if;
  end if;

  insert into bloqueo_ausencia (profesional_id, rango, motivo, creado_por, tipo, todo_el_dia, estado, revisado_por, revisado_en)
  values (
    p_profesional_id, tstzrange(p_desde, p_hasta), p_motivo, auth.uid(), p_tipo, p_todo_el_dia, v_estado,
    case when v_puede_directo then auth.uid() else null end,
    case when v_puede_directo then now() else null end
  )
  returning * into v_bloqueo;

  return v_bloqueo;
end;
$$;

grant execute on function fn_solicitar_bloqueo to authenticated;

create or replace function fn_aprobar_solicitud_bloqueo(p_id uuid) returns bloqueo_ausencia
language plpgsql security definer set search_path = public as $$
declare
  v_bloqueo bloqueo_ausencia;
  v_afectadas int;
begin
  if not fn_es_admin() then
    raise exception 'Solo administración puede aprobar solicitudes';
  end if;

  select * into v_bloqueo from bloqueo_ausencia where id = p_id for update;
  if v_bloqueo is null then raise exception 'Solicitud no encontrada'; end if;
  if v_bloqueo.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue gestionada (estado actual: %)', v_bloqueo.estado;
  end if;

  select count(*) into v_afectadas from fn_reservas_afectadas_bloqueo(v_bloqueo.profesional_id, v_bloqueo.rango);
  if v_afectadas > 0 then
    raise exception 'Este cambio ahora afecta % cita(s). Revísalas antes de aprobar.', v_afectadas;
  end if;

  update bloqueo_ausencia
  set estado = 'aprobada', revisado_por = auth.uid(), revisado_en = now()
  where id = p_id
  returning * into v_bloqueo;

  return v_bloqueo;
end;
$$;

grant execute on function fn_aprobar_solicitud_bloqueo to authenticated;

create or replace function fn_rechazar_solicitud_bloqueo(p_id uuid, p_motivo text) returns bloqueo_ausencia
language plpgsql security definer set search_path = public as $$
declare
  v_bloqueo bloqueo_ausencia;
begin
  if not fn_es_admin() then
    raise exception 'Solo administración puede rechazar solicitudes';
  end if;
  select * into v_bloqueo from bloqueo_ausencia where id = p_id for update;
  if v_bloqueo is null then raise exception 'Solicitud no encontrada'; end if;
  if v_bloqueo.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue gestionada (estado actual: %)', v_bloqueo.estado;
  end if;

  update bloqueo_ausencia
  set estado = 'rechazada', revisado_por = auth.uid(), revisado_en = now(), motivo_rechazo = p_motivo
  where id = p_id
  returning * into v_bloqueo;

  return v_bloqueo;
end;
$$;

grant execute on function fn_rechazar_solicitud_bloqueo to authenticated;

create or replace function fn_retirar_solicitud_bloqueo(p_id uuid) returns bloqueo_ausencia
language plpgsql security definer set search_path = public as $$
declare
  v_bloqueo bloqueo_ausencia;
begin
  select * into v_bloqueo from bloqueo_ausencia where id = p_id for update;
  if v_bloqueo is null then raise exception 'Solicitud no encontrada'; end if;
  if not fn_es_admin() and v_bloqueo.profesional_id <> auth.uid() then
    raise exception 'No autorizada para retirar esta solicitud';
  end if;
  if v_bloqueo.estado <> 'pendiente' then
    raise exception 'Solo se puede retirar una solicitud pendiente (estado actual: %)', v_bloqueo.estado;
  end if;

  update bloqueo_ausencia set estado = 'retirada' where id = p_id returning * into v_bloqueo;
  return v_bloqueo;
end;
$$;

grant execute on function fn_retirar_solicitud_bloqueo to authenticated;
