-- 0059_reserva_propia_en_instalacion.sql
-- reserva_local_privado exigía local_id = fn_local_id() (perfil).
-- super_admin tiene local_id NULL; una clienta de otro salón tiene otro UUID.
-- Pueden crear la cita (fn_crear_reserva es definer) y luego no verla en el portal.
-- Deben ver SOLO las reservas de su fila cliente en ESTE Hostinger (x-local-id).

drop policy if exists reserva_local_privado on reserva;
create policy reserva_local_privado on reserva as restrictive for all to public
  using (
    local_id = fn_local_id()
    or (fn_es_mi_cliente(cliente_id) and local_id = fn_local_publico())
  )
  with check (
    local_id = coalesce(fn_local_id(), fn_local_publico())
    or (fn_es_mi_cliente(cliente_id) and local_id = fn_local_publico())
  );

drop policy if exists reserva_evento_local_privado on reserva_evento;
create policy reserva_evento_local_privado on reserva_evento as restrictive for all to public
  using (
    local_id = fn_local_id()
    or (
      local_id = fn_local_publico()
      and exists (
        select 1 from reserva r
        where r.id = reserva_evento.reserva_id
          and fn_es_mi_cliente(r.cliente_id)
      )
    )
  )
  with check (
    local_id = coalesce(fn_local_id(), fn_local_publico())
  );

drop policy if exists atencion_local_privado on atencion;
create policy atencion_local_privado on atencion as restrictive for all to public
  using (
    local_id = fn_local_id()
    or (fn_es_mi_cliente(cliente_id) and local_id = fn_local_publico())
  )
  with check (
    local_id = coalesce(fn_local_id(), fn_local_publico())
    or (fn_es_mi_cliente(cliente_id) and local_id = fn_local_publico())
  );

drop policy if exists movimiento_puntos_local_privado on movimiento_puntos;
create policy movimiento_puntos_local_privado on movimiento_puntos as restrictive for all to public
  using (
    local_id = fn_local_id()
    or (fn_es_mi_cliente(cliente_id) and local_id = fn_local_publico())
  )
  with check (
    local_id = coalesce(fn_local_id(), fn_local_publico())
    or (fn_es_mi_cliente(cliente_id) and local_id = fn_local_publico())
  );
