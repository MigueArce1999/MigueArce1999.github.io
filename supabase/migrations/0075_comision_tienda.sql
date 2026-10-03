-- 0075_comision_tienda.sql
-- Comisión por venta de "Tienda": todo producto del Paso 3 de Atender marcado como vendido en
-- Tienda genera automáticamente una comisión (configurable, 10% por defecto) para quien lo
-- vendió — que NO necesariamente es la profesional que hizo el servicio de esa atención.
--
-- Decisión de arquitectura (incremental, reutilizando lo que ya existe — nunca un módulo
-- paralelo): se extiende `atencion_producto` (igual que ya tiene categoria/nombre/cantidad/
-- precio_unitario) con quién vendió y si fue venta de tienda, y se extiende la MISMA tabla
-- `comision` que ya usan los servicios (en vez de crear comision_producto aparte) agregando
-- atencion_producto_id como alternativa a atencion_servicio_id (exactamente una de las dos,
-- nunca las dos ni ninguna — constraint comision_origen_xor). Esto hace que TODO lo que ya lee
-- de `comision` — "pendientes" en Comisiones.tsx, fn_crear_liquidacion, fn_venta_protegida —
-- incluya las comisiones de tienda automáticamente, sin tocar esa lógica.

-- --------------------------------------------------------------------------------------------
-- 1. Porcentaje configurable (nunca hardcodeado en la UI) — mismo patrón que
--    tasa_puntos_por_defecto, ya en configuracion_negocio (una fila por local, 0012/0050).
-- --------------------------------------------------------------------------------------------
alter table configuracion_negocio
  add column comision_tienda_porcentaje numeric(5,2) not null default 10
  check (comision_tienda_porcentaje >= 0 and comision_tienda_porcentaje <= 100);

-- --------------------------------------------------------------------------------------------
-- 2. atencion_producto: quién vendió y si fue venta de Tienda. `es_venta_tienda` es la "fuente
--    de verdad" interna (nunca se compara contra el texto visible "Tienda") — mismo patrón ya
--    usado en el proyecto para flags de este tipo (atencion_servicio.es_colaboracion).
-- --------------------------------------------------------------------------------------------
alter table atencion_producto
  add column vendedora_id uuid references profesional (id) on delete restrict,
  add column es_venta_tienda boolean not null default false;

-- --------------------------------------------------------------------------------------------
-- 3. comision: alternativa a atencion_servicio_id para que una comisión pueda originarse en una
--    línea de producto en vez de una de servicio. "on delete restrict" como ya tiene
--    atencion_servicio_id (nunca cascade): fn_eliminar_venta borra la comisión explícitamente
--    ANTES de borrar la atención, para que el borrado nunca deje un registro de dinero huérfano
--    sin que el código que lo hizo lo haya decidido a propósito.
-- --------------------------------------------------------------------------------------------
alter table comision alter column atencion_servicio_id drop not null;
alter table comision add column atencion_producto_id uuid references atencion_producto (id) on delete restrict;
alter table comision add constraint comision_origen_xor
  check ((atencion_servicio_id is not null) <> (atencion_producto_id is not null));
create index comision_atencion_producto_idx on comision (atencion_producto_id);

-- --------------------------------------------------------------------------------------------
-- 4. fn_registrar_atencion: acepta vendedora_id/es_venta_tienda por producto. Validación en el
--    servidor (nunca solo en el formulario): una venta de tienda sin vendedora no se puede
--    registrar — "backend como fuente de verdad" también para esta regla, no solo para el
--    cálculo de la comisión.
-- --------------------------------------------------------------------------------------------
create or replace function fn_registrar_atencion(
  p_cliente_id uuid,
  p_reserva_id uuid,
  p_lineas jsonb, -- [{servicio_id, profesional_id, precio_snapshot?, descuento?, cantidad?, es_colaboracion?}]
  p_productos jsonb default '[]'::jsonb, -- [{categoria, nombre, cantidad?, precio_unitario, vendedora_id?, es_venta_tienda?}]
  p_notas text default null,
  p_borrador_key text default null
) returns atencion
language plpgsql security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_linea jsonb;
  v_producto jsonb;
  v_nombre text;
  v_precio numeric(12,2);
  v_precio_final numeric(12,2);
  v_descuento numeric(12,2);
  v_descuento_maximo_pct numeric(5,2);
  v_descuento_pct numeric(6,2);
  v_profesional_id uuid;
  v_es_colaboracion boolean;
  v_es_venta_tienda boolean;
  v_vendedora_id uuid;
