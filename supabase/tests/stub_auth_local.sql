-- Stub local de auth.* de Supabase, SOLO para probar migraciones en este sandbox.
-- No se incluye en supabase/migrations (Supabase ya provee este esquema real).
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), 'anon')
$$;

-- En Supabase real, anon/authenticated ya tienen EXECUTE sobre auth.uid()/auth.role();
-- aquí se otorga explícito solo para que el sandbox de pruebas se comporte igual.
grant usage on schema auth to public;

-- Stub mínimo de storage.* (Supabase Storage), solo con las columnas que las políticas RLS de
-- las migraciones necesitan referenciar (bucket_id). No replica Supabase Storage real
-- (subida/descarga de archivos), solo permite que `create policy ... on storage.objects`
-- se aplique y se pruebe en este sandbox igual que en producción.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
grant usage on schema storage to public;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated;

