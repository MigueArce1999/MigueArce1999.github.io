-- 0072_clientas_360.sql
-- Convierte Clientas (ya existente en /admin/clientes y /admin/clientes/:id) en una ficha 360°:
-- historial real de visitas, notas/observaciones, recomendaciones + "cuándo volver", seguimientos
-- pendientes, y conexión con Agenda/Peluquería en Vivo/Fidelización YA existentes.
--
-- Principio: NO se duplica ninguna fuente de verdad. Ventas/servicios/productos siguen viviendo
-- en atencion/atencion_servicio/atencion_producto/pago (ver vista_atencion_servicio); citas siguen
-- en reserva (ver vista_reserva); puntos siguen en movimiento_puntos (ver fn_mi_fidelizacion). Lo
-- único que no existía y hacía falta crear son dos conceptos nuevos que hoy no tienen dónde vivir:
--   - una nota/observación libre por clienta, con historial (nunca se sobreescribe, a diferencia
--     de cliente.notas que es un solo blob que sí se reemplaza);
--   - una recomendación con fecha de regreso y estado — distinta de una cita: "sería conveniente
--     que regrese" no es lo mismo que "ya tiene una reserva confirmada" (sección 9 del pedido).

-- --------------------------------------------------------------------------------------------
-- 1. cliente_nota — observaciones libres, histórico inmutable (nunca se edita ni se borra).
-- --------------------------------------------------------------------------------------------
create table cliente_nota (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null references local (id) default fn_local_efectivo(),
  cliente_id uuid not null references cliente (id) on delete cascade,
  atencion_id uuid references atencion (id) on delete set null, -- null = nota general, sin visita asociada
  creado_por uuid references perfil (id),
  nota text not null check (btrim(nota) <> ''),
  creado_en timestamptz not null default now()
);

create index cliente_nota_cliente_idx on cliente_nota (cliente_id, creado_en desc);
create index cliente_nota_local_idx on cliente_nota (local_id);

alter table cliente_nota enable row level security;
create policy cliente_nota_select on cliente_nota for select
  using (fn_es_admin() or fn_rol_actual() = 'empleada');
-- Sin política de INSERT/UPDATE/DELETE directa: toda escritura pasa por fn_crear_nota_cliente
-- (más abajo). Es un historial de auditoría: no se reescribe ni se borra una nota ya guardada.
create policy cliente_nota_local on cliente_nota as restrictive for all to public
  using (local_id = fn_local_id())
  with check (local_id = coalesce(fn_local_id(), fn_local_publico()));

grant select on cliente_nota to authenticated;

-- --------------------------------------------------------------------------------------------
-- 2. cliente_recomendacion — "sería conveniente que la clienta regrese", con fecha real y estado.
-- --------------------------------------------------------------------------------------------
create table cliente_recomendacion (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null references local (id) default fn_local_efectivo(),
  cliente_id uuid not null references cliente (id) on delete cascade,
  atencion_id uuid references atencion (id) on delete set null,
  servicio_recomendado_id uuid references servicio (id) on delete set null,
  creado_por uuid references perfil (id),
  descripcion text not null check (btrim(descripcion) <> ''),
  fecha_recomendada_regreso date,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'completada', 'cancelada')),
  creado_en timestamptz not null default now(),
  completado_en timestamptz
);

create index cliente_recomendacion_cliente_idx on cliente_recomendacion (cliente_id, creado_en desc);
create index cliente_recomendacion_pendiente_idx on cliente_recomendacion (local_id, fecha_recomendada_regreso)
  where estado = 'pendiente';

alter table cliente_recomendacion enable row level security;
create policy cliente_recomendacion_select on cliente_recomendacion for select
  using (fn_es_admin() or fn_rol_actual() = 'empleada');
-- Sin política de INSERT directa (fn_crear_recomendacion_cliente) ni de UPDATE abierta: cambiar
-- de estado pasa por fn_actualizar_estado_recomendacion, para que la descripción/fecha original
-- de una recomendación ya creada nunca se reescriba, solo su estado.
create policy cliente_recomendacion_local on cliente_recomendacion as restrictive for all to public
  using (local_id = fn_local_id())
  with check (local_id = coalesce(fn_local_id(), fn_local_publico()));

