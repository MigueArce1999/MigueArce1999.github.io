-- 0053_local_marca.sql
-- Marca por local (logo, favicon, nombre, URL) y rol de plataforma que las administra
-- sin mezclarse con el admin de un salón.

create or replace function fn_es_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(fn_rol_actual() = 'super_admin', false)
$$;

alter table local
  add column if not exists logo_url text,
  add column if not exists favicon_url text,
  add column if not exists url_sitio text,
  add column if not exists nombre_corto text,
  add column if not exists eslogan text;

comment on column local.logo_url is 'URL pública del logo (header, splash).';
comment on column local.favicon_url is 'URL pública del favicon / icono de pestaña.';
comment on column local.url_sitio is 'URL pública de la instalación (informativa; el aislamiento es VITE_LOCAL_ID).';
comment on column local.nombre_corto is 'Sigla o nombre corto para sidebar y PWA.';
comment on column local.eslogan is 'Texto corto junto al nombre (título de pestaña).';

update local set
  nombre_corto = coalesce(nombre_corto, 'CP'),
  eslogan = coalesce(eslogan, 'Salón de belleza'),
  url_sitio = coalesce(url_sitio, 'https://saladebellezaclaudiapatricia.com')
where id = 'c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001';

-- Un super_admin no pertenece a ningún salón.
alter table perfil alter column local_id drop not null;
alter table perfil drop constraint if exists perfil_local_coherente;
alter table perfil add constraint perfil_local_coherente check (
  (rol = 'super_admin' and local_id is null)
  or (rol <> 'super_admin' and local_id is not null)
);

drop policy if exists local_select_propio on local;
create policy local_select_propio on local for select
  using (id = fn_local_publico() or id = fn_local_id() or fn_es_super_admin());

drop policy if exists local_super_admin_escribe on local;
create policy local_super_admin_escribe on local for all
  using (fn_es_super_admin())
  with check (fn_es_super_admin());

grant select on table local to anon, authenticated;
grant insert, update on table local to authenticated;

drop policy if exists perfil_super_admin_oculto on perfil;
create policy perfil_super_admin_oculto on perfil as restrictive for select
  using (rol <> 'super_admin' or id = auth.uid() or fn_es_super_admin());

drop policy if exists perfil_rol_plataforma on perfil;
create policy perfil_rol_plataforma on perfil as restrictive for update
  using (rol <> 'super_admin' or fn_es_super_admin())
  with check (rol <> 'super_admin' or fn_es_super_admin());

-- Storage: el admin del salón sigue subiendo homepage; la plataforma sube marca.
drop policy if exists imagenes_publico_insert on storage.objects;
create policy imagenes_publico_insert on storage.objects for insert
  with check (bucket_id = 'imagenes-publico' and (fn_es_admin() or fn_es_super_admin()));

drop policy if exists imagenes_publico_update on storage.objects;
create policy imagenes_publico_update on storage.objects for update
  using (bucket_id = 'imagenes-publico' and (fn_es_admin() or fn_es_super_admin()));

drop policy if exists imagenes_publico_delete on storage.objects;
create policy imagenes_publico_delete on storage.objects for delete
  using (bucket_id = 'imagenes-publico' and (fn_es_admin() or fn_es_super_admin()));

drop function if exists fn_provisionar_local(text, text);

create or replace function fn_provisionar_local(
  p_nombre text,
  p_slug text,
  p_url_sitio text default null,
  p_nombre_corto text default null,
  p_eslogan text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not fn_es_super_admin() then
    raise exception 'Solo la plataforma puede crear un local.';
  end if;
  insert into local (nombre, slug, url_sitio, nombre_corto, eslogan)
  values (
    trim(p_nombre),
    trim(p_slug),
    nullif(trim(coalesce(p_url_sitio, '')), ''),
    nullif(trim(coalesce(p_nombre_corto, '')), ''),
    nullif(trim(coalesce(p_eslogan, '')), '')
  )
  returning id into v_id;
  insert into configuracion_negocio (local_id) values (v_id);
  insert into configuracion_homepage (local_id) values (v_id);
  insert into configuracion_fidelizacion (local_id) values (v_id);
  insert into categoria_servicio (nombre, orden_visualizacion, local_id)
  values ('Otros servicios', 99, v_id);
  return v_id;
end;
$$;

grant execute on function fn_provisionar_local(text, text, text, text, text) to authenticated;

-- Conceder el rol desde el SQL editor de Supabase (postgres), no desde el frontend.
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
  update perfil
    set rol = 'super_admin', local_id = null, actualizado_en = now()
    where id = v_id;
  return v_id;
end;
$$;

revoke all on function fn_conceder_super_admin(text) from public, anon, authenticated;
