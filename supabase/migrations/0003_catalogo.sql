-- 0003_catalogo.sql
-- Categorías, servicios y qué profesional presta cada servicio.

create table categoria_servicio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden_visualizacion int not null default 0,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

create table servicio (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references categoria_servicio (id) on delete restrict,
  nombre text not null,
  descripcion text,
  imagen_url text,
  duracion_minutos int not null check (duracion_minutos > 0),
  tipo_precio tipo_precio_servicio not null default 'fijo',
  precio numeric(12, 2), -- null permitido solo si tipo_precio = 'a_valorar'
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint servicio_precio_requerido check (
    (tipo_precio = 'a_valorar' and precio is null)
    or (tipo_precio <> 'a_valorar' and precio is not null and precio >= 0)
  )
);

create index servicio_categoria_idx on servicio (categoria_id) where activo;

create table servicio_profesional (
  servicio_id uuid not null references servicio (id) on delete cascade,
  profesional_id uuid not null references profesional (id) on delete cascade,
  primary key (servicio_id, profesional_id)
);

create index servicio_profesional_prof_idx on servicio_profesional (profesional_id);
