-- 0047_fidelizacion.sql
-- Módulo de fidelización completo: extiende el esquema mínimo de 0007_puntos.sql (que ya traía
-- regla_puntos/movimiento_puntos/recompensa y ya otorgaba puntos automáticamente al completar un
-- cobro, en fn_completar_y_cobrar_atencion) en vez de crear tablas paralelas.
--
-- Decisiones de diseño relevantes (para quien retome esto después):
--   * El saldo de puntos NUNCA es una columna editable: sigue siendo SUM(movimiento_puntos.puntos)
--     (fn_saldo_puntos), tal como ya dejaba dicho el comentario de 0007. Ver también 0014_rls.sql:
--     movimiento_puntos no tiene política de INSERT/UPDATE directa — todo pasa por estas funciones.
--   * "Cuenta de fidelización" no es una tabla nueva: la clienta YA ES la cuenta (cliente.id), así
--     que solo se le agrega meta_recompensa_id. Evita duplicar la relación 1:1 cliente↔cuenta.
--   * fn_registrar_devolucion (0013) ya reproducía casi exactamente el ejemplo de reversión
--     proporcional del pedido (una devolución revierte la fracción de puntos correspondiente);
--     se extiende esa misma función real en vez de inventar un mecanismo de devolución paralelo,
--     ya que en este proyecto una devolución es literalmente un pago con monto negativo
--     (pago.monto, columna que ya existía) vinculado a su pago original.
--   * fn_completar_y_cobrar_atencion sigue siendo EL evento real de "cobro confirmado": ahí se
--     integra tanto el abono de puntos (ya existía) como el canje de una recompensa (nuevo). No se
--     agrega un tercer paso al flujo de Atender → Cobrar.

-- ---------------------------------------------------------------------------
-- 1. Esquema
-- ---------------------------------------------------------------------------

-- Estado on/off del programa. Es un singleton (id siempre `true`) porque solo existe UNA
-- configuración activa a la vez — separar esto de regla_puntos (que sí se versiona por vigencia)
-- porque pausar/reanudar es un interruptor del momento, no una regla de negocio a auditar por
-- separado en cada movimiento.
create table configuracion_fidelizacion (
  id boolean primary key default true check (id),
  acumulacion_activa boolean not null default false,
  canjes_activo boolean not null default false,
  texto_programa text not null default 'Acumula puntos con tus visitas y cámbialos por regalos. Administración define cuánto vale cada visita.',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references perfil (id)
);
insert into configuracion_fidelizacion (id) values (true);

-- regla_puntos ya versionaba (vigente_desde/vigente_hasta/activa); se reemplaza el cálculo por
-- "tasa" (puntos por peso) por el de bloques que pide el pedido. `tasa` se deja nullable (en vez
-- de borrarla) para no invalidar snapshots ya calculados con ella antes de esta migración.
alter table regla_puntos alter column tasa drop not null;
alter table regla_puntos add column monto_por_bloque numeric(12, 2) check (monto_por_bloque is null or monto_por_bloque > 0);
alter table regla_puntos add column puntos_por_bloque numeric(12, 2) check (puntos_por_bloque is null or puntos_por_bloque > 0);
-- Categorías/servicios que NO otorgan puntos (vacío = todo el catálogo es elegible). Arrays en
-- vez de una tabla puente: la cardinalidad es baja (unas pocas exclusiones, no un catálogo
-- entero) y así el snapshot completo de la regla cabe en una sola fila, más fácil de copiar tal
-- cual dentro de movimiento_puntos.regla_aplicada.
alter table regla_puntos add column categorias_excluidas uuid[] not null default '{}';
alter table regla_puntos add column servicios_excluidos uuid[] not null default '{}';
alter table regla_puntos add column incluye_productos boolean not null default true;

comment on column regla_puntos.monto_por_bloque is 'COP por cada bloque de puntos otorgados; null = regla legada solo con tasa, o sin configurar.';

