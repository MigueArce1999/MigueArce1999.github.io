-- 0016_fix_cliente_select.sql
-- Corrige un defecto de diseño en cliente_select (0014): una empleada podía INSERTAR un
-- cliente nuevo (cliente_insert lo permite vía fn_rol_actual() = 'empleada'), pero no podía
-- VERLO inmediatamente después, porque cliente_select solo la dejaba ver clientes con los que
-- ya tuviera una atención o reserva previa (fn_profesional_atendio_cliente). Postgres evalúa
-- el `RETURNING *` de un INSERT contra la política de SELECT de la tabla, así que
-- `insert().select().single()` fallaba con "new row violates row-level security policy for
-- table cliente" al registrar un cliente nuevo desde el portal de empleadas (Atender.tsx).
--
-- Cualquier empleada/admin necesita poder buscar y registrar cualquier cliente (recepción,
-- caja, atención), no solo los que ya atendió antes, así que se amplía la regla para cubrir
-- ese caso real de uso.
drop policy cliente_select on cliente;
create policy cliente_select on cliente for select
  using (
    usuario_id = auth.uid()
    or fn_es_admin()
    or fn_tiene_permiso('puede_caja')
    or fn_rol_actual() = 'empleada'
    or fn_profesional_atendio_cliente(id)
  );
