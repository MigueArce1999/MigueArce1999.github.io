import { isDemoMode, LOCAL_ID, supabaseRequerido } from '../supabase'
import { origenAuth } from './auth'
import {
  demoClientesAdmin,
  demoEquipoResumen,
  demoHistorialAtenciones,
  demoMetricasVentas,
  demoProductosVenta,
  demoResumenNegocio,
} from '../demoData'
import type { Cliente, ReglaComision, VentaLinea } from '../types'

// Fórmulas del resumen (ver docs/01-arquitectura-informacion.md y docs/03-flujos.md):
// - ventas netas = suma de atencion_servicio (precio_snapshot - descuento) * cantidad de
//   atenciones completadas en el periodo (ventas realizadas, no reservas futuras).
// - cobros = suma de pago.monto (incluye devoluciones, que son negativas) en el periodo.
// - ticket promedio = ventas netas / número de atenciones completadas.
export async function resumenNegocio(desdeISO: string, hastaISO: string) {
  if (isDemoMode) return demoResumenNegocio
  const client = supabaseRequerido()

  const { data: atenciones, error: e1 } = await client
    .from('vista_atencion')
    .select('id, total_vendido, total_pagado, estado, creado_en, cliente_id')
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  if (e1) throw e1

  const completadas = (atenciones ?? []).filter((a) => a.estado === 'completada')
  const ventasNetas = completadas.reduce((acc, a) => acc + Number(a.total_vendido), 0)
  const cobros = completadas.reduce((acc, a) => acc + Number(a.total_pagado), 0)

  const { data: reservas, error: e2 } = await client
    .from('reserva')
    .select('id, estado')
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  if (e2) throw e2
  const cancelaciones = (reservas ?? []).filter((r) => r.estado === 'cancelada').length
  const inasistencias = (reservas ?? []).filter((r) => r.estado === 'no_asistio').length

  const { data: comisiones, error: e3 } = await client
    .from('comision')
    .select('valor, estado')
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  if (e3) throw e3
  const comisionesGeneradas = (comisiones ?? []).reduce((acc, c) => acc + Number(c.valor), 0)
  const comisionesPendientes = (comisiones ?? [])
    .filter((c) => c.estado === 'generada')
    .reduce((acc, c) => acc + Number(c.valor), 0)

  return {
    ventasNetas,
    cobros,
    citasCompletadas: completadas.length,
    ticketPromedio: completadas.length ? ventasNetas / completadas.length : 0,
    cancelaciones,
    inasistencias,
    comisionesGeneradas,
    comisionesPendientes,
    clientesNuevos: 0, // requiere comparar cliente.creado_en contra el periodo; ver Fase 2
    clientesRecurrentes: 0,
  }
}

export interface SegmentoVentas {
  etiqueta: string
  valor: number
}

const METODO_PAGO_ETIQUETA: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
}

// Agrupa una lista de {etiqueta, valor} y, si hay más de "maximo" grupos, deja los más
// grandes y suma el resto en "Otros" — evita gráficas de pastel con más de ~6-8 porciones,
// que dejan de leerse (ver skill de dataviz, "Series-count ladder").
function agruparYLimitar(filas: { etiqueta: string; valor: number }[], maximo = 5): SegmentoVentas[] {
  const totales = new Map<string, number>()
  for (const f of filas) totales.set(f.etiqueta, (totales.get(f.etiqueta) ?? 0) + f.valor)
  const ordenado = [...totales.entries()].sort((a, b) => b[1] - a[1])
  if (ordenado.length <= maximo) return ordenado.map(([etiqueta, valor]) => ({ etiqueta, valor }))
  const principales = ordenado.slice(0, maximo)
  const restoValor = ordenado.slice(maximo).reduce((acc, [, v]) => acc + v, 0)
  return [...principales.map(([etiqueta, valor]) => ({ etiqueta, valor })), { etiqueta: 'Otros', valor: restoValor }]
}

