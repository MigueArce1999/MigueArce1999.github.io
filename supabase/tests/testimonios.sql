-- 0073: testimonios de la landing. Corre después de membresias.sql (usa sus cuentas).
\set ON_ERROR_STOP on

create or replace function pg_temp.como(p_uid uuid, p_local uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_uid is null then 'anon' else 'authenticated' end, false);
  perform set_config('request.headers',
    case when p_local is null then '{}' else json_build_object('x-local-id', p_local)::text end, false);
end;
$$;
create or replace function pg_temp.afirmar(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLO DE PRUEBA: %', p_msg; end if;
  raise notice 'OK: %', p_msg;
end;
$$;

-- Super admin desde la consola (sin x-local-id) crea dos: uno publicado y uno oculto.
select pg_temp.como('aaaaaaaa-0000-0000-0000-0000000000aa', null);
set role authenticated;
insert into testimonio_plataforma (cita, autor, detalle, publicado) values
  ('GlowDesk nos ordenó la agenda.', 'Laura', 'Salón Aurora', true),
  ('Borrador sin publicar.', 'Pedro', null, false);
select pg_temp.afirmar((select count(*) from testimonio_plataforma) = 2, 'super admin ve publicados y ocultos');

-- Visitante anónimo: solo el publicado y no puede escribir.
reset role;
select pg_temp.como(null, null);
set role anon;
select pg_temp.afirmar((select count(*) from testimonio_plataforma) = 1, 'anónimo solo ve el publicado');
do $$ begin
  begin
    insert into testimonio_plataforma (cita, autor) values ('spam', 'x');
    raise exception 'FALLO DE PRUEBA: anónimo pudo insertar';
  exception when insufficient_privilege then raise notice 'OK: anónimo no puede insertar';
  end;
end $$;

-- Admin de un salón (no plataforma): lee, pero no escribe.
reset role;
select pg_temp.como('aaaaaaaa-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b');
set role authenticated;
update testimonio_plataforma set autor = 'hackeado';
select pg_temp.afirmar((select count(*) from testimonio_plataforma where autor = 'hackeado') = 0, 'admin de salón no edita testimonios');
-- El super admin, desde un salón (con x-local-id), tampoco: allá es solo clienta.
reset role;
select pg_temp.como('aaaaaaaa-0000-0000-0000-0000000000aa', 'c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001');
set role authenticated;
delete from testimonio_plataforma;
reset role;
select pg_temp.afirmar((select count(*) from testimonio_plataforma) = 2, 'super admin desde un salón no borra testimonios');
select pg_temp.como(null, null);
\echo '=== OK: testimonios de la plataforma ==='
