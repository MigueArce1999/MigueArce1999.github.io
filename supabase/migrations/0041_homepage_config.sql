-- 0041_homepage_config.sql
-- Módulo admin "Configuración de la homepage": reutiliza categoria_servicio, promocion y
-- profesional (que ya alimentan el catálogo público) en vez de crear modelos paralelos —
-- solo se agregan las columnas de contenido/visibilidad/orden que le faltaban a cada una.

-- --- Categorías: contenido de la tarjeta que se muestra en "Nuestros servicios" -------------
-- `activa` ya existe y ya controla la visibilidad pública de la categoría en todo el sitio
-- (Servicios.tsx, listarCategorias) — se reutiliza tal cual como el interruptor "visible en la
-- homepage", sin agregar un segundo booleano paralelo. `orden_visualizacion` también ya existe.
alter table categoria_servicio
  add column if not exists descripcion_corta text,
  add column if not exists imagen_url text,
  add column if not exists texto_boton text not null default 'Ver servicio',
  add column if not exists enlace_boton text;

-- --- Promociones: contenido de marketing + orden propio de aparición en la homepage ---------
-- Las fechas pasan a ser opcionales (antes eran obligatorias): si no hay fechas, la visibilidad
-- pública depende únicamente de `activa` (el interruptor "Mostrar en la homepage" del admin es
-- ese mismo campo, no uno nuevo).
alter table promocion
  add column if not exists imagen_url text,
  add column if not exists orden_visualizacion int not null default 0,
  add column if not exists texto_boton text not null default 'Ver promoción',
  add column if not exists enlace_boton text;

alter table promocion alter column vigente_desde drop not null;
alter table promocion alter column vigente_hasta drop not null;
alter table promocion drop constraint if exists promocion_rango_valido;
alter table promocion add constraint promocion_rango_valido
  check (vigente_desde is null or vigente_hasta is null or vigente_hasta > vigente_desde);

-- --- Profesional: separa "opera en el salón" (activo) de "aparece en la vitrina de la
-- homepage" (mostrar_en_home) — un profesional puede seguir activo (agenda, reservas, ventas)
-- sin ser parte de la portada destacada.
alter table profesional add column if not exists mostrar_en_home boolean not null default true;

-- create or replace view no puede insertar una columna en medio de las existentes (solo agregar
-- al final) sin que Postgres lo interprete como un rename de la columna que queda desplazada —
-- por eso mostrar_en_home va después de pf.nombre, no junto a las demás columnas de profesional.
create or replace view vista_profesional as
select
  p.id, p.slug, p.especialidades, p.bio, p.foto_url, p.activo, p.orden_visualizacion,
  pf.nombre, p.mostrar_en_home
from profesional p
join perfil pf on pf.id = p.id;

-- --- Configuración general de la portada (fila única, mismo patrón que configuracion_negocio).
-- La imagen principal (hero) no es editable todavía: se deja la columna y el interruptor
-- `hero_editable` listos para cuando se habilite esa función, pero ninguna pantalla los expone
-- como control activo por ahora.
create table configuracion_homepage (
  id boolean primary key default true,
  hero_imagen_url text,
  hero_editable boolean not null default false,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references perfil (id),
  constraint configuracion_homepage_singleton check (id)
);
insert into configuracion_homepage (id) values (true);

alter table configuracion_homepage enable row level security;
create policy configuracion_homepage_select_publico on configuracion_homepage for select using (true);
create policy configuracion_homepage_admin_escribe on configuracion_homepage for all
  using (fn_es_admin()) with check (fn_es_admin());

-- --- Storage: bucket público para las imágenes que administra este módulo (categorías y
-- promociones). Nunca se guarda la imagen en la base de datos: solo la ruta/URL pública.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagenes-publico', 'imagenes-publico', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy imagenes_publico_select on storage.objects for select
  using (bucket_id = 'imagenes-publico');
create policy imagenes_publico_insert on storage.objects for insert
  with check (bucket_id = 'imagenes-publico' and fn_es_admin());
create policy imagenes_publico_update on storage.objects for update
  using (bucket_id = 'imagenes-publico' and fn_es_admin());
create policy imagenes_publico_delete on storage.objects for delete
  using (bucket_id = 'imagenes-publico' and fn_es_admin());
