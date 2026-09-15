-- Smoke test de los criterios de aceptación clave. Se ejecuta con rol postgres (bypass RLS)
-- salvo donde se simula auth.uid() vía set_config, para probar las funciones RPC como lo haría
-- un usuario autenticado real.
--
-- Nota de idioma SQL: las llamadas usan `select * from fn(...)` (forma de "función en el FROM"),
-- NO `select (fn(...)).* ` — esta segunda forma hace que Postgres evalúe la función varias veces
-- (una vez por cada columna expandida), lo cual duplicaría inserciones de una función VOLATILE.
-- PostgREST/Supabase (lo que usará el frontend real vía supabase.rpc) invoca la función una sola
-- vez, así que esto es una particularidad de cómo se prueba por psql, no un bug de las funciones.

\set ON_ERROR_STOP on

-- 1. Crear usuarios base (admin, empleada, 2 clientes)
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'naldi@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'cliente1@test.com'),
  ('44444444-4444-4444-4444-444444444444', 'cliente2@test.com');

update perfil set rol = 'admin' where id = '11111111-1111-1111-1111-111111111111';
update perfil set rol = 'empleada' where id = '22222222-2222-2222-2222-222222222222';

insert into profesional (id, slug, especialidades) values
  ('22222222-2222-2222-2222-222222222222', 'naldi', array['Color','Corte']);

-- El trigger on_auth_user_created ya creó una fila `cliente` para cada auth.users insertado
-- arriba (toda cuenta nueva nace como cliente). Se fija su id a valores conocidos para el resto
-- del script en vez de insertar filas nuevas (insertar duplicaría el usuario_id, que es unique).
update cliente set id = 'c1111111-1111-1111-1111-111111111111', nombre = 'Cliente Uno'
  where usuario_id = '33333333-3333-3333-3333-333333333333';
update cliente set id = 'c2222222-2222-2222-2222-222222222222', nombre = 'Cliente Dos'
  where usuario_id = '44444444-4444-4444-4444-444444444444';

insert into categoria_servicio (id, nombre) values ('ca100000-0000-0000-0000-000000000001', 'Cabello');
insert into servicio (id, categoria_id, nombre, duracion_minutos, tipo_precio, precio) values
  ('5e120000-0000-0000-0000-000000000001', 'ca100000-0000-0000-0000-000000000001', 'Corte', 60, 'fijo', 50000);