begin
  if p_borrador_key is not null then
    select * into v_atencion from atencion where borrador_key = p_borrador_key;
    if found then
      return v_atencion;
    end if;
  end if;

  insert into atencion (reserva_id, cliente_id, creado_por, notas, borrador_key)
  values (p_reserva_id, p_cliente_id, auth.uid(), p_notas, p_borrador_key)
  returning * into v_atencion;

  for v_linea in select jsonb_array_elements(p_lineas) loop
    v_profesional_id := (v_linea ->> 'profesional_id')::uuid;
    v_es_colaboracion := coalesce((v_linea ->> 'es_colaboracion')::boolean, false);

    select nombre, precio into v_nombre, v_precio
    from servicio where id = (v_linea ->> 'servicio_id')::uuid;

    -- Cualquier cuenta de EMPLEADA (no solo admin/puede_caja/la propia profesional) puede
    -- registrar el servicio de una compañera: es el caso normal de registrar el ticket
    -- completo de una clienta con varias profesionales. Esto solo sigue bloqueando a una
    -- cuenta de clienta que intente invocar la función directamente.
    if not v_es_colaboracion and not fn_es_admin() and not fn_es_profesional(v_profesional_id)
       and not fn_tiene_permiso('puede_caja') and fn_rol_actual() <> 'empleada' then
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
        raise exception 'El descuento (%) excede tu límite autorizado (%)',
          round(v_descuento_pct, 1) || '%', round(coalesce(v_descuento_maximo_pct, 0), 1) || '%';
      end if;
    end if;

    insert into atencion_servicio (atencion_id, servicio_id, profesional_id, nombre_snapshot, precio_snapshot, descuento, cantidad, es_colaboracion)
    values (
      v_atencion.id,
      (v_linea ->> 'servicio_id')::uuid,
      v_profesional_id,
      v_nombre,
      v_precio_final,
      v_descuento,
      coalesce((v_linea ->> 'cantidad')::int, 1),
      v_es_colaboracion
    );
  end loop;

  for v_producto in select jsonb_array_elements(p_productos) loop
    v_es_venta_tienda := coalesce((v_producto ->> 'es_venta_tienda')::boolean, false);
    v_vendedora_id := (v_producto ->> 'vendedora_id')::uuid;

    if v_es_venta_tienda and v_vendedora_id is null then
      raise exception 'Selecciona quién realizó esta venta para continuar.';
    end if;

    insert into atencion_producto (atencion_id, categoria, nombre, cantidad, precio_unitario, vendedora_id, es_venta_tienda)
    values (
      v_atencion.id,
      v_producto ->> 'categoria',
      v_producto ->> 'nombre',
      coalesce((v_producto ->> 'cantidad')::int, 1),
      coalesce((v_producto ->> 'precio_unitario')::numeric, 0),
      v_vendedora_id,
      v_es_venta_tienda
    );
  end loop;

  return v_atencion;
end;
$$;

grant execute on function fn_registrar_atencion to authenticated;

-- --------------------------------------------------------------------------------------------
-- 5. fn_completar_y_cobrar_atencion: igual que cada línea de servicio genera su comisión
--    prorrateada contra lo efectivamente cobrado (nunca el precio nominal, por si hay pago
--    parcial), cada línea de producto marcada como venta de Tienda genera la suya — mismo
--    criterio, "fuente de verdad" es lo que de verdad entró a caja. El porcentaje se lee de
--    configuracion_negocio en ESTE instante y queda congelado dentro de regla_aplicada: un
--    cambio futuro del porcentaje nunca altera comisiones ya generadas (igual que
--    regla_comision ya hace para servicios).
-- --------------------------------------------------------------------------------------------
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
  v_cobrado_productos numeric(12,2) := 0;
  v_regla regla_comision;
  v_regla_encontrada boolean;
  v_monto_cobrado_linea numeric(12,2);
  v_valor_comision numeric(12,2);
  v_config configuracion_fidelizacion;
  v_config_negocio configuracion_negocio;
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
  select * into v_config_negocio from configuracion_negocio where local_id = v_atencion.local_id;
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
  v_cobrado_productos := v_total_cobrado - v_cobrado_servicios;

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

  -- Comisión de Tienda: una línea de producto marcada por quien registró como vendida en
  -- Tienda (0075). Igual que arriba, se prorratea contra lo EFECTIVAMENTE cobrado, no el
  -- precio nominal — y el porcentaje queda congelado en regla_aplicada en este instante.
  for v_linea in select * from atencion_producto where atencion_id = p_atencion_id and es_venta_tienda loop
    v_monto_cobrado_linea := case when v_total_productos > 0
      then round(v_cobrado_productos * (v_linea.precio_unitario * v_linea.cantidad) / v_total_productos, 2)
      else 0 end;

    if v_monto_cobrado_linea > 0 then
      v_valor_comision := round(v_monto_cobrado_linea * coalesce(v_config_negocio.comision_tienda_porcentaje, 10) / 100, 2);

      insert into comision (atencion_producto_id, profesional_id, regla_aplicada, base_calculo, valor)
      values (
        v_linea.id, v_linea.vendedora_id,
        jsonb_build_object('tipo', 'tienda_producto', 'porcentaje', coalesce(v_config_negocio.comision_tienda_porcentaje, 10), 'origen', 'tienda'),
        v_monto_cobrado_linea, v_valor_comision
      );
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

