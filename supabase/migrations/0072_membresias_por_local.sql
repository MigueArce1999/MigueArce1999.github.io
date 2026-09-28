-- 0072_membresias_por_local.sql
-- Una persona = una cuenta Auth (un correo, UNA contraseña para todos los salones).
-- Esa persona puede pertenecer a N locales con un rol distinto en cada uno:
--   clienta en A, empleada en B, admin en C…  →  tabla `membresia` (usuario_id, local_id, rol).
--
-- El rol que vale en una petición es el de la membresía del local que viaja en el header
-- `x-local-id` (VITE_LOCAL_ID de cada instalación). perfil.rol y perfil.local_id quedan como
-- espejo LEGADO para builds viejos; ninguna función ni política nueva los usa.
--
-- super_admin sale de perfil.rol y pasa a `plataforma_admin`. fn_es_super_admin() solo es
-- verdadero cuando la petición NO trae x-local-id (la consola glowdesk_admin). En cualquier
-- salón (glowdesk_base siempre manda el header) esa persona es exactamente lo que diga su
-- membresía en ese local: clienta, empleada, admin o nada.
--
-- Una misma persona puede ser profesional en varios locales: `profesional` deja de usar el id
-- del usuario como llave. Cada (usuario, local) tiene su propio profesional.id; las filas
-- existentes conservan id = usuario_id, así que nada del historial cambia de llave.

-- ---------------------------------------------------------------------------
-- 1. Tablas nuevas
-- ---------------------------------------------------------------------------
create table if not exists plataforma_admin (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  creado_en timestamptz not null default now()
);
comment on table plataforma_admin is
  'Cuentas de la consola glowdesk_admin. No es un rol de salón: la base (con x-local-id) lo ignora.';

create table if not exists membresia (
  usuario_id uuid not null references perfil (id) on delete cascade,
  local_id uuid not null references local (id) on delete cascade,
  rol rol_usuario not null default 'cliente',
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (usuario_id, local_id),
  constraint membresia_rol_de_salon check (rol in ('cliente', 'empleada', 'admin'))
);
create index if not exists membresia_local_idx on membresia (local_id, rol);
comment on table membresia is
  'Rol de una persona en un local. Una fila por (usuario, local). La contraseña es la de la cuenta Auth, única.';

-- ---------------------------------------------------------------------------
-- 2. Backfill desde el modelo anterior
-- ---------------------------------------------------------------------------
insert into plataforma_admin (usuario_id)
select id from perfil where rol = 'super_admin'
on conflict do nothing;

alter table perfil drop constraint if exists perfil_local_coherente;

insert into membresia (usuario_id, local_id, rol)
select id, local_id, rol from perfil
where local_id is not null and rol in ('cliente', 'empleada', 'admin')
on conflict do nothing;

-- Clienta en otros salones (0056 ya lo permitía con filas `cliente` por local).
insert into membresia (usuario_id, local_id, rol)
select distinct c.usuario_id, c.local_id, 'cliente'::rol_usuario
from cliente c
join perfil p on p.id = c.usuario_id
where c.usuario_id is not null
on conflict do nothing;

-- super_admin deja de existir como rol de perfil.
update perfil set rol = 'cliente', actualizado_en = now() where rol = 'super_admin';

-- ---------------------------------------------------------------------------
-- 3. Helpers de identidad (la base de todas las políticas existentes)
-- ---------------------------------------------------------------------------

-- Local de la petición SOLO si la persona es miembro activo de él.
-- Sin header (Realtime, SQL editor, Edge Functions): el local "principal" de perfil.local_id si
-- sigue siendo miembro (lo mismo que devolvía antes, así Realtime no cambia), si no su única
-- membresía.
-- Se evalúa en casi todas las políticas (por fila), así que se cachea por transacción; cualquier
-- cambio en membresia/perfil limpia la caché (triggers más abajo).
create or replace function fn_local_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req uuid;
  v uuid;
  n int;
  v_clave text;
  v_cache text;
