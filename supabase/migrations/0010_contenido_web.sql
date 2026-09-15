-- 0010_contenido_web.sql
-- Contenido administrable del sitio público.

create table contenido_pagina (
  clave text primary key, -- 'quienes_somos' | 'inicio_mensaje' | ...
  titulo text,
  cuerpo text,
  es_provisional boolean not null default true, -- true = "contenido provisional" mientras no lo edite admin
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references perfil (id)
);

create table contenido_evento (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  fecha_inicio timestamptz not null,
  fecha_fin timestamptz,
  imagen_url text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create index contenido_evento_fecha_idx on contenido_evento (fecha_inicio);

-- Reseñas reales únicamente (registradas manualmente por administración o importadas); nunca sintéticas.
create table resena (
  id uuid primary key default gen_random_uuid(),
  autor_nombre text not null,
  calificacion smallint not null check (calificacion between 1 and 5),
  comentario text not null,
  fuente text, -- 'google' | 'instagram' | 'manual'
  visible boolean not null default true,
  creado_en timestamptz not null default now()
);
