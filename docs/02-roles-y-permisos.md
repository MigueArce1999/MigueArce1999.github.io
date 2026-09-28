# 2. Matriz de roles y permisos

## Roles del sistema

| Rol | Descripción |
|---|---|
| `cliente` | Persona que reserva/recibe servicios. |
| `empleada` | Profesional del salón (Claudia, Naldi, Ana, Valery, futuras). |
| `recepcion` | Permiso opcional, asignable a una `empleada`, para operar caja/agenda de otras profesionales sin ser administración plena. |
| `admin` | Dueña / administración general del salón. Acceso global **de ese local**. |
| `super_admin` | Plataforma (tabla `plataforma_admin`, no es un rol de salón): gestiona locales en la consola `glowdesk_admin`. Solo aplica en peticiones sin `x-local-id`; en cualquier salón esa cuenta es lo que diga su membresía allí. |

### Una cuenta, varios salones (0072)

- Una persona tiene **una** cuenta Auth (un correo, una contraseña) en toda la plataforma.
- `membresia (usuario_id, local_id, rol)`: una fila por salón al que pertenece, con `rol` ∈ cliente/empleada/admin.
- El rol efectivo es el de la membresía del local de la petición (`fn_rol_actual()` / `fn_local_id()` leen el header `x-local-id`).
- `profesional` es por salón: `profesional.usuario_id` apunta a la persona y `profesional.id` es propio de ese salón (las fichas antiguas conservan `id = usuario_id`). `fn_mi_profesional_id()` reemplaza a `auth.uid()` cuando se pregunta "¿soy esta profesional?".
- `permiso` es por (persona, salón).
- RPCs: `fn_mi_sesion()`, `fn_vincular_empleada(email, slug, nombre)`, `fn_quitar_de_equipo(profesional_id)`, `fn_conceder_rol_en_local(email, local_id, rol)` (SQL editor / consola), `fn_conceder_super_admin(email)` (SQL editor).

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