grant select on cliente_recomendacion to authenticated;

-- --------------------------------------------------------------------------------------------
-- 3. Escritura: solo vía funciones (validan pertenencia al mismo local y, si aplica, que la
-- atención citada sea realmente de esa clienta) — igual criterio de autorización que
-- fn_mi_fidelizacion: admin o cualquier empleada (no existe hoy un permiso más fino para esto).
-- --------------------------------------------------------------------------------------------
create or replace function fn_crear_nota_cliente(p_cliente_id uuid, p_atencion_id uuid, p_nota text)
returns cliente_nota
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid;
  v_fila cliente_nota;
begin
  if not (fn_es_admin() or fn_rol_actual() = 'empleada') then
    raise exception 'No autorizada para registrar notas de clientas';
  end if;

  select local_id into v_local from cliente where id = p_cliente_id;
  if v_local is null or v_local <> fn_local_id() then
    raise exception 'Clienta no encontrada';
  end if;

  if p_atencion_id is not null and not exists (
    select 1 from atencion where id = p_atencion_id and cliente_id = p_cliente_id
  ) then
    raise exception 'Esa atención no corresponde a esta clienta';
  end if;

  insert into cliente_nota (local_id, cliente_id, atencion_id, creado_por, nota)
  values (v_local, p_cliente_id, p_atencion_id, auth.uid(), btrim(p_nota))
  returning * into v_fila;

  return v_fila;
end;
$$;

grant execute on function fn_crear_nota_cliente to authenticated;

create or replace function fn_crear_recomendacion_cliente(
  p_cliente_id uuid,
  p_atencion_id uuid,
  p_servicio_id uuid,
  p_descripcion text,
  p_fecha_regreso date
) returns cliente_recomendacion
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid;
  v_fila cliente_recomendacion;
begin
  if not (fn_es_admin() or fn_rol_actual() = 'empleada') then
    raise exception 'No autorizada para registrar recomendaciones';
  end if;

  select local_id into v_local from cliente where id = p_cliente_id;
  if v_local is null or v_local <> fn_local_id() then
    raise exception 'Clienta no encontrada';
  end if;

  if p_atencion_id is not null and not exists (
    select 1 from atencion where id = p_atencion_id and cliente_id = p_cliente_id
  ) then
    raise exception 'Esa atención no corresponde a esta clienta';
  end if;

  if p_servicio_id is not null and not exists (
    select 1 from servicio where id = p_servicio_id and local_id = v_local
  ) then
    raise exception 'Servicio recomendado no encontrado';
  end if;

  insert into cliente_recomendacion
    (local_id, cliente_id, atencion_id, servicio_recomendado_id, creado_por, descripcion, fecha_recomendada_regreso)
  values
    (v_local, p_cliente_id, p_atencion_id, p_servicio_id, auth.uid(), btrim(p_descripcion), p_fecha_regreso)
  returning * into v_fila;

  return v_fila;
end;
$$;

grant execute on function fn_crear_recomendacion_cliente to authenticated;

create or replace function fn_actualizar_estado_recomendacion(p_id uuid, p_estado text)
returns cliente_recomendacion
language plpgsql security definer set search_path = public as $$
declare
  v_fila cliente_recomendacion;
begin
  if not (fn_es_admin() or fn_rol_actual() = 'empleada') then
    raise exception 'No autorizada para actualizar seguimientos';
  end if;
  if p_estado not in ('pendiente', 'completada', 'cancelada') then
    raise exception 'Estado inválido: %', p_estado;
  end if;

  update cliente_recomendacion
  set estado = p_estado, completado_en = case when p_estado = 'pendiente' then null else now() end
  where id = p_id and local_id = fn_local_id()
  returning * into v_fila;

  if v_fila is null then
    raise exception 'Seguimiento no encontrado';
  end if;
  return v_fila;
end;
$$;

grant execute on function fn_actualizar_estado_recomendacion to authenticated;

