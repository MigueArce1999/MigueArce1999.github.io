-- 0020_colaborador_como_servicio.sql
-- Cambio de modelo de negocio para "colaborador" (decisión explícita del negocio): en vez de
-- ser una distribución interna que sale del mismo precio del servicio principal, ahora un
-- colaborador se registra como su PROPIA línea de servicio, adicional a la cuenta de la
-- clienta, y su valor asignado es su ganancia completa (100%, sin aplicar ninguna regla de
-- comisión por encima). Ejemplo: un blower de $40.000 más un corte hecho por otra persona
-- por $10.000 → la clienta paga $50.000 en total, y a quien hizo el corte le queda el 100%
-- de esos $10.000 como su ganancia, visible en su propio portal ("Mis ventas").
--
-- Esto reemplaza por completo el mecanismo de 0018/0019 (atencion_servicio_colaborador +
-- vista_atencion_servicio_colaborador): no hay datos reales todavía sobre esas tablas (el
-- proyecto sigue en fase de pruebas), así que se eliminan en vez de mantener un mecanismo
-- paralelo sin uso.

drop view if exists vista_atencion_servicio_colaborador;
drop table if exists atencion_servicio_colaborador;

alter table atencion_servicio add column es_colaboracion boolean not null default false;

-- vista_atencion_servicio: se agrega es_colaboracion al final (compatible con lo ya
-- publicado, ningún consumidor existente se rompe por una columna nueva).
create or replace view vista_atencion_servicio as
select
  ase.id, ase.atencion_id, ase.servicio_id, ase.nombre_snapshot, ase.precio_snapshot,
  ase.descuento, ase.cantidad, ase.profesional_id, vp.nombre as profesional_nombre,
  a.reserva_id, a.estado as atencion_estado, a.creado_en as atencion_creado_en,
  a.completado_en as atencion_completado_en, a.cliente_id, c.nombre as cliente_nombre,
  coalesce((select sum(co.valor) from comision co where co.atencion_servicio_id = ase.id), 0) as comision_total,
  ase.es_colaboracion
from atencion_servicio ase
join vista_profesional vp on vp.id = ase.profesional_id
join atencion a on a.id = ase.atencion_id
join cliente c on c.id = a.cliente_id;

-- fn_registrar_atencion: misma firma (0018/0019), solo cambia qué trae cada línea. Ya no lee
-- "colaboradores" (removido); ahora cada línea puede traer "es_colaboracion" para marcarse
-- como tal. No requiere DROP porque no cambia la lista de parámetros de la función.
create or replace function fn_registrar_atencion(
  p_cliente_id uuid,
  p_reserva_id uuid,
  p_lineas jsonb, -- [{servicio_id, profesional_id, precio_snapshot?, descuento?, cantidad?, es_colaboracion?}]
  p_productos jsonb default '[]'::jsonb,
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

    -- Una línea de colaboración acredita a OTRA persona por ayudar; cualquiera que esté
    -- registrando la atención puede darle ese crédito (no requiere admin/puede_caja). La
    -- restricción de "no autorizada" solo protege la línea PRINCIPAL de cada servicio (nadie
    -- puede registrar, a su propio nombre, un servicio que en realidad hizo otra persona).
    if not v_es_colaboracion and not fn_es_admin() and not fn_es_profesional(v_profesional_id)
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
    insert into atencion_producto (atencion_id, categoria, nombre, cantidad, precio_unitario)
    values (
      v_atencion.id,
      v_producto ->> 'categoria',
      v_producto ->> 'nombre',
      coalesce((v_producto ->> 'cantidad')::int, 1),
      coalesce((v_producto ->> 'precio_unitario')::numeric, 0)
    );
  end loop;

  return v_atencion;
end;
$$;

grant execute on function fn_registrar_atencion to authenticated;

-- fn_completar_y_cobrar_atencion: una línea de colaboración no usa regla_comision — su
-- ganancia es el 100% de lo cobrado por esa línea (snapshot fijo, decisión de negocio).
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
        -- Ganancia completa (100%) para quien colaboró: no se consulta regla_comision.
        insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor)
        values (
          v_linea.id, v_linea.profesional_id,
          jsonb_build_object('tipo', 'colaboracion_100', 'valor', 100),
          v_monto_cobrado_linea, v_monto_cobrado_linea
        );
      else
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

        if v_regla_encontrada then
          v_valor_comision := case when v_regla.tipo = 'porcentaje'
            then round(v_monto_cobrado_linea * v_regla.valor / 100, 2)
            else v_regla.valor end;

          insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor)
          values (v_linea.id, v_linea.profesional_id, to_jsonb(v_regla), v_monto_cobrado_linea, v_valor_comision);
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
