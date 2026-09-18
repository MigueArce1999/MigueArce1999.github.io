-- 0036_gasto_pago_comprobante.sql
-- El gasto ya tenía un comprobante propio (la factura/soporte del gasto en sí, ver
-- gasto.comprobante_path en 0033). Esto es distinto: un soporte OPCIONAL por cada PAGO
-- individual (p. ej. el comprobante de transferencia de cada abono), para más control cuando
-- un gasto tiene varios pagos parciales — cada uno con su propio soporte.
--
-- Reutiliza el mismo bucket privado 'comprobantes-gastos' y las mismas políticas de Storage ya
-- creadas en 0035 (select/insert para admin o puede_caja, delete solo admin) — no hace falta
-- tocar RLS de Storage, el bucket no distingue "comprobante de gasto" de "comprobante de pago",
-- solo controla quién puede subir/ver/borrar dentro de él.

alter table gasto_pago add column comprobante_path text;

-- fn_crear_gasto: el primer pago (si lo hay) también puede llevar su propio comprobante.
drop function if exists fn_crear_gasto(text, uuid, numeric, uuid, text, date, date, text, text, numeric, date, text, uuid, text, text);

create or replace function fn_crear_gasto(
  p_concepto text,
  p_categoria_id uuid,
  p_valor_total numeric,
  p_proveedor_id uuid,
  p_referencia text,
  p_fecha date,
  p_fecha_vencimiento date,
  p_notas text,
  p_comprobante_path text,
  p_pago_importe numeric default null,
  p_pago_fecha date default null,
  p_pago_metodo text default null,
  p_pago_cuenta_id uuid default null,
  p_pago_referencia text default null,
  p_pago_comprobante_path text default null,
  p_idempotency_key text default null
) returns gasto
language plpgsql security definer set search_path = public as $$
declare
  v_gasto gasto;
  v_pago gasto_pago;
  v_cuenta_activa boolean;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_caja') then
    raise exception 'No autorizada para registrar gastos';
  end if;

  if p_idempotency_key is not null then
    select * into v_gasto from gasto where idempotency_key = p_idempotency_key;
    if found then
      return v_gasto;
    end if;
  end if;

  if p_concepto is null or length(trim(p_concepto)) = 0 then
    raise exception 'El concepto es obligatorio';
  end if;
  if p_valor_total is null or p_valor_total <= 0 then
    raise exception 'El valor total debe ser mayor que cero';
  end if;

  if p_pago_importe is not null and p_pago_importe > 0 then
    if p_pago_importe > p_valor_total then
      raise exception 'El importe pagado no puede superar el valor total';
    end if;
    if p_pago_cuenta_id is null or p_pago_metodo is null then
      raise exception 'Falta el método o la cuenta del pago';
    end if;
    select activa into v_cuenta_activa from cuenta where id = p_pago_cuenta_id;
    if v_cuenta_activa is null or not v_cuenta_activa then
      raise exception 'Cuenta no encontrada o inactiva';
    end if;
  end if;

  insert into gasto (
    concepto, categoria_id, valor_total, proveedor_id, referencia, fecha, fecha_vencimiento,
    notas, comprobante_path, origen, creado_por, idempotency_key
  ) values (
    trim(p_concepto), p_categoria_id, p_valor_total, p_proveedor_id, nullif(trim(coalesce(p_referencia, '')), ''),
    p_fecha, p_fecha_vencimiento, nullif(trim(coalesce(p_notas, '')), ''), p_comprobante_path, 'manual', auth.uid(),
    p_idempotency_key
  )
  returning * into v_gasto;

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_nuevo)
  values (v_gasto.id, 'creado', auth.uid(), to_jsonb(v_gasto));

  if p_pago_importe is not null and p_pago_importe > 0 then
    insert into gasto_pago (gasto_id, importe, fecha, metodo, cuenta_id, referencia, comprobante_path, registrado_por)
    values (v_gasto.id, p_pago_importe, coalesce(p_pago_fecha, current_date), p_pago_metodo, p_pago_cuenta_id, nullif(trim(coalesce(p_pago_referencia, '')), ''), p_pago_comprobante_path, auth.uid())
    returning * into v_pago;

    insert into cuenta_movimiento (cuenta_id, tipo, monto, concepto, gasto_pago_id)
    values (p_pago_cuenta_id, 'egreso', p_pago_importe, 'Pago: ' || v_gasto.concepto, v_pago.id);

    insert into gasto_evento (gasto_id, tipo, usuario_id, valor_nuevo)
    values (v_gasto.id, 'pago_registrado', auth.uid(), to_jsonb(v_pago));
  end if;

  return v_gasto;
