-- 0074_ranking_puntos_mes.sql
-- Ranking de clientas por puntos GANADOS en un período (pensado para el mes calendario en curso
-- y la promoción de "clienta del mes" — quien más puntos reunió gana un premio físico en el
-- salón) — tanto en Fidelización (admin) como en Mis recompensas (clienta), una sola función.
--
-- "Ganados" = tipo='abono' (puntos > 0): un canje a mitad de mes (tipo='canje', puntos negativo)
-- NUNCA debe hacer bajar a nadie del ranking solo por usar una recompensa — el ranking mide
-- cuánto ganó, no cuánto le queda disponible (eso ya lo muestra el saldo de fn_mi_fidelizacion).
--
-- Privacidad (decisión explícita de producto, sección pedida por el salón): el admin/empleada ve
-- el nombre completo de cada clienta, igual que en el resto del panel. Una CLIENTA que consulta
-- el ranking desde su propio portal ve el de las demás abreviado ("María G.") — se reconocen
-- entre ellas sin exponerle a otra clienta el nombre completo de alguien que no es ella misma.

-- --------------------------------------------------------------------------------------------
-- Índice: el ranking agrupa movimiento_puntos por cliente dentro de un rango de fechas — hoy
-- esa combinación no tiene índice (solo existe uno por cliente_id y otro genérico por local_id).
-- Parcial (where puntos > 0) porque el ranking nunca mira canjes/reversiones/ajustes negativos.
-- --------------------------------------------------------------------------------------------
create index if not exists movimiento_puntos_local_creado_ganado_idx
  on movimiento_puntos (local_id, creado_en)
  where puntos > 0;

-- --------------------------------------------------------------------------------------------
-- Abrevia "María José Pérez Gómez" -> "María G.": primer nombre de pila + inicial del último
-- apellido. Un solo nombre (sin espacios) se devuelve tal cual, sin inicial que agregar.
-- --------------------------------------------------------------------------------------------
create or replace function fn_nombre_abreviado(p_nombre text) returns text
language sql immutable as $$
  select case
    when array_length(regexp_split_to_array(btrim(p_nombre), '\s+'), 1) <= 1 then btrim(p_nombre)
    else
      (regexp_split_to_array(btrim(p_nombre), '\s+'))[1]
      || ' ' || left((regexp_split_to_array(btrim(p_nombre), '\s+'))[array_length(regexp_split_to_array(btrim(p_nombre), '\s+'), 1)], 1)
      || '.'
  end
$$;

-- --------------------------------------------------------------------------------------------
create or replace function fn_ranking_puntos_mes(p_desde timestamptz, p_hasta timestamptz, p_limite int default 10)
returns table (
  posicion int,
  cliente_id uuid,
  nombre text,
  puntos_ganados numeric,
  soy_yo boolean,
  dentro_del_top boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid := fn_local_id();
  v_es_staff boolean := fn_es_admin() or fn_rol_actual() = 'empleada';
  v_mi_cliente_id uuid;
begin
  if p_hasta <= p_desde then
    raise exception 'El rango de fechas no es válido';
  end if;
  if p_limite < 1 or p_limite > 100 then
    raise exception 'El límite debe estar entre 1 y 100';
  end if;

  select id into v_mi_cliente_id from cliente where usuario_id = auth.uid() and local_id = v_local;

  return query
  with totales as (
    select mp.cliente_id as c_id, sum(mp.puntos) as puntos
    from movimiento_puntos mp
    where mp.local_id = v_local
      and mp.puntos > 0
      and mp.creado_en >= p_desde
      and mp.creado_en < p_hasta
    group by mp.cliente_id
  ),
  rankeado as (
    select
      (row_number() over (order by t.puntos desc, c.nombre asc))::int as pos,
      t.c_id,
      case when v_es_staff then c.nombre else fn_nombre_abreviado(c.nombre) end as nom,
      t.puntos,
      (t.c_id = v_mi_cliente_id) as es_mia
    from totales t
    join cliente c on c.id = t.c_id
  )
  select r.pos, r.c_id, r.nom, r.puntos, r.es_mia, (r.pos <= p_limite)
  from rankeado r
  where r.pos <= p_limite or r.es_mia
  order by r.pos;
end;
$$;

grant execute on function fn_ranking_puntos_mes to authenticated;
