import { isDemoMode, supabaseRequerido } from '../supabase'
import {
  demoClientesAdmin,
  demoEquipoResumen,
  demoHistorialAtenciones,
  demoProductosVenta,
  demoResumenNegocio,
} from '../demoData'
import type { Cliente, VentaLinea } from '../types'

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

export async function listarEquipoConRendimiento() {
  if (isDemoMode) return demoEquipoResumen
  const client = supabaseRequerido()
  const { data, error } = await client.from('vista_profesional').select('*').order('orden_visualizacion')
  if (error) throw error
  return data
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
  const origen = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined

  const { error: errInvitar } = await client.auth.signInWithOtp({
    email: params.email,
    options: {
      data: { nombre: params.nombre },
      emailRedirectTo: origen ? `${origen}#/ingresar` : undefined,
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
