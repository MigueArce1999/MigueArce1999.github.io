-- 0064_local_splash_gif.sql
-- El splash también admite GIF animado (0063 pudo haberse aplicado sin image/gif).
update storage.buckets
set
  file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
where id = 'imagenes-publico';
