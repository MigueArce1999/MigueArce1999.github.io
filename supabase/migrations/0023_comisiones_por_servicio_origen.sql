-- 0023_comisiones_por_servicio_origen.sql
-- La resolución de comisión por profesional + servicio (excepción específica primero, regla
-- general de la profesional como respaldo) YA existe desde 0006/0013/0020:
-- regla_comision.servicio_id null = regla general; un índice único ya impide dos reglas
-- vigentes para la misma combinación profesional+servicio (regla_comision_vigente_unica_idx);
-- y fn_completar_y_cobrar_atencion ya prioriza "servicio_id = X" sobre "servicio_id is null"
-- con "order by servicio_id nulls last limit 1". Esta migración solo:
--   1. Acota un porcentaje (tipo='porcentaje') a un máximo de 100 — antes solo se validaba
--      valor >= 0, sin techo (un valor fijo en COP sí puede superar 100 sin problema).
--   2. Dentro del snapshot que ya se guarda por comisión (regla_aplicada, auditable e
--      inmutable), agrega un campo "origen" ('base' | 'excepcion') explícito, para no
--      depender de inferirlo leyendo si "servicio_id" quedó en null dentro del snapshot.

alter table regla_comision
  add constraint regla_comision_porcentaje_maximo check (tipo <> 'porcentaje' or valor <= 100);

create or replace function fn_completar_y_cobrar_atencion(
  p_atencion_id uuid,
  p_pagos jsonb,
  p_idempotency_key text
) returns atencion
language plpgsql security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_linea record;
  v_pago jsonb;
  v_total_servicios numeric(12,2) := 0;
  v_total_productos numeric(12,2) := 0;
  v_total_atencion numeric(12,2) := 0;
  v_total_cobrado numeric(12,2) := 0;
  v_cobrado_servicios numeric(12,2) := 0;
  v_regla regla_comision;
  v_regla_encontrada boolean;
  v_monto_cobrado_linea numeric(12,2);
  v_valor_comision numeric(12,2);
  v_tasa_puntos numeric(8,4);
  v_ya_procesada atencion;
begin
  select * into v_ya_procesada from atencion where idempotency_key = p_idempotency_key;
  if found then
    return v_ya_procesada;
  end if;

  select * into v_atencion from atencion where id = p_atencion_id for update;
  if v_atencion is null then raise exception 'Atención no encontrada'; end if;
  if v_atencion.estado = 'completada' then
    raise exception 'La atención ya fue completada';
  end if;

  select coalesce(sum((precio_snapshot - descuento) * cantidad), 0) into v_total_servicios
  from atencion_servicio where atencion_id = p_atencion_id;
  select coalesce(sum(precio_unitario * cantidad), 0) into v_total_productos
  from atencion_producto where atencion_id = p_atencion_id;
  v_total_atencion := v_total_servicios + v_total_productos;

  for v_pago in select jsonb_array_elements(p_pagos) loop
    insert into pago (atencion_id, metodo, monto, registrado_por)
    values (p_atencion_id, (v_pago ->> 'metodo')::metodo_pago, (v_pago ->> 'monto')::numeric, auth.uid());
    v_total_cobrado := v_total_cobrado + (v_pago ->> 'monto')::numeric;
  end loop;

  -- Porción del cobro que corresponde a servicios (el resto es de productos, sin comisión).
  v_cobrado_servicios := case when v_total_atencion > 0
    then v_total_cobrado * (v_total_servicios / v_total_atencion)
    else 0 end;

  for v_linea in select * from atencion_servicio where atencion_id = p_atencion_id loop
    v_monto_cobrado_linea := case when v_total_servicios > 0
      then round(v_cobrado_servicios * ((v_linea.precio_snapshot - v_linea.descuento) * v_linea.cantidad) / v_total_servicios, 2)
      else 0 end;

    if v_monto_cobrado_linea > 0 then
      if v_linea.es_colaboracion then
        -- Ganancia completa (100%) para quien colaboró: no se consulta regla_comision (regla
        -- de negocio ya decidida en 0020, sin relación con la comisión "normal").
        insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor)
        values (
          v_linea.id, v_linea.profesional_id,
          jsonb_build_object('tipo', 'colaboracion_100', 'valor', 100, 'origen', 'colaboracion'),
          v_monto_cobrado_linea, v_monto_cobrado_linea
        );
      else
        -- Prioridad: excepción específica del servicio primero, regla general como respaldo.
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

        -- Si no hay ninguna regla (ni excepción ni general), NO se inventa un porcentaje ni
        -- se asume 0%: simplemente no se genera comisión para esta línea (queda pendiente de
        -- que administración configure una regla; ver docs/02-roles-y-permisos.md).
        if v_regla_encontrada then
          v_valor_comision := case when v_regla.tipo = 'porcentaje'
            then round(v_monto_cobrado_linea * v_regla.valor / 100, 2)
            else v_regla.valor end;

          insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor)
          values (
            v_linea.id, v_linea.profesional_id,
            to_jsonb(v_regla) || jsonb_build_object('origen', case when v_regla.servicio_id is null then 'base' else 'excepcion' end),
            v_monto_cobrado_linea, v_valor_comision
          );
        end if;
      end if;
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
