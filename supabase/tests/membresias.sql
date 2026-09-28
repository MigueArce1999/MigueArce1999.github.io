-- Criterios de 0072_membresias_por_local.sql (corre DESPUÉS de criterios_aceptacion.sql).
--   * Una cuenta (un correo, una contraseña) con un rol distinto en cada local.
--   * super_admin solo existe en la consola (sin x-local-id); en un salón es indiferente.
--   * La misma persona puede ser profesional en dos locales sin mezclar agendas.
-- Las verificaciones con RLS corren con `set role authenticated`, igual que PostgREST.

\set ON_ERROR_STOP on

create or replace function pg_temp.como(p_uid uuid, p_local uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.headers',
    case when p_local is null then '{}' else json_build_object('x-local-id', p_local)::text end, false);
end;
$$;

create or replace function pg_temp.afirmar(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FALLO DE PRUEBA: %', p_msg;
  end if;
  raise notice 'OK: %', p_msg;
end;
$$;

-- Locales: A = semilla, B y C nuevos.
insert into local (id, nombre, slug) values
  ('b0000000-0000-0000-0000-00000000000b', 'Salón B', 'salon-b'),
  ('c0000000-0000-0000-0000-00000000000c', 'Salón C', 'salon-c');
insert into configuracion_negocio (local_id) values
  ('b0000000-0000-0000-0000-00000000000b'), ('c0000000-0000-0000-0000-00000000000c')
on conflict do nothing;

\set A '''c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001'''
\set B '''b0000000-0000-0000-0000-00000000000b'''
\set C '''c0000000-0000-0000-0000-00000000000c'''
\set MULTI '''aaaaaaaa-0000-0000-0000-000000000001'''
\set ADMB '''aaaaaaaa-0000-0000-0000-00000000000b'''
\set ADMC '''aaaaaaaa-0000-0000-0000-00000000000c'''

-- Cuentas: cada una se registra desde un salón (metadata local_id, como hace el frontend).
insert into auth.users (id, email, raw_user_meta_data) values
  (:MULTI, 'multi@test.com', jsonb_build_object('nombre', 'Multi', 'local_id', :A)),
  (:ADMB, 'adminb@test.com', jsonb_build_object('nombre', 'Admin B', 'local_id', :B)),
  (:ADMC, 'adminc@test.com', jsonb_build_object('nombre', 'Admin C', 'local_id', :C)),
  ('aaaaaaaa-0000-0000-0000-0000000000aa', 'sa@test.com', jsonb_build_object('nombre', 'Plataforma', 'local_id', :A));

-- Como postgres (SQL editor): admins de B y C, super admin de plataforma.
select pg_temp.como(null, null);
select fn_conceder_rol_en_local('adminb@test.com', :B, 'admin');
select fn_conceder_rol_en_local('adminc@test.com', :C, 'admin');
select fn_conceder_rol_en_local('multi@test.com', :C, 'admin');
select fn_conceder_super_admin('sa@test.com');

select pg_temp.afirmar((select count(*) from auth.users where email = 'multi@test.com') = 1,
  'multi@test.com es UNA sola cuenta Auth (una contraseña)');

-- Admin B vincula a multi@ como empleada de B (función del panel Equipo).
select pg_temp.como(:ADMB, :B);
select fn_vincular_empleada('multi@test.com', 'multi', null) ->> 'estado' as vincular_b \gset
select pg_temp.afirmar(:'vincular_b' = 'vinculada', 'admin B vincula a multi@ como empleada');

-- ------------------------------------------------------------------ roles por local
select pg_temp.como(:MULTI, :A);
select pg_temp.afirmar(fn_rol_actual() = 'cliente' and not fn_es_admin() and fn_mi_profesional_id() is null,
  'multi@ en A: clienta, sin profesional');
select pg_temp.afirmar((fn_mi_sesion() ->> 'rol') = 'cliente' and (fn_mi_sesion() ->> 'local_id')::uuid = :A,
  'fn_mi_sesion en A → cliente');

select pg_temp.como(:MULTI, :B);
select pg_temp.afirmar(fn_rol_actual() = 'empleada' and not fn_es_admin(), 'multi@ en B: empleada');
select fn_mi_profesional_id() as prof_b \gset
select pg_temp.afirmar(:'prof_b'::uuid = :MULTI::uuid, 'primera ficha de profesional conserva id = usuario (compatibilidad)');

select pg_temp.como(:MULTI, :C);
select pg_temp.afirmar(fn_rol_actual() = 'admin' and fn_es_admin(), 'multi@ en C: admin');

-- Sin header (Realtime / SQL): el local principal (donde se registró), aunque tenga 3 membresías.
select pg_temp.como(:MULTI, null);
select pg_temp.afirmar(fn_local_id() = :A::uuid, 'sin x-local-id (Realtime): local principal, no null');

-- Salón sin membresía: nada.
insert into local (id, nombre, slug) values ('d0000000-0000-0000-0000-00000000000d', 'Salón D', 'salon-d');
select pg_temp.como(:MULTI, 'd0000000-0000-0000-0000-00000000000d');
select pg_temp.afirmar(fn_rol_actual() is null and fn_local_id() is null and not fn_es_admin(),
  'multi@ en D (sin registro): sin rol');
-- En la MISMA transacción (caché de fn_local_id): tras registrarse, ya cuenta como de D.
begin;
select pg_temp.afirmar(fn_local_id() is null, 'antes de registrarse en D: sin local (queda en caché)');
select fn_asegurar_cliente_en_local() is not null as ok \gset
select pg_temp.afirmar(fn_rol_actual() = 'cliente' and fn_local_id() = 'd0000000-0000-0000-0000-00000000000d'::uuid,
  'al entrar a D queda registrada como clienta de D (la caché se invalida)');
commit;

-- ------------------------------------------------------------------ profesional en 2 locales
-- Admin C (que es multi@ misma) la vincula como profesional de C: sigue siendo admin, nueva ficha.
select pg_temp.como(:MULTI, :C);
select fn_vincular_empleada('multi@test.com', 'multi', null) as vinc_c \gset
select pg_temp.afirmar(fn_rol_actual() = 'admin', 'vincularse como profesional no le quita admin en C');
select fn_mi_profesional_id() as prof_c \gset
select pg_temp.afirmar(:'prof_c'::uuid <> :'prof_b'::uuid, 'ficha de profesional distinta en C y en B');

-- Horarios separados por local (antes la agenda se habría mezclado).
reset role;
insert into horario_disponibilidad (profesional_id, dia_semana, hora_inicio, hora_fin, local_id)
values (:'prof_b', 2, '08:00', '12:00', :B), (:'prof_c', 2, '14:00', '18:00', :C);

set role authenticated;
select pg_temp.como(:MULTI, :B);
select pg_temp.afirmar((select count(*) from horario_disponibilidad) = 1
  and (select hora_inicio from horario_disponibilidad) = '08:00', 'en B solo ve su horario de B');
select pg_temp.afirmar((select count(*) from vista_profesional where usuario_id = :MULTI and local_id = :B) = 1,
  'vista_profesional: una ficha por local');
select pg_temp.como(:MULTI, :C);
select pg_temp.afirmar((select count(*) from horario_disponibilidad where profesional_id = :'prof_c') = 1
  and (select count(*) from horario_disponibilidad where profesional_id = :'prof_b') = 0,
  'en C ve el horario de C y no el de B');
reset role;

-- ------------------------------------------------------------------ aislamiento de datos por rol
set role authenticated;
select pg_temp.como(:ADMB, :B);
select pg_temp.afirmar((select count(*) from membresia) >= 2 and not exists (select 1 from membresia where local_id <> :B),
  'admin B solo ve membresías de B');
select pg_temp.afirmar(not exists (select 1 from perfil where id = :ADMC), 'admin B no ve el perfil de admin C');
select pg_temp.afirmar(exists (select 1 from perfil where id = :MULTI), 'admin B sí ve a su empleada');
select pg_temp.como(:ADMB, :C);
select pg_temp.afirmar(not fn_es_admin() and fn_rol_actual() is null, 'admin B con header de C no es nada en C');
reset role;

-- ------------------------------------------------------------------ permisos finos por local
reset role;
insert into permiso (perfil_id, local_id, puede_caja) values (:MULTI, :B, true);
select pg_temp.como(:MULTI, :B);
select pg_temp.afirmar(fn_tiene_permiso('puede_caja'), 'permiso de caja vale en B');
select pg_temp.como(:MULTI, :A);
select pg_temp.afirmar(not fn_tiene_permiso('puede_caja'), 'permiso de caja de B no vale en A');

-- ------------------------------------------------------------------ quitar del equipo
select pg_temp.como(:ADMB, :B);
select fn_quitar_de_equipo(:'prof_b');
select pg_temp.como(:MULTI, :B);
select pg_temp.afirmar(fn_rol_actual() = 'cliente' and fn_mi_profesional_id() = :'prof_b'::uuid,
  'quitada de B: queda clienta (ficha inactiva conserva historial)');
select pg_temp.como(:MULTI, :C);
select pg_temp.afirmar(fn_rol_actual() = 'admin', 'sigue siendo admin en C');
select pg_temp.como(:ADMB, :B);
select fn_vincular_empleada('multi@test.com', 'multi', null) ->> 'estado' as revinc \gset
select pg_temp.afirmar(:'revinc' = 'reactivada', 'volver a vincular reactiva la misma ficha');

-- ------------------------------------------------------------------ super admin
select pg_temp.como('aaaaaaaa-0000-0000-0000-0000000000aa', null);
select pg_temp.afirmar(fn_es_super_admin() and (fn_mi_sesion() ->> 'es_super_admin')::boolean,
  'consola (sin x-local-id): super admin');
set role authenticated;
select pg_temp.afirmar((select count(*) from local) >= 4, 'consola: ve todos los locales');
update local set eslogan = 'Editado desde la consola' where id = :B;
select pg_temp.afirmar((select eslogan from local where id = :B) = 'Editado desde la consola', 'consola: puede editar locales');

select pg_temp.como('aaaaaaaa-0000-0000-0000-0000000000aa', :A);
select pg_temp.afirmar(not fn_es_super_admin() and fn_rol_actual() = 'cliente'
  and (fn_mi_sesion() ->> 'rol') = 'cliente' and not (fn_mi_sesion() ->> 'es_super_admin')::boolean,
  'en el salón A el super admin es solo clienta');
update local set eslogan = 'hackeado' where id = :B;
select pg_temp.afirmar(not exists (select 1 from perfil where id = :ADMC), 'en un salón el super admin no ve perfiles de otros salones');
reset role;
select pg_temp.afirmar((select eslogan from local where id = :B) = 'Editado desde la consola',
  'desde un salón el super admin NO puede editar locales');
select pg_temp.afirmar(not exists (select 1 from perfil where rol = 'super_admin'), 'perfil.rol ya no guarda super_admin');

-- ------------------------------------------------------------------ builds anteriores
-- Un build viejo asciende con UPDATE perfil SET rol, local_id → queda la membresía.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-0000000000ee', 'legado@test.com', jsonb_build_object('nombre', 'Legado', 'local_id', :B));
set role authenticated;
select pg_temp.como(:ADMB, :B);
update perfil set rol = 'empleada', local_id = :B where id = 'aaaaaaaa-0000-0000-0000-0000000000ee';
insert into profesional (id, slug, local_id) values ('aaaaaaaa-0000-0000-0000-0000000000ee', 'legado', :B);
reset role;
select pg_temp.como('aaaaaaaa-0000-0000-0000-0000000000ee', :B);
select pg_temp.afirmar(fn_rol_actual() = 'empleada'
  and fn_mi_profesional_id() = 'aaaaaaaa-0000-0000-0000-0000000000ee'::uuid,
  'build viejo: UPDATE perfil + INSERT profesional siguen funcionando');

select pg_temp.como(null, null);
\echo '=== OK: membresías por local ==='