// Ventas por profesional, por servicio y por método de pago, para las gráficas de pastel del
// Dashboard. Reutiliza las mismas fuentes que resumenNegocio y listarVentasDetalle: solo
// servicios de atenciones YA completadas cuentan como venta (nunca reservas futuras), y solo
// se cuenta la porción realmente cobrada — no el precio de lista con descuento sin más — para
// que la suma de las porciones coincida con "ventas netas" del resumen.
export async function metricasVentasDashboard(desdeISO: string, hastaISO: string) {
  if (isDemoMode) return demoMetricasVentas
  const client = supabaseRequerido()

  const { data: servicios, error: e1 } = await client
    .from('vista_atencion_servicio')
    .select('nombre_snapshot, profesional_nombre, precio_snapshot, descuento, cantidad, atencion_estado, atencion_creado_en')
    .eq('atencion_estado', 'completada')
    .gte('atencion_creado_en', desdeISO)
    .lt('atencion_creado_en', hastaISO)
  if (e1) throw e1

  const lineas = (servicios ?? []).map((s) => ({
    profesional: s.profesional_nombre as string,
    servicio: s.nombre_snapshot as string,
    valor: (Number(s.precio_snapshot) - Number(s.descuento)) * Number(s.cantidad),
  }))

  const { data: pagos, error: e2 } = await client
    .from('pago')
    .select('metodo, monto, creado_en')
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  if (e2) throw e2

  const porMetodo = new Map<string, number>()
  for (const p of pagos ?? []) porMetodo.set(p.metodo, (porMetodo.get(p.metodo) ?? 0) + Number(p.monto))

  return {
    ventasPorProfesional: agruparYLimitar(lineas.map((l) => ({ etiqueta: l.profesional, valor: l.valor }))),
    ventasPorServicio: agruparYLimitar(lineas.map((l) => ({ etiqueta: l.servicio, valor: l.valor }))),
    // Sin agrupar en "Otros": metodo_pago solo tiene 4 valores posibles, ya dentro del límite.
    // Un método que solo tuvo devoluciones (neto <= 0) no tiene sentido como porción de pastel.
    ventasPorMetodoPago: [...porMetodo.entries()]
      .filter(([, valor]) => valor > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([metodo, valor]) => ({ etiqueta: METODO_PAGO_ETIQUETA[metodo] ?? metodo, valor })),
  }
}

export async function listarClientes(busqueda?: string): Promise<Cliente[]> {
  if (isDemoMode) {
    const q = busqueda?.toLowerCase()
    return q ? demoClientesAdmin.filter((c) => c.nombre.toLowerCase().includes(q)) : demoClientesAdmin
  }
  const client = supabaseRequerido()
  let query = client.from('cliente').select('*').order('nombre')
  if (busqueda) query = query.or(`nombre.ilike.%${busqueda}%,telefono.ilike.%${busqueda}%,email.ilike.%${busqueda}%`)
  const { data, error } = await query
  if (error) throw error
  return data
}

// Detalle de ventas por línea de servicio (no por atención completa), para mostrar en el
// panel admin cuánto se cobró por cada servicio y cuánto quedó para el negocio después de
// pagar la comisión (precio - descuento - comisión_total). Ver vista_atencion_servicio en
// supabase/migrations/0017_vista_atencion_servicio_detalle.sql.
export async function listarVentasDetalle(desdeISO: string, hastaISO: string, profesionalId?: string | null, limite = 500): Promise<VentaLinea[]> {
  if (isDemoMode) {
    return demoHistorialAtenciones
      .filter((a) => a.creado_en >= desdeISO && a.creado_en < hastaISO)
      .flatMap((a) =>
        a.lineas
          .filter((l) => !profesionalId || l.profesional_id === profesionalId)
          .map((l) => ({
            id: l.id,
            atencion_id: a.id,
            servicio_id: l.servicio_id,
            nombre_snapshot: l.nombre_snapshot,
            precio_snapshot: l.precio_snapshot,
            descuento: l.descuento,
            cantidad: l.cantidad,
            profesional_id: l.profesional_id,
            profesional_nombre: l.profesional_nombre,
            reserva_id: a.reserva_id,
            atencion_estado: a.estado,
            atencion_creado_en: a.creado_en,
            atencion_completado_en: a.completado_en,
            cliente_id: a.cliente_id,
            cliente_nombre: a.cliente_nombre ?? '',
            comision_total: Math.round(l.precio_snapshot * 0.4),
            es_colaboracion: false,
          })),
      )
  }
  const client = supabaseRequerido()
  let query = client
    .from('vista_atencion_servicio')
    .select('*')
    .gte('atencion_creado_en', desdeISO)
    .lt('atencion_creado_en', hastaISO)
  if (profesionalId) query = query.eq('profesional_id', profesionalId)
  const { data, error } = await query.order('atencion_creado_en', { ascending: false }).limit(limite)
  if (error) throw error
  return data
}

