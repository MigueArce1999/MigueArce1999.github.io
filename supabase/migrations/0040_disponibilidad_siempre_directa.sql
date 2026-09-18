-- 0040_disponibilidad_siempre_directa.sql
-- Decisión de negocio explícita: cada profesional administra su propio horario y sus
-- ausencias/bloqueos directamente, sin pasar por aprobación de administración. El flujo de
-- "solicitud pendiente" (0031/0032) queda sin uso a partir de ahora — nunca se borra el
-- historial ya creado (las filas 'pendiente'/'aprobada'/'rechazada' existentes siguen tal
-- cual), pero ninguna solicitud NUEVA nace pendiente: siempre se aplica de inmediato, igual
-- que ya hacía admin o quien tuviera puede_editar_horario_propio.
--
-- Se mantiene toda la validación de conflictos que ya tenía el camino "directo": si el cambio
-- afecta citas existentes, sigue bloqueado con un error claro (nunca mueve ni cancela una cita
-- sola). No se toca permiso.puede_editar_horario_propio ni fn_tiene_permiso — la columna queda
-- en el esquema sin efecto aquí, por si se necesita reactivar este flujo más adelante.

create or replace function fn_solicitar_horario(
  p_profesional_id uuid,
  p_intervalos jsonb,
  p_vigente_desde date,
  p_motivo text
) returns solicitud_horario
language plpgsql security definer set search_path = public as $$
declare
  v_solicitud solicitud_horario;
  v_afectadas int;
begin
  if not fn_es_admin() and auth.uid() <> p_profesional_id then
    raise exception 'No autorizada para cambiar el horario de otra profesional';
  end if;
  if p_vigente_desde < current_date then
    raise exception 'La fecha de vigencia no puede ser en el pasado';
  end if;

  select count(*) into v_afectadas from fn_reservas_afectadas_horario(p_profesional_id, p_intervalos, p_vigente_desde);
  if v_afectadas > 0 then
    raise exception 'Este cambio afecta % cita(s) existente(s). Reprograma, reasigna o cancélalas antes de continuar.', v_afectadas;
  end if;
  perform fn_aplicar_horario(p_profesional_id, p_intervalos, p_vigente_desde);

  insert into solicitud_horario (profesional_id, estado, intervalos, vigente_desde, motivo, creado_por, revisado_por, revisado_en)
  values (p_profesional_id, 'aprobada', p_intervalos, p_vigente_desde, p_motivo, auth.uid(), auth.uid(), now())
  returning * into v_solicitud;

  return v_solicitud;
end;
$$;

grant execute on function fn_solicitar_horario to authenticated;

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
  v_afectadas int;
begin
  if not fn_es_admin() and auth.uid() <> p_profesional_id then
    raise exception 'No autorizada para crear una ausencia de otra profesional';
  end if;
  if p_hasta <= p_desde then
    raise exception 'La fecha/hora final debe ser posterior a la inicial';
  end if;

  select count(*) into v_afectadas from fn_reservas_afectadas_bloqueo(p_profesional_id, tstzrange(p_desde, p_hasta));
  if v_afectadas > 0 then
    raise exception 'Este bloqueo afecta % cita(s) existente(s). Reprograma, reasigna o cancélalas antes de continuar.', v_afectadas;
  end if;

  insert into bloqueo_ausencia (profesional_id, rango, motivo, creado_por, tipo, todo_el_dia, estado, revisado_por, revisado_en)
  values (p_profesional_id, tstzrange(p_desde, p_hasta), p_motivo, auth.uid(), p_tipo, p_todo_el_dia, 'aprobada', auth.uid(), now())
  returning * into v_bloqueo;

  return v_bloqueo;
end;
$$;

grant execute on function fn_solicitar_bloqueo to authenticated;
