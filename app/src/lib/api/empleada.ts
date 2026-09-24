import { isDemoMode, LOCAL_ID, supabase, supabaseRequerido } from '../supabase'
import { demoClientesAdmin, demoComisionesEmpleada, demoReservasAgendaEmpleada } from '../demoData'
import type { Cliente, ComisionResumen, ResultadoCobro, VentaLinea } from '../types'

// Clientes recién actualizados, para mostrar en el buscador de "Atender" antes de escribir
// nada (actualizado_en es la mejor aproximación disponible a "actividad reciente" sin sumar
// una consulta de reservas/atenciones aparte).
export async function listarClientesRecientes(limite = 5): Promise<Cliente[]> {
  if (isDemoMode) return demoClientesAdmin.slice(0, limite)
  const { data, error } = await supabase!
    .from('cliente')
    .select('*')
    .order('actualizado_en', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data
}

export async function buscarClientes(texto: string, limite = 6): Promise<Cliente[]> {
  if (isDemoMode) {
    const q = texto.toLowerCase()
    return demoClientesAdmin.filter((c) => c.nombre.toLowerCase().includes(q) || c.telefono?.includes(q)).slice(0, limite)
  }
  const { data, error } = await supabase!
    .from('cliente')
    .select('*')
    .or(`nombre.ilike.%${texto}%,telefono.ilike.%${texto}%`)
    .order('nombre')
    .limit(limite)
  if (error) throw error
  return data
}

// Misma forma de alta que el "+ Crear cliente" inline de Atender.tsx (ClienteSeccion): el
// asistente de voz reutiliza esta lógica en vez de duplicarla, para que ambos caminos (a mano o
// por voz) sigan exactamente las mismas reglas (RLS cliente_insert: admin/empleada/dueña).
export async function crearClienteRapido(datos: { nombre: string; telefono: string | null }): Promise<Cliente> {
  if (isDemoMode) {
    return {
      id: 'demo-cliente-' + Date.now(), usuario_id: null, nombre: datos.nombre, telefono: datos.telefono, email: null,
      consentimiento_marketing: false, visitas_completadas: 0, gasto_acumulado: 0, activo: true, origen_registro: 'admin',
      notas: null, resena_google_confirmada: false, meta_recompensa_id: null, creado_en: new Date().toISOString(),
    }
  }
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('cliente')
    .insert({ nombre: datos.nombre, telefono: datos.telefono, consentimiento_marketing: false, local_id: LOCAL_ID })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function registrarAtencion(params: {
  clienteId: string
  reservaId: string | null
  lineas: {
    servicioId: string
    profesionalId: string
    precioSnapshot?: number
    descuento?: number
    cantidad?: number
    // Una colaboración es su PROPIA línea (no un campo anidado): se suma al total y su
    // precio es la ganancia completa (100%) de esa persona, sin regla de comisión encima.
    esColaboracion?: boolean
  }[]
  productos?: { categoria: string; nombre: string; cantidad?: number; precioUnitario: number }[]
  notas?: string | null
  // Clave estable generada UNA vez por intento de registro (ver Atender.tsx): si la petición
  // se reintenta por un error de red, evita crear una segunda atención duplicada.
  borradorKey: string
}): Promise<{ id: string }> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_registrar_atencion', {
    p_cliente_id: params.clienteId,
    p_reserva_id: params.reservaId,
    p_lineas: params.lineas.map((l) => ({
      servicio_id: l.servicioId,
      profesional_id: l.profesionalId,
      precio_snapshot: l.precioSnapshot,
      descuento: l.descuento ?? 0,
      cantidad: l.cantidad ?? 1,
      es_colaboracion: l.esColaboracion ?? false,
    })),
    p_productos: (params.productos ?? []).map((p) => ({
      categoria: p.categoria,
      nombre: p.nombre,
      cantidad: p.cantidad ?? 1,
      precio_unitario: p.precioUnitario,
    })),
    p_notas: params.notas ?? null,
    p_borrador_key: params.borradorKey,
  })
  if (error) throw error
  return data as { id: string }
}

