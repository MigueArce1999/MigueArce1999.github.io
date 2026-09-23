-- 0056_cliente_multi_local.sql
-- Una cuenta Auth (un correo) puede ser clienta en varios locales.
-- usuario_id deja de ser único global; es único por local.
-- fn_asegurar_cliente_en_local crea la fila de este salón (header x-local-id)
-- para quien ya tenía cuenta en otro local o es super_admin.

alter table cliente drop constraint if exists cliente_usuario_id_key;

create unique index if not exists cliente_usuario_por_local_idx
  on cliente (local_id, usuario_id)
  where usuario_id is not null;

drop policy if exists cliente_local_privado on cliente;
create policy cliente_local_privado on cliente as restrictive for all to public
  using (
    local_id = fn_local_id()
    or (usuario_id = auth.uid() and local_id = fn_local_publico())
    or fn_es_super_admin()
  )
  with check (
    local_id = coalesce(fn_local_id(), fn_local_publico())
    or (usuario_id = auth.uid() and local_id = fn_local_publico())
    or fn_es_super_admin()
  );

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
  v_local := fn_local_publico();
  if v_local is null or not exists (select 1 from local where id = v_local and activo) then
    raise exception 'Falta el identificador del local.';
  end if;

  select id into v_id
  from cliente
  where usuario_id = v_uid and local_id = v_local
  limit 1;
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
