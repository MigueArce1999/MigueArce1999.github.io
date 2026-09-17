-- 0025_editar_y_eliminar_venta.sql
-- Admin → Ventas necesita poder corregir un error de registro (clienta equivocada, precio mal
-- digitado, profesional equivocada) o borrar por completo una venta de prueba/duplicada, sin
-- dejar pagos huérfanos ni comisiones desincronizadas. Ambas operaciones son SECURITY DEFINER
-- (solo admin) y respetan la misma regla que el reinicio manual de ventas: una venta con AL
-- MENOS una comisión ya liquidada queda protegida — no se edita ni se borra desde aquí.
--
-- fn_editar_venta NO toca los pagos (pago.monto): el dinero que de verdad entró a caja es un
-- hecho histórico que un error de captura en el precio/descuento de una línea no cambia. Solo
-- recalcula, línea por línea, la comisión de cada servicio con la regla vigente para su
-- profesional (posiblemente distinta si se reasignó a otra persona) — igual que hace
-- fn_completar_y_cobrar_atencion al cobrar, pero sin la prorrata entre líneas (aquí no hay un
-- pago nuevo que repartir: cada línea se trata como si ella sola cubriera su propio monto).

create or replace function fn_venta_protegida(p_atencion_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from atencion_servicio ase
    join comision c on c.atencion_servicio_id = ase.id
    where ase.atencion_id = p_atencion_id and c.estado = 'liquidada'
  )
$$;

create or replace function fn_recalcular_contadores_cliente(p_cliente_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update cliente c set
    visitas_completadas = coalesce((
      select count(*) from atencion a where a.cliente_id = c.id and a.estado = 'completada'
    ), 0),
    gasto_acumulado = coalesce((
      select sum(p.monto) from pago p join atencion a on a.id = p.atencion_id where a.cliente_id = c.id
    ), 0)
  where c.id = p_cliente_id;
end;
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

  -- pago.atencion_id es "restrict" (no cascada): hay que borrarlo antes de la atención.
  delete from pago where atencion_id = p_atencion_id;

  -- atencion_servicio y atencion_producto cascadean desde atencion.
  delete from atencion where id = p_atencion_id;

  perform fn_recalcular_contadores_cliente(v_cliente_id);
end;
$$;

grant execute on function fn_eliminar_venta to authenticated;

create or replace function fn_editar_venta(
  p_atencion_id uuid,
  p_cliente_id uuid,
  p_notas text,
  p_lineas jsonb -- [{id, profesional_id, precio_snapshot, descuento, cantidad}]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cliente_anterior uuid;
  v_linea jsonb;
  v_ase atencion_servicio;
  v_precio numeric(12,2);
  v_descuento numeric(12,2);
  v_cantidad int;
  v_profesional_id uuid;
  v_monto numeric(12,2);
  v_regla regla_comision;
  v_regla_encontrada boolean;
  v_valor_comision numeric(12,2);
  v_comision_id uuid;
begin
  if not fn_es_admin() then
    raise exception 'Solo administración puede editar una venta';
  end if;

  select cliente_id into v_cliente_anterior from atencion where id = p_atencion_id;
  if v_cliente_anterior is null then
    raise exception 'La venta ya no existe';
  end if;

  if fn_venta_protegida(p_atencion_id) then
    raise exception 'Esta venta ya fue liquidada a la profesional; no se puede editar. Habla con administración si de verdad hay que corregirla.';
  end if;

  update atencion set cliente_id = p_cliente_id, notas = p_notas where id = p_atencion_id;

  for v_linea in select jsonb_array_elements(p_lineas) loop
    select * into v_ase from atencion_servicio
    where id = (v_linea ->> 'id')::uuid and atencion_id = p_atencion_id;
    if not found then
      raise exception 'Esa línea ya no pertenece a esta venta';
    end if;

    v_precio := coalesce((v_linea ->> 'precio_snapshot')::numeric, v_ase.precio_snapshot);
    v_descuento := coalesce((v_linea ->> 'descuento')::numeric, v_ase.descuento);
    v_cantidad := coalesce((v_linea ->> 'cantidad')::int, v_ase.cantidad);
    v_profesional_id := coalesce((v_linea ->> 'profesional_id')::uuid, v_ase.profesional_id);

    update atencion_servicio
    set precio_snapshot = v_precio, descuento = v_descuento, cantidad = v_cantidad, profesional_id = v_profesional_id
    where id = v_ase.id;

    v_monto := round((v_precio - v_descuento) * v_cantidad, 2);
    select id into v_comision_id from comision where atencion_servicio_id = v_ase.id;

    if v_ase.es_colaboracion then
      -- Ganancia completa (100%) para quien colaboró, igual que al cobrar (0020).
      if v_comision_id is not null then
        update comision set profesional_id = v_profesional_id, base_calculo = v_monto, valor = v_monto,
          regla_aplicada = jsonb_build_object('tipo', 'colaboracion_100', 'valor', 100)
        where id = v_comision_id;
      else
        insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor)
        values (v_ase.id, v_profesional_id, jsonb_build_object('tipo', 'colaboracion_100', 'valor', 100), v_monto, v_monto);
      end if;
    else
      select * into v_regla from regla_comision
      where profesional_id = v_profesional_id
        and (servicio_id = v_ase.servicio_id or servicio_id is null)
        and vigente_hasta is null
      order by servicio_id nulls last
      limit 1;
      v_regla_encontrada := found;

      if v_regla_encontrada and v_monto > 0 then
        v_valor_comision := case when v_regla.tipo = 'porcentaje'
          then round(v_monto * v_regla.valor / 100, 2)
          else v_regla.valor end;

        if v_comision_id is not null then
          update comision set profesional_id = v_profesional_id, regla_aplicada = to_jsonb(v_regla),
            base_calculo = v_monto, valor = v_valor_comision
          where id = v_comision_id;
        else
          insert into comision (atencion_servicio_id, profesional_id, regla_aplicada, base_calculo, valor)
          values (v_ase.id, v_profesional_id, to_jsonb(v_regla), v_monto, v_valor_comision);
        end if;
      elsif v_comision_id is not null then
        -- Ya no hay regla vigente para la nueva profesional/servicio: sin comisión.
        delete from comision where id = v_comision_id;
      end if;
    end if;
  end loop;

  perform fn_recalcular_contadores_cliente(v_cliente_anterior);
  if p_cliente_id <> v_cliente_anterior then
    perform fn_recalcular_contadores_cliente(p_cliente_id);
  end if;
end;
$$;

grant execute on function fn_editar_venta to authenticated;
