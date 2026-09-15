# 5. Inventario de pantallas

🟢 construida en Fase 1 (código en `app/`) · 🟡 diseñada, pendiente de construir (Fase 2)

## Web pública
| Pantalla | Estado | Notas |
|---|---|---|
| Inicio | 🟢 | valor, servicios destacados, promos vigentes, equipo, ubicación, reseñas reales (vacío si no hay) |
| Quiénes somos | 🟢 | contenido editable desde admin; usa placeholder marcado si falta |
| Servicios (listado + detalle) | 🟢 | filtro por categoría |
| Promociones | 🟢 | filtro día/mes/categoría, oculta vencidas |
| Equipo (listado + detalle) | 🟢 | CTA reservar con esa profesional |
| Ubicación y eventos | 🟢 | mapa embebido, horarios, eventos administrables |
| Flujo de reserva | 🟢 | servicio→profesional→horario→login→confirmar |
| Ingreso / Registro | 🟢 | acceso cliente y acceso equipo en el mismo formulario |

## Portal del cliente
| Pantalla | Estado | Notas |
|---|---|---|
| Mi inicio | 🟢 | próxima cita, puntos, últimos servicios, beneficios vigentes |
| Mis reservas (lista + detalle) | 🟢 | cancelar/reprogramar según política |
| Historial de servicios | 🟢 | distinto de "reservas canceladas"; botón "volver a reservar" |
| Mis puntos y beneficios | 🟢 saldo y movimientos / 🟡 canje interactivo de recompensas |
| Mi perfil | 🟢 | datos + preferencias de comunicación (separadas de marketing) |

## Portal de empleadas
| Pantalla | Estado | Notas |
|---|---|---|
| Mi día | 🟢 | vendido vs cobrado vs comisión vs liquidado vs propinas, siempre diferenciados |
| Mi agenda (día/semana/mes) | 🟢 | gestión de disponibilidad sin mover citas existentes en silencio |
| Registrar atención | 🟢 | con o sin cita, multi-servicio, multi-profesional |
| Mis ventas y ganancias | 🟢 | filtros hoy/semana/mes/rango, detalle de cálculo por operación |
| Mi historial y perfil | 🟢 | historial + edición limitada por permisos |

## Dashboard administrativo
| Pantalla | Estado | Notas |
|---|---|---|
| Resumen del negocio | 🟢 | KPIs con fórmula documentada, comparación de periodo |
| Agenda general | 🟢 | todas las profesionales, crear/reprogramar/cancelar/bloquear |
| Clientes | 🟢 lista+detalle / 🟡 fusión asistida de duplicados |
| Equipo | 🟢 perfiles, horarios, servicios autorizados / 🟡 permisos finos por checkbox |
| Servicios y categorías | 🟢 | alta/edición/desactivación |
| Ventas, cobros y caja | 🟢 registro de ventas/cobros / 🟡 apertura-cierre de caja con arqueo |
| Comisiones y liquidaciones | 🟢 reglas + liquidar / 🟡 UI de simulación previa |
| Gastos | 🟡 | esquema listo, pantalla pendiente |
| Fidelización | 🟢 reglas de puntos / 🟡 recompensas avanzadas con vigencia |
| Promociones y campañas | 🟢 promociones / 🟡 campañas con segmentación y envío |
| Contenido web | 🟢 | equipo, historia, fotos, ubicación, eventos |
| Reportes | 🟢 básicos con export CSV / 🟡 export PDF y reportes avanzados |
| Configuración | 🟢 | negocio, reservas, puntos, comisiones, notificaciones |

## Componentes transversales (usados en los 4 portales)
Botones, campos de formulario, selects, tabs, tarjetas, tablas con filtros, calendario (día/semana/mes),
modal, panel lateral, badge de estado (con ícono, nunca solo color), banner de modo demo, estados de
carga/vacío/error. Ver `docs/06-propuesta-visual.md`.
