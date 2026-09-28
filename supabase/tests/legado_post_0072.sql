-- Verifica que 0072 migró bien los datos del modelo anterior.
\set ON_ERROR_STOP on
do $$
declare
  a uuid := 'c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001';
  b uuid := 'b0000000-0000-0000-0000-00000000000b';
begin
  if not exists (select 1 from plataforma_admin where usuario_id = 'bbbbbbbb-0000-0000-0000-000000000001') then
    raise exception 'FALLO: super_admin no pasó a plataforma_admin'; end if;
  if exists (select 1 from perfil where rol = 'super_admin') then
    raise exception 'FALLO: quedó perfil.rol = super_admin'; end if;
  if exists (select 1 from membresia where usuario_id = 'bbbbbbbb-0000-0000-0000-000000000001' and rol <> 'cliente') then
    raise exception 'FALLO: el super admin quedó con un rol de salón'; end if;
  if (select rol from membresia where usuario_id = 'bbbbbbbb-0000-0000-0000-000000000002' and local_id = a) <> 'admin' then
    raise exception 'FALLO: admin no migró'; end if;
  if (select rol from membresia where usuario_id = 'bbbbbbbb-0000-0000-0000-000000000003' and local_id = a) <> 'empleada' then
    raise exception 'FALLO: empleada no migró'; end if;
  if (select usuario_id from profesional where id = 'bbbbbbbb-0000-0000-0000-000000000003') <> 'bbbbbbbb-0000-0000-0000-000000000003' then
    raise exception 'FALLO: profesional.usuario_id'; end if;
  if (select local_id from permiso where perfil_id = 'bbbbbbbb-0000-0000-0000-000000000003') <> a then
    raise exception 'FALLO: permiso.local_id'; end if;
  if (select count(*) from membresia where usuario_id = 'bbbbbbbb-0000-0000-0000-000000000004' and rol = 'cliente' and local_id in (a, b)) <> 2 then
    raise exception 'FALLO: clienta multi-local debe tener membresía en A y B'; end if;
  raise notice 'OK: backfill de 0072 (super admin, admin, empleada, permisos, clienta en 2 locales)';
end $$;
