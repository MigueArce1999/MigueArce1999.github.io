-- 0034_gastos_pagos_funciones.sql
-- Funciones RPC y vista de lectura del módulo "Gastos y pagos". Toda escritura de dinero pasa
-- por aquí (SECURITY DEFINER, igual que el resto del proyecto — ver 0013_funciones.sql): el
-- frontend nunca hace INSERT/UPDATE directo sobre gasto/gasto_pago/gasto_pago_reversion.

-- ---------------------------------------------------------------------------
-- Lectura: el saldo pagado/pendiente y el estado (pendiente/pago_parcial/pagado) SIEMPRE se
-- calculan desde los pagos y reversiones reales — nunca se guarda un estado editable que
-- permita forzar "Pagado" a mano. `anulado` sí es una columna propia porque un gasto se puede
-- anular sin haber tenido nunca un pago.
-- ---------------------------------------------------------------------------
create view vista_gasto with (security_invoker = true) as
select
  g.id, g.concepto, g.categoria_id, cg.nombre as categoria_nombre, cg.activa as categoria_activa,
  g.proveedor_id, pv.nombre as proveedor_nombre,
  g.referencia, g.fecha, g.fecha_vencimiento, g.valor_total, g.notas, g.comprobante_path,
  g.origen, g.referencia_liquidacion_id, g.plantilla_id,
  g.anulado, g.anulado_motivo, g.anulado_por, g.anulado_en,
  g.creado_por, pf.nombre as creado_por_nombre, g.creado_en, g.actualizado_por, g.actualizado_en,
  coalesce(pb.bruto, 0) - coalesce(pr.reversiones, 0) as total_pagado,
  g.valor_total - (coalesce(pb.bruto, 0) - coalesce(pr.reversiones, 0)) as saldo_pendiente,
  case
    when g.anulado then 'anulado'
    when (coalesce(pb.bruto, 0) - coalesce(pr.reversiones, 0)) <= 0 then 'pendiente'
    when (coalesce(pb.bruto, 0) - coalesce(pr.reversiones, 0)) >= g.valor_total then 'pagado'
    else 'pago_parcial'
  end as estado,
  (
    not g.anulado
    and (g.valor_total - (coalesce(pb.bruto, 0) - coalesce(pr.reversiones, 0))) > 0
    and g.fecha_vencimiento is not null
    and g.fecha_vencimiento < current_date
  ) as vencido
from gasto g
join categoria_gasto cg on cg.id = g.categoria_id
left join proveedor pv on pv.id = g.proveedor_id
left join perfil pf on pf.id = g.creado_por
left join lateral (
  select coalesce(sum(gp.importe), 0) as bruto from gasto_pago gp where gp.gasto_id = g.id
) pb on true
left join lateral (
  select coalesce(sum(gpr.importe), 0) as reversiones
  from gasto_pago_reversion gpr
  join gasto_pago gp2 on gp2.id = gpr.gasto_pago_id
  where gp2.gasto_id = g.id
) pr on true;

grant select on vista_gasto to authenticated;

-- Saldo corriente por cuenta: suma de ingresos menos egresos de su libro de movimientos.
create view vista_cuenta with (security_invoker = true) as
select
  c.id, c.nombre, c.tipo, c.activa,
  coalesce(sum(case when cm.tipo = 'ingreso' then cm.monto else -cm.monto end), 0) as saldo
from cuenta c
left join cuenta_movimiento cm on cm.cuenta_id = c.id
group by c.id, c.nombre, c.tipo, c.activa;

grant select on vista_cuenta to authenticated;

