-- 0069_glowdesk_live_admin_estado_equipo.sql
-- GlowDesk Live: la administradora puede marcar/quitar la disponibilidad manual de CUALQUIER
-- profesional de su local, no solo la suya — para el caso real de un salón donde una empleada no
-- siempre tiene la app abierta en su celular. fn_marcar_estado_manual/fn_limpiar_estado_manual
-- (0061) solo aceptaban auth.uid() como objetivo; se les agrega p_profesional_id (opcional, sigue
-- funcionando igual que antes para la propia profesional) con el mismo criterio de autorización
-- que el resto del proyecto: uno mismo, o un admin sobre alguien de su propio local.

-- Cambia de firma (se agrega p_profesional_id): "create or replace" NO reemplaza una función
-- cuando cambian sus parámetros, crea una sobrecarga aparte — y con parámetros por defecto de
-- por medio, una llamada con los 3 argumentos de siempre quedaría ambigua entre las dos. Hay que
-- borrar la versión vieja primero.
drop function if exists fn_marcar_estado_manual(text, int, text);
drop function if exists fn_limpiar_estado_manual();

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
  if p_estado not in ('descanso', 'almuerzo', 'no_disponible', 'ocupado_temporal') then
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

grant execute on function fn_marcar_estado_manual(text, int, text, uuid) to authenticated;

create or replace function fn_limpiar_estado_manual(p_profesional_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_objetivo uuid := coalesce(p_profesional_id, auth.uid());
  v_local uuid;
begin
  select local_id into v_local from profesional where id = v_objetivo;
  if v_local is null then
    raise exception 'Profesional no encontrada';
  end if;
  if v_objetivo <> auth.uid() and not (fn_es_admin() and v_local = fn_local_id()) then
    raise exception 'No autorizada para quitar la disponibilidad de esta profesional';
  end if;
  delete from profesional_estado_manual where profesional_id = v_objetivo;
end;
$$;

grant execute on function fn_limpiar_estado_manual(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Vista de equipo para el panel admin: a diferencia de fn_salon_en_vivo (pensada para la
-- clienta, apagada por completo si live_disponibilidad_activo es false), esta SIEMPRE responde
-- para quien administra — necesita ver y ajustar el estado del equipo incluso mientras decide si
-- prender la función pública o mientras la tiene apagada.
-- ---------------------------------------------------------------------------

create or replace function fn_estado_equipo_en_vivo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_local uuid := fn_local_id();
  v_prof record;
  v_resultado jsonb := '[]'::jsonb;
begin
  if not fn_es_admin() then
    raise exception 'No autorizada';
  end if;
  if v_local is null then
    raise exception 'Falta el identificador del local.';
  end if;

  for v_prof in
    select p.id, pf.nombre, p.foto_url
    from profesional p
    join perfil pf on pf.id = p.id
    where p.local_id = v_local and p.activo
    order by p.orden_visualizacion
  loop
    v_resultado := v_resultado || jsonb_build_object(
      'profesional_id', v_prof.id, 'nombre', v_prof.nombre, 'foto_url', v_prof.foto_url,
      'estado', fn_estado_profesional_ahora(v_prof.id)
    );
  end loop;

  return v_resultado;
end;
$$;

grant execute on function fn_estado_equipo_en_vivo to authenticated;
