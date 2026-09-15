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