-- --------------------------------------------------------------------------------------------
-- 4. vista_cliente_resumen: se agregan columnas calculadas al final (nunca se tocan las
-- existentes, así "create or replace view" no rompe nada que ya la consuma por nombre de
-- columna). Cubre la sección 18 del pedido (próxima cita, próximo seguimiento, puntos) en la
-- misma consulta que ya arma el listado, sin N+1.
--
-- `visitas_completadas` y `gasto_acumulado` NO se agregan acá: ya son columnas reales de
-- `cliente` (0012_configuracion.sql), mantenidas por trigger en cada pago/atención completada, y
-- ya llegan solas vía `c.*` — agregarlas de nuevo con otro nombre habría sido una segunda fuente
-- de verdad para el mismo número (se detectó al probar esta migración contra Postgres real: el
-- primer intento chocaba "column already exists").
-- --------------------------------------------------------------------------------------------
create or replace view vista_cliente_resumen with (security_invoker = true) as
select
  c.*,
  v.ultima_visita,
  v.ultimo_servicio_nombre,
  v.ultimo_profesional_nombre,
  sp.saldo_puntos,
  pc.proxima_cita_inicio,
  ps.proximo_seguimiento_fecha,
  ps.proximo_seguimiento_descripcion
from cliente c
left join lateral (
  select
    max(a.completado_en) as ultima_visita,
    (array_agg(ase.nombre_snapshot order by a.completado_en desc nulls last, ase.id))[1] as ultimo_servicio_nombre,
    (array_agg(vp.nombre order by a.completado_en desc nulls last, ase.id))[1] as ultimo_profesional_nombre
  from atencion a
  join atencion_servicio ase on ase.atencion_id = a.id
  left join vista_profesional vp on vp.id = ase.profesional_id
  where a.cliente_id = c.id and a.estado = 'completada'
) v on true
left join lateral (
  select coalesce(sum(mp.puntos), 0) as saldo_puntos
  from movimiento_puntos mp
  where mp.cliente_id = c.id
) sp on true
left join lateral (
  select min(lower(r.rango)) as proxima_cita_inicio
  from reserva r
  where r.cliente_id = c.id and r.estado in ('pendiente', 'confirmada') and lower(r.rango) > now()
) pc on true
left join lateral (
  select cr.fecha_recomendada_regreso as proximo_seguimiento_fecha, cr.descripcion as proximo_seguimiento_descripcion
  from cliente_recomendacion cr
  where cr.cliente_id = c.id and cr.estado = 'pendiente'
  order by cr.fecha_recomendada_regreso asc nulls last, cr.creado_en asc
  limit 1
) ps on true;

grant select on vista_cliente_resumen to authenticated;

-- --------------------------------------------------------------------------------------------
-- 5. vista_seguimiento_pendiente — mismo patrón ya usado para "canjes por entregar"
-- (vista_canje_pendiente_entrega, 0068): vista de cola + card en una pantalla existente + badge
-- en el menú lateral. No se construye un sistema de notificaciones nuevo (sección 14 del pedido).
-- --------------------------------------------------------------------------------------------
create or replace view vista_seguimiento_pendiente with (security_invoker = true) as
select
  cr.id, cr.cliente_id, c.nombre as cliente_nombre, c.telefono as cliente_telefono,
  cr.descripcion, cr.fecha_recomendada_regreso, cr.servicio_recomendado_id,
  s.nombre as servicio_recomendado_nombre, cr.creado_por, pf.nombre as creado_por_nombre,
  cr.creado_en, cr.local_id
from cliente_recomendacion cr
join cliente c on c.id = cr.cliente_id
left join servicio s on s.id = cr.servicio_recomendado_id
left join perfil pf on pf.id = cr.creado_por
where cr.estado = 'pendiente'
order by cr.fecha_recomendada_regreso asc nulls last, cr.creado_en asc;

grant select on vista_seguimiento_pendiente to authenticated;

