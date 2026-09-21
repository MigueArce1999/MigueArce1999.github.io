// Fidelización ("Tu belleza florece"). Ver supabase/migrations/0047_fidelizacion.sql para las
// funciones RPC y el porqué de cada regla — este archivo solo las expone al frontend, nunca
// reimplementa lógica de negocio que ya vive (y debe seguir viviendo) en el servidor.

import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
import {
  demoCanjesCliente,
  demoClienteActual,
  demoConfiguracionFidelizacion,
  demoMiFidelizacion,
  demoMovimientosPuntos,
  demoNotificacionesFidelizacion,
  demoReglaPuntos,
  demoRecompensas,
} from '../demoData'
import type {
  CanjeRecompensa,
  ConfiguracionFidelizacion,
  MiFidelizacion,
  MovimientoPuntos,
  NotificacionFidelizacion,
  Recompensa,
  ReglaPuntos,
  TipoRecompensa,
} from '../types'

// --- Vista de la clienta ---------------------------------------------------------------------

export async function obtenerMiFidelizacion(clienteId: string): Promise<MiFidelizacion> {
  if (isDemoMode) return demoMiFidelizacion
  const { data, error } = await supabase!.rpc('fn_mi_fidelizacion', { p_cliente_id: clienteId })
  if (error) throw error
  return data as MiFidelizacion
}

export async function elegirMetaRecompensa(clienteId: string, recompensaId: string | null): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_elegir_meta_recompensa', { p_cliente_id: clienteId, p_recompensa_id: recompensaId })
  if (error) throw error
}

export async function listarRecompensasActivas(): Promise<Recompensa[]> {
  if (isDemoMode) return demoRecompensas.filter((r) => r.activa)
  const { data, error } = await supabase!
    .from('recompensa')
    .select('*')
    .eq('activa', true)
    .order('orden_visualizacion')
    .order('costo_puntos')
  if (error) throw error
  return data
}

export async function listarMovimientosPuntosPagina(
  clienteId: string,
  pagina: number,
  porPagina = 20,
): Promise<{ movimientos: MovimientoPuntos[]; total: number }> {
  if (isDemoMode) return { movimientos: demoMovimientosPuntos, total: demoMovimientosPuntos.length }
  const desde = pagina * porPagina
  const { data, error, count } = await supabase!
    .from('movimiento_puntos')
    .select('*', { count: 'exact' })
    .eq('cliente_id', clienteId)
    .order('creado_en', { ascending: false })
    .range(desde, desde + porPagina - 1)
  if (error) throw error
  return { movimientos: data, total: count ?? data.length }
}

export async function listarNotificacionesNoVistas(clienteId: string): Promise<NotificacionFidelizacion[]> {
  if (isDemoMode) return demoNotificacionesFidelizacion
  const { data, error } = await supabase!
    .from('notificacion_fidelizacion')
    .select('*')
    .eq('cliente_id', clienteId)
    .is('leida_en', null)
    .order('creado_en')
  if (error) throw error
  return data
}

export async function marcarNotificacionVista(notificacionId: string): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_marcar_notificacion_vista', { p_notificacion_id: notificacionId })
  if (error) throw error
}

export async function listarMisCanjes(clienteId: string): Promise<CanjeRecompensa[]> {
  if (isDemoMode) return demoCanjesCliente
  const { data, error } = await supabase!
    .from('canje_recompensa')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return data
}

// --- Uso desde Atender → Cobrar (empleada) -------------------------------------------------

// Recompensas que ESTA clienta puede usar ahora mismo (activas, con stock, y que alcanza con su
// saldo) — el bloque compacto de "Fidelización" en Atender.tsx solo necesita esto, nunca el
// catálogo completo con las que todavía no alcanza.
export async function listarRecompensasDisponiblesPara(saldo: number): Promise<Recompensa[]> {
  const todas = await listarRecompensasActivas()
  return todas.filter((r) => (r.stock_ilimitado || (r.cantidad_disponible ?? 0) > 0) && r.costo_puntos <= saldo)
}

// --- Administración ---------------------------------------------------------------------------

export async function obtenerConfiguracionFidelizacion(): Promise<ConfiguracionFidelizacion> {
  if (isDemoMode) return demoConfiguracionFidelizacion
  const { data, error } = await supabase!.from('configuracion_fidelizacion').select('*').eq('id', true).single()
  if (error) throw error
  return data
}