alter table recompensa add column tipo text not null default 'beneficio' check (tipo in ('beneficio', 'descuento_fijo'));
alter table recompensa add column servicio_id uuid references servicio (id) on delete restrict;
alter table recompensa add column monto_descuento numeric(12, 2) check (monto_descuento is null or monto_descuento > 0);
-- Servicios sobre los que aplica un descuento_fijo (vacío = cualquier servicio de la atención).
alter table recompensa add column servicios_elegibles uuid[] not null default '{}';
alter table recompensa add column condiciones text;
alter table recompensa add column requiere_atencion_pagada boolean not null default true;
alter table recompensa add column stock_ilimitado boolean not null default true;
alter table recompensa add column cantidad_disponible int check (cantidad_disponible is null or cantidad_disponible >= 0);
alter table recompensa add column imagen_url text;
alter table recompensa add column orden_visualizacion int not null default 0;
alter table recompensa add column actualizado_en timestamptz not null default now();

alter table recompensa add constraint recompensa_tipo_valido check (
  (tipo = 'beneficio' and servicio_id is not null and monto_descuento is null)
  or (tipo = 'descuento_fijo' and monto_descuento is not null and servicio_id is null)
);
alter table recompensa add constraint recompensa_stock_valido check (stock_ilimitado or cantidad_disponible is not null);

-- Meta elegida por la propia clienta (sección 6 del pedido): personaliza la visualización del
-- progreso, nunca reserva puntos ni stock — por eso vive como un simple puntero, no como una fila
-- de movimiento/canje.
alter table cliente add column meta_recompensa_id uuid references recompensa (id) on delete set null;

alter table movimiento_puntos add column clave_idempotencia text;
alter table movimiento_puntos add column regla_aplicada jsonb;
alter table movimiento_puntos add column canje_id uuid;
alter table movimiento_puntos add column movimiento_revertido_id uuid references movimiento_puntos (id);
create unique index movimiento_puntos_idempotencia_idx on movimiento_puntos (clave_idempotencia) where clave_idempotencia is not null;

create table canje_recompensa (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references cliente (id) on delete restrict,
  recompensa_id uuid not null references recompensa (id) on delete restrict,
  atencion_id uuid references atencion (id) on delete set null,
  costo_puntos_snapshot numeric(12, 2) not null,
  -- Copia de nombre/tipo/condiciones al momento del canje: si después se edita la recompensa,
  -- este canje sigue mostrando exactamente lo que la clienta recibió (sección 14 del pedido).
  condiciones_snapshot jsonb not null,
  estado text not null default 'confirmado' check (estado in ('confirmado', 'revertido')),
  entregado boolean not null default false,
  empleada_id uuid references perfil (id),
  idempotency_key text unique,
  creado_en timestamptz not null default now(),
  revertido_en timestamptz,
  revertido_por uuid references perfil (id)
);
create index canje_recompensa_cliente_idx on canje_recompensa (cliente_id);
create index canje_recompensa_atencion_idx on canje_recompensa (atencion_id);

alter table movimiento_puntos add constraint movimiento_puntos_canje_fk foreign key (canje_id) references canje_recompensa (id);

-- Traza qué línea de servicio de una atención corresponde a un beneficio de fidelización
-- aplicado (sección 9.A del pedido: "conservar la trazabilidad del beneficio").
alter table atencion_servicio add column recompensa_canje_id uuid references canje_recompensa (id) on delete set null;

-- fn_registrar_devolucion (ver más abajo) gana un parámetro de idempotencia: sin esta columna,
-- repetir la llamada (doble clic, reintento de red) crearía dos filas de devolución y revertiría
-- puntos dos veces (sección 12 del pedido).
alter table pago add column idempotency_key text;
create unique index pago_idempotency_key_idx on pago (idempotency_key) where idempotency_key is not null;