-- --------------------------------------------------------------------------------------------
-- 6. Estado en vivo de UNA clienta (para su propio perfil): a diferencia de
-- fn_estado_profesional_ahora/fn_salon_en_vivo (que deliberadamente nunca revelan qué cliente
-- está siendo atendido, por privacidad de cara al público), aquí el dato es sobre sí misma o
-- consultado por el propio salón — no hay nada que ocultar. No se toca ninguna función del motor
-- de Peluquería en Vivo.
-- --------------------------------------------------------------------------------------------
create or replace function fn_estado_en_vivo_cliente(p_cliente_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_atencion record;
  v_reserva record;
begin
  if not (fn_es_admin() or fn_rol_actual() = 'empleada' or fn_es_mi_cliente(p_cliente_id)) then
    raise exception 'No autorizada';
  end if;

  select
    a.id as atencion_id, a.creado_en as inicio,
    (select ase.nombre_snapshot from atencion_servicio ase where ase.atencion_id = a.id order by ase.id limit 1) as servicio_nombre,
    (select vp.nombre from atencion_servicio ase join vista_profesional vp on vp.id = ase.profesional_id
       where ase.atencion_id = a.id order by ase.id limit 1) as profesional_nombre
  into v_atencion
  from atencion a
  where a.cliente_id = p_cliente_id and a.estado = 'en_progreso'
  limit 1;

  if found then
    return jsonb_build_object(
      'en_salon', true, 'atencion_id', v_atencion.atencion_id, 'servicio_nombre', v_atencion.servicio_nombre,
      'profesional_nombre', v_atencion.profesional_nombre, 'inicio', v_atencion.inicio
    );
  end if;

  select s.nombre as servicio_nombre, vp.nombre as profesional_nombre, lower(r.rango) as inicio
  into v_reserva
  from reserva r
  join servicio s on s.id = r.servicio_id
  join vista_profesional vp on vp.id = r.profesional_id
  where r.cliente_id = p_cliente_id and r.estado = 'en_atencion' and r.rango @> now()
  limit 1;

  if found then
    return jsonb_build_object(
      'en_salon', true, 'atencion_id', null, 'servicio_nombre', v_reserva.servicio_nombre,
      'profesional_nombre', v_reserva.profesional_nombre, 'inicio', v_reserva.inicio
    );
  end if;

  return jsonb_build_object('en_salon', false);
end;
$$;

grant execute on function fn_estado_en_vivo_cliente to authenticated;

-- --------------------------------------------------------------------------------------------
-- 7. fn_estado_equipo_en_vivo (0069, YA restringida a admin): se le agrega qué clienta está
-- siendo atendida ahora mismo, cuando aplica. Es seguro hacerlo acá porque esta función SIEMPRE
-- fue exclusiva de administración (nunca pública, nunca de la propia profesional) — no toca
-- fn_estado_profesional_ahora ni fn_salon_en_vivo, que siguen sin exponer clientes.
-- --------------------------------------------------------------------------------------------
create or replace function fn_estado_equipo_en_vivo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_local uuid := fn_local_id();
  v_prof record;
  v_resultado jsonb := '[]'::jsonb;
  v_cliente_id uuid;
  v_cliente_nombre text;
begin
  if not fn_es_admin() then
    raise exception 'No autorizada';
  end if;
  if v_local is null then
    raise exception 'Falta el identificador del local.';
  end if;

  for v_prof in
    select p.id, pf.nombre, p.foto_url
    from profesional p
    join perfil pf on pf.id = p.id
    where p.local_id = v_local and p.activo
    order by p.orden_visualizacion
  loop
    select a.cliente_id, c.nombre into v_cliente_id, v_cliente_nombre
    from atencion a
    join cliente c on c.id = a.cliente_id
    join atencion_servicio ase on ase.atencion_id = a.id
    where ase.profesional_id = v_prof.id and a.estado = 'en_progreso'
    limit 1;

    v_resultado := v_resultado || jsonb_build_object(
      'profesional_id', v_prof.id, 'nombre', v_prof.nombre, 'foto_url', v_prof.foto_url,
      'estado', fn_estado_profesional_ahora(v_prof.id),
      'cliente_id', v_cliente_id, 'cliente_nombre', v_cliente_nombre
    );
    v_cliente_id := null;
    v_cliente_nombre := null;
  end loop;

  return v_resultado;
end;
$$;

grant execute on function fn_estado_equipo_en_vivo to authenticated;
