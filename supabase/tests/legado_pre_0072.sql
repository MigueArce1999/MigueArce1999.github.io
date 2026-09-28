-- Datos con el modelo ANTERIOR a 0072 (perfil.rol/local_id), para probar el backfill.
\set ON_ERROR_STOP on
insert into local (id, nombre, slug) values ('b0000000-0000-0000-0000-00000000000b', 'Salón B', 'salon-b');
insert into auth.users (id, email, raw_user_meta_data) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'sa@legado.com', '{"local_id":"c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'admin@legado.com', '{"local_id":"c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001"}'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'emp@legado.com', '{"local_id":"c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001"}'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'cli@legado.com', '{"local_id":"c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001"}');
select fn_conceder_super_admin('sa@legado.com');
update perfil set rol = 'admin' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update perfil set rol = 'empleada' where id = 'bbbbbbbb-0000-0000-0000-000000000003';
insert into profesional (id, slug, local_id) values ('bbbbbbbb-0000-0000-0000-000000000003', 'emp', 'c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001');
insert into permiso (perfil_id, puede_caja) values ('bbbbbbbb-0000-0000-0000-000000000003', true);
-- clienta también en B (0056)
insert into cliente (usuario_id, nombre, local_id) values ('bbbbbbbb-0000-0000-0000-000000000004', 'Cli', 'b0000000-0000-0000-0000-00000000000b');
