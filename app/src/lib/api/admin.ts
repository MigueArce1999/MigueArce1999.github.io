import { isDemoMode, supabaseRequerido } from '../supabase'
import {
  demoClientesAdmin,
  demoEquipoResumen,
  demoHistorialAtenciones,
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
export async function listarVentasDetalle(limite = 50): Promise<VentaLinea[]> {
  if (isDemoMode) {
    return demoHistorialAtenciones.flatMap((a) =>
      a.lineas.map((l) => ({
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
  const { data, error } = await client
    .from('vista_atencion_servicio')
    .select('*')
    .order('atencion_creado_en', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data
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

export async function listarProductosVendidos(limite = 50): Promise<ProductoVenta[]> {
  if (isDemoMode) return demoProductosVenta.slice(0, limite)
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('vista_atencion_producto')
    .select('*')
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
export async function invitarEmpleada(params: { nombre: string; email: string; slug: string }): Promise<'invitada' | 'ya_era_empleada'> {
  if (isDemoMode) return 'invitada'
  const client = supabaseRequerido()
  // Sin sufijo de ruta (#/ingresar): la app usa HashRouter, y Supabase añade su propio
  // fragmento "#access_token=...&type=magiclink" al final de emailRedirectTo. Si ya trae un
  // "#" (p. ej. "...#/ingresar"), el resultado queda con DOS "#" en la misma URL
  // ("...#/ingresar#access_token=..."), y supabase-js ya no logra leer access_token del hash
  // (window.location.hash.substring(1) deja de ser un query string válido). Dejando el
  // origen "limpio", el enlace del correo llega como ".../#access_token=...", supabase-js
  // detecta la sesión, y luego limpia el hash — Home.tsx se encarga de redirigir a su portal.
  const origen = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined

  const { error: errInvitar } = await client.auth.signInWithOtp({
    email: params.email,
    options: {
      data: { nombre: params.nombre },
      emailRedirectTo: origen,
    },
  })
  if (errInvitar) throw errInvitar

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
    throw new Error('La invitación se envió, pero el perfil todavía no aparece. Espera unos segundos y vuelve a intentarlo.')
  }

  const { data: yaProfesional, error: errRevisar } = await client.from('profesional').select('id').eq('id', usuarioId).maybeSingle()
  if (errRevisar) throw errRevisar
  if (yaProfesional) return 'ya_era_empleada'

  const { error: errRol } = await client.from('perfil').update({ rol: 'empleada' }).eq('id', usuarioId)
  if (errRol) throw errRol
  const { error: errProf } = await client.from('profesional').insert({ id: usuarioId, slug: params.slug })
  if (errProf) throw errProf
  return 'invitada'
}
