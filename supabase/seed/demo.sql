-- ============================================================================
-- DATOS DE DEMOSTRACIÓN — Claudia Patricia Salón de Belleza
-- ============================================================================
-- NO ejecutar contra una base de datos de producción. Este script es solo para
-- poder ver el catálogo público y el dashboard con contenido de ejemplo antes
-- de que administración cargue los datos reales.
--
-- No incluye perfiles de clientes/empleadas/admin porque esas filas requieren
-- una cuenta real en Supabase Auth (auth.users) — no se pueden fabricar de
-- forma segura por SQL directo sin construir a mano campos internos de Auth
-- (encrypted_password, aud, instance_id, etc.) que deben quedar a cargo de
-- Supabase. Para probar los portales de cliente/empleada/admin con datos de
-- ejemplo, crea usuarios reales desde /registro y /ingresar y luego usa este
-- patrón para asignarles rol:
--   update perfil set rol = 'empleada' where id = '<uuid del usuario>';
--
-- El equipo inicial mencionado en el brief (Claudia, Naldi, Ana, Valery) NO se
-- inventa aquí con horarios/comisiones "confirmados": eso lo debe cargar
-- administración desde /admin/equipo una vez existan sus cuentas.
-- ============================================================================

insert into categoria_servicio (nombre, orden_visualizacion) values
  ('Cabello', 1),
  ('Estética', 2),
  ('Cejas y maquillaje', 3),
  ('Manicura y pedicura', 4)
on conflict (nombre) do nothing;

insert into servicio (categoria_id, nombre, descripcion, duracion_minutos, tipo_precio, precio)
select c.id, s.nombre, s.descripcion, s.duracion, s.tipo::tipo_precio_servicio, s.precio
from (values
  ('Cabello', 'Corte de dama', 'Corte y asesoría de imagen según tipo de rostro y cabello. [DEMO]', 60, 'fijo', 45000),
  ('Cabello', 'Color y tinte', 'Aplicación de color completo. El valor final depende de largo y técnica. [DEMO]', 120, 'desde', 120000),
  ('Cabello', 'Alisado / tratamiento capilar', 'Tratamiento de alisado o hidratación profunda. Se valora según diagnóstico capilar. [DEMO]', 150, 'a_valorar', null),
  ('Estética', 'Limpieza facial profunda', 'Limpieza, exfoliación e hidratación facial. [DEMO]', 60, 'fijo', 70000),
  ('Cejas y maquillaje', 'Diseño de cejas', 'Perfilado y diseño de cejas con henna opcional. [DEMO]', 30, 'fijo', 25000),
  ('Cejas y maquillaje', 'Maquillaje social', 'Maquillaje para eventos. [DEMO]', 60, 'desde', 80000),
  ('Manicura y pedicura', 'Manicura clásica', 'Manicura con esmaltado tradicional. [DEMO]', 45, 'fijo', 30000),
  ('Manicura y pedicura', 'Pedicura spa', 'Pedicura con exfoliación e hidratación. [DEMO]', 60, 'fijo', 40000)
) as s(categoria, nombre, descripcion, duracion, tipo, precio)
join categoria_servicio c on c.nombre = s.categoria
on conflict do nothing;

insert into promocion (nombre, descripcion, condiciones, vigente_desde, vigente_hasta, tipo_descuento, valor, acumulable)
values (
  'Martes de cejas [DEMO]',
  'Diseño de cejas con 20% de descuento todos los martes.',
  'Válido solo los martes, no acumulable con otras promociones.',
  now() - interval '1 day',
  now() + interval '60 days',
  'porcentaje', 20, false
);

insert into promocion_servicio (promocion_id, servicio_id)
select p.id, s.id from promocion p, servicio s
where p.nombre = 'Martes de cejas [DEMO]' and s.nombre = 'Diseño de cejas';

insert into contenido_pagina (clave, titulo, cuerpo, es_provisional) values
  ('quienes_somos', 'Quiénes somos',
   '[CONTENIDO PROVISIONAL — pendiente de redacción final por administración] Claudia Patricia es un salón familiar en Cartagena dedicado al cuidado real de personas reales.',
   true),
  ('inicio_mensaje', 'Tu esencia, en buenas manos',
   'Más que un salón, un espacio para sentirte bien. Cuidado, experiencia y belleza que realza lo mejor de ti.',
   false)
on conflict (clave) do nothing;

insert into contenido_evento (titulo, descripcion, fecha_inicio, fecha_fin)
values ('Jornada de bienestar capilar [DEMO]', 'Diagnóstico capilar gratuito con cada servicio de color.', now() + interval '10 days', now() + interval '10 days' + interval '6 hours');
