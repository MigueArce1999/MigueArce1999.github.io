-- 0046_voice_fuzzy_search.sql
-- RPCs de búsqueda difusa para el asistente de voz (EntityResolver.ts). Cada una devuelve
-- candidatos con su puntaje de similitud (0-1); la decisión de qué hacer con ese puntaje
-- (seleccionar sola, pedir confirmación, mostrar alternativas o "no encontrado") vive en
-- TypeScript (lib/voz/EntityResolver.ts), no aquí — así los umbrales quedan centralizados en un
-- solo lugar fácil de ajustar, en vez de reconstruir la misma regla en cada función SQL.
--
-- SECURITY INVOKER (el valor por defecto, no se declara aparte): cada función corre con los
-- permisos de quien la llama, así que las políticas RLS ya existentes de cliente/servicio/
-- perfil/producto se siguen respetando exactamente igual que en una consulta normal — nadie ve
-- por esta vía nada que no pudiera ver ya con select directo.
create or replace function fn_buscar_clientes_fuzzy(p_texto text, p_limite int default 5)
returns table (id uuid, nombre text, telefono text, score real)
language sql stable as $$
  select c.id, c.nombre, c.telefono, similarity(c.nombre, p_texto) as score
  from cliente c
  where c.activo
  order by score desc
  limit p_limite;
$$;

create or replace function fn_buscar_servicios_fuzzy(p_texto text, p_limite int default 5)
returns table (id uuid, nombre text, tipo_precio tipo_precio_servicio, precio numeric, score real)
language sql stable as $$
  select s.id, s.nombre, s.tipo_precio, s.precio, similarity(s.nombre, p_texto) as score
  from servicio s
  where s.activo
  order by score desc
  limit p_limite;
$$;

create or replace function fn_buscar_profesionales_fuzzy(p_texto text, p_limite int default 5)
returns table (id uuid, nombre text, score real)
language sql stable as $$
  select p.id, pf.nombre, similarity(pf.nombre, p_texto) as score
  from profesional p
  join perfil pf on pf.id = p.id
  where p.activo
  order by score desc
  limit p_limite;
$$;

create or replace function fn_buscar_productos_fuzzy(p_texto text, p_limite int default 5)
returns table (id uuid, nombre text, categoria text, precio numeric, score real)
language sql stable as $$
  select pr.id, pr.nombre, pr.categoria, pr.precio, similarity(pr.nombre, p_texto) as score
  from producto pr
  where pr.activo
  order by score desc
  limit p_limite;
$$;

grant execute on function fn_buscar_clientes_fuzzy to authenticated;
grant execute on function fn_buscar_servicios_fuzzy to authenticated;
grant execute on function fn_buscar_profesionales_fuzzy to authenticated;
grant execute on function fn_buscar_productos_fuzzy to authenticated;