-- No existía ningún sistema de notificaciones internas en el proyecto (se revisó antes de
-- escribir esta migración); se crea uno mínimo, acotado a fidelización, en vez de inventar un
-- sistema genérico que nadie más usa todavía.
create table notificacion_fidelizacion (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references cliente (id) on delete cascade,
  tipo text not null check (tipo in ('puntos_ganados', 'meta_alcanzada')),
  titulo text not null,
  mensaje text not null,
  origen_tipo text not null,
  origen_id uuid not null,
  -- NULL = todavía no se le mostró la celebración en NINGÚN dispositivo; se marca server-side
  -- (fn_marcar_notificacion_vista) para que no dependa de localStorage de un solo navegador.
  leida_en timestamptz,
  creado_en timestamptz not null default now(),
  -- Dedup natural: reprocesar el mismo cobro/canje nunca duplica la notificación.
  unique (cliente_id, tipo, origen_tipo, origen_id)
);
create index notificacion_fidelizacion_cliente_idx on notificacion_fidelizacion (cliente_id, creado_en desc);

alter table configuracion_fidelizacion enable row level security;
alter table canje_recompensa enable row level security;
alter table notificacion_fidelizacion enable row level security;

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------

create policy configuracion_fidelizacion_select_publico on configuracion_fidelizacion for select using (true);
create policy configuracion_fidelizacion_admin_escribe on configuracion_fidelizacion for update
  using (fn_es_admin()) with check (fn_es_admin());

-- Mismo criterio que ya usa cliente_select (0016): la propia clienta, admin, o cualquier
-- empleada (necesita ver los canjes de la clienta que está atendiendo). Todas las escrituras
-- pasan por fn_completar_y_cobrar_atencion / fn_revertir_canje — no hay política de INSERT.
create policy canje_recompensa_select on canje_recompensa for select
  using (fn_es_admin() or fn_es_mi_cliente(cliente_id) or fn_rol_actual() = 'empleada');

create policy notificacion_fidelizacion_select on notificacion_fidelizacion for select
  using (fn_es_admin() or fn_es_mi_cliente(cliente_id));
-- La propia clienta puede marcar SUS notificaciones como vistas (columna leida_en únicamente;
-- no puede tocar el resto de campos, que fn_marcar_notificacion_vista tampoco toca).
create policy notificacion_fidelizacion_update_propia on notificacion_fidelizacion for update
  using (fn_es_mi_cliente(cliente_id)) with check (fn_es_mi_cliente(cliente_id));

-- ---------------------------------------------------------------------------
-- 3. Funciones
-- ---------------------------------------------------------------------------

create or replace function fn_saldo_puntos(p_cliente_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(puntos), 0) from movimiento_puntos where cliente_id = p_cliente_id
$$;
grant execute on function fn_saldo_puntos to authenticated;

