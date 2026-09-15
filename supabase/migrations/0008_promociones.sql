-- 0008_promociones.sql

create table promocion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text not null,
  condiciones text,
  vigente_desde timestamptz not null,
  vigente_hasta timestamptz not null,
  tipo_descuento tipo_descuento_promocion not null,
  valor numeric(12, 2) not null check (valor >= 0),
  acumulable boolean not null default false,
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint promocion_rango_valido check (vigente_hasta > vigente_desde)
);

create index promocion_vigencia_idx on promocion (vigente_desde, vigente_hasta) where activa;

create table promocion_servicio (
  promocion_id uuid not null references promocion (id) on delete cascade,
  servicio_id uuid not null references servicio (id) on delete cascade,
  primary key (promocion_id, servicio_id)
);
