-- 0058_local_logo_footer.sql
-- (antes 0056_local_logo_footer: el version 0056 ya lo ocupaba 0056_cliente_multi_local)
alter table local
  add column if not exists logo_footer_url text;

comment on column local.logo_footer_url is 'URL pública del logo del footer. Si falta, el sitio usa logo_url.';