// Corrige una venta ya registrada: clienta, notas y, por línea, profesional/precio/descuento/
// cantidad — recalculando la comisión de cada línea con la regla vigente (ver fn_editar_venta
// en supabase/migrations/0025). NO toca los pagos ya cobrados: el dinero que entró a caja es
// un hecho histórico que un error de captura en el precio no cambia.
export async function editarVenta(params: {
  atencionId: string
  clienteId: string
  notas: string | null
  lineas: { id: string; profesionalId: string; precioSnapshot: number; descuento: number; cantidad: number }[]
}): Promise<void> {
  if (isDemoMode) throw new Error('En modo demostración no se pueden editar ventas.')
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_editar_venta', {
    p_atencion_id: params.atencionId,
    p_cliente_id: params.clienteId,
    p_notas: params.notas,
    p_lineas: params.lineas.map((l) => ({
      id: l.id,
      profesional_id: l.profesionalId,
      precio_snapshot: l.precioSnapshot,
      descuento: l.descuento,
      cantidad: l.cantidad,
    })),
  })
  if (error) throw error
}

// Borra una venta completa (todas sus líneas, pagos, comisiones y los puntos que generó). Si
// alguna de sus comisiones ya fue liquidada a la profesional, fn_eliminar_venta la rechaza con
// un mensaje explicando por qué, en vez de dejar una liquidación pagada sin sustento.
export async function eliminarVenta(atencionId: string): Promise<void> {
  if (isDemoMode) throw new Error('En modo demostración no se pueden borrar ventas.')
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_eliminar_venta', { p_atencion_id: atencionId })
  if (error) throw error
}

// vista_atencion_servicio no expone atencion.notas (no hace falta para el listado); se busca
// aparte solo al abrir el formulario de editar, para no perder lo que ya se había anotado.
export async function obtenerNotasVenta(atencionId: string): Promise<string | null> {
  if (isDemoMode) return null
  const client = supabaseRequerido()
  const { data, error } = await client.from('atencion').select('notas').eq('id', atencionId).maybeSingle()
  if (error) throw error
  return data?.notas ?? null
}

export async function listarVentasDeCliente(clienteId: string): Promise<VentaLinea[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('vista_atencion_servicio')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('atencion_creado_en', { ascending: false })
  if (error) throw error
  return data
}

export async function listarEquipoConRendimiento() {
  if (isDemoMode) return demoEquipoResumen
  const client = supabaseRequerido()
  const { data, error } = await client.from('vista_profesional').select('*').order('orden_visualizacion')
  if (error) throw error
  return data
}

// "Eliminar" una empleada NO borra la fila de profesional ni su historial: atencion_servicio,
// comision, regla_comision y liquidacion tienen su profesional_id con "on delete restrict"
// justamente para que un borrado real sea imposible sin perder ventas/comisiones ya cobradas
// (ver supabase/migrations/0005_atencion_pagos.sql y 0006_comisiones_liquidaciones.sql). En
// vez de eso: le quita el rol de empleada (perfil.rol -> 'cliente', que es lo que de verdad
// le bloquea el acceso a /equipo-app, tanto en el frontend como en la RLS vía fn_rol_actual())
// y la marca inactiva (profesional.activo = false, la oculta del sitio público y de nuevas
// reservas). Su cuenta sigue existiendo como clienta normal.
export async function eliminarEmpleada(profesionalId: string): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error: errRol } = await client.from('perfil').update({ rol: 'cliente' }).eq('id', profesionalId)
  if (errRol) throw errRol
  const { error: errProf } = await client.from('profesional').update({ activo: false }).eq('id', profesionalId)
  if (errProf) throw errProf
}