-- Snapshot completo de fidelización para una clienta: saldo, meta elegida y su progreso. Se
-- expone como función (no solo columnas) porque el progreso siempre debe calcularse sobre el
-- saldo DISPONIBLE actual, nunca sobre el total histórico ganado (sección 6 del pedido).
create or replace function fn_mi_fidelizacion(p_cliente_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_saldo numeric;
  v_meta recompensa;
  v_config configuracion_fidelizacion;
begin
  if not (fn_es_admin() or fn_es_mi_cliente(p_cliente_id) or fn_rol_actual() = 'empleada') then
    raise exception 'No autorizada para consultar esta fidelización';
  end if;
  select * into v_config from configuracion_fidelizacion where id = true;
  v_saldo := fn_saldo_puntos(p_cliente_id);
  select r.* into v_meta from cliente c join recompensa r on r.id = c.meta_recompensa_id
  where c.id = p_cliente_id;
  -- Sin meta elegida: por defecto, la recompensa activa de menor costo que la clienta ya puede
  -- alcanzar viendo el catálogo (sección 6: "selecciona por defecto la recompensa activa de
  -- menor costo en puntos que esté disponible").
  if v_meta is null then
    select r.* into v_meta from recompensa r
    where r.activa and (r.stock_ilimitado or coalesce(r.cantidad_disponible, 0) > 0)
    order by r.costo_puntos asc limit 1;
  end if;
  return jsonb_build_object(
    'saldo', v_saldo,
    'acumulacion_activa', coalesce(v_config.acumulacion_activa, false),
    'canjes_activo', coalesce(v_config.canjes_activo, false),
    'texto_programa', v_config.texto_programa,
    'meta', case when v_meta is null then null else to_jsonb(v_meta) end,
    'progreso', case when v_meta is null or v_meta.costo_puntos <= 0 then null
      else least(greatest(v_saldo / v_meta.costo_puntos, 0), 1) end,
    'puntos_faltantes', case when v_meta is null then null else greatest(v_meta.costo_puntos - v_saldo, 0) end
  );
end;
$$;
grant execute on function fn_mi_fidelizacion to authenticated;

-- Elegir meta (sección 6): nunca descuenta puntos ni reserva stock, solo valida y guarda el
-- puntero. p_recompensa_id = null quita la meta elegida (vuelve al comportamiento por defecto).
create or replace function fn_elegir_meta_recompensa(p_cliente_id uuid, p_recompensa_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (fn_es_admin() or fn_es_mi_cliente(p_cliente_id)) then
    raise exception 'No autorizada para elegir esta meta';
  end if;
  if p_recompensa_id is not null and not exists (
    select 1 from recompensa where id = p_recompensa_id and activa
  ) then
    raise exception 'Esa recompensa ya no está disponible como meta.';
  end if;
  update cliente set meta_recompensa_id = p_recompensa_id where id = p_cliente_id;
end;
$$;
grant execute on function fn_elegir_meta_recompensa to authenticated;

create or replace function fn_marcar_notificacion_vista(p_notificacion_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cliente_id uuid;
begin
  select cliente_id into v_cliente_id from notificacion_fidelizacion where id = p_notificacion_id;
  if v_cliente_id is null or not fn_es_mi_cliente(v_cliente_id) then
    raise exception 'No autorizada';
  end if;
  update notificacion_fidelizacion set leida_en = now() where id = p_notificacion_id and leida_en is null;
end;
$$;
grant execute on function fn_marcar_notificacion_vista to authenticated;

-- Reconstruye la respuesta de fidelización de un cobro ya procesado, leyendo lo que de verdad
-- quedó guardado — la usan tanto el camino "recién procesado" como el "reintento idempotente",
-- así que ambos devuelven EXACTAMENTE lo mismo sin repetir ningún efecto.
create or replace function fn_resultado_cobro(p_atencion_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_puntos_ganados numeric;
  v_puntos_utilizados numeric;
  v_canje canje_recompensa;
begin
  select * into v_atencion from atencion where id = p_atencion_id;
  select coalesce(sum(puntos), 0) into v_puntos_ganados from movimiento_puntos
    where referencia_tipo = 'atencion' and referencia_id = p_atencion_id and tipo = 'abono';
  select cr.*, coalesce(sum(mp.puntos), 0) as puntos_movimiento into v_canje
    from canje_recompensa cr left join movimiento_puntos mp on mp.canje_id = cr.id
    where cr.atencion_id = p_atencion_id
    group by cr.id;
  v_puntos_utilizados := coalesce(v_canje.costo_puntos_snapshot, 0);
  return jsonb_build_object(
    'atencion', to_jsonb(v_atencion),
    'puntos_ganados', v_puntos_ganados,
    'puntos_utilizados', v_puntos_utilizados,
    'saldo_nuevo', fn_saldo_puntos(v_atencion.cliente_id),
    'recompensa_aplicada', case when v_canje.id is null then null else jsonb_build_object(
      'canje_id', v_canje.id, 'nombre', v_canje.condiciones_snapshot ->> 'nombre', 'tipo', v_canje.condiciones_snapshot ->> 'tipo'
    ) end
  );
end;
$$;
grant execute on function fn_resultado_cobro to authenticated;

-- fn_completar_y_cobrar_atencion: mismo evento real de "cobro confirmado" que ya existía
-- (0023_comisiones_por_servicio_origen), extendido con canje opcional + abono con la nueva
-- regla por bloques. p_recompensa_id es opcional para no romper el único call site existente.
-- Cambia el tipo de retorno de `atencion` a `jsonb` (incluye la atención completa adentro) para
-- poder devolver también los valores definitivos de fidelización sin un segundo viaje al
-- servidor — el único llamador real (app/src/lib/api/empleada.ts) se actualiza junto con esto.
-- El cambio de tipo de retorno obliga a soltar la función anterior primero (CREATE OR REPLACE no
-- permite cambiar el tipo de retorno).
drop function if exists fn_completar_y_cobrar_atencion(uuid, jsonb, text);

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

  -- Bloquea la fila de la clienta: dos empleadas cobrando a la vez, o un canje simultáneo, nunca
  -- leen/graban su saldo al mismo tiempo (sección 12 del pedido).
  perform 1 from cliente where id = v_atencion.cliente_id for update;

  select coalesce(sum((precio_snapshot - descuento) * cantidad), 0) into v_total_servicios
  from atencion_servicio where atencion_id = p_atencion_id;
  select coalesce(sum(precio_unitario * cantidad), 0) into v_total_productos
  from atencion_producto where atencion_id = p_atencion_id;
  v_total_atencion := v_total_servicios + v_total_productos;

  select * into v_config from configuracion_fidelizacion where id = true;
  select * into v_regla_puntos from regla_puntos where activa and vigente_hasta is null limit 1;

  -- Saldo ANTES de este cobro: los puntos que esta misma compra genera nunca financian su
  -- propio canje (sección 11 del pedido, validación explícita).
  v_saldo_anterior := fn_saldo_puntos(v_atencion.cliente_id);

  if p_recompensa_id is not null then
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
    if v_saldo_anterior < v_recompensa.costo_puntos then
      raise exception 'No tienes suficientes puntos para esta recompensa.';
    end if;
    if v_recompensa.requiere_atencion_pagada and v_total_atencion <= 0 then
      raise exception 'Esta recompensa requiere una atención con servicios o productos cobrados.';
    end if;
    if v_recompensa.tipo = 'descuento_fijo' then
      v_descuento_recompensa := least(v_recompensa.monto_descuento, v_total_atencion);
    end if;
    -- tipo 'beneficio': no reduce el total aquí — el servicio de regalo ya se registró en la
    -- atención con precio 0 desde el paso "Registrar" (ver Atender.tsx), así que el total ya lo
    -- refleja; solo queda dejar constancia del canje y su trazabilidad más abajo.
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
  -- Nota: v_cobrado_servicios usa v_total_servicios/v_total_productos ORIGINALES (antes del
  -- descuento de la recompensa) para prorratear comisión — ese cálculo es ajeno a fidelización
  -- y no cambia respecto a la versión anterior de esta función.

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

    -- Traza la línea de servicio del regalo (si la hay) hasta este canje.
    update atencion_servicio set recompensa_canje_id = v_canje_id
    where atencion_id = p_atencion_id and servicio_id = v_recompensa.servicio_id and precio_snapshot = 0
      and recompensa_canje_id is null;

    -- Si esta era su meta elegida, se limpia: ya se usó (sección 6 — "Después de canjear,
    -- actualiza el progreso al saldo restante").
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

    -- El descuento de la recompensa se resta del elegible en la misma proporción que representa
    -- sobre el total original (antes del descuento) — así nunca se otorgan puntos sobre dinero
    -- que en realidad no se pagó (sección 10: "usa el importe neto después de descuentos y
    -- recompensas").
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

-- fn_registrar_devolucion: se extiende (mismo evento real — un pago con monto negativo) para
-- recalcular puntos por RECOMPUTO desde el monto elegible retenido (usando la regla que se
-- aplicó originalmente, snapshot en movimiento_puntos.regla_aplicada) en vez de la aproximación
-- proporcional que ya traía, que con floor() puede desviarse. Considera reversiones previas para
-- no revertir dos veces (sección 13 del pedido).
-- Agrega un parámetro nuevo (idempotencia): sin soltar la firma anterior antes, Postgres deja
-- coexistir dos sobrecargas y "grant ... fn_registrar_devolucion" (sin lista de argumentos) deja
-- de ser válido por ambigüedad.
drop function if exists fn_registrar_devolucion(uuid, numeric, text);

create or replace function fn_registrar_devolucion(
  p_pago_id uuid,
  p_monto numeric,
  p_motivo text,
  p_idempotency_key text default null
) returns pago
language plpgsql security definer set search_path = public as $$
declare
  v_pago_original pago;
  v_devolucion pago;
  v_ya_procesada pago;
  v_atencion_id uuid;
  v_cliente_id uuid;
  v_comision_original comision;
  v_proporcion numeric;
  v_abono movimiento_puntos;
  v_ya_revertido numeric;
  v_monto_elegible_original numeric;
  v_bloque_monto numeric;
  v_bloque_puntos numeric;
  v_total_pagado_original numeric;
  v_total_devuelto_previo numeric;
  v_monto_elegible_retenido numeric;
  v_puntos_correspondientes numeric;
  v_diferencia_a_revertir numeric;
begin
  if not fn_es_admin() and not fn_tiene_permiso('puede_anular_ventas') then
    raise exception 'No autorizada para registrar devoluciones';
  end if;

  if p_idempotency_key is not null then
    select * into v_ya_procesada from pago where referencia_pago_id = p_pago_id and idempotency_key = p_idempotency_key;
    if found then return v_ya_procesada; end if;
  end if;

  select * into v_pago_original from pago where id = p_pago_id for update;
  if v_pago_original is null then raise exception 'Pago no encontrado'; end if;
  if p_monto > v_pago_original.monto then
    raise exception 'El monto a devolver no puede superar el pago original';
  end if;

  v_atencion_id := v_pago_original.atencion_id;
  perform 1 from atencion where id = v_atencion_id for update;
  select cliente_id into v_cliente_id from atencion where id = v_atencion_id;

  insert into pago (atencion_id, metodo, monto, referencia_pago_id, registrado_por, idempotency_key)
  values (v_pago_original.atencion_id, v_pago_original.metodo, -p_monto, p_pago_id, auth.uid(), p_idempotency_key)
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
      'generada'
    );
  end loop;

  -- Puntos: se busca el abono original de esta atención y su snapshot de regla. Sin snapshot
  -- (movimientos anteriores a esta migración, o sin regla configurada al momento del cobro) se
  -- cae de vuelta a la aproximación proporcional que ya existía, único caso donde no hay datos
  -- suficientes para recomputar.
  select * into v_abono from movimiento_puntos
    where referencia_tipo = 'atencion' and referencia_id = v_atencion_id and tipo = 'abono'
    order by creado_en asc limit 1;

  if v_abono.id is not null then
    select coalesce(sum(-puntos), 0) into v_ya_revertido from movimiento_puntos
      where movimiento_revertido_id = v_abono.id and tipo = 'reversion';

    if v_abono.regla_aplicada is not null and (v_abono.regla_aplicada ->> 'monto_elegible_neto') is not null then
      v_monto_elegible_original := (v_abono.regla_aplicada ->> 'monto_elegible_neto')::numeric;
      v_bloque_monto := (v_abono.regla_aplicada ->> 'monto_por_bloque')::numeric;
      v_bloque_puntos := (v_abono.regla_aplicada ->> 'puntos_por_bloque')::numeric;

      select coalesce(sum(monto), 0) into v_total_pagado_original from pago where atencion_id = v_atencion_id and monto > 0;
      select coalesce(sum(-monto), 0) into v_total_devuelto_previo from pago
        where atencion_id = v_atencion_id and monto < 0 and id <> v_devolucion.id;

      if v_total_pagado_original > 0 then
        v_monto_elegible_retenido := greatest(
          round(v_monto_elegible_original * (v_total_pagado_original - v_total_devuelto_previo - p_monto) / v_total_pagado_original, 2),
          0
        );
      else
        v_monto_elegible_retenido := 0;
      end if;

      v_puntos_correspondientes := floor(v_monto_elegible_retenido / v_bloque_monto) * v_bloque_puntos;
      v_diferencia_a_revertir := (v_abono.puntos - v_ya_revertido) - v_puntos_correspondientes;
    else
      -- Movimiento legado sin snapshot: aproximación proporcional (comportamiento anterior).
      v_diferencia_a_revertir := round(v_abono.puntos * v_proporcion, 2);
    end if;

    -- El saldo puede quedar negativo si los puntos ya se gastaron (sección 13 del pedido, a
    -- propósito: no se cancelan otros canjes ni se bloquea la reversión por eso).
    if v_diferencia_a_revertir > 0 then
      insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, referencia_id, movimiento_revertido_id, clave_idempotencia, motivo, creado_por)
      values (
        v_cliente_id, 'reversion', -v_diferencia_a_revertir, 'atencion', v_atencion_id, v_abono.id,
        'reversion:' || v_devolucion.id, p_motivo, auth.uid()
      );
    end if;
  end if;

  return v_devolucion;
end;
$$;

grant execute on function fn_registrar_devolucion to authenticated;

-- fn_eliminar_venta: se extiende para revertir (no dejar huérfano) un canje ligado a la venta que
-- se borra. Si el beneficio YA fue entregado, el canje se conserva y solo se avisa — no se
-- deshace en silencio (sección 13: "si el beneficio ya se entregó, conserva el canje y permite
-- una corrección administrativa auditada", que son los ajustes manuales de la sección 14).
create or replace function fn_eliminar_venta(p_atencion_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cliente_id uuid;
  v_canje canje_recompensa;
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

  select * into v_canje from canje_recompensa where atencion_id = p_atencion_id and estado = 'confirmado';
  if v_canje.id is not null and not v_canje.entregado then
    update canje_recompensa set estado = 'revertido', revertido_en = now(), revertido_por = auth.uid() where id = v_canje.id;
    if not exists (select 1 from recompensa r where r.id = v_canje.recompensa_id and r.stock_ilimitado) then
      update recompensa set cantidad_disponible = cantidad_disponible + 1 where id = v_canje.recompensa_id;
    end if;
  end if;
  -- Si v_canje.entregado, se deja como está a propósito: el movimiento de puntos del canje
  -- (delete más abajo, igual que ya hacía esta función con TODOS los movimientos de la atención)
  -- de todas formas desaparece junto con la venta completa — es coherente con que borrar una
  -- venta significa "esto nunca pasó", a diferencia de una devolución parcial real.

  delete from movimiento_puntos where referencia_tipo = 'atencion' and referencia_id = p_atencion_id;
  delete from movimiento_puntos where canje_id = v_canje.id;

  delete from comision
  where atencion_servicio_id in (select id from atencion_servicio where atencion_id = p_atencion_id);

  delete from pago where atencion_id = p_atencion_id;
  delete from atencion where id = p_atencion_id;

  perform fn_recalcular_contadores_cliente(v_cliente_id);
end;
$$;

grant execute on function fn_eliminar_venta to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Ajustes manuales auditados (sección 14 del pedido) y consultas admin
-- ---------------------------------------------------------------------------

create or replace function fn_ajustar_puntos_manual(p_cliente_id uuid, p_puntos numeric, p_motivo text) returns movimiento_puntos
language plpgsql security definer set search_path = public as $$
declare
  v_movimiento movimiento_puntos;
begin
  if not fn_es_admin() then
    raise exception 'Solo administración puede hacer ajustes manuales de puntos';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo del ajuste es obligatorio';
  end if;
  if p_puntos = 0 then
    raise exception 'El ajuste no puede ser cero';
  end if;

  insert into movimiento_puntos (cliente_id, tipo, puntos, referencia_tipo, motivo, creado_por)
  values (p_cliente_id, 'ajuste', p_puntos, 'ajuste_manual', p_motivo, auth.uid())
  returning * into v_movimiento;

  return v_movimiento;
end;
$$;

grant execute on function fn_ajustar_puntos_manual to authenticated;
