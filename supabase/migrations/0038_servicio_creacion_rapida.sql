-- 0038_servicio_creacion_rapida.sql
-- Cuando una empleada escribe en "Atender" un servicio que todavía no existe en el catálogo,
-- se crea automáticamente (en vez de bloquearla o forzarla a salir del flujo a pedirle a
-- administración que lo agregue primero). Nace en la categoría "Otros servicios" (nueva,
-- fallback) con precio "a valorar" y sin duración confirmada — exactamente el mismo estado que
-- ya soporta un servicio real e incompleto desde 0027 ("se puede seleccionar igual al
-- registrar una atención directa, que nunca depende de la duración"). Administración lo
-- reclasifica después desde Admin → Servicios (categoría, precio, duración) sin que eso afecte
-- las atenciones ya registradas con el snapshot original.

insert into categoria_servicio (nombre, orden_visualizacion)
values ('Otros servicios', 99)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- Cualquier persona del equipo (admin o empleada) puede crear un servicio "sobre la marcha" —
-- mismo criterio amplio que ya usa fn_registrar_atencion para decidir quién puede atender.
-- Idempotente por nombre (case-insensitive): si dos personas escriben el mismo nombre nuevo
-- casi al tiempo, la segunda reutiliza el servicio que ya creó la primera en vez de duplicarlo.
-- ---------------------------------------------------------------------------
create or replace function fn_crear_servicio_rapido(p_nombre text, p_precio numeric default null)
returns servicio
language plpgsql security definer set search_path = public as $$
declare
  v_categoria_id uuid;
  v_existente servicio;
  v_nuevo servicio;
begin
  -- `fn_rol_actual() not in (...)` da NULL (no true) cuando no hay fila en `perfil` — y
  -- `if null` en PL/pgSQL no entra al bloque, así que dejaría pasar a cualquiera sin perfil.
  -- Se comprueba explícito para que la ausencia de rol bloquee, no habilite.
  if fn_rol_actual() is null or fn_rol_actual() not in ('admin', 'empleada') then
    raise exception 'No autorizada para crear servicios';
  end if;

  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'El nombre del servicio es obligatorio';
  end if;

  select * into v_existente from servicio where lower(nombre) = lower(trim(p_nombre)) limit 1;
  if found then
    return v_existente;
  end if;

  select id into v_categoria_id from categoria_servicio where nombre = 'Otros servicios';

  insert into servicio (categoria_id, nombre, duracion_minutos, tipo_precio, precio)
  values (
    v_categoria_id,
    trim(p_nombre),
    null,
    case when p_precio is not null and p_precio > 0 then 'fijo' else 'a_valorar' end::tipo_precio_servicio,
    case when p_precio is not null and p_precio > 0 then p_precio else null end
  )
  returning * into v_nuevo;

  return v_nuevo;
end;
$$;

grant execute on function fn_crear_servicio_rapido to authenticated;
