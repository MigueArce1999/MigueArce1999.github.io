-- 0044_producto_catalogo.sql
-- Hasta ahora "producto" nunca fue una entidad real (ver 0018_atender_avanzado.sql: "No se
-- construye un catálogo de productos" — decisión deliberada en ese momento). El asistente de
-- voz necesita resolver "agrega un champú" contra algo real (sección 13 del pedido: "Resolver
-- el producto contra Supabase"), así que esta migración llena ese vacío con el catálogo mínimo
-- necesario — no reemplaza `atencion_producto` (que sigue guardando categoria/nombre como
-- snapshot de texto libre, igual que servicio.nombre se snapshotea en atencion_servicio): este
-- catálogo es solo la fuente para BUSCAR y sugerir, igual que `servicio` lo es para los
-- servicios.
create table producto (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text,
  precio numeric(12, 2),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index producto_nombre_unico_idx on producto (lower(nombre));
create index producto_nombre_trgm_idx on producto using gin (nombre gin_trgm_ops);

alter table producto enable row level security;

-- Mismo patrón que servicio: lectura pública (cualquier persona autenticada del salón puede
-- buscar en el catálogo), escritura solo admin.
create policy producto_select_publico on producto for select using (true);
create policy producto_admin_escribe on producto for all
  using (fn_es_admin()) with check (fn_es_admin());

grant select on producto to anon, authenticated;
grant insert, update, delete on producto to authenticated;

-- Semilla: los mismos productos que el formulario manual ya sugería como categorías
-- (CATEGORIAS_PRODUCTO_SUGERIDAS en Atender.tsx) — así el catálogo no arranca vacío.
insert into producto (nombre, categoria, precio) values
  ('Champú', 'Cuidado capilar', null),
  ('Acondicionador', 'Cuidado capilar', null),
  ('Tinte', 'Color', null),
  ('Tratamiento capilar', 'Cuidado capilar', null)
on conflict (lower(nombre)) do nothing;

-- Cualquier persona del equipo (admin o empleada) puede crear un producto "sobre la marcha" —
-- mismo criterio que ya usa fn_crear_servicio_rapido (0038) para servicios nuevos dictados o
-- escritos que todavía no existen en el catálogo.
create or replace function fn_crear_producto_rapido(p_nombre text, p_categoria text default null, p_precio numeric default null)
returns producto
language plpgsql security definer set search_path = public as $$
declare
  v_existente producto;
  v_nuevo producto;
begin
  if fn_rol_actual() is null or fn_rol_actual() not in ('admin', 'empleada') then
    raise exception 'No autorizada para crear productos';
  end if;

  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'El nombre del producto es obligatorio';
  end if;

  select * into v_existente from producto where lower(nombre) = lower(trim(p_nombre)) limit 1;
  if found then
    return v_existente;
  end if;

  insert into producto (nombre, categoria, precio)
  values (trim(p_nombre), nullif(trim(coalesce(p_categoria, '')), ''), p_precio)
  returning * into v_nuevo;

  return v_nuevo;
end;
$$;

grant execute on function fn_crear_producto_rapido to authenticated;