-- ---------------------------------------------------------------------------
-- Crear gasto (opcionalmente con su primer pago, de forma atómica: si hay pago, el gasto y su
-- movimiento de cuenta se guardan en la misma transacción — nunca queda un gasto "a medio
-- pagar" por una falla a mitad de camino).
-- ---------------------------------------------------------------------------
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
    insert into gasto_pago (gasto_id, importe, fecha, metodo, cuenta_id, referencia, registrado_por)
    values (v_gasto.id, p_pago_importe, coalesce(p_pago_fecha, current_date), p_pago_metodo, p_pago_cuenta_id, nullif(trim(coalesce(p_pago_referencia, '')), ''), auth.uid())
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

-- ---------------------------------------------------------------------------
-- Editar gasto: el valor total de un gasto generado automáticamente (compra/liquidación/
-- recurrente) no se puede tocar a mano, y el de uno manual nunca puede bajar de lo ya pagado.
-- ---------------------------------------------------------------------------
create or replace function fn_editar_gasto(
  p_gasto_id uuid,
  p_concepto text,
  p_categoria_id uuid,
  p_valor_total numeric,
  p_proveedor_id uuid,
  p_referencia text,
  p_fecha date,
  p_fecha_vencimiento date,
  p_notas text,
  p_comprobante_path text
) returns gasto
language plpgsql security definer set search_path = public as $$
declare
  v_gasto gasto;
  v_anterior jsonb;
  v_pagado numeric(12,2);
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_caja') then
    raise exception 'No autorizada para editar gastos';
  end if;
  if p_concepto is null or length(trim(p_concepto)) = 0 then
    raise exception 'El concepto es obligatorio';
  end if;

  select * into v_gasto from gasto where id = p_gasto_id for update;
  if v_gasto is null then raise exception 'Gasto no encontrado'; end if;
  if v_gasto.anulado then raise exception 'Este gasto está anulado y no se puede editar'; end if;

  select coalesce(sum(gp.importe), 0) - coalesce((
      select sum(gpr.importe) from gasto_pago_reversion gpr
      join gasto_pago gp2 on gp2.id = gpr.gasto_pago_id
      where gp2.gasto_id = v_gasto.id
    ), 0)
  into v_pagado
  from gasto_pago gp where gp.gasto_id = v_gasto.id;

  if p_valor_total <> v_gasto.valor_total then
    if v_gasto.origen <> 'manual' then
      raise exception 'El valor de un gasto con origen "%" no se edita manualmente aquí', v_gasto.origen;
    end if;
    if p_valor_total <= 0 then
      raise exception 'El valor total debe ser mayor que cero';
    end if;
    if p_valor_total < v_pagado then
      raise exception 'No puedes bajar el valor total por debajo de lo ya pagado (%)', v_pagado;
    end if;
  end if;

  v_anterior := to_jsonb(v_gasto);

  update gasto set
    concepto = trim(p_concepto),
    categoria_id = p_categoria_id,
    valor_total = p_valor_total,
    proveedor_id = p_proveedor_id,
    referencia = nullif(trim(coalesce(p_referencia, '')), ''),
    fecha = p_fecha,
    fecha_vencimiento = p_fecha_vencimiento,
    notas = nullif(trim(coalesce(p_notas, '')), ''),
    comprobante_path = coalesce(p_comprobante_path, comprobante_path),
    actualizado_por = auth.uid(),
    actualizado_en = now()
  where id = p_gasto_id
  returning * into v_gasto;

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_anterior, valor_nuevo)
  values (p_gasto_id, 'editado', auth.uid(), v_anterior, to_jsonb(v_gasto));

  return v_gasto;
end;
$$;

grant execute on function fn_editar_gasto to authenticated;

-- ---------------------------------------------------------------------------
-- Duplicar como nuevo gasto: copia los datos descriptivos, nunca los pagos — nace como
-- 'pendiente' aunque el original ya esté pagado.
-- ---------------------------------------------------------------------------
create or replace function fn_duplicar_gasto(p_gasto_id uuid) returns gasto
language plpgsql security definer set search_path = public as $$
declare
  v_original gasto;
  v_nuevo gasto;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_caja') then
    raise exception 'No autorizada para duplicar gastos';
  end if;

  select * into v_original from gasto where id = p_gasto_id;
  if v_original is null then raise exception 'Gasto no encontrado'; end if;

  insert into gasto (concepto, categoria_id, valor_total, proveedor_id, referencia, fecha, notas, origen, creado_por)
  values (v_original.concepto, v_original.categoria_id, v_original.valor_total, v_original.proveedor_id, v_original.referencia, current_date, v_original.notas, 'manual', auth.uid())
  returning * into v_nuevo;

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_nuevo)
  values (v_nuevo.id, 'creado', auth.uid(), to_jsonb(v_nuevo));

  return v_nuevo;
end;
$$;

grant execute on function fn_duplicar_gasto to authenticated;

-- ---------------------------------------------------------------------------
-- Registrar pago: idempotente (una clave repetida nunca duplica el pago), bloquea el gasto con
-- FOR UPDATE (dos pagos concurrentes al mismo gasto se serializan — el segundo ve el saldo ya
-- actualizado por el primero y nunca puede sobrepasar el saldo pendiente), y crea una única
-- salida en la cuenta elegida.
-- ---------------------------------------------------------------------------
create or replace function fn_registrar_pago_gasto(
  p_gasto_id uuid,
  p_importe numeric,
  p_fecha date,
  p_metodo text,
  p_cuenta_id uuid,
  p_referencia text,
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

  insert into gasto_pago (gasto_id, importe, fecha, metodo, cuenta_id, referencia, registrado_por, idempotency_key)
  values (v_gasto.id, p_importe, coalesce(p_fecha, current_date), p_metodo, p_cuenta_id, nullif(trim(coalesce(p_referencia, '')), ''), auth.uid(), p_idempotency_key)
  returning * into v_pago;

  insert into cuenta_movimiento (cuenta_id, tipo, monto, concepto, gasto_pago_id)
  values (p_cuenta_id, 'egreso', p_importe, 'Pago: ' || v_gasto.concepto, v_pago.id);

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_nuevo)
  values (v_gasto.id, 'pago_registrado', auth.uid(), to_jsonb(v_pago));

  return v_pago;