export async function actualizarConfiguracionFidelizacion(cambios: {
  acumulacionActiva?: boolean
  canjesActivo?: boolean
  textoPrograma?: string
}): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const patch: Record<string, unknown> = { actualizado_en: new Date().toISOString() }
  if (cambios.acumulacionActiva !== undefined) patch.acumulacion_activa = cambios.acumulacionActiva
  if (cambios.canjesActivo !== undefined) patch.canjes_activo = cambios.canjesActivo
  if (cambios.textoPrograma !== undefined) patch.texto_programa = cambios.textoPrograma
  const { error } = await client.from('configuracion_fidelizacion').update(patch).eq('id', true)
  if (error) throw error
}

export async function obtenerReglaPuntosVigente(): Promise<ReglaPuntos | null> {
  if (isDemoMode) return demoReglaPuntos
  const { data, error } = await supabase!
    .from('regla_puntos')
    .select('*')
    .eq('activa', true)
    .is('vigente_hasta', null)
    .maybeSingle()
  if (error) throw error
  return data
}

// Nunca se hace UPDATE de la regla vigente (alteraría cómo se explican movimientos ya
// otorgados si alguien mira el histórico junto a la regla "actual" incorrectamente asociada) —
// se cierra la vigente y se inserta una nueva versión, mismo patrón que ya traía el prototipo de
// Fase 1 de este módulo.
export async function guardarReglaPuntos(datos: {
  montoPorBloque: number
  puntosPorBloque: number
  categoriasExcluidas: string[]
  serviciosExcluidos: string[]
  incluyeProductos: boolean
}): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  await client.from('regla_puntos').update({ vigente_hasta: new Date().toISOString(), activa: false }).is('vigente_hasta', null)
  const { error } = await client.from('regla_puntos').insert({
    activa: true,
    monto_por_bloque: datos.montoPorBloque,
    puntos_por_bloque: datos.puntosPorBloque,
    categorias_excluidas: datos.categoriasExcluidas,
    servicios_excluidos: datos.serviciosExcluidos,
    incluye_productos: datos.incluyeProductos,
  })
  if (error) throw error
}

export interface RecompensaFormulario {
  nombre: string
  descripcion: string | null
  costoPuntos: number
  tipo: TipoRecompensa
  servicioId: string | null
  montoDescuento: number | null
  serviciosElegibles: string[]
  condiciones: string | null
  requiereAtencionPagada: boolean
  stockIlimitado: boolean
  cantidadDisponible: number | null
  imagenUrl: string | null
  ordenVisualizacion: number
  activa: boolean
}

export async function listarRecompensasAdmin(): Promise<Recompensa[]> {
  if (isDemoMode) return demoRecompensas
  const { data, error } = await supabase!.from('recompensa').select('*').order('orden_visualizacion').order('creado_en')
  if (error) throw error
  return data
}

function datosRecompensa(f: RecompensaFormulario) {
  return {
    nombre: f.nombre,
    descripcion: f.descripcion,
    costo_puntos: f.costoPuntos,
    tipo: f.tipo,
    servicio_id: f.tipo === 'beneficio' ? f.servicioId : null,
    monto_descuento: f.tipo === 'descuento_fijo' ? f.montoDescuento : null,
    servicios_elegibles: f.serviciosElegibles,
    condiciones: f.condiciones,
    requiere_atencion_pagada: f.requiereAtencionPagada,
    stock_ilimitado: f.stockIlimitado,
    cantidad_disponible: f.stockIlimitado ? null : f.cantidadDisponible,
    imagen_url: f.imagenUrl,
    orden_visualizacion: f.ordenVisualizacion,
    activa: f.activa,
  }
}

export async function crearRecompensa(datos: RecompensaFormulario): Promise<Recompensa> {
  if (isDemoMode) throw new Error('No disponible en modo demostración.')
  const client = supabaseRequerido()
  const { data, error } = await client.from('recompensa').insert(datosRecompensa(datos)).select().single()
  if (error) throw error
  return data
}

