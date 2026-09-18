-- 0037_gastos_categoria_insumos.sql
-- Nueva categoría "Insumos" (distinta de "Insumos desechables", ya existente desde 0033): para
-- insumos generales del salón, no solo los desechables. Inserción idempotente, igual patrón que
-- el seed de categorías iniciales de 0033 — nunca duplica si ya existe por otro medio.
insert into categoria_gasto (nombre)
select 'Insumos'
where not exists (select 1 from categoria_gasto where lower(nombre) = lower('Insumos'));
