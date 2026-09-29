-- 0074_solicitudes_acceso.sql
-- Solicitudes de prueba de GlowDesk (formulario "Pedir acceso" de la landing).
-- Cualquiera puede ENVIAR una (anon); solo el super admin las ve y las gestiona en la consola.

create table if not exists solicitud_acceso (
  id uuid primary key default gen_random_uuid(),
  -- Contacto
  nombre_contacto text not null check (length(trim(nombre_contacto)) between 2 and 120),
  cargo text check (cargo is null or length(cargo) <= 80),
  email text not null check (length(email) <= 160 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp text not null check (length(regexp_replace(whatsapp, '\D', '', 'g')) between 7 and 15),
  -- Negocio
  negocio text not null check (length(trim(negocio)) between 2 and 120),
  razon_social text check (razon_social is null or length(razon_social) <= 160),
  nit text check (nit is null or length(nit) <= 30),
  tipo_negocio text not null check (length(tipo_negocio) <= 60),
  ciudad text not null check (length(trim(ciudad)) between 2 and 80),
  direccion text check (direccion is null or length(direccion) <= 200),
  sedes text not null check (length(sedes) <= 20),
  tamano_equipo text not null check (length(tamano_equipo) <= 20),
  sitio_web text check (sitio_web is null or length(sitio_web) <= 200),
  instagram text check (instagram is null or length(instagram) <= 80),
  -- Necesidades
  herramienta_actual text check (herramienta_actual is null or length(herramienta_actual) <= 60),
  modulos text[] not null default '{}' check (cardinality(modulos) <= 20),
  mensaje text check (mensaje is null or length(mensaje) <= 1000),
  -- Consentimientos (Ley 1581 de 2012)
  acepta_terminos boolean not null check (acepta_terminos),
  acepta_novedades boolean not null default false,
  -- Gestión interna (consola)
  estado text not null default 'pendiente' check (estado in ('pendiente', 'contactada', 'activada', 'descartada')),
  prueba_hasta date,
  notas_internas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table solicitud_acceso is
  'Pedidos de prueba de 10 días desde la landing. Se habilitan en máximo 1 día hábil desde la consola.';

create index if not exists solicitud_acceso_estado_idx on solicitud_acceso (estado, creado_en desc);

alter table solicitud_acceso enable row level security;
revoke all on solicitud_acceso from anon, authenticated;
-- Insertar sin RETURNING (el público no puede leer la tabla).
grant insert on solicitud_acceso to anon, authenticated;
grant select, update, delete on solicitud_acceso to authenticated;

drop policy if exists solicitud_acceso_enviar on solicitud_acceso;
create policy solicitud_acceso_enviar on solicitud_acceso for insert to anon, authenticated
  with check (estado = 'pendiente' and prueba_hasta is null and notas_internas is null);

drop policy if exists solicitud_acceso_super_admin on solicitud_acceso;
create policy solicitud_acceso_super_admin on solicitud_acceso for all to authenticated
  using (fn_es_super_admin())
  with check (fn_es_super_admin());

create or replace function fn_solicitud_acceso_actualizada() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists solicitud_acceso_actualizada on solicitud_acceso;
create trigger solicitud_acceso_actualizada before update on solicitud_acceso
  for each row execute function fn_solicitud_acceso_actualizada();