// Nunca se borra una recompensa (podría tener canjes históricos con su nombre/condiciones ya
// congelados en el snapshot del canje): solo se edita o se desactiva.
export async function actualizarRecompensa(id: string, datos: RecompensaFormulario): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client
    .from('recompensa')
    .update({ ...datosRecompensa(datos), actualizado_en: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function alternarRecompensaActiva(id: string, activa: boolean): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.from('recompensa').update({ activa, actualizado_en: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export interface ClienteFidelizacionResumen {
  cliente_id: string
  nombre: string
  telefono: string | null
  saldo: number
  total_ganado: number
  total_utilizado: number
  ultimo_movimiento: string | null
}

// Se calcula en el cliente a partir de movimiento_puntos (tabla pequeña para el tamaño de este
// negocio) en vez de crear una vista SQL nueva solo para este listado — si el volumen crece,
// esto es lo primero que conviene mover a una vista/función agregada en el servidor.
export async function listarClientesFidelizacion(busqueda: string): Promise<ClienteFidelizacionResumen[]> {
  if (isDemoMode) {
    return [{
      cliente_id: demoClienteActual.id, nombre: demoClienteActual.nombre, telefono: demoClienteActual.telefono,
      saldo: demoMovimientosPuntos.reduce((a, m) => a + Number(m.puntos), 0),
      total_ganado: demoMovimientosPuntos.filter((m) => Number(m.puntos) > 0).reduce((a, m) => a + Number(m.puntos), 0),
      total_utilizado: -demoMovimientosPuntos.filter((m) => Number(m.puntos) < 0).reduce((a, m) => a + Number(m.puntos), 0),
      ultimo_movimiento: demoMovimientosPuntos[0]?.creado_en ?? null,
    }]
  }
  const client = supabaseRequerido()
  let query = client.from('cliente').select('id, nombre, telefono, movimiento_puntos(puntos, creado_en)')
  if (busqueda.trim()) query = query.or(`nombre.ilike.%${busqueda}%,telefono.ilike.%${busqueda}%`)
  const { data, error } = await query.limit(50)
  if (error) throw error
  const filas: ClienteFidelizacionResumen[] = []
  for (const c of data as any[]) {
    const movimientos: { puntos: number; creado_en: string }[] = c.movimiento_puntos ?? []
    if (movimientos.length === 0) continue
    const saldo = movimientos.reduce((a, m) => a + Number(m.puntos), 0)
    const totalGanado = movimientos.filter((m) => Number(m.puntos) > 0).reduce((a, m) => a + Number(m.puntos), 0)
    const totalUtilizado = -movimientos.filter((m) => Number(m.puntos) < 0).reduce((a, m) => a + Number(m.puntos), 0)
    const ultimo: string = movimientos.reduce((max, m) => (m.creado_en > max ? m.creado_en : max), movimientos[0].creado_en)
    filas.push({ cliente_id: c.id, nombre: c.nombre, telefono: c.telefono, saldo, total_ganado: totalGanado, total_utilizado: totalUtilizado, ultimo_movimiento: ultimo })
  }
  return filas.sort((a, b) => (b.ultimo_movimiento ?? '').localeCompare(a.ultimo_movimiento ?? ''))
}

export interface ResumenFidelizacionPeriodo {
  clientas_con_movimientos: number
  puntos_otorgados: number
  puntos_utilizados: number
  recompensas_canjeadas: number
}

export async function obtenerResumenFidelizacion(desdeISO: string, hastaISO: string): Promise<ResumenFidelizacionPeriodo> {
  if (isDemoMode) return { clientas_con_movimientos: 1, puntos_otorgados: 600, puntos_utilizados: 0, recompensas_canjeadas: 0 }
  const { data, error } = await supabase!
    .from('movimiento_puntos')
    .select('cliente_id, tipo, puntos')
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  if (error) throw error
  const clientasUnicas = new Set(data.map((m: any) => m.cliente_id))
  const otorgados = data.filter((m: any) => Number(m.puntos) > 0).reduce((a: number, m: any) => a + Number(m.puntos), 0)
  const utilizados = -data.filter((m: any) => Number(m.puntos) < 0 && m.tipo === 'canje').reduce((a: number, m: any) => a + Number(m.puntos), 0)
  const { count: recompensasCanjeadas } = await supabaseRequerido()
    .from('canje_recompensa')
    .select('id', { count: 'exact', head: true })
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  return { clientas_con_movimientos: clientasUnicas.size, puntos_otorgados: otorgados, puntos_utilizados: utilizados, recompensas_canjeadas: recompensasCanjeadas ?? 0 }
}

export async function ajustarPuntosManual(clienteId: string, puntos: number, motivo: string): Promise<MovimientoPuntos> {
  if (isDemoMode) throw new Error('No disponible en modo demostración.')
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_ajustar_puntos_manual', { p_cliente_id: clienteId, p_puntos: puntos, p_motivo: motivo })
  if (error) throw error
  return data as MovimientoPuntos
}
