-- 0071_analytics_dashboard.sql
-- Dashboard admin (/admin/dashboard) evoluciona a un módulo real de analytics con filtro de
-- fecha global (hoy/ayer/semana/mes/personalizado) y comparación de periodos. Resumen (/admin) y
-- Ventas (/admin/ventas) NO cambian: siguen siendo la pareja operativa (KPIs rápidos + tabla
-- editable), con sus propias consultas intactas.
--
-- Objetivo de esta función: una sola fuente de verdad para todo lo que muestra el Dashboard
-- nuevo (KPIs, gráfica de evolución, por profesional, por servicio, por producto, por método de
-- pago) en un solo viaje al servidor, en vez de las 4+ consultas independientes que hace hoy
-- metricasVentasDashboard/resumenNegocio/listarVentasDetalle/listarProductosVendidos.
--
-- Reglas de negocio que replica EXACTAMENTE de lo que ya existe (no se inventa una definición
-- nueva de "venta"):
--   - Solo cuentan atenciones con estado = 'completada' (nunca en_progreso ni anulada).
--   - "Ventas totales" = servicios, no incluye productos (mismo criterio que resumenNegocio.
--     ventasNetas) — productos se muestra como su propio número, igual que ya hace Ventas.tsx.
--   - "Ticket promedio" = ventas totales ÷ número de ATENCIONES completadas, nunca ÷ servicios.
--   - Comisión: se lee de `comision` (ya calculada por fn_completar_y_cobrar_atencion con la
--     regla vigente en su momento), nunca se recalcula aquí con un porcentaje propio.
--
-- Decisión nueva (solo para este Dashboard, no afecta Resumen/Ventas que ya funcionan así):
-- la fecha de referencia de una venta es coalesce(completado_en, creado_en) — cuándo se cobró,
-- no cuándo se abrió la atención — para que "cuánto vendimos el sábado" sea exacto incluso si
-- una atención se abrió la noche anterior. Pago y comisión se filtran uniendo contra la misma
-- atención (no por su propio creado_en) para que profesional/servicio/método/comisión siempre
-- sumen exactamente lo mismo que "ventas totales" — es la propiedad de consistencia que se pide
-- explícitamente en el pedido ("un widget no puede tener una regla distinta a otro").

-- --------------------------------------------------------------------------------------------
-- Índices: las consultas de este módulo (y las que ya existen en Resumen/Ventas/Dashboard viejo)
-- filtran por estas columnas y hoy no tienen índice. Aditivo, sin tocar nada existente.
-- --------------------------------------------------------------------------------------------
create index if not exists atencion_completado_en_idx on atencion (completado_en);
create index if not exists atencion_creado_en_idx on atencion (creado_en);
create index if not exists pago_creado_en_idx on pago (creado_en);
create index if not exists comision_creado_en_idx on comision (creado_en);

