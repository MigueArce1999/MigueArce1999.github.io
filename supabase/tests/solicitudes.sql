-- 0074: solicitudes de prueba. Corre después de membresias.sql (usa sus cuentas).
\set ON_ERROR_STOP on
create or replace function pg_temp.como(p_uid uuid, p_local uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_uid is null then 'anon' else 'authenticated' end, false);
  perform set_config('request.headers', case when p_local is null then '{}' else json_build_object('x-local-id', p_local)::text end, false);
end;
$$;
create or replace function pg_temp.afirmar(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLO DE PRUEBA: %', p_msg; end if;
  raise notice 'OK: %', p_msg;
end;
$$;

-- Visitante anónimo envía una solicitud válida.
select pg_temp.como(null, null);
set role anon;
insert into solicitud_acceso (nombre_contacto, email, whatsapp, negocio, tipo_negocio, ciudad, sedes, tamano_equipo, modulos, acepta_terminos)
values ('Laura Gómez', 'laura@salon.co', '+57 300 000 0000', 'Salón Aurora', 'Peluquería', 'Cartagena', '1', '4-10', '{Agenda,Caja}', true);
select pg_temp.afirmar(true, 'anónimo puede enviar una solicitud');
-- No puede leerla ni meterse con los campos internos ni saltarse el consentimiento.
do $$ begin
  begin perform 1 from solicitud_acceso; raise exception 'FALLO DE PRUEBA: anónimo pudo leer';
  exception when insufficient_privilege then raise notice 'OK: anónimo no puede leer solicitudes'; end;
  begin
    insert into solicitud_acceso (nombre_contacto, email, whatsapp, negocio, tipo_negocio, ciudad, sedes, tamano_equipo, acepta_terminos, estado)
    values ('X Y', 'x@y.co', '3000000000', 'N', 'Spa', 'Bogotá', '1', '1-3', true, 'activada');
    raise exception 'FALLO DE PRUEBA: anónimo se auto-activó';
  exception when insufficient_privilege or check_violation then raise notice 'OK: anónimo no puede marcarla activada'; end;
  begin
    insert into solicitud_acceso (nombre_contacto, email, whatsapp, negocio, tipo_negocio, ciudad, sedes, tamano_equipo, acepta_terminos)
    values ('X Y', 'x@y.co', '3000000000', 'Nn', 'Spa', 'Bogotá', '1', '1-3', false);
    raise exception 'FALLO DE PRUEBA: sin aceptar términos';
  exception when check_violation then raise notice 'OK: exige aceptar términos'; end;
  begin
    insert into solicitud_acceso (nombre_contacto, email, whatsapp, negocio, tipo_negocio, ciudad, sedes, tamano_equipo, acepta_terminos)
    values ('X Y', 'no-es-correo', '3000000000', 'Nn', 'Spa', 'Bogotá', '1', '1-3', true);
    raise exception 'FALLO DE PRUEBA: correo inválido aceptado';
  exception when check_violation then raise notice 'OK: valida el correo'; end;
end $$;
reset role;

-- Admin de un salón no las ve.
select pg_temp.como('aaaaaaaa-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.afirmar((select count(*) from solicitud_acceso) = 0, 'admin de salón no ve solicitudes');
reset role;

-- Super admin (consola) la ve y activa la prueba de 10 días.
select pg_temp.como('aaaaaaaa-0000-0000-0000-0000000000aa', null);
set role authenticated;
update solicitud_acceso set estado = 'activada', prueba_hasta = current_date + 10;
select pg_temp.afirmar((select count(*) from solicitud_acceso where estado = 'activada' and prueba_hasta = current_date + 10) = 1,
  'super admin activa la prueba de 10 días');
reset role;
select pg_temp.como(null, null);
\echo '=== OK: solicitudes de acceso ==='
