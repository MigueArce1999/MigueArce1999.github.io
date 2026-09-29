-- 0073_testimonios_plataforma.sql
-- Testimonios de la landing de GlowDesk (glowdesk_admin). Son de la PLATAFORMA, no de un salón:
-- no llevan local_id. Cualquiera lee los publicados; solo el super admin (consola) los gestiona.

create table if not exists testimonio_plataforma (
  id uuid primary key default gen_random_uuid(),
  cita text not null check (length(trim(cita)) between 1 and 600),
  autor text not null check (length(trim(autor)) between 1 and 120),
  detalle text check (detalle is null or length(detalle) <= 160),
  foto_url text,
  publicado boolean not null default true,
  orden int not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table testimonio_plataforma is
  'Reseñas que muestra la landing de GlowDesk. detalle = negocio/cargo/ciudad de quien la da.';

create index if not exists testimonio_plataforma_orden_idx on testimonio_plataforma (publicado, orden, creado_en);

alter table testimonio_plataforma enable row level security;
revoke all on testimonio_plataforma from anon, authenticated;
grant select on testimonio_plataforma to anon, authenticated;
grant insert, update, delete on testimonio_plataforma to authenticated;

drop policy if exists testimonio_plataforma_lectura on testimonio_plataforma;
create policy testimonio_plataforma_lectura on testimonio_plataforma for select
  using (publicado or fn_es_super_admin());

drop policy if exists testimonio_plataforma_super_admin on testimonio_plataforma;
create policy testimonio_plataforma_super_admin on testimonio_plataforma for all
  using (fn_es_super_admin())
  with check (fn_es_super_admin());

create or replace function fn_testimonio_plataforma_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists testimonio_plataforma_actualizado on testimonio_plataforma;
create trigger testimonio_plataforma_actualizado before update on testimonio_plataforma
  for each row execute function fn_testimonio_plataforma_actualizado();
