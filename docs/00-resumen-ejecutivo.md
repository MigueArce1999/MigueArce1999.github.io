# Claudia Patricia — Ecosistema Digital · Resumen ejecutivo

## Qué es esto

Un ecosistema de 4 experiencias conectadas a **una sola base de datos** (Supabase/Postgres):

1. **Web pública** — vitrina, catálogo de servicios, promociones, equipo, reserva sin cuenta.
2. **Portal del cliente** — reservas, historial, puntos, perfil.
3. **Portal de empleadas** — agenda, registro de atenciones, ventas y comisiones propias.
4. **Dashboard administrativo** — control total: agenda general, clientes, equipo, ventas, caja, comisiones, fidelización, contenido web, reportes.

## Cómo está organizado este repositorio

```
docs/                     ← los 7 entregables de arquitectura (léelos en orden)
supabase/
  migrations/             ← esquema real (tablas, RLS, funciones transaccionales)
  seed/demo.sql           ← datos de DEMOSTRACIÓN, claramente separados, opcionales
app/                      ← SPA (React + Vite + TypeScript + Supabase JS)
```

## Estado real (léase antes de asumir que algo "funciona")

- **No existe todavía un proyecto Supabase conectado a este repo.** Las migraciones SQL están escritas y listas para aplicarse, pero **no han sido ejecutadas contra una base de datos real** porque esta sesión no tiene credenciales de un proyecto Supabase. Ver `docs/07-plan-implementacion.md` → "Cómo conectar" para los pasos exactos.
- Mientras no haya conexión, la app corre en **modo demostración**: usa datos de ejemplo en memoria, claramente marcados con un aviso visible ("MODO DEMOSTRACIÓN — datos de ejemplo"), nunca mezclados con datos reales ni persistidos como si lo fueran.
- Lo implementado en código cubre el **flujo principal de la Fase 1** (ver `docs/07-plan-implementacion.md`): catálogo público, reserva con validación de disponibilidad, autenticación con roles, portal de cliente (inicio, reservas, historial, puntos, perfil), portal de empleadas (mi día, agenda, registrar atención, mis ventas) y dashboard admin (resumen, agenda general, clientes, equipo, servicios, ventas/comisiones).
- Los módulos de Fase 2 (caja avanzada, campañas con envío real, pagos en línea, inventario de productos, facturación electrónica) están **identificados pero no implementados**; en la interfaz aparecen marcados como "Próximamente" y no simulan funcionar.

## Supuestos documentados (decisiones reversibles tomadas con criterio)

Todos estos son **configurables** desde administración, no reglas fijas del código:

1. **Confirmación de reservas**: automática por defecto. Si se activa manual, una solicitud pendiente vence a los 30 minutos y libera el horario (configurable en `configuracion_negocio.reserva_pendiente_expira_minutos`).
2. **Cancelación/reprogramación por el cliente**: permitida hasta 2 horas antes de la cita (configurable en `configuracion_negocio.cancelacion_horas_limite`).
3. **Comisión sobre atenciones con varias empleadas**: se calcula **por línea de servicio dentro de la atención**, atribuida a quien la realizó (campo `atencion_servicio.profesional_id`), no de forma global sobre el total.
4. **Comisión sobre pagos parciales**: se causa sobre el **valor efectivamente cobrado**, no sobre el valor vendido; si el pago es parcial, la comisión pendiente de esa línea queda "pendiente por cobro" hasta que se registre el resto del pago.
5. **Puntos**: se generan al completar y pagar una atención, según `regla_puntos` vigente (por defecto: puntos = valor pagado × tasa configurable). Se revierten proporcionalmente ante devoluciones.
6. **Equipo inicial** (Claudia, Naldi, Ana, Valery): se crean como perfiles de ejemplo **desactivados/editables**, sin horarios ni comisiones inventadas — la administradora debe completarlos antes de publicarlos.

Ninguno de estos supuestos bloquea el uso del sistema; todos se pueden cambiar desde `Configuración` sin tocar código.