-- --------------------------------------------------------------------------------------------
create or replace function fn_analytics_resumen(p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid := fn_local_id();
  v_ventas_totales numeric := 0;
  v_atenciones_count int := 0;
  v_clientes_count int := 0;
  v_servicios_count numeric := 0;
  v_productos_valor numeric := 0;
  v_productos_unidades numeric := 0;
  v_por_profesional jsonb;
  v_por_servicio jsonb;
  v_por_producto jsonb;
  v_por_metodo_pago jsonb;
  v_serie_diaria jsonb;
begin
  if not fn_es_admin() then
    raise exception 'No autorizada para consultar analytics';
  end if;
  if v_local is null then
    raise exception 'Tu perfil no tiene un local asignado';
  end if;
  if p_hasta <= p_desde then
    raise exception 'El rango de fechas no es válido (hasta debe ser posterior a desde)';
  end if;

  -- Por si la función se llama dos veces dentro de la misma transacción (p. ej. durante
  -- pruebas en un solo bloque de psql): `on commit drop` no alcanza a limpiar entre llamadas
  -- si el commit todavía no pasó.
  drop table if exists tmp_atenciones_periodo, tmp_servicios_periodo;

  create temporary table tmp_atenciones_periodo on commit drop as
  select a.id, a.cliente_id, coalesce(a.completado_en, a.creado_en) as fecha_referencia
  from atencion a
  where a.local_id = v_local
    and a.estado = 'completada'
    and coalesce(a.completado_en, a.creado_en) >= p_desde
    and coalesce(a.completado_en, a.creado_en) < p_hasta;

  create temporary table tmp_servicios_periodo on commit drop as
  select ase.*
  from atencion_servicio ase
  join tmp_atenciones_periodo ap on ap.id = ase.atencion_id;

  -- KPIs base (ventas de servicios, conteo de atenciones/clientes/servicios).
  select
    coalesce(sum((precio_snapshot - descuento) * cantidad), 0),
    coalesce(sum(cantidad), 0)
  into v_ventas_totales, v_servicios_count
  from tmp_servicios_periodo;

  select count(*), count(distinct cliente_id) into v_atenciones_count, v_clientes_count
  from tmp_atenciones_periodo;

  -- Productos: mismo criterio que listarProductosVendidos (une por la atención, no por su
  -- propia fecha, ya que atencion_producto no tiene columna de fecha propia).
  select coalesce(sum(ap.precio_unitario * ap.cantidad), 0), coalesce(sum(ap.cantidad), 0)
  into v_productos_valor, v_productos_unidades
  from atencion_producto ap
  join tmp_atenciones_periodo tp on tp.id = ap.atencion_id;

  -- Por profesional: ventas + clientes atendidos + servicios + comisión real (de `comision`,
  -- nunca recalculada). Tres agregados INDEPENDIENTES unidos al final por profesional_id — nunca
  -- un solo join de las tres tablas a la vez, que multiplicaría filas (una atención con 2
  -- servicios de la misma profesional, cruzada con 2 filas de comisión de esos servicios,
  -- inflaría "ventas" y "servicios" al doble) y dañaría justo la propiedad de consistencia que
  -- se busca.
  with vp_ventas as (
    select sp.profesional_id, vp.nombre,
           sum((sp.precio_snapshot - sp.descuento) * sp.cantidad) as ventas,
           sum(sp.cantidad) as servicios
    from tmp_servicios_periodo sp
    join vista_profesional vp on vp.id = sp.profesional_id
    group by sp.profesional_id, vp.nombre
  ),
  vp_clientes as (
    select sp.profesional_id, count(distinct ap.cliente_id) as clientes
    from tmp_servicios_periodo sp
    join tmp_atenciones_periodo ap on ap.id = sp.atencion_id
    group by sp.profesional_id
  ),
  vp_comision as (
    select sp.profesional_id, sum(co.valor) as comision
    from comision co
    join tmp_servicios_periodo sp on sp.id = co.atencion_servicio_id
    group by sp.profesional_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'profesional_id', v.profesional_id,
      'nombre', v.nombre,
      'ventas', v.ventas,
      'clientes', coalesce(c.clientes, 0),
      'servicios', v.servicios,
      'comision', coalesce(co.comision, 0)
    ) order by v.ventas desc), '[]'::jsonb)
  into v_por_profesional
  from vp_ventas v
  left join vp_clientes c on c.profesional_id = v.profesional_id
  left join vp_comision co on co.profesional_id = v.profesional_id;

  -- Por servicio: nombre (snapshot, resiste que el servicio real se haya renombrado/borrado),
  -- cantidad realizada e ingresos.
  select coalesce(jsonb_agg(fila order by fila->>'ingresos' desc), '[]'::jsonb) into v_por_servicio
  from (
    select jsonb_build_object(
      'servicio_id', servicio_id,
      'nombre', nombre_snapshot,
      'cantidad', sum(cantidad),
      'ingresos', sum((precio_snapshot - descuento) * cantidad)
    ) as fila
    from tmp_servicios_periodo
    group by servicio_id, nombre_snapshot
  ) t;

  -- Por producto: categoria/nombre son snapshot de texto libre (atencion_producto no tiene FK
  -- al catálogo `producto`, ver 0044) — se agrupa tal cual están guardados.
  select coalesce(jsonb_agg(fila order by fila->>'ingresos' desc), '[]'::jsonb) into v_por_producto
  from (
    select jsonb_build_object(
      'nombre', ap.nombre,
      'categoria', ap.categoria,
      'cantidad', sum(ap.cantidad),
      'ingresos', sum(ap.precio_unitario * ap.cantidad)
    ) as fila
    from atencion_producto ap
    join tmp_atenciones_periodo tp on tp.id = ap.atencion_id
    group by ap.nombre, ap.categoria
  ) t;

  -- Métodos de pago: unido por la atención (no por pago.creado_en) para que la suma cuadre
  -- exactamente con "ventas totales" — a diferencia del Dashboard viejo, que sumaba todos los
  -- pagos del rango sin filtrar por atenciones completadas.
  select coalesce(jsonb_agg(fila order by fila->>'valor' desc), '[]'::jsonb) into v_por_metodo_pago
  from (
    select jsonb_build_object('metodo', pg.metodo, 'valor', sum(pg.monto)) as fila
    from pago pg
    join tmp_atenciones_periodo tp on tp.id = pg.atencion_id
    group by pg.metodo
    having sum(pg.monto) > 0
  ) t;

  -- Serie diaria (siempre por día calendario en hora de Bogotá; la vista de "por hora" para un
  -- solo día se arma en el cliente a partir de las mismas filas ya traídas, no hace falta una
  -- segunda función solo para eso).
  select coalesce(jsonb_agg(fila order by fila->>'fecha'), '[]'::jsonb) into v_serie_diaria
  from (
    select jsonb_build_object(
      'fecha', (fecha_referencia at time zone 'America/Bogota')::date,
      'ventas', sum((sp.precio_snapshot - sp.descuento) * sp.cantidad)
    ) as fila
    from tmp_servicios_periodo sp
    join tmp_atenciones_periodo ap on ap.id = sp.atencion_id
    group by (fecha_referencia at time zone 'America/Bogota')::date
  ) t;

  return jsonb_build_object(
    'kpis', jsonb_build_object(
      'ventas_totales', v_ventas_totales,
      'atenciones', v_atenciones_count,
      'clientes_atendidos', v_clientes_count,
      'servicios_realizados', v_servicios_count,
      'ticket_promedio', case when v_atenciones_count > 0 then round(v_ventas_totales / v_atenciones_count, 2) else 0 end,
      'productos_valor', v_productos_valor,
      'productos_unidades', v_productos_unidades
    ),
    'por_profesional', v_por_profesional,
    'por_servicio', v_por_servicio,
    'por_producto', v_por_producto,
    'por_metodo_pago', v_por_metodo_pago,
    'serie_diaria', v_serie_diaria
  );
end;
$$;

grant execute on function fn_analytics_resumen to authenticated;
