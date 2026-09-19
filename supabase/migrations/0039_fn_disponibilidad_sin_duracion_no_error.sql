-- 0039_fn_disponibilidad_sin_duracion_no_error.sql
-- Corrige una regresión: 0027 dejó duracion_minutos opcional a propósito ("un servicio nuevo
-- puede no tener todavía una duración confirmada... se devuelve una lista vacía, igual que un
-- día sin horario disponible, en vez de un mensaje confuso") pero 0032, al reescribir
-- fn_disponibilidad para agregar margen/anticipación/horizonte y la versión vigente de
-- horario, volvió a poner un `raise exception` cuando el servicio no tiene duración — lo
-- mismo que 0027 dijo explícitamente que había que evitar.
--
-- Esto se volvió mucho más frecuente ahora que fn_crear_servicio_rapido (0038) crea servicios
-- nuevos sin duración por defecto: cualquier intento de ver horarios disponibles para uno de
-- esos servicios (o para cualquier servicio real al que nunca se le configuró duración) tira
-- un error crudo de Postgres en vez de mostrar simplemente "sin horarios disponibles" — el
-- síntoma reportado de "no me deja agendar/reservar".
--
-- fn_disponibilidad_equipo llama a esta misma función por cada profesional (lateral join), así
-- que el arreglo aquí también corrige el flujo de "cualquier profesional" sin tocarlo aparte.

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
  if not found then
    raise exception 'Servicio % no existe', p_servicio_id;
  end if;
  if v_duracion is null then
    return; -- servicio real pero sin duración configurada todavía: sin horarios que ofrecer, no es un error
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