begin
  if v_uid is null then
    return null;
  end if;
  v_req := fn_local_id_request();
  v_clave := v_uid::text || '|' || coalesce(v_req::text, '-');
  v_cache := current_setting('glowdesk.local_cache', true);
  if v_cache is not null and v_cache <> '' and split_part(v_cache, '=', 1) = v_clave then
    return nullif(split_part(v_cache, '=', 2), '')::uuid;
  end if;

  if v_req is not null then
    select m.local_id into v from membresia m
    where m.usuario_id = v_uid and m.local_id = v_req and m.activo;
  else
    select m.local_id into v from membresia m
    join perfil p on p.id = m.usuario_id and p.local_id = m.local_id
    where m.usuario_id = v_uid and m.activo;
    if v is null then
      select count(*) into n from membresia m where m.usuario_id = v_uid and m.activo;
      if n = 1 then
        select m.local_id into v from membresia m where m.usuario_id = v_uid and m.activo;
      end if;
    end if;
  end if;

  perform set_config('glowdesk.local_cache', v_clave || '=' || coalesce(v::text, ''), true);
  return v;
end;
$$;

create or replace function fn_limpiar_cache_local() returns trigger
language plpgsql as $$
begin
  perform set_config('glowdesk.local_cache', '', true);
  return null;
end;
$$;
drop trigger if exists membresia_limpiar_cache on membresia;
create trigger membresia_limpiar_cache after insert or update or delete on membresia
  for each statement execute function fn_limpiar_cache_local();
drop trigger if exists perfil_limpiar_cache on perfil;
create trigger perfil_limpiar_cache after update of local_id on perfil
  for each statement execute function fn_limpiar_cache_local();

create or replace function fn_rol_actual() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select m.rol from membresia m
  where m.usuario_id = auth.uid() and m.local_id = fn_local_id() and m.activo
$$;

