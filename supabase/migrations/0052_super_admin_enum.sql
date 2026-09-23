-- 0052_super_admin_enum.sql
-- Valor nuevo del enum; debe ir en su propia transacción (Postgres no deja usarlo
-- en el mismo COMMIT donde se agrega). 0053 ya puede referenciarlo.

alter type rol_usuario add value if not exists 'super_admin';
