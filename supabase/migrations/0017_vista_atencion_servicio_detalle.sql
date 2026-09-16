-- 0017_vista_atencion_servicio_detalle.sql
-- vista_atencion_servicio (0015) no traía el estado/fecha de la atención ni el cliente, así
-- que el portal de empleadas no podía mostrar en "Mi día" un servicio registrado como venta
-- directa ("Atender" sin cita previa): esa pantalla solo consultaba reservas del día
-- (vista_reserva), y una atención sin reserva nunca aparece ahí. Se enriquece la vista para
-- que el frontend pueda listar "atenciones de hoy" de una profesional sin depender de que
-- exista una reserva, y de paso incluye la comisión ya generada por línea (útil también para
-- el detalle de ventas del panel admin: precio cobrado vs. lo que se queda el negocio).
drop view vista_atencion_servicio;

create view vista_atencion_servicio with (security_invoker = true) as
select
  ase.id, ase.atencion_id, ase.servicio_id, ase.nombre_snapshot, ase.precio_snapshot,
  ase.descuento, ase.cantidad, ase.profesional_id, vp.nombre as profesional_nombre,
  a.reserva_id, a.estado as atencion_estado, a.creado_en as atencion_creado_en,
  a.completado_en as atencion_completado_en, a.cliente_id, c.nombre as cliente_nombre,
  coalesce((select sum(co.valor) from comision co where co.atencion_servicio_id = ase.id), 0) as comision_total
from atencion_servicio ase
join vista_profesional vp on vp.id = ase.profesional_id
join atencion a on a.id = ase.atencion_id
join cliente c on c.id = a.cliente_id;

grant select on vista_atencion_servicio to anon, authenticated;
