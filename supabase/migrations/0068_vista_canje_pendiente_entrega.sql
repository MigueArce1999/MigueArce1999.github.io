-- La vista y fn_marcar_canje_entregado quedaron en 0049_autocanje.sql, pero esa
-- versión ya estaba aplicada en remoto sin estos objetos. PostgREST responde 404
-- (PGRST205) y el aviso de "canjes por entregar" no puede cargar.

-- En una base nueva (todas las migraciones desde 0001), la vista de 0049 sí se crea, y para
-- entonces `canje_recompensa` ya tiene `local_id` (0050) en medio de sus columnas — "cr.*" trae
-- una columna más que cuando la vista se creó, así que "create or replace view" falla con
-- "cannot change name of view column" (desplaza cliente_nombre/cliente_telefono de posición).
-- Se dropea primero para evitar ese choque; en remoto es un no-op seguro (mismo resultado final).
drop view if exists vista_canje_pendiente_entrega;

create view vista_canje_pendiente_entrega with (security_invoker = true) as
select cr.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono
from canje_recompensa cr
join cliente c on c.id = cr.cliente_id
where cr.atencion_id is null
  and cr.entregado = false
  and cr.estado = 'confirmado'
  and cr.local_id = fn_local_id()
order by cr.creado_en asc;

grant select on vista_canje_pendiente_entrega to authenticated;

create or replace function fn_marcar_canje_entregado(p_canje_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (fn_es_admin() or fn_rol_actual() = 'empleada') then
    raise exception 'No autorizada para marcar esta entrega';
  end if;
  update canje_recompensa
  set entregado = true
  where id = p_canje_id
    and estado = 'confirmado'
    and local_id = fn_local_id();
end;
$$;

grant execute on function fn_marcar_canje_entregado to authenticated;
