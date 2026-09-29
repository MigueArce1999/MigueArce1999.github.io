-- 0073_diario_belleza_cliente.sql
-- "Diario de belleza": la propia clienta puede ver (nunca escribir ni borrar) sus propias
-- observaciones y recomendaciones (cliente_nota / cliente_recomendacion, 0072) — un historial
-- tipo bitácora de lo que su profesional fue registrando visita a visita.
--
-- 0072 dejó estas dos tablas con SELECT exclusivo para admin/empleada a propósito ("Cliente: NO
-- debe recibir acceso accidental a notas administrativas internas", sección 22 del pedido
-- original). Este es un cambio de producto explícito y posterior: ahora SÍ se quiere que la
-- clienta vea lo que se anota sobre su cabello/servicio — así que de acá en adelante, cualquier
-- observación o recomendación que el salón registre debe asumirse visible para esa clienta.
-- Las políticas de 0072 (admin/empleada) se mantienen intactas; esta es una política PERMISSIVE
-- adicional, así que ambas se combinan con OR (ve lo suyo la propia clienta, y ve todo admin/
-- empleada) — no reemplaza nada.

create policy cliente_nota_select_propia on cliente_nota for select
  using (fn_es_mi_cliente(cliente_id));

create policy cliente_recomendacion_select_propia on cliente_recomendacion for select
  using (fn_es_mi_cliente(cliente_id));
