-- 0028_seed_catalogo_servicios.sql
-- Carga del catálogo real de servicios en 4 categorías (Peluquería, Maquillaje, Manicura y
-- pedicura, Estética). Idempotente: se puede correr más de una vez sin duplicar nada.
--
-- Reglas aplicadas (ver conversación con el negocio):
--   - El catálogo nuevo pasa a ser el único activo: TODO lo que ya existiera en `servicio`
--     se desactiva primero (nunca se borra — el historial de ventas ya hechas usa su propio
--     snapshot de nombre/precio en atencion_servicio, totalmente independiente de esta tabla,
--     así que desactivar u ocultar un servicio no cambia ni un peso de una venta pasada).
--   - Si un servicio de la lista nueva ya existía con ese mismo nombre (comparando sin
--     mayúsculas ni espacios de sobra), se ACTUALIZA en el mismo lugar (conserva su id, y con
--     él cualquier asignación a profesionales o regla de comisión por servicio que ya tuviera)
--     en vez de crear una fila duplicada.
--   - "Diseño de cejas con cuchilla" y "Cambio de esmalte" quedan como PENDIENTES DE REVISIÓN:
--     se cargan con activo=false (no aparecen para elegir en Atender ni en el sitio público)
--     porque su precio real es ambiguo en el texto original — nunca se les asigna un número
--     inventado ni un 0 de relleno.
--   - Precios de paquete (depilación láser, paquete reductor) son el precio del paquete
--     COMPLETO, no se dividen por sesión.
--   - Cada variante de laminado de cejas es su propio servicio seleccionable.
--   - Ningún servicio nuevo trae duracion_minutos (no se inventa): queda NULL, seleccionable
--     igual en Atender (que nunca depende de ese campo), sin ofrecerse para reserva en línea
--     hasta que alguien le configure una duración real desde Admin → Servicios.
--
-- Quedaron FUERA de esta carga (ni se insertan ni se actualiza nada por ellos — solo texto
-- suelto del pedido original, sin nombre/precio propio y claro):
--   - "lipstin de pestaña: cejas semipermanente" (no se sabe si es uno o dos servicios).
--   - La mención de "Hidrofacial" dentro de Tratamientos faciales (no se sabe qué extremo del
--     rango 100.000–200.000 le corresponde).
--   - La variante "localizado" del Paquete relajante (se menciona que "aumenta el precio",
--     sin monto).

do $$
declare
  v_cat_peluqueria uuid;
  v_cat_maquillaje uuid;
  v_cat_manicura uuid;
  v_cat_estetica uuid;
  v_row record;
  v_cat_id uuid;
  v_id uuid;
  v_id_nuevo uuid;
  v_ids_tocados uuid[] := array[]::uuid[];
  v_creados int := 0;
  v_actualizados int := 0;
  v_pendientes int := 0;
  v_desactivados int := 0;
  v_inactivos_restantes text;