end;
$$;

grant execute on function fn_crear_gasto to authenticated;

-- fn_registrar_pago_gasto: mismo soporte opcional para un pago posterior (parcial o el que
-- salda el resto).
drop function if exists fn_registrar_pago_gasto(uuid, numeric, date, text, uuid, text, text);

create or replace function fn_registrar_pago_gasto(
  p_gasto_id uuid,
  p_importe numeric,
  p_fecha date,
  p_metodo text,
  p_cuenta_id uuid,
  p_referencia text,
  p_comprobante_path text default null,
  p_idempotency_key text default null
) returns gasto_pago
language plpgsql security definer set search_path = public as $$
declare
  v_gasto gasto;
  v_pago gasto_pago;
  v_pagado numeric(12,2);
  v_saldo numeric(12,2);
  v_cuenta_activa boolean;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_caja') then
    raise exception 'No autorizada para registrar pagos de gastos';
  end if;

  if p_idempotency_key is not null then
    select * into v_pago from gasto_pago where idempotency_key = p_idempotency_key;
    if found then
      return v_pago;
    end if;
  end if;

  if p_importe is null or p_importe <= 0 then
    raise exception 'El importe debe ser mayor que cero';
  end if;

  select * into v_gasto from gasto where id = p_gasto_id for update;
  if v_gasto is null then raise exception 'Gasto no encontrado'; end if;
  if v_gasto.anulado then raise exception 'Este gasto está anulado; no se le pueden registrar pagos'; end if;

  select coalesce(sum(gp.importe), 0) - coalesce((
      select sum(gpr.importe) from gasto_pago_reversion gpr
      join gasto_pago gp2 on gp2.id = gpr.gasto_pago_id
      where gp2.gasto_id = v_gasto.id
    ), 0)
  into v_pagado
  from gasto_pago gp where gp.gasto_id = v_gasto.id;

  v_saldo := v_gasto.valor_total - v_pagado;
  if p_importe > v_saldo then
    raise exception 'El importe (%) supera el saldo pendiente (%)', p_importe, v_saldo;
  end if;

  select activa into v_cuenta_activa from cuenta where id = p_cuenta_id;
  if v_cuenta_activa is null or not v_cuenta_activa then
    raise exception 'Cuenta no encontrada o inactiva';
  end if;

  insert into gasto_pago (gasto_id, importe, fecha, metodo, cuenta_id, referencia, comprobante_path, registrado_por, idempotency_key)
  values (v_gasto.id, p_importe, coalesce(p_fecha, current_date), p_metodo, p_cuenta_id, nullif(trim(coalesce(p_referencia, '')), ''), p_comprobante_path, auth.uid(), p_idempotency_key)
  returning * into v_pago;

  insert into cuenta_movimiento (cuenta_id, tipo, monto, concepto, gasto_pago_id)
  values (p_cuenta_id, 'egreso', p_importe, 'Pago: ' || v_gasto.concepto, v_pago.id);

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_nuevo)
  values (v_gasto.id, 'pago_registrado', auth.uid(), to_jsonb(v_pago));

  return v_pago;
end;
$$;

grant execute on function fn_registrar_pago_gasto to authenticated;
