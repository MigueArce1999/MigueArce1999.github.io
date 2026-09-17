-- 0027_servicio_precio_maximo_y_duracion_opcional.sql
-- Dos cambios para poder cargar un catálogo real sin inventar datos que no se tienen:
--
-- 1) precio_maximo: para tipo_precio = 'rango' ("$100.000–$200.000"), precio guarda el
--    extremo inferior y esta columna nueva el superior. Sigue null para 'fijo'/'desde'
--    (un solo número) y para 'a_valorar' (sin número).
--
-- 2) duracion_minutos pasa a ser opcional: un servicio nuevo puede no tener todavía una
--    duración confirmada. Sigue siendo obligatoria para reservar en línea (fn_crear_reserva
--    ya rechaza limpiamente un servicio sin duración con "Servicio no disponible"; ver el
--    ajuste a fn_disponibilidad más abajo para el mismo caso al listar horarios) pero un
--    servicio sin duración se puede seleccionar igual al registrar una atención directa
--    (Atender), que nunca depende de este campo.

alter table servicio add column precio_maximo numeric(12, 2);

alter table servicio drop constraint servicio_precio_requerido;
alter table servicio add constraint servicio_precio_requerido check (
  (tipo_precio = 'a_valorar' and precio is null and precio_maximo is null)
  or (tipo_precio = 'rango' and precio is not null and precio >= 0 and precio_maximo is not null and precio_maximo > precio)
  or (tipo_precio in ('fijo', 'desde') and precio is not null and precio >= 0 and precio_maximo is null)
);

alter table servicio alter column duracion_minutos drop not null;
alter table servicio drop constraint servicio_duracion_minutos_check;
alter table servicio add constraint servicio_duracion_minutos_check check (duracion_minutos is null or duracion_minutos > 0);

-- fn_disponibilidad ya se llama para el sitio público (buscar horarios libres antes de
-- reservar). Antes de este cambio, "duración null" solo podía significar "el servicio no
-- existe" (la columna era NOT NULL); ahora también puede significar "existe, pero todavía no
-- tiene duración configurada" — en ese caso no hay slots que ofrecer (nunca fue pensado para
-- reservarse en línea), pero eso no es un error: se devuelve una lista vacía, igual que un día
-- sin horario disponible, en vez de un mensaje confuso de "el servicio no existe".
create or replace function fn_disponibilidad(
  p_servicio_id uuid,
  p_profesional_id uuid,
  p_fecha date
) returns table (inicio timestamptz, fin timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_duracion int;
  v_dow int;
begin
  select duracion_minutos into v_duracion from servicio where id = p_servicio_id;
  if not found then
    raise exception 'Servicio % no existe', p_servicio_id;
  end if;
  if v_duracion is null then
    return;
  end if;

  -- p_fecha es la fecha de calendario del negocio (America/Bogota); no se convierte de zona
  -- horaria aquí porque es un `date` sin componente horaria, no un instante.
  v_dow := extract(dow from p_fecha);

  return query
  with horarios as (
    select
      (p_fecha::timestamp + h.hora_inicio) at time zone 'America/Bogota' as inicio_jornada,
      (p_fecha::timestamp + h.hora_fin) at time zone 'America/Bogota' as fin_jornada
    from horario_disponibilidad h
    where h.profesional_id = p_profesional_id and h.dia_semana = v_dow and h.activo
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
  where not exists (
    select 1 from bloqueo_ausencia b
    where b.profesional_id = p_profesional_id
      and b.rango && tstzrange(s.inicio, s.fin)
  )
  and not exists (
    select 1 from reserva r
    where r.profesional_id = p_profesional_id
      and r.estado not in ('cancelada', 'no_asistio')
      and r.rango && tstzrange(s.inicio, s.fin)
  )
  order by s.inicio;
end;
$$;
