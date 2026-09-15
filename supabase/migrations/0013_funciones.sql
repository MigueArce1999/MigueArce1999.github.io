-- 0013_funciones.sql
-- Funciones RPC que concentran toda la lógica sensible (disponibilidad, reservas, cobro,
-- comisiones, liquidaciones, puntos). El frontend nunca escribe estas tablas directamente
-- para dinero: siempre llama a estas funciones vía supabase.rpc(...).

-- ---------------------------------------------------------------------------
-- Helpers de rol / pertenencia
-- ---------------------------------------------------------------------------

create or replace function fn_rol_actual() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfil where id = auth.uid()
$$;

create or replace function fn_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(fn_rol_actual() = 'admin', false)
$$;

create or replace function fn_es_profesional(p_profesional_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() = p_profesional_id, false)
$$;

create or replace function fn_tiene_permiso(p_columna text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_resultado boolean;
begin
  if fn_es_admin() then
    return true;
  end if;
  execute format('select %I from permiso where perfil_id = $1', p_columna)
    into v_resultado using auth.uid();
  return coalesce(v_resultado, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Predicados de pertenencia usados por RLS (0014_rls.sql).
--
-- Se definen como funciones SECURITY DEFINER (bypassean RLS, igual que fn_es_admin())
-- en vez de subconsultas inline en las policies, porque cliente/reserva/atencion/
-- atencion_servicio se referencian entre sí: una policy de `cliente` que hace un EXISTS
-- directo contra `reserva`, cuya propia policy hace un EXISTS contra `cliente`, produce
-- "infinite recursion detected in policy" en Postgres. Al mover la subconsulta a una
-- función SECURITY DEFINER, esa lectura interna corre como dueña de las tablas (sin RLS)
-- y el ciclo se rompe.
-- ---------------------------------------------------------------------------

create or replace function fn_es_mi_cliente(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cliente where id = p_cliente_id and usuario_id = auth.uid()
  )
$$;

create or replace function fn_profesional_atendio_cliente(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from atencion_servicio ase
    join atencion a on a.id = ase.atencion_id
    where a.cliente_id = p_cliente_id and ase.profesional_id = auth.uid()
  ) or exists (
    select 1 from reserva r where r.cliente_id = p_cliente_id and r.profesional_id = auth.uid()
  )
$$;

create or replace function fn_atencion_visible(p_atencion_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select fn_es_admin()
    or fn_tiene_permiso('puede_caja')
    or exists (
      select 1 from atencion_servicio ase where ase.atencion_id = p_atencion_id and ase.profesional_id = auth.uid()
    )
    or exists (
      select 1 from atencion a where a.id = p_atencion_id and fn_es_mi_cliente(a.cliente_id)
    )
$$;

grant execute on function fn_es_mi_cliente to authenticated;
grant execute on function fn_profesional_atendio_cliente to authenticated;
grant execute on function fn_atencion_visible to authenticated;

-- ---------------------------------------------------------------------------
-- Disponibilidad
-- ---------------------------------------------------------------------------

-- Devuelve los slots libres de una profesional para un servicio en una fecha (día completo, zona Bogotá).
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
  if v_duracion is null then
    raise exception 'Servicio % no existe', p_servicio_id;
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

grant execute on function fn_disponibilidad to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Crear reserva (revalida disponibilidad dentro de la misma transacción)
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
begin
  select duracion_minutos, precio, tipo_precio into v_duracion, v_precio, v_tipo_precio
  from servicio where id = p_servicio_id and activo;
  if v_duracion is null then
    raise exception 'Servicio no disponible';
  end if;

  select modo_confirmacion into v_modo from configuracion_negocio;
  v_fin := p_inicio + make_interval(mins => v_duracion);
  v_estado := case when v_modo = 'automatica' then 'confirmada' else 'pendiente' end;

  -- El EXCLUDE constraint de `reserva` es la garantía definitiva anti-solapamiento;
  -- esta verificación explícita solo sirve para devolver un mensaje de error legible.
  if exists (
    select 1 from reserva
    where profesional_id = p_profesional_id
      and estado not in ('cancelada', 'no_asistio')
      and rango && tstzrange(p_inicio, v_fin)
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

-- ---------------------------------------------------------------------------
-- Reprogramar / cancelar
-- ---------------------------------------------------------------------------

create or replace function fn_reprogramar_reserva(
  p_reserva_id uuid,
  p_nuevo_inicio timestamptz
) returns reserva
language plpgsql security definer set search_path = public as $$
declare
  v_reserva reserva;
  v_duracion int;
  v_nuevo_fin timestamptz;
  v_limite_horas int;
  v_anterior jsonb;
begin
  select r.* into v_reserva from reserva r where r.id = p_reserva_id for update;
  if v_reserva is null then raise exception 'Reserva no encontrada'; end if;
  v_anterior := to_jsonb(v_reserva);

  select duracion_minutos into v_duracion from servicio where id = v_reserva.servicio_id;
  select cancelacion_horas_limite into v_limite_horas from configuracion_negocio;

  if not fn_es_admin() and not fn_tiene_permiso('puede_saltar_politica_cancelacion') then
    if lower(v_reserva.rango) - now() < make_interval(hours => v_limite_horas) then
      raise exception 'Fuera de la ventana permitida para reprogramar (% horas antes)', v_limite_horas;
    end if;
  end if;

  v_nuevo_fin := p_nuevo_inicio + make_interval(mins => v_duracion);

  update reserva
  set rango = tstzrange(p_nuevo_inicio, v_nuevo_fin), actualizado_en = now()
  where id = p_reserva_id
  returning * into v_reserva;

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_anterior, valor_nuevo)
  values (p_reserva_id, 'reprogramada', auth.uid(), v_anterior, to_jsonb(v_reserva));

  return v_reserva;
end;
$$;

grant execute on function fn_reprogramar_reserva to authenticated;

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

  select cancelacion_horas_limite into v_limite_horas from configuracion_negocio;
  if not fn_es_admin() and not fn_tiene_permiso('puede_saltar_politica_cancelacion') then
    if lower(v_reserva.rango) - now() < make_interval(hours => v_limite_horas) then
      raise exception 'Fuera de la ventana permitida para cancelar (% horas antes)', v_limite_horas;
    end if;
  end if;

  update reserva set estado = 'cancelada', actualizado_en = now() where id = p_reserva_id
  returning * into v_reserva;

  insert into reserva_evento (reserva_id, tipo, usuario_id, valor_anterior, valor_nuevo, motivo)
  values (p_reserva_id, 'cancelada', auth.uid(), v_anterior, to_jsonb(v_reserva), p_motivo);

  return v_reserva;
end;
$$;

grant execute on function fn_cancelar_reserva to authenticated;

create or replace function fn_liberar_reservas_pendientes_vencidas() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_minutos int;
  v_afectadas int;
begin
  select reserva_pendiente_expira_minutos into v_minutos from configuracion_negocio;

  with vencidas as (
    update reserva
    set estado = 'cancelada', actualizado_en = now()
    where estado = 'pendiente' and creado_en + make_interval(mins => v_minutos) < now()
    returning id
  )
  select count(*) into v_afectadas from vencidas;

  insert into reserva_evento (reserva_id, tipo, motivo)
  select id, 'cancelada', 'vencida_sin_confirmar' from reserva
  where estado = 'cancelada' and actualizado_en > now() - interval '1 minute';

  return v_afectadas;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registrar atención sin cita
-- ---------------------------------------------------------------------------

create or replace function fn_registrar_atencion(
  p_cliente_id uuid,
  p_reserva_id uuid,
  p_lineas jsonb -- [{servicio_id, profesional_id, descuento?, cantidad?}]
) returns atencion
language plpgsql security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_linea jsonb;
  v_nombre text;
  v_precio numeric(12,2);
  v_precio_final numeric(12,2);
  v_descuento numeric(12,2);
  v_descuento_maximo_pct numeric(5,2);
  v_descuento_pct numeric(6,2);
begin
  insert into atencion (reserva_id, cliente_id, creado_por)
  values (p_reserva_id, p_cliente_id, auth.uid())
  returning * into v_atencion;

  for v_linea in select jsonb_array_elements(p_lineas) loop
    select nombre, precio into v_nombre, v_precio
    from servicio where id = (v_linea ->> 'servicio_id')::uuid;

    if not fn_es_admin() and not fn_es_profesional((v_linea ->> 'profesional_id')::uuid)
       and not fn_tiene_permiso('puede_caja') then
      raise exception 'No autorizada para registrar servicios de otra profesional';
    end if;

    v_precio_final := coalesce((v_linea ->> 'precio_snapshot')::numeric, v_precio, 0);
    v_descuento := coalesce((v_linea ->> 'descuento')::numeric, 0);

    -- Un descuento fuera del límite autorizado (permiso.puede_descuentos_hasta, en %) se
    -- rechaza para cualquiera que no sea admin; evita que una empleada aplique descuentos
    -- por su cuenta más allá de lo que administración le permitió (ver docs/02-roles-y-permisos.md).
    if v_descuento > 0 and not fn_es_admin() then
      select puede_descuentos_hasta into v_descuento_maximo_pct from permiso where perfil_id = auth.uid();
      v_descuento_pct := case when v_precio_final > 0 then (v_descuento / v_precio_final) * 100 else 0 end;
      if v_descuento_pct > coalesce(v_descuento_maximo_pct, 0) then
        -- RAISE solo soporta sustitución simple de %, no especificadores tipo printf (%.1f);
        -- por eso se redondea antes con round(...) y el símbolo % se concatena en el propio valor.
        raise exception 'El descuento (%) excede tu límite autorizado (%)',
          round(v_descuento_pct, 1) || '%', round(coalesce(v_descuento_maximo_pct, 0), 1) || '%';
      end if;
    end if;

    insert into atencion_servicio (atencion_id, servicio_id, profesional_id, nombre_snapshot, precio_snapshot, descuento, cantidad)
    values (
      v_atencion.id,
      (v_linea ->> 'servicio_id')::uuid,
      (v_linea ->> 'profesional_id')::uuid,
      v_nombre,
      v_precio_final,
      v_descuento,
      coalesce((v_linea ->> 'cantidad')::int, 1)
    );
  end loop;

  return v_atencion;
end;
$$;

grant execute on function fn_registrar_atencion to authenticated;

-- ---------------------------------------------------------------------------
-- Completar y cobrar: el corazón transaccional e idempotente del sistema
-- ---------------------------------------------------------------------------

create or replace function fn_completar_y_cobrar_atencion(
  p_atencion_id uuid,
  p_pagos jsonb, -- [{metodo, monto}]
  p_idempotency_key text
) returns atencion
language plpgsql security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_linea record;
  v_pago jsonb;
  v_total_atencion numeric(12,2) := 0;
  v_total_cobrado numeric(12,2) := 0;
  v_regla regla_comision;
  v_regla_encontrada boolean;
  v_monto_cobrado_linea numeric(12,2);
  v_valor_comision numeric(12,2);
  v_tasa_puntos numeric(8,4);
  v_ya_procesada atencion;
begin
  -- Idempotencia: un reintento con la misma clave no vuelve a escribir nada.
  -- Nota: se usa FOUND (no "v_ya_procesada is not null") porque una fila real de `atencion`
  -- casi siempre tiene algún campo nulo (p. ej. notas); para un tipo compuesto, "IS NOT NULL"
  -- solo es verdadero si TODOS los campos son no nulos, así que esa comparación da un falso
  -- negativo con una fila real y rompería la idempotencia.
  select * into v_ya_procesada from atencion where idempotency_key = p_idempotency_key;
  if found then
    return v_ya_procesada;
  end if;

  select * into v_atencion from atencion where id = p_atencion_id for update;
  if v_atencion is null then raise exception 'Atención no encontrada'; end if;
  if v_atencion.estado = 'completada' then
    raise exception 'La atención ya fue completada';
  end if;

  select coalesce(sum((precio_snapshot - descuento) * cantidad), 0) into v_total_atencion
  from atencion_servicio where atencion_id = p_atencion_id;

  for v_pago in select jsonb_array_elements(p_pagos) loop
    insert into pago (atencion_id, metodo, monto, registrado_por)
    values (p_atencion_id, (v_pago ->> 'metodo')::metodo_pago, (v_pago ->> 'monto')::numeric, auth.uid());
    v_total_cobrado := v_total_cobrado + (v_pago ->> 'monto')::numeric;
  end loop;

  -- Comisión por línea, prorrateando el cobro total sobre el peso de cada línea en el total.
  for v_linea in select * from atencion_servicio where atencion_id = p_atencion_id loop
    v_monto_cobrado_linea := case when v_total_atencion > 0
      then round(v_total_cobrado * ((v_linea.precio_snapshot - v_linea.descuento) * v_linea.cantidad) / v_total_atencion, 2)
      else 0 end;

    select * into v_regla from regla_comision
    where profesional_id = v_linea.profesional_id
      and (servicio_id = v_linea.servicio_id or servicio_id is null)
      and vigente_hasta is null
    order by servicio_id nulls last
    limit 1;
    -- FOUND, no "v_regla is not null": una regla general válida tiene servicio_id y
    -- vigente_hasta en null a la vez, así que "IS NOT NULL" del registro completo
    -- daría falso incluso habiendo encontrado la regla.
    v_regla_encontrada := found;

    if v_regla_encontrada and v_monto_cobrado_linea > 0 then
      v_valor_comision := case when v_regla.tipo = 'porcentaje'
        then round(v_monto_cobrado_linea * v_regla.valor / 100, 2)
        else v_regla.valor end;

      insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor)
      values (v_linea.id, v_linea.profesional_id, to_jsonb(v_regla), v_monto_cobrado_linea, v_valor_comision);
    end if;
  end loop;

  update atencion
  set estado = 'completada', completado_en = now(), idempotency_key = p_idempotency_key
  where id = p_atencion_id
  returning * into v_atencion;

  if v_atencion.reserva_id is not null then
    update reserva set estado = 'completada', actualizado_en = now() where id = v_atencion.reserva_id;
  end if;

  -- Puntos solo si el pago cubre el total (evita otorgar puntos sobre dinero no recibido).
  if v_total_cobrado >= v_total_atencion and v_total_atencion > 0 then
    select tasa into v_tasa_puntos from regla_puntos where activa and vigente_hasta is null limit 1;
    if v_tasa_puntos is not null then
      insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, referencia_id, creado_por)
      values (v_atencion.cliente_id, 'abono', round(v_total_cobrado * v_tasa_puntos, 2), 'atencion', v_atencion.id, auth.uid());
    end if;
  end if;

  return v_atencion;
end;
$$;

grant execute on function fn_completar_y_cobrar_atencion to authenticated;

-- ---------------------------------------------------------------------------
-- Devolución
-- ---------------------------------------------------------------------------

create or replace function fn_registrar_devolucion(
  p_pago_id uuid,
  p_monto numeric,
  p_motivo text
) returns pago
language plpgsql security definer set search_path = public as $$
declare
  v_pago_original pago;
  v_devolucion pago;
  v_atencion_id uuid;
  v_comision_original comision;
  v_proporcion numeric;
  v_puntos_originales numeric;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_anular_ventas') then
    raise exception 'No autorizada para registrar devoluciones';
  end if;

  select * into v_pago_original from pago where id = p_pago_id;
  if v_pago_original is null then raise exception 'Pago no encontrado'; end if;
  if p_monto > v_pago_original.monto then
    raise exception 'El monto a devolver no puede superar el pago original';
  end if;

  insert into pago (atencion_id, metodo, monto, referencia_pago_id, registrado_por)
  values (v_pago_original.atencion_id, v_pago_original.metodo, -p_monto, p_pago_id, auth.uid())
  returning * into v_devolucion;

  v_proporcion := p_monto / v_pago_original.monto;

  for v_comision_original in
    select c.* from comision c
    join atencion_servicio a on a.id = c.atencion_servicio_id
    where a.atencion_id = v_pago_original.atencion_id and c.valor > 0
  loop
    insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor, referencia_devolucion_id, estado)
    values (
      v_comision_original.atencion_servicio_id,
      v_comision_original.profesional_id,
      v_comision_original.regla_aplicada,
      -round(v_comision_original.base_calculo * v_proporcion, 2),
      -round(v_comision_original.valor * v_proporcion, 2),
      v_comision_original.id,
      'generada' -- si la original ya estaba liquidada, esta reversión se descuenta en la próxima liquidación
    );
  end loop;

  select cliente_id into v_atencion_id from atencion where id = v_pago_original.atencion_id;
  select coalesce(sum(puntos), 0) into v_puntos_originales
  from movimiento_puntos where referencia_tipo = 'atencion' and referencia_id = v_pago_original.atencion_id;

  if v_puntos_originales > 0 then
    insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, referencia_id, motivo, creado_por)
    values (v_atencion_id, 'reversion', -round(v_puntos_originales * v_proporcion, 2), 'atencion', v_pago_original.atencion_id, p_motivo, auth.uid());
  end if;

  return v_devolucion;