-- --------------------------------------------------------------------------------------------
-- 6. fn_venta_protegida / fn_eliminar_venta (0025): una comisión de tienda ya liquidada también
--    debe proteger la venta de ser borrada, y borrar una venta también debe borrar sus
--    comisiones de tienda (nunca dejarlas huérfanas) — mismo criterio que ya aplica a servicios.
-- --------------------------------------------------------------------------------------------
create or replace function fn_venta_protegida(p_atencion_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from atencion_servicio ase
    join comision c on c.atencion_servicio_id = ase.id
    where ase.atencion_id = p_atencion_id and c.estado = 'liquidada'
  ) or exists (
    select 1 from atencion_producto ap
    join comision c on c.atencion_producto_id = ap.id
    where ap.atencion_id = p_atencion_id and c.estado = 'liquidada'
  )
$$;

create or replace function fn_eliminar_venta(p_atencion_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cliente_id uuid;
begin
  if not fn_es_admin() then
    raise exception 'Solo administración puede borrar una venta';
  end if;

  select cliente_id into v_cliente_id from atencion where id = p_atencion_id;
  if v_cliente_id is null then
    raise exception 'La venta ya no existe';
  end if;

  if fn_venta_protegida(p_atencion_id) then
    raise exception 'Esta venta ya fue liquidada a la profesional; no se puede borrar. Habla con administración si de verdad hay que corregirla.';
  end if;

  -- Puntos ganados por esta venta: si la venta se anula, los puntos que generó también.
  delete from movimiento_puntos where referencia_tipo = 'atencion' and referencia_id = p_atencion_id;

  delete from comision
  where atencion_servicio_id in (select id from atencion_servicio where atencion_id = p_atencion_id);
  delete from comision
  where atencion_producto_id in (select id from atencion_producto where atencion_id = p_atencion_id);

  -- pago.atencion_id es "restrict" (no cascada): hay que borrarlo antes de la atención.
  delete from pago where atencion_id = p_atencion_id;

  -- atencion_servicio y atencion_producto cascadean desde atencion.
  delete from atencion where id = p_atencion_id;

  perform fn_recalcular_contadores_cliente(v_cliente_id);
end;
$$;

grant execute on function fn_eliminar_venta to authenticated;

-- --------------------------------------------------------------------------------------------
-- 7. fn_atencion_visible (0013): solo reconocía a la profesional de un SERVICIO de la atención
--    (atencion_servicio.profesional_id). Una vendedora de Tienda que no hizo ningún servicio en
--    esa misma atención (caso normal: Vale vende un producto en una atención que Naldi está
--    cobrando) quedaba sin "visibilidad" sobre esa atención ni su propia línea de
--    atencion_producto (atencion_select / atencion_producto_select usan esta misma función) —
--    aunque `comision_select` ya la dejaba ver la fila de comisión en sí. Mismo criterio que ya
--    existe para profesional_id, ahora también para vendedora_id.
-- --------------------------------------------------------------------------------------------
create or replace function fn_atencion_visible(p_atencion_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select fn_es_admin()
    or fn_tiene_permiso('puede_caja')
    or exists (
      select 1 from atencion_servicio ase where ase.atencion_id = p_atencion_id and ase.profesional_id = auth.uid()
    )
    or exists (
      select 1 from atencion_producto ap where ap.atencion_id = p_atencion_id and ap.vendedora_id = auth.uid()
    )
    or exists (
      select 1 from atencion a where a.id = p_atencion_id and fn_es_mi_cliente(a.cliente_id)
    )
$$;

-- --------------------------------------------------------------------------------------------
-- 8. vista_comision (0015): tenía un INNER JOIN contra atencion_servicio, así que cualquier
--    comisión de tienda (atencion_servicio_id null) quedaba invisible en "Mis ventas y
--    ganancias" de la propia profesional (empleada/Ventas.tsx vía listarComisiones) aunque RLS
--    ya le permite ver esa fila — no es un módulo paralelo, es la MISMA vista con left joins
--    para cubrir también el origen de producto.
-- --------------------------------------------------------------------------------------------
drop view if exists vista_comision;
create view vista_comision with (security_invoker = true) as
select
  co.id, co.atencion_servicio_id, co.atencion_producto_id, co.profesional_id, co.base_calculo,
  co.valor, co.estado, co.creado_en,
  ase.nombre_snapshot as servicio_nombre,
  ap.nombre as producto_nombre,
  coalesce(a_serv.cliente_id, a_prod.cliente_id) as cliente_id,
  c.nombre as cliente_nombre
from comision co
left join atencion_servicio ase on ase.id = co.atencion_servicio_id
left join atencion a_serv on a_serv.id = ase.atencion_id
left join atencion_producto ap on ap.id = co.atencion_producto_id
left join atencion a_prod on a_prod.id = ap.atencion_id
join cliente c on c.id = coalesce(a_serv.cliente_id, a_prod.cliente_id);

grant select on vista_comision to anon, authenticated;