insert into servicio_profesional (servicio_id, profesional_id) values
  ('5e120000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- Horario: Naldi disponible lunes 9am-5pm (lunes = dow 1)
insert into horario_disponibilidad (profesional_id, dia_semana, hora_inicio, hora_fin) values
  ('22222222-2222-2222-2222-222222222222', 1, '09:00', '17:00');

insert into regla_comision (profesional_id, servicio_id, tipo, valor) values
  ('22222222-2222-2222-2222-222222222222', null, 'porcentaje', 40);

insert into regla_puntos (tasa, activa) values (0.02, true);

-- 2. Probar disponibilidad para un lunes futuro conocido: 2026-09-21 es lunes
select count(*) as slots_disponibles from fn_disponibilidad(
  '5e120000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-09-21'
);

-- 3. Cliente 1 reserva 10:00-11:00 del lunes
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select set_config('request.jwt.claim.role', 'authenticated', false);

select * from fn_crear_reserva(
  'c1111111-1111-1111-1111-111111111111',
  '5e120000-0000-0000-0000-000000000001',
  '22222222-2222-2222-2222-222222222222',
  '2026-09-21 10:00:00-05'::timestamptz
) \gset r1_

\echo '--- Reserva 1 creada, estado:'
select :'r1_estado' as reserva1_estado;

-- 4. CRITERIO: Cliente 2 intenta reservar el MISMO horario con la MISMA profesional -> debe fallar
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$
begin
  begin
    perform fn_crear_reserva(
      'c2222222-2222-2222-2222-222222222222',
      '5e120000-0000-0000-0000-000000000001',
      '22222222-2222-2222-2222-222222222222',
      '2026-09-21 10:00:00-05'::timestamptz
    );
    raise exception 'FALLO DE PRUEBA: se permitió doble reserva del mismo horario';
  exception when others then
    raise notice 'OK esperado (rechazado): %', sqlerrm;
  end;
end $$;

-- 5. Cliente 2 reserva un horario distinto (11:00) sin problema
select * from fn_crear_reserva(
  'c2222222-2222-2222-2222-222222222222',
  '5e120000-0000-0000-0000-000000000001',
  '22222222-2222-2222-2222-222222222222',
  '2026-09-21 11:00:00-05'::timestamptz
) \gset r2_
\echo '--- Reserva 2 (horario distinto) creada, estado:'
select :'r2_estado' as reserva2_estado;

-- CRITERIO: una empleada no puede aplicar un descuento fuera de su permiso autorizado
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$
begin
  begin
    -- Naldi no tiene fila en `permiso` todavía => su límite de descuento por defecto es 0%.
    perform fn_registrar_atencion(
      'c1111111-1111-1111-1111-111111111111',
      null,
      jsonb_build_array(jsonb_build_object(
        'servicio_id', '5e120000-0000-0000-0000-000000000001',
        'profesional_id', '22222222-2222-2222-2222-222222222222',
        'descuento', 25000  -- 50% de 50000, muy por encima de su límite (0%)
      ))
    );
    raise exception 'FALLO DE PRUEBA: se permitió un descuento fuera de permiso';
  exception when others then
    raise notice 'OK esperado (descuento rechazado): %', sqlerrm;
  end;
end $$;

insert into permiso (perfil_id, puede_descuentos_hasta) values ('22222222-2222-2222-2222-222222222222', 10);
select * from fn_registrar_atencion(
  'c1111111-1111-1111-1111-111111111111',
  null,
  jsonb_build_array(jsonb_build_object(
    'servicio_id', '5e120000-0000-0000-0000-000000000001',
    'profesional_id', '22222222-2222-2222-2222-222222222222',
    'descuento', 2500 -- 5%, dentro de su nuevo límite del 10%
  ))
) \gset atdesc_
\echo '--- CRITERIO OK: descuento dentro de permiso (10%) aceptado, atención:'
select :'atdesc_id' as atencion_con_descuento_autorizado;

-- 6. Naldi completa y cobra la atención de cliente 1
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

select * from fn_registrar_atencion(
  'c1111111-1111-1111-1111-111111111111',
  :'r1_id'::uuid,
  jsonb_build_array(jsonb_build_object('servicio_id','5e120000-0000-0000-0000-000000000001','profesional_id','22222222-2222-2222-2222-222222222222'))
) \gset at_

\echo '--- Atención creada:'
select :'at_id' as atencion_id, :'at_estado' as atencion_estado;

select * from fn_completar_y_cobrar_atencion(
  :'at_id'::uuid,
  jsonb_build_array(jsonb_build_object('metodo','efectivo','monto',50000)),
  'test-idem-key-1'
) \gset done_

\echo '--- Atención completada, estado:'
select :'done_estado' as atencion_estado_final, :'done_completado_en' as completado_en;

-- CRITERIO: reintentar con la MISMA idempotency key no debe duplicar pago/comision/puntos
select * from fn_completar_y_cobrar_atencion(
  :'at_id'::uuid,
  jsonb_build_array(jsonb_build_object('metodo','efectivo','monto',50000)),
  'test-idem-key-1'
) \gset retry_

\echo '--- CRITERIO idempotencia: debe haber exactamente 1 pago, 1 comisión, y puntos = 1000 (2% de 50000)'
select count(*) as pagos_totales from pago where atencion_id = :'at_id'::uuid;
select count(*) as comisiones_totales from comision where atencion_servicio_id in (select id from atencion_servicio where atencion_id = :'at_id'::uuid);
select sum(puntos) as puntos_cliente1 from movimiento_puntos where cliente_id = 'c1111111-1111-1111-1111-111111111111';

-- CRITERIO: reprogramar libera el horario anterior y ocupa el nuevo
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select * from fn_reprogramar_reserva(:'r2_id'::uuid, '2026-09-21 13:00:00-05'::timestamptz) \gset reprog_
\echo '--- Reserva 2 reprogramada a las 13:00, rango:'
select :'reprog_rango' as nuevo_rango;

-- Ahora el horario de las 11:00 debe estar libre de nuevo (lo ocupaba la reserva 2 antes de reprogramar)
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select estado as reserva_en_horario_liberado from fn_crear_reserva(
  'c1111111-1111-1111-1111-111111111111',
  '5e120000-0000-0000-0000-000000000001',
  '22222222-2222-2222-2222-222222222222',
  '2026-09-21 11:00:00-05'::timestamptz
);

-- CRITERIO: devolución deja trazabilidad y corrige comisión/puntos
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- admin
select id as pago_original_id from pago where atencion_id = :'at_id'::uuid and monto > 0 \gset dev_
select * from fn_registrar_devolucion(:'dev_pago_original_id'::uuid, 25000, 'Cliente no quedó conforme con la mitad del servicio') \gset devres_
\echo '--- Devolución registrada, monto (negativo):'
select :'devres_monto' as monto_devolucion;
select sum(monto) as neto_pagado from pago where atencion_id = :'at_id'::uuid;
select sum(valor) as comision_neta from comision where atencion_servicio_id in (select id from atencion_servicio where atencion_id = :'at_id'::uuid);
select sum(puntos) as puntos_netos_cliente1 from movimiento_puntos where cliente_id = 'c1111111-1111-1111-1111-111111111111';

-- CRITERIO: cambiar una regla de comisión no debe alterar comisiones ya generadas (snapshot)
update regla_comision set vigente_hasta = now() where profesional_id = '22222222-2222-2222-2222-222222222222' and vigente_hasta is null;
insert into regla_comision (profesional_id, servicio_id, tipo, valor) values ('22222222-2222-2222-2222-222222222222', null, 'porcentaje', 90);
select valor as comision_ya_generada_no_cambia from comision where atencion_servicio_id in (select id from atencion_servicio where atencion_id = :'at_id'::uuid) order by creado_en limit 1;

\echo '=== TODOS LOS CRITERIOS PROBADOS OK ==='