export async function completarYCobrarAtencion(params: {
  atencionId: string
  pagos: { metodo: 'efectivo' | 'transferencia' | 'tarjeta' | 'otro'; monto: number }[]
  // Clave estable generada UNA vez por intento de cobro y reutilizada en reintentos (mismo
  // borrador, mismo clic repetido o recuperación tras error): evita cobrar dos veces.
  idempotencyKey: string
  // Recompensa de fidelización elegida para canjear EN este cobro (sección 11 del pedido) — el
  // servidor valida saldo/stock/estado contra el saldo ANTERIOR a este mismo cobro, nunca contra
  // lo que esta misma compra va a generar.
  recompensaId?: string | null
}): Promise<ResultadoCobro> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_completar_y_cobrar_atencion', {
    p_atencion_id: params.atencionId,
    p_pagos: params.pagos,
    p_idempotency_key: params.idempotencyKey,
    p_recompensa_id: params.recompensaId ?? null,
  })
  if (error) throw error
  return data as ResultadoCobro
}

export async function listarComisiones(
  profesionalId: string,
  desdeISO: string,
  hastaISO: string,
): Promise<ComisionResumen[]> {
  if (isDemoMode) return demoComisionesEmpleada
  const { data, error } = await supabase!
    .from('vista_comision')
    .select('*')
    .eq('profesional_id', profesionalId)
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return data
}

export async function listarReservasDelDia(profesionalId: string, fechaISO: string) {
  if (isDemoMode) return demoReservasAgendaEmpleada
  const desde = `${fechaISO}T00:00:00`
  const hasta = `${fechaISO}T23:59:59`
  const { data, error } = await supabase!
    .from('vista_reserva')
    .select('*')
    .eq('profesional_id', profesionalId)
    .eq('local_id', LOCAL_ID)
    .gte('inicio', desde)
    .lte('inicio', hasta)
    .order('inicio')
  if (error) throw error
  return data
}

// Servicios que la profesional registró y cobró hoy directamente desde "Atender", sin pasar
// por una cita (reserva_id null). "Mi día" solo miraba vista_reserva, así que una venta de
// mostrador nunca aparecía ahí ni sumaba a "Servicios realizados"/"Vendido hoy" — ver
// supabase/migrations/0017_vista_atencion_servicio_detalle.sql.
export async function listarAtencionesDelDia(profesionalId: string, fechaISO: string): Promise<VentaLinea[]> {
  if (isDemoMode) return []
  const desde = `${fechaISO}T00:00:00`
  const hasta = `${fechaISO}T23:59:59`
  const { data, error } = await supabase!
    .from('vista_atencion_servicio')
    .select('*')
    .eq('profesional_id', profesionalId)
    .is('reserva_id', null)
    .gte('atencion_creado_en', desde)
    .lte('atencion_creado_en', hasta)
    .order('atencion_creado_en', { ascending: false })
  if (error) throw error
  return data
}

// Autogestión de servicios: antes solo admin podía tocar servicio_profesional
// (0014_rls.sql). 0022 agrega una policy que permite a cada profesional escribir sus PROPIAS
// filas (profesional_id = auth.uid()); esta función reemplaza el conjunto completo por el que
// se le pasa, igual que el mismo patrón ya usado en el formulario de admin (Equipo.tsx).
export async function guardarServiciosPropios(profesionalId: string, servicioIds: string[]): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error: errDel } = await client.from('servicio_profesional').delete().eq('profesional_id', profesionalId)
  if (errDel) throw errDel
  if (servicioIds.length > 0) {
    const filas = servicioIds.map((servicio_id) => ({ servicio_id, profesional_id: profesionalId }))
    const { error: errIns } = await client.from('servicio_profesional').insert(filas)
    if (errIns) throw errIns
  }
}

export async function crearLiquidacion(profesionalId: string, periodoInicio: string, periodoFin: string) {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_crear_liquidacion', {
    p_profesional_id: profesionalId,
    p_periodo_inicio: periodoInicio,
    p_periodo_fin: periodoFin,
  })
  if (error) throw error
  return data
}
