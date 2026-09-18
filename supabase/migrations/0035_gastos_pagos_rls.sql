-- 0035_gastos_pagos_rls.sql
-- RLS del módulo "Gastos y pagos". `gasto`/`categoria_gasto` ya tenían RLS activo desde 0014
-- (stub de Fase 2); las tablas nuevas de 0033 nacen sin políticas propias, y como 0014 ya dejó
-- GRANT de tabla + ALTER DEFAULT PRIVILEGES para anon/authenticated, sin estas políticas
-- cualquier cuenta autenticada podría leer/escribir directo — se activa RLS aquí antes de que
-- el frontend las use.
--
-- Reutiliza los permisos existentes (nunca se inventa uno nuevo): puede_caja para
-- crear/pagar/consultar, puede_anular_ventas para revertir/anular — mismo criterio que ya usan
-- fn_registrar_atencion y fn_registrar_devolucion. Una profesional sin puede_caja sigue sin
-- ningún acceso a gastos ni cuentas, tal como ya garantizaba gasto_admin_o_permiso (0014).

alter table cuenta enable row level security;
alter table cuenta_movimiento enable row level security;
alter table proveedor enable row level security;
alter table plantilla_gasto_recurrente enable row level security;
alter table plantilla_gasto_ocurrencia enable row level security;
alter table gasto_pago enable row level security;
alter table gasto_pago_reversion enable row level security;
alter table gasto_evento enable row level security;

-- Cuentas: cualquiera con puede_caja las ve (las necesita para elegir "cuenta de origen" al
-- pagar); solo admin las crea o edita (dar de alta un banco/billetera es tarea de
-- configuración, no de captura diaria).
create policy cuenta_select on cuenta for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));
create policy cuenta_admin_escribe on cuenta for all using (fn_es_admin()) with check (fn_es_admin());

-- El libro de movimientos de cuenta solo se escribe desde las funciones SECURITY DEFINER de
-- 0034 (bypasean RLS al ejecutar como el dueño de la función) — aquí solo hace falta lectura.
create policy cuenta_movimiento_select on cuenta_movimiento for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));

-- Proveedor/beneficiario: seleccionable o creable por cualquiera que pueda registrar gastos.
create policy proveedor_select on proveedor for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));
create policy proveedor_escribe on proveedor for all
  using (fn_es_admin() or fn_tiene_permiso('puede_caja'))
  with check (fn_es_admin() or fn_tiene_permiso('puede_caja'));

-- categoria_gasto_admin (0014) es "for all" solo para admin — sin política de select para
-- puede_caja, recepción no podría ni ver la lista de categorías al crear un gasto.
create policy categoria_gasto_select_caja on categoria_gasto for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));

-- Plantillas recurrentes: crear/editar/pausar no mueve dinero por sí solo (la ocurrencia real
-- solo nace vía fn_generar_siguiente_gasto_recurrente), así que se permite escritura directa.
create policy plantilla_gasto_recurrente_select on plantilla_gasto_recurrente for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));
create policy plantilla_gasto_recurrente_escribe on plantilla_gasto_recurrente for all
  using (fn_es_admin() or fn_tiene_permiso('puede_caja'))
  with check (fn_es_admin() or fn_tiene_permiso('puede_caja'));

-- Las ocurrencias generadas solo se leen directo; se insertan únicamente desde el RPC.
create policy plantilla_gasto_ocurrencia_select on plantilla_gasto_ocurrencia for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));

-- Pagos, reversiones e historial: solo lectura directa — toda escritura pasa por las funciones
-- SECURITY DEFINER de 0034 (fn_crear_gasto, fn_registrar_pago_gasto, fn_revertir_pago_gasto,
-- fn_anular_gasto), igual que el resto de la lógica sensible del proyecto.
create policy gasto_pago_select on gasto_pago for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));
create policy gasto_pago_reversion_select on gasto_pago_reversion for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));
create policy gasto_evento_select on gasto_evento for select using (fn_es_admin() or fn_tiene_permiso('puede_caja'));

-- ---------------------------------------------------------------------------
-- Comprobantes: bucket privado (nunca público). Solo quien puede manejar gastos puede subir o
-- ver un comprobante; solo admin puede borrarlo. Validación de tipo/tamaño de archivo se hace
-- en el cliente antes de subir (Supabase Storage no valida MIME por política RLS), y se
-- refuerza aquí limitando el bucket a un tamaño máximo de archivo razonable para un
-- comprobante (10 MB) vía la propia configuración del bucket.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-gastos', 'comprobantes-gastos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy comprobantes_gastos_select on storage.objects for select
  using (bucket_id = 'comprobantes-gastos' and (fn_es_admin() or fn_tiene_permiso('puede_caja')));
create policy comprobantes_gastos_insert on storage.objects for insert
  with check (bucket_id = 'comprobantes-gastos' and (fn_es_admin() or fn_tiene_permiso('puede_caja')));
create policy comprobantes_gastos_delete on storage.objects for delete
  using (bucket_id = 'comprobantes-gastos' and fn_es_admin());
