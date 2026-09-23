-- 0057_catalogo_por_local.sql
-- 1) vista_profesional vuelve a security_definer (nombres públicos sin abrir RLS de perfil).
-- 2) fn_local_publico prioriza x-local-id de la instalación, no el local del usuario logueado.
-- 3) Semilla: equipo y catálogo existentes al local Claudia Patricia.

create or replace function fn_local_publico() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(fn_local_id_request(), fn_local_id())
$$;

drop view if exists vista_cliente_resumen;
drop view if exists vista_atencion_servicio_colaborador;
drop view if exists vista_atencion_servicio;
drop view if exists vista_reserva;
drop view if exists vista_profesional;

-- Sin security_invoker: el join a perfil solo expone el nombre del personal (0015).
create view vista_profesional as
select
  p.id, p.slug, p.especialidades, p.bio, p.foto_url, p.activo, p.orden_visualizacion,
  pf.nombre, p.mostrar_en_home, p.local_id
from profesional p
join perfil pf on pf.id = p.id;

create view vista_reserva with (security_invoker = true) as
select
  r.id, r.cliente_id, c.nombre as cliente_nombre,
  r.servicio_id, s.nombre as servicio_nombre, s.duracion_minutos,
  r.profesional_id, vp.nombre as profesional_nombre,
  r.rango, lower(r.rango) as inicio, upper(r.rango) as fin,
  r.precio_estimado, r.estado, r.origen, r.notas, r.creado_en, r.actualizado_en, r.local_id
from reserva r
join cliente c on c.id = r.cliente_id
join servicio s on s.id = r.servicio_id
join vista_profesional vp on vp.id = r.profesional_id;

create view vista_atencion_servicio with (security_invoker = true) as
select
  ase.id, ase.atencion_id, ase.servicio_id, ase.nombre_snapshot, ase.precio_snapshot,
  ase.descuento, ase.cantidad, ase.profesional_id, vp.nombre as profesional_nombre,
  a.reserva_id, a.estado as atencion_estado, a.creado_en as atencion_creado_en,
  a.completado_en as atencion_completado_en, a.cliente_id, c.nombre as cliente_nombre,
  coalesce((select sum(co.valor) from comision co where co.atencion_servicio_id = ase.id), 0) as comision_total,
  ase.es_colaboracion, a.local_id
from atencion_servicio ase
join vista_profesional vp on vp.id = ase.profesional_id
join atencion a on a.id = ase.atencion_id
join cliente c on c.id = a.cliente_id;

grant select on vista_profesional, vista_reserva, vista_atencion_servicio
  to anon, authenticated;

do $$
begin
  if to_regclass('public.atencion_servicio_colaborador') is not null then
    execute $v$
      create view vista_atencion_servicio_colaborador with (security_invoker = true) as
      select
        col.id, col.atencion_servicio_id, col.colaborador_id, vpc.nombre as colaborador_nombre,
        col.participacion, col.valor, col.creado_por, pf.nombre as creado_por_nombre, col.creado_en
      from atencion_servicio_colaborador col
      join vista_profesional vpc on vpc.id = col.colaborador_id
      left join perfil pf on pf.id = col.creado_por
    $v$;
    execute 'grant select on vista_atencion_servicio_colaborador to anon, authenticated';
  end if;
end $$;

create view vista_cliente_resumen with (security_invoker = true) as
select
  c.*,
  v.ultima_visita,
  v.ultimo_servicio_nombre,
  v.ultimo_profesional_nombre
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
) v on true;

grant select on vista_cliente_resumen to authenticated;

do $$
declare
  patricia uuid := 'c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001';
  n int;
  t text;
begin
  select count(*) into n from local;
  if n = 1 then
    select id into patricia from local limit 1;
    foreach t in array array[
      'profesional', 'horario_disponibilidad',
      'categoria_servicio', 'servicio', 'servicio_profesional',
      'promocion', 'promocion_servicio',
      'producto',
      'recompensa', 'regla_puntos',
      'configuracion_fidelizacion', 'configuracion_homepage', 'configuracion_negocio'
    ]
    loop
      if to_regclass('public.' || t) is null then
        continue;
      end if;
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = 'local_id'
      ) then
        continue;
      end if;
      execute format('update %I set local_id = $1', t) using patricia;
    end loop;
  end if;

  update perfil
    set local_id = patricia, actualizado_en = now()
  where rol <> 'super_admin'
    and id in (select id from profesional where local_id = patricia);
end;
$$;
