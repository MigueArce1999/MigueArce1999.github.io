-- 0042_hero_homepage_editable.sql
-- Habilita la edición de la imagen principal (hero) desde Admin → Homepage, que 0041 dejó
-- preparada pero bloqueada a propósito. No hace falta ninguna columna nueva: solo se enciende
-- el interruptor que ya existía.
update configuracion_homepage set hero_editable = true;
