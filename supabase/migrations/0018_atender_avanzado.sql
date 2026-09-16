-- 0018_atender_avanzado.sql
-- Amplía "registrar atención" para soportar, en una sola pantalla y una sola transacción:
-- colaboradores internos por servicio (distribución del precio ya cobrado, NUNCA un cargo
-- adicional a la clienta) y productos vendidos (sí se suman a la cuenta de la clienta).
-- No se construye un catálogo de productos (Fase 2 lo justifica): recepción escribe
-- categoría, nombre y precio en el momento, como pide docs/03-flujos.md para este alcance.

-- ---------------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------------

-- Clave de idempotencia propia para el paso "registrar" (crear atención + líneas +
-- colaboradores + productos), independiente de `idempotency_key` (que ya protege el paso
-- "completar y cobrar"). Sin esto, reintentar el registro tras un error de red duplicaría
-- la atención completa.
alter table atencion add column borrador_key text unique;

create table atencion_producto (
  id uuid primary key default gen_random_uuid(),
  atencion_id uuid not null references atencion (id) on delete cascade,
  categoria text not null,
  nombre text not null,
  cantidad int not null default 1 check (cantidad > 0),
  precio_unitario numeric(12, 2) not null check (precio_unitario >= 0),
  creado_en timestamptz not null default now()
);
create index atencion_producto_atencion_idx on atencion_producto (atencion_id);

create table atencion_servicio_colaborador (
  id uuid primary key default gen_random_uuid(),
  atencion_servicio_id uuid not null references atencion_servicio (id) on delete cascade,
  colaborador_id uuid not null references profesional (id) on delete restrict,
  participacion text,
  valor numeric(12, 2) not null default 0 check (valor >= 0),
  creado_en timestamptz not null default now(),
  unique (atencion_servicio_id, colaborador_id)
);
create index atencion_servicio_colaborador_ase_idx on atencion_servicio_colaborador (atencion_servicio_id);

alter table atencion_producto enable row level security;
alter table atencion_servicio_colaborador enable row level security;

-- Sin política de INSERT directa: igual que atencion_servicio, solo se escriben a través de
-- fn_registrar_atencion (SECURITY DEFINER), que ya valida las reglas de negocio.
create policy atencion_producto_select on atencion_producto for select
  using (fn_atencion_visible(atencion_id));

create policy atencion_servicio_colaborador_select on atencion_servicio_colaborador for select
  using (
    fn_es_admin()
    or fn_tiene_permiso('puede_caja')
    or colaborador_id = auth.uid()
    or exists (
      select 1 from atencion_servicio ase
      where ase.id = atencion_servicio_colaborador.atencion_servicio_id and ase.profesional_id = auth.uid()
    )
  );

grant select, insert, update, delete on atencion_producto, atencion_servicio_colaborador to anon, authenticated;

-- vista_atencion sumaba solo atencion_servicio; con productos vendidos, total_vendido
-- quedaba por debajo de total_pagado y el badge de "pagado vs. total" mentía.
create or replace view vista_atencion as
select
  a.id, a.reserva_id, a.cliente_id, c.nombre as cliente_nombre,
  a.estado, a.notas, a.creado_en, a.completado_en,
  coalesce((select sum((ase.precio_snapshot - ase.descuento) * ase.cantidad) from atencion_servicio ase where ase.atencion_id = a.id), 0)
    + coalesce((select sum(ap.precio_unitario * ap.cantidad) from atencion_producto ap where ap.atencion_id = a.id), 0) as total_vendido,
  coalesce((select sum(pg.monto) from pago pg where pg.atencion_id = a.id), 0) as total_pagado
from atencion a
join cliente c on c.id = a.cliente_id;

-- ---------------------------------------------------------------------------
-- fn_registrar_atencion: se extiende (parámetros nuevos con default, compatible con
-- llamadas existentes) para aceptar colaboradores por línea, productos y notas, y para
-- ser idempotente ante reintentos del propio registro (borrador_key).
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE no basta: agregar parámetros nuevos cambia la lista de tipos, así que
-- Postgres crearía una segunda función sobrecargada en vez de reemplazar la anterior (y eso
-- deja ambiguo tanto el GRANT como la llamada RPC desde supabase-js). Se elimina primero la
-- firma original de 3 parámetros.
drop function if exists fn_registrar_atencion(uuid, uuid, jsonb);