create or replace function fn_es_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and fn_local_id_request() is null
    and exists (select 1 from plataforma_admin where usuario_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- 4. Profesional: un registro por (usuario, local)
-- ---------------------------------------------------------------------------
alter table profesional add column if not exists usuario_id uuid;
update profesional set usuario_id = id where usuario_id is null;
alter table profesional alter column usuario_id set not null;
alter table profesional drop constraint if exists profesional_id_fkey;
alter table profesional drop constraint if exists profesional_usuario_id_fkey;
alter table profesional add constraint profesional_usuario_id_fkey
  foreign key (usuario_id) references perfil (id) on delete cascade;
alter table profesional alter column id set default gen_random_uuid();
create unique index if not exists profesional_usuario_por_local_idx on profesional (usuario_id, local_id);

comment on column profesional.usuario_id is 'Cuenta de la persona. profesional.id es propio de este local (históricamente igual a usuario_id).';

-- Builds viejos insertan profesional (id = usuario). Se completa usuario_id solo.
create or replace function fn_profesional_completar_usuario() returns trigger
language plpgsql as $$
begin
  if new.usuario_id is null then
    new.usuario_id := new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists profesional_completar_usuario on profesional;
create trigger profesional_completar_usuario before insert on profesional
  for each row execute function fn_profesional_completar_usuario();

create or replace function fn_mi_profesional_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profesional p
  where p.usuario_id = auth.uid() and p.local_id = fn_local_id()
  limit 1
$$;
grant execute on function fn_mi_profesional_id() to authenticated;

create or replace function fn_es_profesional(p_profesional_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(fn_mi_profesional_id() = p_profesional_id, false)
$$;

create or replace view vista_profesional as
select p.id, p.slug, p.especialidades, p.bio, p.foto_url, p.activo, p.orden_visualizacion,
       pf.nombre, p.mostrar_en_home, p.local_id, p.usuario_id
from profesional p
join perfil pf on pf.id = p.usuario_id;

-- ---------------------------------------------------------------------------
-- 5. Permisos finos: por local
-- ---------------------------------------------------------------------------
alter table permiso add column if not exists local_id uuid references local (id) on delete cascade;
update permiso pe set local_id = pf.local_id
from perfil pf
where pf.id = pe.perfil_id and pe.local_id is null;
delete from permiso where local_id is null;
alter table permiso alter column local_id set not null;
alter table permiso alter column local_id set default fn_local_efectivo();
alter table permiso drop constraint if exists permiso_pkey;
alter table permiso add primary key (perfil_id, local_id);

drop policy if exists permiso_local_privado on permiso;
create policy permiso_local_privado on permiso as restrictive for all to public
  using (local_id = fn_local_id())
  with check (local_id = fn_local_id());

create or replace function fn_tiene_permiso(p_columna text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_resultado boolean;
begin
  if fn_es_admin() then
    return true;
  end if;
  execute format('select %I from permiso where perfil_id = $1 and local_id = $2', p_columna)
    into v_resultado using auth.uid(), fn_local_id();
  return coalesce(v_resultado, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Unicidades que asumían "una profesional = una persona"
-- ---------------------------------------------------------------------------
drop index if exists regla_comision_vigente_unica_idx;
create unique index regla_comision_vigente_unica_idx on regla_comision
  (profesional_id, coalesce(servicio_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where vigente_hasta is null;
-- (profesional_id ya es único por local, así que la unicidad existente sigue siendo correcta.)

-- ---------------------------------------------------------------------------
-- 7. Reescribir políticas y funciones: "soy esa profesional" ya no es auth.uid()
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for r in
    select * from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'auth\.uid\(\)'
  loop
    v_using := r.qual;
    v_check := r.with_check;
    if r.tablename = 'profesional' then
      v_using := regexp_replace(v_using, '\(id = auth\.uid\(\)\)', '(usuario_id = auth.uid())', 'g');
      v_check := regexp_replace(v_check, '\(id = auth\.uid\(\)\)', '(usuario_id = auth.uid())', 'g');
    end if;
    v_using := regexp_replace(v_using, 'profesional_id = auth\.uid\(\)', 'profesional_id = fn_mi_profesional_id()', 'g');
    v_check := regexp_replace(v_check, 'profesional_id = auth\.uid\(\)', 'profesional_id = fn_mi_profesional_id()', 'g');
    if v_using is not distinct from r.qual and v_check is not distinct from r.with_check then
      continue;
    end if;
    v_sql := format('drop policy %I on %I.%I; create policy %I on %I.%I as %s for %s to %s',
      r.policyname, r.schemaname, r.tablename,
      r.policyname, r.schemaname, r.tablename,
      r.permissive, r.cmd, array_to_string(r.roles, ', '));
    if v_using is not null then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;
    execute v_sql;
  end loop;
end $$;

do $$
declare
  r record;
  v_def text;
  v_nuevo text;
begin
  for r in
    select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname not in ('fn_local_id', 'fn_rol_actual', 'fn_es_profesional', 'fn_mi_profesional_id',
                            'fn_tiene_permiso', 'fn_es_super_admin')
      and p.prosrc ~ '(profesional_id (=|<>) auth\.uid\(\)|auth\.uid\(\) (=|<>) p_profesional_id|coalesce\(p_profesional_id, auth\.uid\(\)\)|v_objetivo <> auth\.uid\(\)|pf\.id = p\.id|pf\.id = sd\.profesional_id|from permiso where perfil_id = auth\.uid\(\))'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_nuevo := v_def;
    v_nuevo := regexp_replace(v_nuevo, '(\w+\.)?profesional_id = auth\.uid\(\)', '\1profesional_id = fn_mi_profesional_id()', 'g');
    v_nuevo := regexp_replace(v_nuevo, '(\w+\.)?profesional_id <> auth\.uid\(\)', '\1profesional_id is distinct from fn_mi_profesional_id()', 'g');
    v_nuevo := regexp_replace(v_nuevo, 'auth\.uid\(\) <> p_profesional_id', 'fn_mi_profesional_id() is distinct from p_profesional_id', 'g');
    v_nuevo := regexp_replace(v_nuevo, 'auth\.uid\(\) = p_profesional_id', 'fn_mi_profesional_id() = p_profesional_id', 'g');
    v_nuevo := regexp_replace(v_nuevo, 'coalesce\(p_profesional_id, auth\.uid\(\)\)', 'coalesce(p_profesional_id, fn_mi_profesional_id())', 'g');
    v_nuevo := regexp_replace(v_nuevo, 'v_objetivo <> auth\.uid\(\)', 'v_objetivo is distinct from fn_mi_profesional_id()', 'g');
    v_nuevo := regexp_replace(v_nuevo, 'pf\.id = p\.id', 'pf.id = p.usuario_id', 'g');
    v_nuevo := regexp_replace(v_nuevo, 'pf\.id = sd\.profesional_id',
      'pf.id = (select pr.usuario_id from profesional pr where pr.id = sd.profesional_id)', 'g');
    v_nuevo := regexp_replace(v_nuevo, 'from permiso where perfil_id = auth\.uid\(\)',
      'from permiso where perfil_id = auth.uid() and local_id = fn_local_id()', 'g');
    if v_nuevo <> v_def then
      execute v_nuevo;
    end if;
  end loop;

  -- Si quedó algún patrón sin convertir, que la migración falle en vez de dejar un hueco.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ '(profesional_id (=|<>) auth\.uid\(\)|auth\.uid\(\) (=|<>) p_profesional_id|v_objetivo <> auth\.uid\(\))'
  ) or exists (
    select 1 from pg_policies where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'profesional_id = auth\.uid\(\)'
  ) then
    raise exception '0072: quedaron comparaciones profesional_id = auth.uid() sin convertir';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. perfil: visible dentro de mi local si la persona es miembro de él
-- ---------------------------------------------------------------------------
create or replace function fn_es_miembro_de_mi_local(p_usuario_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membresia m
    where m.usuario_id = p_usuario_id and m.local_id = fn_local_id()
  )
$$;

drop policy if exists perfil_super_admin_oculto on perfil;
drop policy if exists perfil_rol_plataforma on perfil;
drop policy if exists perfil_local_privado on perfil;
create policy perfil_local_privado on perfil as restrictive for all to public
  using (id = auth.uid() or fn_es_miembro_de_mi_local(id) or fn_es_super_admin())
  with check (id = auth.uid() or fn_es_miembro_de_mi_local(id) or fn_es_super_admin());

-- ---------------------------------------------------------------------------
-- 9. RLS de las tablas nuevas (sin escritura directa: todo por RPC)
-- ---------------------------------------------------------------------------
alter table membresia enable row level security;
alter table plataforma_admin enable row level security;
revoke all on membresia, plataforma_admin from anon, authenticated;
grant select on membresia, plataforma_admin to authenticated;

drop policy if exists membresia_select on membresia;
create policy membresia_select on membresia for select
  using (
    usuario_id = auth.uid()
    or (local_id = fn_local_id() and fn_es_admin())
    or fn_es_super_admin()
  );

drop policy if exists plataforma_admin_select on plataforma_admin;
create policy plataforma_admin_select on plataforma_admin for select
  using (usuario_id = auth.uid() or fn_es_super_admin());

-- ---------------------------------------------------------------------------
-- 10. Alta de cuentas y "clienta en este salón"
-- ---------------------------------------------------------------------------
create or replace function fn_manejar_usuario_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_local uuid;
  v_n int;
begin
  v_nombre := coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1));
  begin
    v_local := nullif(new.raw_user_meta_data ->> 'local_id', '')::uuid;
  exception when invalid_text_representation then
    v_local := null;
  end;
  if v_local is null then
    v_local := fn_local_id_request();
  end if;
  if v_local is null then
    select count(*) into v_n from local where activo;
    if v_n = 1 then
      select id into v_local from local where activo limit 1;
    end if;
  end if;
  if v_local is null or not exists (select 1 from local where id = v_local and activo) then
    raise exception 'Falta el identificador del local para crear la cuenta.';
  end if;

  insert into perfil (id, nombre, rol, local_id) values (new.id, v_nombre, 'cliente', v_local);
  insert into membresia (usuario_id, local_id, rol) values (new.id, v_local, 'cliente')
  on conflict do nothing;
  insert into cliente (usuario_id, nombre, email, telefono, local_id)
  values (new.id, v_nombre, new.email, new.raw_user_meta_data ->> 'telefono', v_local);
  return new;
end;
$$;

create or replace function fn_asegurar_cliente_en_local()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_local uuid;
  v_id uuid;
  v_nombre text;
  v_email text;
  v_telefono text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.';
  end if;
  v_local := coalesce(fn_local_id_request(), fn_local_id());
  if v_local is null or not exists (select 1 from local where id = v_local and activo) then
    raise exception 'Falta el identificador del local.';
  end if;

  insert into membresia (usuario_id, local_id, rol) values (v_uid, v_local, 'cliente')
  on conflict do nothing;

  select id into v_id from cliente where usuario_id = v_uid and local_id = v_local limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select pf.nombre, pf.telefono, au.email
    into v_nombre, v_telefono, v_email
  from perfil pf
  join auth.users au on au.id = pf.id
  where pf.id = v_uid;

  insert into cliente (usuario_id, nombre, email, telefono, local_id)
  values (
    v_uid,
    coalesce(v_nombre, split_part(coalesce(v_email, 'clienta'), '@', 1)),
    v_email,
    v_telefono,
    v_local
  )
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function fn_asegurar_cliente_en_local() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Sesión de ESTE salón (lo que usa el frontend en lugar de perfil.rol / perfil.local_id)
-- ---------------------------------------------------------------------------
create or replace function fn_mi_sesion() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_perfil perfil;
  v_local uuid;
  v_rol rol_usuario;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_perfil from perfil where id = v_uid;
  if not found then
    return null;
  end if;
  v_local := fn_local_id();
  v_rol := fn_rol_actual();
  return jsonb_build_object(
    'id', v_perfil.id,
    'nombre', v_perfil.nombre,
    'telefono', v_perfil.telefono,
    'activo', v_perfil.activo,
    'rol', coalesce(v_rol, 'cliente'),
    'local_id', v_local,
    'profesional_id', fn_mi_profesional_id(),
    'es_super_admin', fn_es_super_admin()
  );
end;
$$;
grant execute on function fn_mi_sesion() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Equipo: vincular / quitar sin tocar perfil.rol (RPCs para el admin del salón)
-- ---------------------------------------------------------------------------
create or replace function fn_espejar_perfil_legado(p_usuario_id uuid, p_local_id uuid, p_rol rol_usuario)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Solo para que builds anteriores (que leen perfil.rol/local_id) sigan funcionando
  -- cuando la persona pertenece a un único salón.
  update perfil
    set rol = p_rol, local_id = p_local_id, actualizado_en = now()
  where id = p_usuario_id
    and (local_id is null or local_id = p_local_id)
    and (rol is distinct from p_rol or local_id is distinct from p_local_id);
end;
$$;
revoke execute on function fn_espejar_perfil_legado(uuid, uuid, rol_usuario) from public, anon, authenticated;

create or replace function fn_vincular_empleada(p_email text, p_slug text, p_nombre text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid := fn_local_id();
  v_uid uuid;
  v_prof profesional;
  v_rol_actual rol_usuario;
  v_estado text;
begin
  if not fn_es_admin() then
    raise exception 'Solo la administración del salón puede vincular empleadas.';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'Todavía no existe una cuenta con ese correo.';
  end if;
  if not exists (select 1 from perfil where id = v_uid) then
    raise exception 'La cuenta existe pero su perfil aún no se ha creado. Intenta de nuevo en unos segundos.';
  end if;

  if nullif(trim(coalesce(p_nombre, '')), '') is not null then
    update perfil set nombre = trim(p_nombre), actualizado_en = now()
    where id = v_uid and nombre is distinct from trim(p_nombre)
      and not exists (select 1 from membresia where usuario_id = v_uid and local_id <> v_local);
  end if;

  select rol into v_rol_actual from membresia where usuario_id = v_uid and local_id = v_local;
  insert into membresia (usuario_id, local_id, rol)
  values (v_uid, v_local, 'empleada')
  on conflict (usuario_id, local_id) do update
    set rol = case when membresia.rol = 'admin' then 'admin'::rol_usuario else 'empleada'::rol_usuario end,
        activo = true,
        actualizado_en = now();

  -- Ficha de clienta en este salón (una empleada también puede reservar).
  insert into cliente (usuario_id, nombre, email, local_id)
  select v_uid, pf.nombre, au.email, v_local
  from perfil pf join auth.users au on au.id = pf.id
  where pf.id = v_uid
    and not exists (select 1 from cliente c where c.usuario_id = v_uid and c.local_id = v_local);

  select * into v_prof from profesional where usuario_id = v_uid and local_id = v_local;
  if found then
    if v_prof.activo and v_rol_actual in ('empleada', 'admin') then
      v_estado := 'ya_era_empleada';
    else
      update profesional set activo = true, actualizado_en = now() where id = v_prof.id;
      v_estado := 'reactivada';
    end if;
  else
    insert into profesional (id, usuario_id, local_id, slug)
    values (
      -- Primera vez como profesional en cualquier salón: conserva id = usuario (como siempre).
      case when exists (select 1 from profesional where id = v_uid) then gen_random_uuid() else v_uid end,
      v_uid, v_local, trim(p_slug)
    )
    returning * into v_prof;
    v_estado := 'vinculada';
  end if;

  perform fn_espejar_perfil_legado(v_uid, v_local,
    case when v_rol_actual = 'admin' then 'admin'::rol_usuario else 'empleada'::rol_usuario end);

  return jsonb_build_object('estado', v_estado, 'usuario_id', v_uid, 'profesional_id', v_prof.id);
end;
$$;
grant execute on function fn_vincular_empleada(text, text, text) to authenticated;

create or replace function fn_quitar_de_equipo(p_profesional_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prof profesional;
begin
  if not fn_es_admin() then
    raise exception 'Solo la administración del salón puede quitar a alguien del equipo.';
  end if;
  select * into v_prof from profesional where id = p_profesional_id and local_id = fn_local_id();
  if not found then
    raise exception 'Esa profesional no pertenece a este salón.';
  end if;
  update profesional set activo = false, actualizado_en = now() where id = v_prof.id;
  -- Una admin que además atendía sigue siendo admin; solo deja de figurar como profesional.
  update membresia set rol = 'cliente', actualizado_en = now()
  where usuario_id = v_prof.usuario_id and local_id = v_prof.local_id and rol = 'empleada';
  if found then
    perform fn_espejar_perfil_legado(v_prof.usuario_id, v_prof.local_id, 'cliente');
  end if;
end;
$$;
grant execute on function fn_quitar_de_equipo(uuid) to authenticated;

-- Para el SQL editor (postgres) o la consola: dar un rol a alguien en un local concreto.
create or replace function fn_conceder_rol_en_local(p_email text, p_local_id uuid, p_rol rol_usuario)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
begin
  if auth.uid() is not null and not fn_es_super_admin() then
    raise exception 'Solo la plataforma puede asignar roles entre salones.';
  end if;
  if p_rol not in ('cliente', 'empleada', 'admin') then
    raise exception 'Rol de salón inválido: %', p_rol;
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'No hay una cuenta con ese correo.';
  end if;
  insert into membresia (usuario_id, local_id, rol) values (v_uid, p_local_id, p_rol)
  on conflict (usuario_id, local_id) do update set rol = excluded.rol, activo = true, actualizado_en = now();
  if not exists (select 1 from cliente where usuario_id = v_uid and local_id = p_local_id) then
    insert into cliente (usuario_id, nombre, email, local_id)
    select v_uid, pf.nombre, au.email, p_local_id
    from perfil pf join auth.users au on au.id = pf.id where pf.id = v_uid;
  end if;
  perform fn_espejar_perfil_legado(v_uid, p_local_id, p_rol);
end;
$$;
revoke execute on function fn_conceder_rol_en_local(text, uuid, rol_usuario) from public, anon;
grant execute on function fn_conceder_rol_en_local(text, uuid, rol_usuario) to authenticated;

create or replace function fn_conceder_super_admin(p_email text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'No hay una cuenta con ese correo.';
  end if;
  insert into plataforma_admin (usuario_id) values (v_id) on conflict do nothing;
  return v_id;
end;
$$;
revoke execute on function fn_conceder_super_admin(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. Compatibilidad: builds anteriores que aún hacen UPDATE perfil SET rol/local_id
-- ---------------------------------------------------------------------------
create or replace function fn_perfil_rol_a_membresia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid;
begin
  if new.rol = 'super_admin' then
    -- Nadie se vuelve super_admin editando perfil: eso es plataforma_admin.
    new.rol := old.rol;
    new.local_id := old.local_id;
    return new;
  end if;
  if new.rol is not distinct from old.rol and new.local_id is not distinct from old.local_id then
    return new;
  end if;
  v_local := case
    when new.local_id is distinct from old.local_id then new.local_id
    else coalesce(fn_local_id(), new.local_id)
  end;
  if v_local is not null then
    insert into membresia (usuario_id, local_id, rol) values (new.id, v_local, new.rol)
    on conflict (usuario_id, local_id) do update set rol = excluded.rol, actualizado_en = now();
  end if;
  return new;
end;
$$;
drop trigger if exists perfil_rol_a_membresia on perfil;
create trigger perfil_rol_a_membresia before update of rol, local_id on perfil
  for each row execute function fn_perfil_rol_a_membresia();

comment on column perfil.rol is 'LEGADO: espejo para builds anteriores. El rol real es membresia.rol del local de la petición.';
comment on column perfil.local_id is 'LEGADO: local "principal". El acceso real sale de membresia.';
