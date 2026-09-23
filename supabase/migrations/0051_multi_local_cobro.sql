-- 0051_multi_local_cobro.sql
-- Ajusta fn_completar_y_cobrar_atencion (0048) al PK local_id de configuracion_fidelizacion.

create or replace function fn_completar_y_cobrar_atencion(
  p_atencion_id uuid,
  p_pagos jsonb,
  p_idempotency_key text,
  p_recompensa_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_ya_procesada atencion;
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
  v_config configuracion_fidelizacion;
  v_regla_puntos regla_puntos;
  v_recompensa recompensa;
  v_saldo_anterior numeric(12,2);
  v_descuento_recompensa numeric(12,2) := 0;
  v_canje_id uuid;
  v_puntos_ganados numeric(12,2) := 0;
  v_monto_elegible_bruto numeric(12,2) := 0;
  v_monto_elegible_neto numeric(12,2) := 0;
  v_saldo_nuevo numeric(12,2);
  v_meta recompensa;
begin
  select * into v_ya_procesada from atencion where idempotency_key = p_idempotency_key;
  if found then
    return fn_resultado_cobro(v_ya_procesada.id);
  end if;

  select * into v_atencion from atencion where id = p_atencion_id for update;
  if v_atencion is null then raise exception 'Atención no encontrada'; end if;
  if v_atencion.estado = 'completada' then
    raise exception 'La atención ya fue completada';
  end if;

  perform 1 from cliente where id = v_atencion.cliente_id for update;

  select coalesce(sum((precio_snapshot - descuento) * cantidad), 0) into v_total_servicios
  from atencion_servicio where atencion_id = p_atencion_id;
  select coalesce(sum(precio_unitario * cantidad), 0) into v_total_productos
  from atencion_producto where atencion_id = p_atencion_id;
  v_total_atencion := v_total_servicios + v_total_productos;

  select * into v_config from configuracion_fidelizacion where local_id = v_atencion.local_id;
  select * into v_regla_puntos from regla_puntos where activa and vigente_hasta is null and local_id = v_atencion.local_id limit 1;

  v_saldo_anterior := fn_saldo_puntos(v_atencion.cliente_id);

  if p_recompensa_id is not null then
    if coalesce(v_config.canjes_activo, false) is not true then
      raise exception 'Los canjes de fidelización están pausados por ahora.';
    end if;
    select * into v_recompensa from recompensa where id = p_recompensa_id and local_id = v_atencion.local_id for update;
    if v_recompensa is null or not v_recompensa.activa then
      raise exception 'Esa recompensa ya no está disponible.';
    end if;
    if not v_recompensa.stock_ilimitado and coalesce(v_recompensa.cantidad_disponible, 0) <= 0 then
      raise exception 'Esa recompensa se agotó.';
    end if;
    if v_saldo_anterior < v_recompensa.costo_puntos then
      raise exception 'No tienes suficientes puntos para esta recompensa.';
    end if;
    if v_recompensa.requiere_atencion_pagada and v_total_atencion <= 0 then
      raise exception 'Esta recompensa requiere una atención con servicios o productos cobrados.';
    end if;
    if v_recompensa.tipo = 'descuento_fijo' then
      v_descuento_recompensa := least(v_recompensa.monto_descuento, v_total_atencion);
    end if;
  end if;

  v_total_atencion := greatest(v_total_atencion - v_descuento_recompensa, 0);

  for v_pago in select jsonb_array_elements(p_pagos) loop
    insert into pago (atencion_id, metodo, monto, registrado_por)
    values (p_atencion_id, (v_pago ->> 'metodo')::metodo_pago, (v_pago ->> 'monto')::numeric, auth.uid());
    v_total_cobrado := v_total_cobrado + (v_pago ->> 'monto')::numeric;
  end loop;

  v_cobrado_servicios := case when v_total_atencion > 0
    then v_total_cobrado * (v_total_servicios / (v_total_servicios + v_total_productos))
    else 0 end;

  for v_linea in select * from atencion_servicio where atencion_id = p_atencion_id loop
    v_monto_cobrado_linea := case when v_total_servicios > 0
      then round(v_cobrado_servicios * ((v_linea.precio_snapshot - v_linea.descuento) * v_linea.cantidad) / v_total_servicios, 2)
      else 0 end;

    if v_monto_cobrado_linea > 0 then
      if v_linea.es_colaboracion then
        insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor)
        values (
          v_linea.id, v_linea.profesional_id,
          jsonb_build_object('tipo', 'colaboracion_100', 'valor', 100, 'origen', 'colaboracion'),
          v_monto_cobrado_linea, v_monto_cobrado_linea
        );
      else
        select * into v_regla from regla_comision
        where profesional_id = v_linea.profesional_id
          and (servicio_id = v_linea.servicio_id or servicio_id is null)
          and vigente_hasta is null
        order by servicio_id nulls last
        limit 1;
        v_regla_encontrada := found;

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

  if p_recompensa_id is not null then
    insert into canje_recompensa (cliente_id, recompensa_id, atencion_id, costo_puntos_snapshot, condiciones_snapshot, empleada_id, idempotency_key)
    values (
      v_atencion.cliente_id, v_recompensa.id, v_atencion.id, v_recompensa.costo_puntos,
      jsonb_build_object('nombre', v_recompensa.nombre, 'tipo', v_recompensa.tipo, 'condiciones', v_recompensa.condiciones,
                          'servicio_id', v_recompensa.servicio_id, 'monto_descuento', v_recompensa.monto_descuento),
      auth.uid(), p_idempotency_key || ':canje'
    )
    returning id into v_canje_id;

    insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, referencia_id, canje_id, clave_idempotencia, creado_por)
    values (v_atencion.cliente_id, 'canje', -v_recompensa.costo_puntos, 'canje', v_canje_id, v_canje_id, 'canje:' || v_canje_id, auth.uid());

    if not v_recompensa.stock_ilimitado then
      update recompensa set cantidad_disponible = cantidad_disponible - 1 where id = v_recompensa.id;
    end if;

    update atencion_servicio set recompensa_canje_id = v_canje_id
    where atencion_id = p_atencion_id and servicio_id = v_recompensa.servicio_id and precio_snapshot = 0
      and recompensa_canje_id is null;

    update cliente set meta_recompensa_id = null where id = v_atencion.cliente_id and meta_recompensa_id = v_recompensa.id;
  end if;

  if coalesce(v_config.acumulacion_activa, false) and v_regla_puntos.id is not null
     and v_regla_puntos.monto_por_bloque > 0 and v_regla_puntos.puntos_por_bloque > 0
     and v_total_cobrado >= v_total_atencion and v_total_atencion > 0 then

    select coalesce(sum((ase.precio_snapshot - ase.descuento) * ase.cantidad), 0) into v_monto_elegible_bruto
    from atencion_servicio ase join servicio s on s.id = ase.servicio_id
    where ase.atencion_id = p_atencion_id
      and not (s.categoria_id = any(v_regla_puntos.categorias_excluidas))
      and not (ase.servicio_id = any(v_regla_puntos.servicios_excluidos));
    if v_regla_puntos.incluye_productos then
      v_monto_elegible_bruto := v_monto_elegible_bruto + v_total_productos;
    end if;

    if (v_total_atencion + v_descuento_recompensa) > 0 then
      v_monto_elegible_neto := greatest(
        v_monto_elegible_bruto - round(v_descuento_recompensa * (v_monto_elegible_bruto / (v_total_atencion + v_descuento_recompensa)), 2),
        0
      );
    end if;

    v_puntos_ganados := floor(v_monto_elegible_neto / v_regla_puntos.monto_por_bloque) * v_regla_puntos.puntos_por_bloque;

    if v_puntos_ganados > 0 then
      insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, referencia_id, regla_aplicada, clave_idempotencia, creado_por)
      values (
        v_atencion.cliente_id, 'abono', v_puntos_ganados, 'atencion', v_atencion.id,
        jsonb_build_object(
          'monto_por_bloque', v_regla_puntos.monto_por_bloque, 'puntos_por_bloque', v_regla_puntos.puntos_por_bloque,
          'monto_elegible_neto', v_monto_elegible_neto, 'regla_puntos_id', v_regla_puntos.id
        ),
        'abono:' || v_atencion.id, auth.uid()
      );
    end if;
  end if;

  v_saldo_nuevo := fn_saldo_puntos(v_atencion.cliente_id);

  -- Snapshot + celebración del canje: se completa ACÁ (no dentro del bloque de arriba) porque
  -- necesita v_saldo_nuevo, que ya incluye el abono de esta misma atención si lo hubo (sección 10
  -- del pedido de celebración: "utilizaste 500 → ganaste 45 → ahora tienes 545", un solo evento).
  if v_canje_id is not null then
    update canje_recompensa set saldo_anterior = v_saldo_anterior, saldo_posterior = v_saldo_nuevo
    where id = v_canje_id;

    insert into notificacion_fidelizacion (cliente_id, tipo, titulo, mensaje, origen_tipo, origen_id, datos)
    values (
      v_atencion.cliente_id, 'canje_confirmado', '¡Disfruta tu recompensa!',
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
        'puntos_ganados_en_esta_atencion', v_puntos_ganados
      )
    )
    on conflict do nothing;
  end if;

  if v_puntos_ganados > 0 then
    insert into notificacion_fidelizacion (cliente_id, tipo, titulo, mensaje, origen_tipo, origen_id)
    values (
      v_atencion.cliente_id, 'puntos_ganados', '¡Ganaste puntos!',
      'Ganaste ' || v_puntos_ganados || ' puntos por tu visita.', 'atencion', v_atencion.id
    )
    on conflict do nothing;
  end if;

  select r.* into v_meta from cliente c join recompensa r on r.id = c.meta_recompensa_id where c.id = v_atencion.cliente_id;
  if v_meta.id is not null and v_saldo_nuevo >= v_meta.costo_puntos then
    insert into notificacion_fidelizacion (cliente_id, tipo, titulo, mensaje, origen_tipo, origen_id)
    values (
      v_atencion.cliente_id, 'meta_alcanzada', '¡Tu regalo ya está disponible!',
      'Ya tienes suficientes puntos para "' || v_meta.nombre || '".', 'atencion', v_atencion.id
    )
    on conflict do nothing;
  end if;

  return fn_resultado_cobro(v_atencion.id);
end;
$$;

grant execute on function fn_completar_y_cobrar_atencion to authenticated;
