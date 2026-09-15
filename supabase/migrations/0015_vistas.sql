-- 0015_vistas.sql
-- Vistas de lectura para que el frontend no dependa de sintaxis de embedding anidado
-- frágil (profesional.id = perfil.id es una relación 1:1 vía PK/FK).
--
-- `vista_profesional` es intencionalmente NO security_invoker: expone el nombre de cada
-- profesional (nunca de un cliente, porque solo hace join con `profesional`, que solo
-- contiene personal) como información pública, igual que ya permite la policy pública de
-- la tabla `profesional`. Esto evita tener que abrir la RLS de `perfil` (que sí protege
-- datos sensibles como el teléfono) para exponer un simple nombre visible en el sitio.
--
-- El resto de vistas SÍ son security_invoker = true: respetan la RLS de reserva/cliente/
-- atencion/comision según quién consulta, y solo obtienen el nombre del profesional
-- haciendo join contra `vista_profesional` (nunca contra `perfil` directamente), para no
-- toparse con esa misma restricción de forma indirecta.

create view vista_profesional as
select
  p.id, p.slug, p.especialidades, p.bio, p.foto_url, p.activo, p.orden_visualizacion,
  pf.nombre
from profesional p
join perfil pf on pf.id = p.id;

create view vista_reserva with (security_invoker = true) as
select
  r.id, r.cliente_id, c.nombre as cliente_nombre,
  r.servicio_id, s.nombre as servicio_nombre, s.duracion_minutos,
  r.profesional_id, vp.nombre as profesional_nombre,
  r.rango, lower(r.rango) as inicio, upper(r.rango) as fin,
  r.precio_estimado, r.estado, r.origen, r.notas, r.creado_en, r.actualizado_en
from reserva r
join cliente c on c.id = r.cliente_id
join servicio s on s.id = r.servicio_id
join vista_profesional vp on vp.id = r.profesional_id;

create view vista_atencion with (security_invoker = true) as
select
  a.id, a.reserva_id, a.cliente_id, c.nombre as cliente_nombre,
  a.estado, a.notas, a.creado_en, a.completado_en,
  coalesce((select sum((ase.precio_snapshot - ase.descuento) * ase.cantidad) from atencion_servicio ase where ase.atencion_id = a.id), 0) as total_vendido,
  coalesce((select sum(pg.monto) from pago pg where pg.atencion_id = a.id), 0) as total_pagado
from atencion a
join cliente c on c.id = a.cliente_id;

create view vista_atencion_servicio with (security_invoker = true) as
select
  ase.id, ase.atencion_id, ase.servicio_id, ase.nombre_snapshot, ase.precio_snapshot,
  ase.descuento, ase.cantidad, ase.profesional_id, vp.nombre as profesional_nombre
from atencion_servicio ase
join vista_profesional vp on vp.id = ase.profesional_id;

create view vista_comision with (security_invoker = true) as
select
  co.id, co.atencion_servicio_id, co.profesional_id, co.base_calculo, co.valor, co.estado, co.creado_en,
  ase.nombre_snapshot as servicio_nombre, a.cliente_id, c.nombre as cliente_nombre
from comision co
join atencion_servicio ase on ase.id = co.atencion_servicio_id
join atencion a on a.id = ase.atencion_id
join cliente c on c.id = a.cliente_id;

grant select on vista_profesional, vista_reserva, vista_atencion, vista_atencion_servicio, vista_comision
  to anon, authenticated;
