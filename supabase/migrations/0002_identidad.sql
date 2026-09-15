-- 0002_identidad.sql
-- Perfiles, permisos finos, clientes y profesionales.

create table perfil (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  telefono text,
  rol rol_usuario not null default 'cliente',
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table perfil is '1:1 con auth.users. La fuente de verdad del rol de cada persona.';

-- Permisos finos opcionales; un perfil sin fila aquí usa los permisos base de su rol.
create table permiso (
  perfil_id uuid primary key references perfil (id) on delete cascade,
  puede_ver_agenda_equipo boolean not null default false,
  puede_descuentos_hasta numeric(5, 2) not null default 0, -- % máximo de descuento autorizado
  puede_caja boolean not null default false,
  puede_anular_ventas boolean not null default false,
  puede_saltar_politica_cancelacion boolean not null default false,
  actualizado_en timestamptz not null default now()
);

-- Puede o no tener cuenta (usuario_id NULL = creado en recepción, sin acceso al portal).
create table cliente (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid unique references perfil (id) on delete set null,
  nombre text not null,
  telefono text,
  email text,
  consentimiento_comunicaciones_citas boolean not null default true, -- transaccional, no es marketing
  consentimiento_marketing boolean not null default false,
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index cliente_usuario_id_idx on cliente (usuario_id);
create index cliente_telefono_idx on cliente (telefono);
create index cliente_email_idx on cliente (lower(email));

-- 1:1 con perfil (rol 'empleada'). El id del profesional ES el id del perfil.
create table profesional (
  id uuid primary key references perfil (id) on delete cascade,
  slug text unique not null,
  especialidades text[] not null default '{}',
  bio text,
  foto_url text,
  activo boolean not null default true,
  orden_visualizacion int not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Trigger: cada auth.users nuevo obtiene automáticamente una fila en perfil (rol 'cliente' por defecto).
create or replace function fn_manejar_usuario_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  v_nombre := coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1));
  insert into perfil (id, nombre, rol) values (new.id, v_nombre, 'cliente');
  -- Toda cuenta nueva nace como cliente (con su propia fila `cliente`, vinculada por
  -- usuario_id). Si más adelante administración la asciende a 'empleada'/'admin' en
  -- `perfil.rol`, esta fila de cliente permanece intacta: así una empleada que también es
  -- clienta queda modelada con dos registros vinculados, sin duplicar historial.
  insert into cliente (usuario_id, nombre, email, telefono)
  values (new.id, v_nombre, new.email, new.raw_user_meta_data ->> 'telefono');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function fn_manejar_usuario_nuevo();
