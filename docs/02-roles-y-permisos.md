# 2. Matriz de roles y permisos

## Roles del sistema

| Rol | Descripción |
|---|---|
| `cliente` | Persona que reserva/recibe servicios. |
| `empleada` | Profesional del salón (Claudia, Naldi, Ana, Valery, futuras). |
| `recepcion` | Permiso opcional, asignable a una `empleada`, para operar caja/agenda de otras profesionales sin ser administración plena. |
| `admin` | Dueña / administración general del salón. Acceso global **de ese local**. |
| `super_admin` | Plataforma: gestiona locales en el sitio `adminpeluquerias` (marca, empresa, colores). No opera el salón; si entra a esta SPA se redirige a `VITE_PLATAFORMA_URL`. |

Los permisos finos (p. ej. "puede aplicar descuentos", "puede ver agenda de todo el equipo") se modelan como **flags en `perfil_permiso`**, no hardcodeados por rol, para que administración pueda ajustar sin desplegar código.

## Matriz resumida (🔒 = enforced en RLS de Postgres, no solo oculto en UI)

| Recurso / acción | cliente | empleada | recepcion | admin |
|---|---|---|---|---|
| Ver/editar su propio perfil | ✅🔒 | ✅🔒 | ✅🔒 | ✅🔒 |
| Ver perfil de otro cliente | ❌🔒 | ✅🔒 (cualquier empleada puede buscar/registrar clientes en recepción y caja) | ✅🔒 | ✅🔒 |
| Crear reserva propia | ✅🔒 | ✅ (para clientes, como recepción) | ✅ | ✅ |
| Cancelar/reprogramar reserva propia | ✅🔒 (según política) | — | — | ✅ |
| Cancelar/reprogramar cualquier reserva | ❌ | ❌🔒 | ✅🔒 | ✅🔒 |
| Ver su propia agenda | — | ✅🔒 | ✅🔒 | ✅🔒 |
| Ver agenda de todo el equipo | ❌ | ❌🔒 (salvo permiso explícito) | ✅🔒 | ✅🔒 |
| Registrar atención / cobrar | ❌ | ✅🔒 (solo servicios que ella prestó) | ✅🔒 | ✅🔒 |
| Aplicar descuento fuera de su límite | ❌ | ❌🔒 | según permiso🔒 | ✅🔒 |
| Anular venta / registrar devolución | ❌ | ❌🔒 | según permiso🔒 | ✅🔒 |
| Editar reglas de comisión | ❌ | ❌🔒 | ❌🔒 | ✅🔒 |
| Ver su propia comisión/liquidación | ❌ | ✅🔒 (solo la suya) | ✅🔒 (solo la suya) | ✅🔒 (todas) |
| Ejecutar liquidación de comisiones | ❌ | ❌🔒 | ❌🔒 | ✅🔒 |
| Ver puntos propios / canjear | ✅🔒 | — | — | ✅ (consulta) |
| Ajustar puntos de un cliente | ❌ | ❌🔒 | ❌🔒 | ✅🔒 (con motivo obligatorio) |
| Editar servicios/categorías/promociones | ❌ | ❌🔒 | ❌🔒 | ✅🔒 |
| Editar contenido web | ❌ | ❌🔒 | ❌🔒 | ✅🔒 |
| Apertura/cierre de caja | ❌ | ❌🔒 | según permiso🔒 | ✅🔒 |
| Ver reportes globales del negocio | ❌ | ❌🔒 | ❌🔒 | ✅🔒 |

## Principios de enforcement

1. **Todo lo marcado 🔒 se valida con Row Level Security en Postgres**, usando `auth.uid()` contra `perfil.usuario_id` y funciones `SECURITY DEFINER` para operaciones que cruzan tablas (p. ej. completar+cobrar). Ocultar un botón en la UI es una ayuda de experiencia, nunca el mecanismo de seguridad.
2. Las operaciones sensibles (completar atención, cobrar, anular, liquidar, ajustar puntos) se ejecutan **solo a través de funciones RPC** de Postgres que validan rol y pertenencia antes de escribir, no mediante `INSERT`/`UPDATE` directos desde el cliente a las tablas de dinero. Esto evita que una empleada, aunque tenga acceso de escritura limitado, pueda alterar una comisión ya calculada.
3. Un cliente creado desde recepción (sin cuenta) es una fila en `cliente` con `usuario_id = NULL`. Vincularlo a una cuenta verificada más adelante es un `UPDATE` de `cliente.usuario_id`, nunca una fila nueva — así no se duplica historial.