// Borrado real de la fila de `profesional` (no solo desactivarla): solo para cuentas de
// prueba/duplicadas sin historial. La base de datos misma protege el historial real —
// cualquier profesional con una reserva, atención o liquidación ya registrada bloquea el
// DELETE (llaves foráneas "on delete restrict"), así que ese caso se traduce a un mensaje
// claro en vez del error técnico de Postgres (código 23503 = violación de llave foránea).
// La fila de `perfil` (y la cuenta de auth) NO se toca: sigue existiendo como clienta normal.
export async function eliminarProfesionalDefinitivo(profesionalId: string): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.from('profesional').delete().eq('id', profesionalId)
  if (error) {
    if (error.code === '23503') {
      throw new Error('Esta empleada ya tiene reservas, ventas o liquidaciones registradas; no se puede borrar. Usa "Eliminar empleada" en su lugar.')
    }
    throw error
  }
}

// Actualiza el nombre visible de la profesional: vive en perfil.nombre (profesional no tiene
// columna propia — ver fn_manejar_usuario_nuevo en 0002_identidad.sql), no en la tabla profesional.
export async function actualizarNombreProfesional(profesionalId: string, nombre: string): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.from('perfil').update({ nombre }).eq('id', profesionalId)
  if (error) throw error
}

// --- Comisión base y excepciones por servicio (Equipo → Editar perfil y servicios → Comisiones) ---
//
// Misma lógica de prioridad que ya usa fn_completar_y_cobrar_atencion al cobrar (servicio_id
// específico gana sobre servicio_id null): esto es solo la capa de administración de esas
// mismas filas de regla_comision, no una regla nueva. Sigue el patrón ya establecido en
// AdminComisiones.tsx: nunca se hace UPDATE de una regla vigente, se cierra (vigente_hasta)
// y se crea una nueva, para que las comisiones ya generadas conserven intacto el snapshot de
// la regla con la que se calcularon (ver regla_aplicada en la tabla comision).
export async function listarReglasComision(profesionalId: string): Promise<ReglaComision[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('regla_comision')
    .select('id, profesional_id, servicio_id, tipo, valor, servicio:servicio_id(nombre)')
    .eq('profesional_id', profesionalId)
    .is('vigente_hasta', null)
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id,
    profesionalId: r.profesional_id,
    servicioId: r.servicio_id,
    servicioNombre: r.servicio?.nombre ?? null,
    tipo: r.tipo,
    valor: Number(r.valor),
  }))
}

async function cerrarReglaVigente(profesionalId: string, servicioId: string | null): Promise<void> {
  const client = supabaseRequerido()
  let query = client.from('regla_comision').update({ vigente_hasta: new Date().toISOString() }).eq('profesional_id', profesionalId).is('vigente_hasta', null)
  query = servicioId ? query.eq('servicio_id', servicioId) : query.is('servicio_id', null)
  const { error } = await query
  if (error) throw error
}

// valorPct: 0-100 inclusive, hasta 2 decimales (validado también en el formulario). Reemplaza
// la comisión base vigente de la profesional; no afecta ninguna excepción por servicio.
export async function guardarComisionBase(profesionalId: string, valorPct: number): Promise<void> {
  if (isDemoMode) return
  await cerrarReglaVigente(profesionalId, null)
  const client = supabaseRequerido()
  const { error } = await client.from('regla_comision').insert({ profesional_id: profesionalId, servicio_id: null, tipo: 'porcentaje', valor: valorPct })
  if (error) throw error
}

// Crea o reemplaza la excepción vigente para esa combinación profesional+servicio (el índice
// único regla_comision_vigente_unica_idx impide dos excepciones vigentes para la misma
// combinación, aunque esta función ya cierra la anterior antes de insertar la nueva).
export async function guardarExcepcionComision(profesionalId: string, servicioId: string, valorPct: number): Promise<void> {
  if (isDemoMode) return
  await cerrarReglaVigente(profesionalId, servicioId)
  const client = supabaseRequerido()
  const { error } = await client.from('regla_comision').insert({ profesional_id: profesionalId, servicio_id: servicioId, tipo: 'porcentaje', valor: valorPct })
  if (error) throw error
}

// "Eliminar" una excepción cierra su vigencia (nunca se borra la fila, igual que el resto del
// historial de reglas): las próximas atenciones de ese servicio vuelven a usar la comisión
// base de la profesional; las comisiones ya generadas con esta excepción no cambian.
export async function eliminarExcepcionComision(profesionalId: string, servicioId: string): Promise<void> {
  if (isDemoMode) return
  await cerrarReglaVigente(profesionalId, servicioId)
}

export interface ProductoVenta {
  id: string
  fecha: string
  clienteNombre: string
  categoria: string
  nombre: string
  cantidad: number
  precioUnitario: number
  subtotal: number
}