end;
$$;

grant execute on function fn_registrar_devolucion to authenticated;

-- ---------------------------------------------------------------------------
-- Liquidación de comisiones
-- ---------------------------------------------------------------------------

create or replace function fn_crear_liquidacion(
  p_profesional_id uuid,
  p_periodo_inicio date,
  p_periodo_fin date
) returns liquidacion
language plpgsql security definer set search_path = public as $$
declare
  v_liquidacion liquidacion;
  v_total numeric(12,2);
begin
  if not fn_es_admin() then
    raise exception 'Solo administración puede liquidar comisiones';
  end if;

  select coalesce(sum(c.valor), 0) into v_total
  from comision c
  where c.profesional_id = p_profesional_id
    and c.estado = 'generada'
    and c.creado_en::date between p_periodo_inicio and p_periodo_fin;

  insert into liquidacion (profesional_id, periodo_inicio, periodo_fin, importe_total, responsable_id)
  values (p_profesional_id, p_periodo_inicio, p_periodo_fin, v_total, auth.uid())
  returning * into v_liquidacion;

  insert into liquidacion_detalle (liquidacion_id, comision_id)
  select v_liquidacion.id, c.id
  from comision c
  where c.profesional_id = p_profesional_id
    and c.estado = 'generada'
    and c.creado_en::date between p_periodo_inicio and p_periodo_fin;

  update comision set estado = 'liquidada'
  where id in (select comision_id from liquidacion_detalle where liquidacion_id = v_liquidacion.id);

  return v_liquidacion;
end;
$$;

grant execute on function fn_crear_liquidacion to authenticated;

-- ---------------------------------------------------------------------------
-- Ajuste manual de puntos (admin, motivo obligatorio)
-- ---------------------------------------------------------------------------

create or replace function fn_ajustar_puntos(
  p_cliente_id uuid,
  p_puntos numeric,
  p_motivo text
) returns movimiento_puntos
language plpgsql security definer set search_path = public as $$
declare
  v_movimiento movimiento_puntos;
begin
  if not fn_es_admin() then
    raise exception 'Solo administración puede ajustar puntos';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'El ajuste de puntos requiere un motivo';
  end if;

  insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, motivo, creado_por)
  values (p_cliente_id, 'ajuste', p_puntos, 'ajuste_manual', p_motivo, auth.uid())
  returning * into v_movimiento;

  return v_movimiento;
end;
$$;

grant execute on function fn_ajustar_puntos to authenticated;
