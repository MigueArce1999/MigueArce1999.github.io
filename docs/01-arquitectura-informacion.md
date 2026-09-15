# 1. Arquitectura de información — los 4 portales

Notación: 🟢 Fase 1 (implementado) · 🟡 Fase 2 (diseñado, pendiente de construir).

## A. Web pública (`/`)

```
/                          Inicio
/nosotros                  Quiénes somos
/servicios                 Catálogo (filtrable por categoría)
/servicios/:slug           Detalle de servicio → CTA Reservar
/promociones                Promociones vigentes (día / mes / categoría)
/equipo                    Perfiles de profesionales
/equipo/:slug              Detalle profesional → CTA Reservar con ella
/ubicacion                 Mapa, horarios, contacto, eventos
/reservar                  Flujo de reserva (servicio → profesional → horario)
/ingresar                  Acceso cliente / equipo (discreto, mismo formulario, redirige por rol)
/registro                  Alta de cuenta cliente
```

## B. Portal del cliente (`/cliente/*`, requiere sesión rol `cliente`)

```
/cliente                   Mi inicio (próxima cita, puntos, últimos servicios, beneficios)
/cliente/reservas          Mis reservas (próximas / anteriores)
/cliente/reservas/:id      Detalle de reserva (cancelar / reprogramar)
/cliente/historial         Historial de servicios realizados y pagados
/cliente/puntos            Mis puntos y beneficios (saldo, movimientos, recompensas) 🟢 básico / 🟡 canje completo
/cliente/perfil            Datos de contacto y preferencias de comunicación
```

## C. Portal de empleadas (`/equipo-app/*`, requiere sesión rol `empleada`)

```
/equipo-app                Mi día (citas de hoy, próxima cita, cobrado, comisión, propinas)
/equipo-app/agenda         Mi agenda (día / semana / mes)
/equipo-app/atender        Registrar atención (con o sin cita)
/equipo-app/ventas         Mis ventas y ganancias (filtros hoy/semana/mes/rango)
/equipo-app/perfil         Mi historial y perfil (foto, especialidades, servicios autorizados)
```

## D. Dashboard administrativo (`/admin/*`, requiere sesión rol `admin` o permisos explícitos)

```
/admin                      Resumen del negocio (KPIs, filtros de fecha)
/admin/agenda                Agenda general (todas las profesionales)
/admin/clientes              Base de clientes + detalle + fusión de duplicados 🟡 fusión automática
/admin/equipo                 Perfiles, roles, permisos, horarios, comisiones, rendimiento
/admin/servicios              Servicios y categorías
/admin/ventas                 Ventas, cobros, caja 🟢 registro básico / 🟡 apertura-cierre de caja
/admin/comisiones              Reglas de comisión + liquidaciones
/admin/gastos                  🟡 Registro de gastos por categoría
/admin/fidelizacion             Reglas de puntos y recompensas
/admin/promociones               Promociones y campañas 🟢 promociones / 🟡 campañas con segmentación y envío
/admin/contenido                 Contenido web (historia, equipo, fotos, ubicación, eventos)
/admin/reportes                   Reportes exportables por periodo/profesional/servicio/método de pago
/admin/configuracion               Config. de negocio, reservas, permisos, puntos, comisiones, notificaciones
```

## Navegación cruzada (por qué "un solo sistema" y no 4 apps sueltas)

- Una **reserva** creada en la web pública o el portal del cliente es la misma fila de la tabla `reserva` que ve la empleada en `/equipo-app/agenda` y la administración en `/admin/agenda`. No hay sincronización: es la misma fuente leída con distintos filtros y RLS.
- **Completar y cobrar** una atención desde `/equipo-app/atender` dispara una función transaccional (`fn_completar_y_cobrar_atencion`, ver `docs/03-flujos.md`) que en una sola transacción escribe: atención, venta, pago, comisión y movimiento de puntos. Todos los portales leen el resultado de esa misma transacción.
- El **login es único**: `/ingresar` autentica contra Supabase Auth y redirige según el rol del usuario (`perfil.rol`). Una misma persona no puede tener más de un rol activo a la vez en este modelo (una empleada que también es clienta se gestiona con dos registros vinculados por `cliente.usuario_id`, ver modelo de datos).