export async function listarProductosVendidos(desdeISO: string, hastaISO: string, limite = 500): Promise<ProductoVenta[]> {
  if (isDemoMode) return demoProductosVenta.filter((p) => p.fecha >= desdeISO && p.fecha < hastaISO).slice(0, limite)
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('vista_atencion_producto')
    .select('*')
    .gte('atencion_creado_en', desdeISO)
    .lt('atencion_creado_en', hastaISO)
    .order('atencion_creado_en', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id,
    fecha: r.atencion_completado_en ?? r.atencion_creado_en,
    clienteNombre: r.cliente_nombre,
    categoria: r.categoria,
    nombre: r.nombre,
    cantidad: r.cantidad,
    precioUnitario: Number(r.precio_unitario),
    subtotal: Number(r.subtotal),
  }))
}

// Invita a una persona a unirse como empleada por correo, sin depender de la clave
// service_role (nunca debe exponerse en el navegador): signInWithOtp es una llamada segura
// con la clave pública (anon) que crea la cuenta si no existe y envía un correo con un
// enlace de acceso. Si el correo ya pertenece a una clienta, se reutiliza esa misma cuenta.
// El trigger on_auth_user_created (0002_identidad.sql) ya crea perfil+cliente en la misma
// transacción, así que justo después se puede buscar el usuario por email y ascenderlo.
export async function invitarEmpleada(
  params: { nombre: string; email: string; slug: string },
): Promise<'invitada' | 'ya_era_empleada' | 'creada_sin_correo'> {
  if (isDemoMode) return 'invitada'
  const client = supabaseRequerido()
  const { error: errInvitar } = await client.auth.signInWithOtp({
    email: params.email,
    options: {
      data: { nombre: params.nombre, local_id: LOCAL_ID },
      emailRedirectTo: origenAuth(),
    },
  })
  // El proyecto usa el correo compartido de Supabase (cuota muy baja, pensada solo para
  // pruebas): "email rate limit exceeded" significa que YA se agotó por hoy/por hora. Supabase
  // a veces crea la cuenta igual aunque el envío falle, así que en vez de abandonar la
  // invitación de una, seguimos intentando promoverla si el perfil ya quedó creado — mejor
  // que perder por completo lo que la administradora acaba de escribir.
  const correoLimitado = !!errInvitar && /rate limit/i.test(errInvitar.message)
  if (errInvitar && !correoLimitado) throw errInvitar

  const { data: candidatos, error: errBuscar } = await client
    .from('cliente')
    .select('usuario_id')
    .ilike('email', params.email)
    .not('usuario_id', 'is', null)
    .order('creado_en', { ascending: false })
    .limit(1)
  if (errBuscar) throw errBuscar
  const usuarioId = candidatos?.[0]?.usuario_id
  if (!usuarioId) {
    if (correoLimitado) {
      throw new Error(
        'Se alcanzó el límite de correos del proyecto y la cuenta tampoco llegó a crearse. Espera unos minutos y vuelve a ' +
          'intentarlo, o configura un proveedor de correo propio en Supabase (Authentication → Settings → SMTP Settings) ' +
          'para dejar de depender de esa cuota compartida.',
      )
    }
    throw new Error('La invitación se envió, pero el perfil todavía no aparece. Espera unos segundos y vuelve a intentarlo.')
  }

  const { data: yaProfesional, error: errRevisar } = await client.from('profesional').select('id').eq('id', usuarioId).maybeSingle()
  if (errRevisar) throw errRevisar
  if (yaProfesional) return 'ya_era_empleada'

  const { error: errRol } = await client.from('perfil').update({ rol: 'empleada' }).eq('id', usuarioId)
  if (errRol) throw errRol
  const { error: errProf } = await client.from('profesional').insert({ id: usuarioId, slug: params.slug, local_id: LOCAL_ID })
  if (errProf) throw errProf
  // La cuenta y el rol quedaron listos, pero si el correo de acceso nunca salió (límite de envíos),
  // la empleada no tiene forma de entrar por su cuenta todavía — se lo dejamos claro a quien invita
  // para que pueda avisarle por otro medio o pedir que se le asigne una contraseña manualmente.
  return correoLimitado ? 'creada_sin_correo' : 'invitada'
}