create or replace function fn_registrar_atencion(
  p_cliente_id uuid,
  p_reserva_id uuid,
  p_lineas jsonb, -- [{servicio_id, profesional_id, precio_snapshot?, descuento?, cantidad?, colaboradores?: [{colaborador_id, participacion?, valor}]}]
  p_productos jsonb default '[]'::jsonb, -- [{categoria, nombre, cantidad?, precio_unitario}]
  p_notas text default null,
  p_borrador_key text default null
) returns atencion
language plpgsql security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_atencion_servicio_id uuid;
  v_linea jsonb;
  v_colaborador jsonb;
  v_producto jsonb;
  v_nombre text;
  v_precio numeric(12,2);
  v_precio_final numeric(12,2);
  v_descuento numeric(12,2);
  v_descuento_maximo_pct numeric(5,2);
  v_descuento_pct numeric(6,2);
  v_profesional_id uuid;
  v_colaborador_id uuid;
  v_colaboradores_vistos uuid[];
  v_suma_colaboradores numeric(12,2);
  v_valor_colaborador numeric(12,2);
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

    select nombre, precio into v_nombre, v_precio
    from servicio where id = (v_linea ->> 'servicio_id')::uuid;

    if not fn_es_admin() and not fn_es_profesional(v_profesional_id)
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
      v_profesional_id,
      v_nombre,
      v_precio_final,
      v_descuento,
      coalesce((v_linea ->> 'cantidad')::int, 1)
    )
    returning id into v_atencion_servicio_id;

    -- Colaboradores: distribución interna del precio ya cobrado, nunca un cargo adicional.
    v_colaboradores_vistos := array[]::uuid[];
    v_suma_colaboradores := 0;
    for v_colaborador in select jsonb_array_elements(coalesce(v_linea -> 'colaboradores', '[]'::jsonb)) loop
      v_colaborador_id := (v_colaborador ->> 'colaborador_id')::uuid;
      v_valor_colaborador := coalesce((v_colaborador ->> 'valor')::numeric, 0);

      if v_colaborador_id = v_profesional_id then
        raise exception 'El profesional responsable no puede ser su propio colaborador';
      end if;
      if v_colaborador_id = any(v_colaboradores_vistos) then
        raise exception 'Un colaborador no puede repetirse en el mismo servicio';
      end if;
      v_colaboradores_vistos := array_append(v_colaboradores_vistos, v_colaborador_id);
      v_suma_colaboradores := v_suma_colaboradores + v_valor_colaborador;

      if v_suma_colaboradores > (v_precio_final - v_descuento) * coalesce((v_linea ->> 'cantidad')::int, 1) then
        raise exception 'La suma de los colaboradores no puede superar el precio del servicio';
      end if;

      insert into atencion_servicio_colaborador (atencion_servicio_id, colaborador_id, participacion, valor)
      values (v_atencion_servicio_id, v_colaborador_id, v_colaborador ->> 'participacion', v_valor_colaborador);
    end loop;
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

-- ---------------------------------------------------------------------------
-- fn_completar_y_cobrar_atencion: el total a cobrar ahora incluye productos. La comisión
-- sigue prorateándose solo sobre servicios (los productos no generan comisión en este
-- alcance), así que se calcula la porción del cobro que corresponde a servicios primero y
-- luego se reparte igual que antes entre líneas (fórmula compatible: si no hay productos,
-- da exactamente el mismo resultado que la versión anterior).
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

  -- Comisión por línea, prorrateando esa porción sobre el peso de cada línea entre servicios.
  for v_linea in select * from atencion_servicio where atencion_id = p_atencion_id loop
    v_monto_cobrado_linea := case when v_total_servicios > 0
      then round(v_cobrado_servicios * ((v_linea.precio_snapshot - v_linea.descuento) * v_linea.cantidad) / v_total_servicios, 2)
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