end;
$$;

grant execute on function fn_registrar_pago_gasto to authenticated;

-- ---------------------------------------------------------------------------
-- Revertir un pago (total o parcialmente): nunca se borra el pago original, se registra la
-- reversión aparte y se devuelve el dinero a la cuenta con un ingreso — el historial completo
-- queda intacto.
-- ---------------------------------------------------------------------------
create or replace function fn_revertir_pago_gasto(
  p_gasto_pago_id uuid,
  p_importe numeric,
  p_motivo text
) returns gasto_pago_reversion
language plpgsql security definer set search_path = public as $$
declare
  v_pago gasto_pago;
  v_gasto gasto;
  v_ya_revertido numeric(12,2);
  v_disponible numeric(12,2);
  v_reversion gasto_pago_reversion;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_anular_ventas') then
    raise exception 'No autorizada para revertir pagos';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'La reversión requiere un motivo';
  end if;
  if p_importe is null or p_importe <= 0 then
    raise exception 'El importe a revertir debe ser mayor que cero';
  end if;

  select * into v_pago from gasto_pago where id = p_gasto_pago_id for update;
  if v_pago is null then raise exception 'Pago no encontrado'; end if;

  select coalesce(sum(importe), 0) into v_ya_revertido from gasto_pago_reversion where gasto_pago_id = v_pago.id;
  v_disponible := v_pago.importe - v_ya_revertido;
  if p_importe > v_disponible then
    raise exception 'El importe a revertir (%) supera lo disponible de este pago (%)', p_importe, v_disponible;
  end if;

  select * into v_gasto from gasto where id = v_pago.gasto_id;

  insert into gasto_pago_reversion (gasto_pago_id, importe, motivo, registrado_por)
  values (v_pago.id, p_importe, p_motivo, auth.uid())
  returning * into v_reversion;

  insert into cuenta_movimiento (cuenta_id, tipo, monto, concepto, gasto_pago_reversion_id)
  values (v_pago.cuenta_id, 'ingreso', p_importe, 'Reversión de pago: ' || v_gasto.concepto, v_reversion.id);

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_nuevo, motivo)
  values (v_gasto.id, 'pago_revertido', auth.uid(), to_jsonb(v_reversion), p_motivo);

  return v_reversion;
end;
$$;

grant execute on function fn_revertir_pago_gasto to authenticated;

-- ---------------------------------------------------------------------------
-- Anular gasto: solo si no tiene pagos vigentes (netos de reversiones). Nunca "recupera dinero"
-- por sí sola — eso ya debió resolverse antes con una reversión.
-- ---------------------------------------------------------------------------
create or replace function fn_anular_gasto(p_gasto_id uuid, p_motivo text) returns gasto
language plpgsql security definer set search_path = public as $$
declare
  v_gasto gasto;
  v_pagado numeric(12,2);
  v_anterior jsonb;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_anular_ventas') then
    raise exception 'No autorizada para anular gastos';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Anular un gasto requiere un motivo';
  end if;

  select * into v_gasto from gasto where id = p_gasto_id for update;
  if v_gasto is null then raise exception 'Gasto no encontrado'; end if;
  if v_gasto.anulado then raise exception 'Este gasto ya está anulado'; end if;

  select coalesce(sum(gp.importe), 0) - coalesce((
      select sum(gpr.importe) from gasto_pago_reversion gpr
      join gasto_pago gp2 on gp2.id = gpr.gasto_pago_id
      where gp2.gasto_id = v_gasto.id
    ), 0)
  into v_pagado
  from gasto_pago gp where gp.gasto_id = v_gasto.id;

  if v_pagado > 0 then
    raise exception 'Este gasto tiene % en pagos vigentes; revierte esos pagos antes de anularlo', v_pagado;
  end if;

  v_anterior := to_jsonb(v_gasto);

  update gasto set anulado = true, anulado_motivo = p_motivo, anulado_por = auth.uid(), anulado_en = now()
  where id = p_gasto_id
  returning * into v_gasto;

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_anterior, valor_nuevo, motivo)
  values (p_gasto_id, 'anulado', auth.uid(), v_anterior, to_jsonb(v_gasto), p_motivo);

  return v_gasto;
end;
$$;

grant execute on function fn_anular_gasto to authenticated;