begin
  insert into categoria_servicio (nombre, orden_visualizacion) values ('Peluquería', 1) on conflict (nombre) do nothing;
  insert into categoria_servicio (nombre, orden_visualizacion) values ('Maquillaje', 2) on conflict (nombre) do nothing;
  insert into categoria_servicio (nombre, orden_visualizacion) values ('Manicura y pedicura', 3) on conflict (nombre) do nothing;
  insert into categoria_servicio (nombre, orden_visualizacion) values ('Estética', 4) on conflict (nombre) do nothing;

  select id into v_cat_peluqueria from categoria_servicio where nombre = 'Peluquería';
  select id into v_cat_maquillaje from categoria_servicio where nombre = 'Maquillaje';
  select id into v_cat_manicura from categoria_servicio where nombre = 'Manicura y pedicura';
  select id into v_cat_estetica from categoria_servicio where nombre = 'Estética';

  update servicio set activo = false where activo = true;
  get diagnostics v_desactivados = row_count;

  for v_row in
    select * from (values
      ('peluqueria', 'Blower', 'desde', 35000::numeric, null::numeric, true, null::text),
      ('peluqueria', 'Aminoácidos', 'desde', 220000::numeric, null::numeric, true, null::text),
      ('peluqueria', 'Color basic', 'desde', 120000::numeric, null::numeric, true, null::text),
      ('peluqueria', 'Color premium', 'desde', 250000::numeric, null::numeric, true, null::text),
      ('peluqueria', 'Corte de cabello', 'desde', 30000::numeric, null::numeric, true, null::text),
      ('peluqueria', 'Definición de rizos', 'desde', 70000::numeric, null::numeric, true, null::text),
      ('peluqueria', 'Peinados', 'desde', 70000::numeric, null::numeric, true, null::text),

      ('maquillaje', 'Maquillaje social', 'desde', 120000::numeric, null::numeric, true, null::text),
      ('maquillaje', 'Maquillaje express', 'desde', 80000::numeric, null::numeric, true, null::text),
      ('maquillaje', 'Maquillaje de evento', 'fijo', 180000::numeric, null::numeric, true, null::text),
      ('maquillaje', 'Diseño de cejas con cuchilla', 'fijo', 25000::numeric, null::numeric, false,
        '[PENDIENTE DE REVISIÓN] Texto original: "25.000 + henna". Confirmar si la henna está incluida en este precio o tiene recargo aparte antes de activarlo.'),
      ('maquillaje', 'Diseño de cejas con hilo + henna', 'fijo', 50000::numeric, null::numeric, true, null::text),
      ('maquillaje', 'Laminado de cejas sin henna', 'fijo', 70000::numeric, null::numeric, true, null::text),
      ('maquillaje', 'Laminado de cejas con henna', 'fijo', 90000::numeric, null::numeric, true, null::text),
      ('maquillaje', 'Cejas semipermanentes con henna, sin depilación', 'fijo', 20000::numeric, null::numeric, true, null::text),
      ('maquillaje', 'Pestañas punto a punto', 'fijo', 25000::numeric, null::numeric, true, null::text),

      ('manicura', 'Tradicional básico: manos y pies', 'fijo', 45000::numeric, null::numeric, true, 'Precio del conjunto (manos + pies).'),
      ('manicura', 'Manos', 'fijo', 22000::numeric, null::numeric, true, null::text),
      ('manicura', 'Pies', 'fijo', 25000::numeric, null::numeric, true, null::text),
      ('manicura', 'Cambio de esmalte', 'a_valorar', null::numeric, null::numeric, false,
        '[PENDIENTE DE REVISIÓN] Texto original ambiguo: "15.0000". Podría ser $15.000, pero no se asigna sin confirmar con el salón — nunca se pone un precio a ciegas.'),
      ('manicura', 'Poligel con tic', 'fijo', 75000::numeric, null::numeric, true, 'Nombre conservado tal cual el original; confirmar si "tic" debía decir "tip".'),
      ('manicura', 'Poligel sin tic', 'fijo', 70000::numeric, null::numeric, true, 'Nombre conservado tal cual el original; confirmar si "tic" debía decir "tip".'),
      ('manicura', 'Baño de acrílico', 'fijo', 80000::numeric, null::numeric, true, null::text),
      ('manicura', 'Acrílicas', 'fijo', 85000::numeric, null::numeric, true, 'Largo 2, diseño sencillo.'),
      ('manicura', 'Press-on', 'fijo', 70000::numeric, null::numeric, true, null::text),
      ('manicura', 'Semipermanente', 'fijo', 60000::numeric, null::numeric, true, null::text),
      ('manicura', 'Retiro de semipermanente', 'fijo', 15000::numeric, null::numeric, true, null::text),
      ('manicura', 'Retiro de acrílicas', 'fijo', 20000::numeric, null::numeric, true, null::text),

      ('estetica', 'Paquete reductor', 'fijo', 800000::numeric, null::numeric, true, 'Precio del paquete completo; cantidad de sesiones no confirmada.'),
      ('estetica', 'Tratamientos faciales', 'rango', 100000::numeric, 200000::numeric, true,
        'Rango de precio del tratamiento facial; falta confirmar qué tratamiento (p. ej. "Hidrofacial") corresponde a cada extremo.'),
      ('estetica', 'Paquete relajante', 'fijo', 180000::numeric, null::numeric, true,
        'Precio base. Se mencionó una variante "localizado" que aumentaría el precio, sin monto confirmado — esa variante no está incluida aquí.'),
      ('estetica', 'Depilación láser: axila y bikini', 'fijo', 600000::numeric, null::numeric, true, 'Paquete completo de 10 sesiones.'),
      ('estetica', 'Depilación: axila, bikini, pierna completa y bozo', 'fijo', 1000000::numeric, null::numeric, true,
        'Técnica y cantidad de sesiones sin confirmar; no asumir 10 sesiones.'),
      ('estetica', 'Depilación con cera: axila', 'fijo', 50000::numeric, null::numeric, true, null::text),
      ('estetica', 'Depilación de cejas', 'fijo', 30000::numeric, null::numeric, true, 'Técnica sin confirmar; no asumir que es con cera.')
    ) as t(cat_key, nombre, tipo_precio, precio, precio_maximo, activo, descripcion)
  loop
    v_cat_id := case v_row.cat_key
      when 'peluqueria' then v_cat_peluqueria
      when 'maquillaje' then v_cat_maquillaje
      when 'manicura' then v_cat_manicura
      when 'estetica' then v_cat_estetica
    end;

    select id into v_id from servicio where lower(trim(nombre)) = lower(trim(v_row.nombre)) limit 1;

    if v_id is null then
      insert into servicio (categoria_id, nombre, descripcion, tipo_precio, precio, precio_maximo, activo)
      values (v_cat_id, v_row.nombre, v_row.descripcion, v_row.tipo_precio::tipo_precio_servicio, v_row.precio, v_row.precio_maximo, v_row.activo)
      returning id into v_id_nuevo;
      v_ids_tocados := array_append(v_ids_tocados, v_id_nuevo);
      v_creados := v_creados + 1;
      if not v_row.activo then v_pendientes := v_pendientes + 1; end if;
      raise notice '% : %', case when v_row.activo then 'CREADO' else 'CREADO (PENDIENTE DE REVISIÓN, inactivo)' end, v_row.nombre;
    else
      update servicio set
        categoria_id = v_cat_id,
        descripcion = v_row.descripcion,
        tipo_precio = v_row.tipo_precio::tipo_precio_servicio,
        precio = v_row.precio,
        precio_maximo = v_row.precio_maximo,
        activo = v_row.activo,
        actualizado_en = now()
      where id = v_id;
      v_ids_tocados := array_append(v_ids_tocados, v_id);
      v_actualizados := v_actualizados + 1;
      if not v_row.activo then v_pendientes := v_pendientes + 1; end if;
      raise notice '% : % (ya existía con ese nombre, id %)', case when v_row.activo then 'ACTUALIZADO' else 'ACTUALIZADO (PENDIENTE DE REVISIÓN, inactivo)' end, v_row.nombre, v_id;
    end if;
  end loop;

  select string_agg(nombre, ', ' order by nombre) into v_inactivos_restantes
  from servicio
  where activo = false and not (id = any(v_ids_tocados));

  raise notice '=== RESUMEN: % servicios previos desactivados, % creados, % actualizados (ya existían con ese nombre), % del catálogo nuevo quedaron pendientes de revisión (inactivos) ===',
    v_desactivados, v_creados, v_actualizados, v_pendientes;
  if v_inactivos_restantes is not null then
    raise notice 'Servicios que existían ANTES y quedaron INACTIVOS por no estar en el catálogo nuevo (no se borraron, solo se ocultan): %', v_inactivos_restantes;
  end if;
end $$;
