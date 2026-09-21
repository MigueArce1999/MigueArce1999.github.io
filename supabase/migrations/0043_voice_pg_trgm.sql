-- 0043_voice_pg_trgm.sql
-- Búsqueda difusa (fuzzy) para el asistente de voz: pg_trgm permite medir qué tan parecidos son
-- dos textos (similarity()) sin depender de coincidencias exactas — necesario para que "Balayash"
-- encuentre "Balayage" o "Valery" encuentre a la profesional aunque la transcripción de voz
-- tenga errores menores. Los índices GIN con gin_trgm_ops son los que hacen que esa comparación
-- sea rápida incluso cuando el catálogo crezca (sin ellos, similarity() funciona igual mediante
-- un recorrido secuencial, solo que sin acelerar con índice).
create extension if not exists pg_trgm;

create index if not exists cliente_nombre_trgm_idx on cliente using gin (nombre gin_trgm_ops);
create index if not exists servicio_nombre_trgm_idx on servicio using gin (nombre gin_trgm_ops);
-- El nombre de una profesional vive en `perfil` (profesional solo tiene el id + datos propios
-- del rol); vista_profesional lo expone vía join, así que el índice va en la tabla real.
create index if not exists perfil_nombre_trgm_idx on perfil using gin (nombre gin_trgm_ops);
