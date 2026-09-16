-- 0021_empleada_registra_cualquier_profesional.sql
-- Bug reportado en producción: al registrar una atención con varios servicios de distintas
-- profesionales (p. ej. un color hecho por Claudia y una limpieza facial hecha por Naldi, en
-- la misma cuenta de la clienta), fn_registrar_atencion rechazaba la línea de la profesional
-- que NO fuera quien inicia sesión, con "No autorizada para registrar servicios de otra
-- profesional" — a menos que quien registrara fuera admin o tuviera el permiso puede_caja.
--
-- Esa restricción no encaja con cómo trabaja el salón: cualquier empleada puede estar
-- registrando en el sistema el ticket completo de una clienta, incluyendo servicios que
-- hicieron sus compañeras. Se relaja para permitir esto a cualquier cuenta con rol
-- 'empleada' (no solo admin/puede_caja/la propia profesional) — sigue bloqueando a una
-- cuenta de clienta que intente llamar la función directamente para inventar atenciones.
--
-- Misma firma de siempre (0018/0019/0020): no requiere DROP FUNCTION.
create or replace function fn_registrar_atencion(
  p_cliente_id uuid,
  p_reserva_id uuid,
  p_lineas jsonb, -- [{servicio_id, profesional_id, precio_snapshot?, descuento?, cantidad?, es_colaboracion?}]
  p_productos jsonb default '[]'::jsonb,
  p_notas text default null,
  p_borrador_key text default null
) returns atencion
language plpgsql security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_linea jsonb;
  v_producto jsonb;
  v_nombre text;
  v_precio numeric(12,2);
  v_precio_final numeric(12,2);
  v_descuento numeric(12,2);
  v_descuento_maximo_pct numeric(5,2);
  v_descuento_pct numeric(6,2);
  v_profesional_id uuid;
  v_es_colaboracion boolean;
begin
  if p_borrador_key is not null then
    select * into v_atencion from atencion where borrador_key = p_borrador_key;
    if found then
      return v_atencion;
    end if;
  end if;

  insert into atencion (reserva_id, cliente_id, creado_por, notas, borrador_key)
  values (p_reserva_id, p_cliente_id, auth.uid(), p_notas, p_borrador_key)
  returning * into v_atencion;

  for v_linea in select jsonb_array_elements(p_lineas) loop
    v_profesional_id := (v_linea ->> 'profesional_id')::uuid;
    v_es_colaboracion := coalesce((v_linea ->> 'es_colaboracion')::boolean, false);

    select nombre, precio into v_nombre, v_precio
    from servicio where id = (v_linea ->> 'servicio_id')::uuid;

    -- Cualquier cuenta de EMPLEADA (no solo admin/puede_caja/la propia profesional) puede
    -- registrar el servicio de una compañera: es el caso normal de registrar el ticket
    -- completo de una clienta con varias profesionales. Esto solo sigue bloqueando a una
    -- cuenta de clienta que intente invocar la función directamente.
    if not v_es_colaboracion and not fn_es_admin() and not fn_es_profesional(v_profesional_id)
       and not fn_tiene_permiso('puede_caja') and fn_rol_actual() <> 'empleada' then
      raise exception 'No autorizada para registrar servicios de otra profesional';
    end if;

    v_precio_final := coalesce((v_linea ->> 'precio_snapshot')::numeric, v_precio, 0);
    v_descuento := coalesce((v_linea ->> 'descuento')::numeric, 0);

    -- Un descuento fuera del límite autorizado (permiso.puede_descuentos_hasta, en %) se
    -- rechaza para cualquiera que no sea admin; evita que una empleada aplique descuentos
    -- por su cuenta más allá de lo que administración le permitió (ver docs/02-roles-y-permisos.md).
    if v_descuento > 0 and not fn_es_admin() then
      select puede_descuentos_hasta into v_descuento_maximo_pct from permiso where perfil_id = auth.uid();
      v_descuento_pct := case when v_precio_final > 0 then (v_descuento / v_precio_final) * 100 else 0 end;
      if v_descuento_pct > coalesce(v_descuento_maximo_pct, 0) then
        raise exception 'El descuento (%) excede tu límite autorizado (%)',
          round(v_descuento_pct, 1) || '%', round(coalesce(v_descuento_maximo_pct, 0), 1) || '%';
      end if;
    end if;

    insert into atencion_servicio (atencion_id, servicio_id, profesional_id, nombre_snapshot, precio_snapshot, descuento, cantidad, es_colaboracion)
    values (
      v_atencion.id,
      (v_linea ->> 'servicio_id')::uuid,
      v_profesional_id,
      v_nombre,
      v_precio_final,
      v_descuento,
      coalesce((v_linea ->> 'cantidad')::int, 1),
      v_es_colaboracion
    );
  end loop;

  for v_producto in select jsonb_array_elements(p_productos) loop
    insert into atencion_producto (atencion_id, categoria, nombre, cantidad, precio_unitario)
    values (
      v_atencion.id,
      v_producto ->> 'categoria',
      v_producto ->> 'nombre',
      coalesce((v_producto ->> 'cantidad')::int, 1),
      coalesce((v_producto ->> 'precio_unitario')::numeric, 0)
    );
  end loop;

  return v_atencion;
end;
$$;

grant execute on function fn_registrar_atencion to authenticated;
