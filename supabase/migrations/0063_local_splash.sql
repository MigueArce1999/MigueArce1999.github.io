-- 0063_local_splash.sql
-- Imagen o video de la pantalla de carga (3 s) configurable desde GlowDesk.
alter table local
  add column if not exists splash_url text;

comment on column local.splash_url is
  'URL pública de imagen o video para la pantalla de carga. Dura 3 segundos. Si falta, el sitio usa logo_url.';

-- El bucket nació solo para fotos (5 MB, jpeg/png/webp). El splash admite video corto.
update storage.buckets
set
  file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
where id = 'imagenes-publico';
