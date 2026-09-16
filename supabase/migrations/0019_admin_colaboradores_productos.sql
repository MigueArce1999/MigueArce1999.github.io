-- 0019_admin_colaboradores_productos.sql
-- El panel admin necesita, en el detalle de ventas: (1) saber quién agregó cada colaborador
-- (auditoría — hasta ahora solo se sabía quién registró la atención completa, no quién
-- agregó cada colaborador puntual) y (2) ver el valor de los productos vendidos.

alter table atencion_servicio_colaborador add column creado_por uuid references perfil (id);

-- Backfill: la única forma de agregar un colaborador hasta ahora es dentro de
-- fn_registrar_atencion, así que quien registró la atención completa es quien lo agregó.
update atencion_servicio_colaborador col
set creado_por = a.creado_por
from atencion_servicio ase
join atencion a on a.id = ase.atencion_id
where ase.id = col.atencion_servicio_id and col.creado_por is null;

-- Misma firma que la versión anterior (0018): solo cambia el insert de colaborador para
-- guardar quién lo agregó.
create or replace function fn_registrar_atencion(
  p_cliente_id uuid,
  p_reserva_id uuid,
  p_lineas jsonb,
  p_productos jsonb default '[]'::jsonb,
  p_notas text default null,
  p_borrador_key text default null
) returns atencion
language plpgsql security definer set search_path = public as $$
declare
  v_atencion atencion;
  v_atencion_servicio_id uuid;
  v_linea jsonb;
  v_colaborador jsonb;
  v_producto jsonb;
  v_nombre text;
  v_precio numeric(12,2);
  v_precio_final numeric(12,2);
  v_descuento numeric(12,2);
  v_descuento_maximo_pct numeric(5,2);
  v_descuento_pct numeric(6,2);
  v_profesional_id uuid;
  v_colaborador_id uuid;
  v_colaboradores_vistos uuid[];
  v_suma_colaboradores numeric(12,2);
  v_valor_colaborador numeric(12,2);
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

    select nombre, precio into v_nombre, v_precio
    from servicio where id = (v_linea ->> 'servicio_id')::uuid;

    if not fn_es_admin() and not fn_es_profesional(v_profesional_id)
       and not fn_tiene_permiso('puede_caja') then
      raise exception 'No autorizada para registrar servicios de otra profesional';
    end if;

    v_precio_final := coalesce((v_linea ->> 'precio_snapshot')::numeric, v_precio, 0);
    v_descuento := coalesce((v_linea ->> 'descuento')::numeric, 0);

    if v_descuento > 0 and not fn_es_admin() then
      select puede_descuentos_hasta into v_descuento_maximo_pct from permiso where perfil_id = auth.uid();
      v_descuento_pct := case when v_precio_final > 0 then (v_descuento / v_precio_final) * 100 else 0 end;
      if v_descuento_pct > coalesce(v_descuento_maximo_pct, 0) then
        raise exception 'El descuento (%) excede tu límite autorizado (%)',
          round(v_descuento_pct, 1) || '%', round(coalesce(v_descuento_maximo_pct, 0), 1) || '%';
      end if;
    end if;

    insert into atencion_servicio (atencion_id, servicio_id, profesional_id, nombre_snapshot, precio_snapshot, descuento, cantidad)
    values (
      v_atencion.id,
      (v_linea ->> 'servicio_id')::uuid,
      v_profesional_id,
      v_nombre,
      v_precio_final,
      v_descuento,
      coalesce((v_linea ->> 'cantidad')::int, 1)
    )
    returning id into v_atencion_servicio_id;

    v_colaboradores_vistos := array[]::uuid[];
    v_suma_colaboradores := 0;
    for v_colaborador in select jsonb_array_elements(coalesce(v_linea -> 'colaboradores', '[]'::jsonb)) loop
      v_colaborador_id := (v_colaborador ->> 'colaborador_id')::uuid;
      v_valor_colaborador := coalesce((v_colaborador ->> 'valor')::numeric, 0);

      if v_colaborador_id = v_profesional_id then
        raise exception 'El profesional responsable no puede ser su propio colaborador';
      end if;
      if v_colaborador_id = any(v_colaboradores_vistos) then
        raise exception 'Un colaborador no puede repetirse en el mismo servicio';
      end if;
      v_colaboradores_vistos := array_append(v_colaboradores_vistos, v_colaborador_id);
      v_suma_colaboradores := v_suma_colaboradores + v_valor_colaborador;

      if v_suma_colaboradores > (v_precio_final - v_descuento) * coalesce((v_linea ->> 'cantidad')::int, 1) then
        raise exception 'La suma de los colaboradores no puede superar el precio del servicio';
      end if;

      insert into atencion_servicio_colaborador (atencion_servicio_id, colaborador_id, participacion, valor, creado_por)
      values (v_atencion_servicio_id, v_colaborador_id, v_colaborador ->> 'participacion', v_valor_colaborador, auth.uid());
    end loop;
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

-- Vistas de lectura para el panel admin (security_invoker: respetan la RLS de cada tabla
-- base según quién consulta).
create view vista_atencion_servicio_colaborador with (security_invoker = true) as
select
  col.id, col.atencion_servicio_id, col.colaborador_id, vpc.nombre as colaborador_nombre,
  col.participacion, col.valor, col.creado_por, pf.nombre as creado_por_nombre, col.creado_en
from atencion_servicio_colaborador col
join vista_profesional vpc on vpc.id = col.colaborador_id
left join perfil pf on pf.id = col.creado_por;

grant select on vista_atencion_servicio_colaborador to anon, authenticated;

create view vista_atencion_producto with (security_invoker = true) as
select
  ap.id, ap.atencion_id, ap.categoria, ap.nombre, ap.cantidad, ap.precio_unitario,
  (ap.cantidad * ap.precio_unitario) as subtotal,
  a.cliente_id, c.nombre as cliente_nombre, a.estado as atencion_estado,
  a.creado_en as atencion_creado_en, a.completado_en as atencion_completado_en
from atencion_producto ap
join atencion a on a.id = ap.atencion_id
join cliente c on c.id = a.cliente_id;

grant select on vista_atencion_producto to anon, authenticated;
