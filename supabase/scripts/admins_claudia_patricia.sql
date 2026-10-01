-- Da rol de ADMIN del salón Claudia Patricia a las cuentas de abajo.
-- Correr en Supabase → SQL Editor (rol postgres). Requiere la migración 0072 (membresías).
-- Es idempotente: se puede correr varias veces. No quita el super admin de la consola:
-- con 0072 una misma cuenta puede ser super admin en glowdesk_admin y admin en el salón.

do $$
declare
  v_local uuid;
  v_email text;
  v_faltan text[] := '{}';
begin
  if to_regclass('public.membresia') is null then
    raise exception 'Primero aplica supabase/migrations/0072_membresias_por_local.sql';
  end if;

  select id into v_local from local where slug = 'claudia-patricia';
  if v_local is null then
    raise exception 'No encontré el local con slug claudia-patricia';
  end if;

  foreach v_email in array array[
    'esneider.m12@gmail.com',
    'miguelarcemercado08@gmail.com'
  ] loop
    if not exists (select 1 from auth.users where lower(email) = lower(v_email)) then
      v_faltan := v_faltan || v_email;
      continue;
    end if;
    perform fn_conceder_rol_en_local(v_email, v_local, 'admin');
    raise notice 'OK: % es admin de Claudia Patricia', v_email;
  end loop;

  if cardinality(v_faltan) > 0 then
    raise notice 'Estas cuentas aún no existen: %. Regístrense en el sitio del salón (o créalas en Authentication → Users) y vuelve a correr este script.', v_faltan;
  end if;
end $$;

-- Verificación
select u.email, m.rol, m.activo, p.rol as rol_legado, (pa.usuario_id is not null) as super_admin_consola
from membresia m
join auth.users u on u.id = m.usuario_id
join local l on l.id = m.local_id
join perfil p on p.id = m.usuario_id
left join plataforma_admin pa on pa.usuario_id = m.usuario_id
where l.slug = 'claudia-patricia'
  and lower(u.email) in ('esneider.m12@gmail.com', 'miguelarcemercado08@gmail.com');
