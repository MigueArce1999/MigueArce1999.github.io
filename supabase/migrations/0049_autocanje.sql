-- 0049_autocanje.sql
-- Autocanje: la clienta redime una recompensa DIRECTAMENTE desde su perfil, sin depender de que
-- una empleada la aplique durante un cobro (decisión explícita de negocio — hasta ahora el canje
-- solo pasaba por Atender→Cobrar a propósito, para que siempre hubiera alguien del salón
-- confirmando la entrega).
--
-- El autocanje SÍ descuenta los puntos al instante (mismo mecanismo transaccional que ya usa
-- fn_completar_y_cobrar_atencion: bloqueo de fila + idempotencia), pero el canje queda marcado
-- "pendiente de entregar" (entregado = false, atencion_id = null) hasta que alguien del salón lo
-- entregue y lo marque — nunca se asume la entrega solo porque ya se gastaron los puntos.
--
-- Reutiliza EXACTAMENTE el mismo esquema y la misma celebración (canje_recompensa,
-- notificacion_fidelizacion tipo canje_confirmado) que ya construyeron 0047/0048 para el canje
-- durante un cobro — no se duplica ninguna tabla ni componente de frontend nuevo del lado de la
-- animación.

-- ---------------------------------------------------------------------------
-- 1. fn_autocanjear_recompensa
-- ---------------------------------------------------------------------------

create or replace function fn_resultado_autocanje(p_canje_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'canje_id', cr.id,
    'recompensa_nombre', cr.condiciones_snapshot ->> 'nombre',
    'costo_puntos', cr.costo_puntos_snapshot,
    'saldo_anterior', cr.saldo_anterior,
    'saldo_posterior', cr.saldo_posterior,
    'entregado', cr.entregado
  )
  from canje_recompensa cr where cr.id = p_canje_id
$$;
grant execute on function fn_resultado_autocanje to authenticated;

create or replace function fn_autocanjear_recompensa(
  p_cliente_id uuid,
  p_recompensa_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ya_procesado canje_recompensa;
  v_config configuracion_fidelizacion;
  v_recompensa recompensa;
  v_saldo_anterior numeric(12,2);
  v_saldo_nuevo numeric(12,2);
  v_canje_id uuid;
begin
  if not (fn_es_admin() or fn_es_mi_cliente(p_cliente_id)) then
    raise exception 'No autorizada para canjear a nombre de esta clienta';
  end if;

  select * into v_ya_procesado from canje_recompensa where idempotency_key = p_idempotency_key;
  if found then
    return fn_resultado_autocanje(v_ya_procesado.id);
  end if;

  -- Bloquea la fila de la clienta: un autocanje y un cobro simultáneos (o dos autocanjes a la
  -- vez) nunca leen/gastan el mismo saldo al mismo tiempo — mismo mecanismo que ya prueba
  -- fn_completar_y_cobrar_atencion.
  perform 1 from cliente where id = p_cliente_id for update;

  select * into v_config from configuracion_fidelizacion where id = true;
  if coalesce(v_config.canjes_activo, false) is not true then
    raise exception 'Los canjes de fidelización están pausados por ahora.';
  end if;

  select * into v_recompensa from recompensa where id = p_recompensa_id for update;
  if v_recompensa is null or not v_recompensa.activa then
    raise exception 'Esa recompensa ya no está disponible.';
  end if;
  if not v_recompensa.stock_ilimitado and coalesce(v_recompensa.cantidad_disponible, 0) <= 0 then
    raise exception 'Esa recompensa se agotó.';
  end if;

  v_saldo_anterior := fn_saldo_puntos(p_cliente_id);
  if v_saldo_anterior < v_recompensa.costo_puntos then
    raise exception 'No tienes suficientes puntos para esta recompensa.';
  end if;

  insert into canje_recompensa (cliente_id, recompensa_id, atencion_id, costo_puntos_snapshot, condiciones_snapshot, empleada_id, idempotency_key)
  values (
    p_cliente_id, v_recompensa.id, null, v_recompensa.costo_puntos,
    jsonb_build_object('nombre', v_recompensa.nombre, 'tipo', v_recompensa.tipo, 'condiciones', v_recompensa.condiciones,
                        'servicio_id', v_recompensa.servicio_id, 'monto_descuento', v_recompensa.monto_descuento),
    null, p_idempotency_key
  )
  returning id into v_canje_id;

  insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, referencia_id, canje_id, clave_idempotencia, creado_por)
  values (p_cliente_id, 'canje', -v_recompensa.costo_puntos, 'canje', v_canje_id, v_canje_id, 'canje:' || v_canje_id, auth.uid());

  if not v_recompensa.stock_ilimitado then
    update recompensa set cantidad_disponible = cantidad_disponible - 1 where id = v_recompensa.id;
  end if;

  -- Si esta era su meta elegida, se limpia: ya se usó (mismo criterio que el canje durante un
  -- cobro, sección 6 del pedido original de fidelización).
  update cliente set meta_recompensa_id = null where id = p_cliente_id and meta_recompensa_id = v_recompensa.id;

  v_saldo_nuevo := fn_saldo_puntos(p_cliente_id);

  update canje_recompensa set saldo_anterior = v_saldo_anterior, saldo_posterior = v_saldo_nuevo where id = v_canje_id;

  insert into notificacion_fidelizacion (cliente_id, tipo, titulo, mensaje, origen_tipo, origen_id, datos)
  values (
    p_cliente_id, 'canje_confirmado', '¡Disfruta tu recompensa!',
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
      'puntos_ganados_en_esta_atencion', 0
    )
  )
  on conflict do nothing;

  return fn_resultado_autocanje(v_canje_id);
end;
$$;

grant execute on function fn_autocanjear_recompensa to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Entrega: administración/empleada ven y marcan lo pendiente
-- ---------------------------------------------------------------------------

-- Solo canjes SIN atención asociada (autocanjes) y aún sin entregar — un canje aplicado durante
-- un cobro ya se resolvió en esa misma visita, no necesita seguimiento aparte.
create view vista_canje_pendiente_entrega with (security_invoker = true) as
select cr.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono
from canje_recompensa cr
join cliente c on c.id = cr.cliente_id
where cr.atencion_id is null and cr.entregado = false and cr.estado = 'confirmado'
order by cr.creado_en asc;

create or replace function fn_marcar_canje_entregado(p_canje_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (fn_es_admin() or fn_rol_actual() = 'empleada') then
    raise exception 'No autorizada para marcar esta entrega';
  end if;
  update canje_recompensa set entregado = true where id = p_canje_id and estado = 'confirmado';
end;
$$;

grant execute on function fn_marcar_canje_entregado to authenticated;