-- ---------------------------------------------------------------------------
-- Recurrentes: sin infraestructura de tareas programadas en este proyecto (ver resumen de
-- entrega), así que cada ocurrencia se genera manualmente con este RPC — nunca un pago
-- automático, solo un gasto pendiente nuevo. El índice único de plantilla_gasto_ocurrencia
-- (0033) es la garantía anti-duplicados definitiva.
-- ---------------------------------------------------------------------------
create or replace function fn_generar_siguiente_gasto_recurrente(p_plantilla_id uuid) returns gasto
language plpgsql security definer set search_path = public as $$
declare
  v_plantilla plantilla_gasto_recurrente;
  v_ultima date;
  v_siguiente date;
  v_mes_destino date;
  v_ultimo_dia_mes date;
  v_dia_objetivo int;
  v_gasto gasto;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_caja') then
    raise exception 'No autorizada para generar gastos recurrentes';
  end if;

  select * into v_plantilla from plantilla_gasto_recurrente where id = p_plantilla_id for update;
  if v_plantilla is null then raise exception 'Plantilla no encontrada'; end if;
  if not v_plantilla.activa then raise exception 'Esta plantilla está pausada'; end if;

  select max(fecha_vencimiento) into v_ultima from plantilla_gasto_ocurrencia where plantilla_id = p_plantilla_id;

  if v_ultima is null then
    v_siguiente := v_plantilla.primera_fecha_vencimiento;
  elsif v_plantilla.frecuencia = 'semanal' then
    v_siguiente := v_ultima + interval '7 days';
  else
    -- Mensual: si el día configurado (el de primera_fecha_vencimiento) no existe en el mes
    -- siguiente (p. ej. 31 en febrero), se usa el último día de ese mes.
    v_mes_destino := (date_trunc('month', v_ultima) + interval '1 month')::date;
    v_ultimo_dia_mes := (v_mes_destino + interval '1 month - 1 day')::date;
    v_dia_objetivo := extract(day from v_plantilla.primera_fecha_vencimiento)::int;
    v_siguiente := least(v_mes_destino + (v_dia_objetivo - 1), v_ultimo_dia_mes);
  end if;

  if v_plantilla.fecha_fin is not null and v_siguiente > v_plantilla.fecha_fin then
    raise exception 'Esta plantilla ya generó su última ocurrencia (vence el %)', v_plantilla.fecha_fin;
  end if;

  if exists (select 1 from plantilla_gasto_ocurrencia where plantilla_id = p_plantilla_id and fecha_vencimiento = v_siguiente) then
    raise exception 'Ya existe una ocurrencia generada para el %', v_siguiente;
  end if;

  insert into gasto (categoria_id, concepto, valor_total, proveedor_id, fecha, fecha_vencimiento, origen, plantilla_id, creado_por)
  values (v_plantilla.categoria_id, v_plantilla.concepto, v_plantilla.valor_total, v_plantilla.proveedor_id, current_date, v_siguiente, 'manual', v_plantilla.id, auth.uid())
  returning * into v_gasto;

  insert into plantilla_gasto_ocurrencia (plantilla_id, fecha_vencimiento, gasto_id)
  values (p_plantilla_id, v_siguiente, v_gasto.id);

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_nuevo)
  values (v_gasto.id, 'creado', auth.uid(), to_jsonb(v_gasto));

  return v_gasto;
end;
$$;

grant execute on function fn_generar_siguiente_gasto_recurrente to authenticated;

-- ---------------------------------------------------------------------------
-- Integración con comisiones: cada liquidación crea automáticamente su gasto vinculado (regla
-- 7 — "pagarlas no crea otra obligación duplicada"). El índice único gasto_liquidacion_unq_idx
-- (0033) impide que una misma liquidación termine con dos gastos. Una liquidación en cero
-- (periodo sin comisiones pendientes) no genera gasto: no hay nada real que pagar.
-- ---------------------------------------------------------------------------
create or replace function fn_crear_gasto_desde_liquidacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria_id uuid;
  v_profesional_nombre text;
  v_gasto gasto;
begin
  if new.importe_total <= 0 then
    return new;
  end if;

  select id into v_categoria_id from categoria_gasto where lower(nombre) = lower('Otros gastos') limit 1;
  select nombre into v_profesional_nombre from vista_profesional where id = new.profesional_id;

  insert into gasto (categoria_id, concepto, valor_total, fecha, origen, referencia_liquidacion_id, creado_por)
  values (
    v_categoria_id,
    'Comisiones: ' || coalesce(v_profesional_nombre, 'profesional') || ' (' || new.periodo_inicio || ' a ' || new.periodo_fin || ')',
    new.importe_total,
    current_date,
    'liquidacion',
    new.id,
    new.responsable_id
  )
  returning * into v_gasto;

  insert into gasto_evento (gasto_id, tipo, usuario_id, valor_nuevo)
  values (v_gasto.id, 'creado', new.responsable_id, to_jsonb(v_gasto));

  return new;
end;
$$;

create trigger crear_gasto_on_liquidacion_nueva
  after insert on liquidacion
  for each row execute function fn_crear_gasto_desde_liquidacion();
