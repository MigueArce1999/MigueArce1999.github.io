// Fidelización ("Tu belleza florece"). Ver supabase/migrations/0047_fidelizacion.sql para las
// funciones RPC y el porqué de cada regla — este archivo solo las expone al frontend, nunca
// reimplementa lógica de negocio que ya vive (y debe seguir viviendo) en el servidor.

import { isDemoMode, LOCAL_ID, supabase, supabaseRequerido } from '../supabase'
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

// Solo en modo demo: el autocanje (más abajo) necesita poder "gastar" puntos de verdad para que
// la celebración se sienta real, sin tocar ningún dato del servidor. demoMiFidelizacion es un
// snapshot fijo — este override en memoria es lo único que cambia durante la sesión del navegador.
let demoSaldoOverride: number | null = null
const demoCanjesExtra: CanjeRecompensa[] = []
const demoNotificacionesExtra: NotificacionFidelizacion[] = []

function demoFidelizacionActual(): MiFidelizacion {
  const saldo = demoSaldoOverride ?? demoMiFidelizacion.saldo
  const meta = demoMiFidelizacion.meta
  return {
    ...demoMiFidelizacion,
    saldo,
    progreso: meta ? Math.min(Math.max(saldo / meta.costo_puntos, 0), 1) : null,
    puntos_faltantes: meta ? Math.max(meta.costo_puntos - saldo, 0) : null,
  }
}

export async function obtenerMiFidelizacion(clienteId: string): Promise<MiFidelizacion> {
  if (isDemoMode) return demoFidelizacionActual()
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
    .eq('local_id', LOCAL_ID)
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

// Solo en modo demo: recuerda qué notificaciones demo ya se "reconocieron" durante esta sesión
// del navegador. marcarNotificacionVista no puede persistir de verdad (no hay servidor), pero sin
// este mínimo estado en memoria una celebración demo reaparecería en cada pantalla que vuelva a
// pedir notificaciones (cada página llama a useMiFidelizacion por su cuenta) — justo lo que la
// sección 3 del pedido pide evitar ("no reproducirla cada vez que visita el perfil").
const demoNotificacionesReconocidas = new Set<string>()

export async function listarNotificacionesNoVistas(clienteId: string): Promise<NotificacionFidelizacion[]> {
  if (isDemoMode) {
    return [...demoNotificacionesFidelizacion, ...demoNotificacionesExtra].filter((n) => !demoNotificacionesReconocidas.has(n.id))
  }
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
  if (isDemoMode) { demoNotificacionesReconocidas.add(notificacionId); return }
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_marcar_notificacion_vista', { p_notificacion_id: notificacionId })
  if (error) throw error
}

export async function listarMisCanjes(clienteId: string): Promise<CanjeRecompensa[]> {
  if (isDemoMode) return [...demoCanjesExtra, ...demoCanjesCliente]
  const { data, error } = await supabase!
    .from('canje_recompensa')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return data
}

// Canje directo desde el perfil de la clienta (sin pasar por un cobro de Atender) — decisión
// explícita de negocio: la clienta puede pedir su recompensa ella misma. El canje queda
// "pendiente de entregar" (atencion_id = null, entregado = false) hasta que alguien del salón lo
// entregue y lo marque (ver marcarCanjeEntregado) — nunca se asume la entrega solo porque ya se
// gastaron los puntos. Reutiliza EXACTAMENTE la misma tabla/notificación/celebración que el canje
// durante un cobro (ver supabase/migrations/0049_autocanje.sql).
export async function autocanjearRecompensa(clienteId: string, recompensaId: string, idempotencyKey: string): Promise<void> {
  if (isDemoMode) {
    const recompensa = demoRecompensas.find((r) => r.id === recompensaId)
    if (!recompensa) throw new Error('Esa recompensa ya no está disponible.')
    const saldoAnterior = demoSaldoOverride ?? demoMiFidelizacion.saldo
    if (saldoAnterior < recompensa.costo_puntos) throw new Error('No tienes suficientes puntos para esta recompensa.')
    const saldoPosterior = saldoAnterior - recompensa.costo_puntos
    demoSaldoOverride = saldoPosterior
    const ahora = new Date().toISOString()
    demoCanjesExtra.unshift({
      id: idempotencyKey, cliente_id: clienteId, recompensa_id: recompensa.id, atencion_id: null,
      costo_puntos_snapshot: recompensa.costo_puntos,
      condiciones_snapshot: { nombre: recompensa.nombre, tipo: recompensa.tipo, condiciones: recompensa.condiciones, servicio_id: recompensa.servicio_id, monto_descuento: recompensa.monto_descuento },
      estado: 'confirmado', entregado: false, empleada_id: null, creado_en: ahora, revertido_en: null,
      saldo_anterior: saldoAnterior, saldo_posterior: saldoPosterior,
    })
    demoNotificacionesExtra.push({
      id: `demo-autocanje-notif-${idempotencyKey}`, cliente_id: clienteId, tipo: 'canje_confirmado',
      titulo: '¡Disfruta tu recompensa!', mensaje: `Usaste ${recompensa.costo_puntos} puntos en "${recompensa.nombre}".`,
      origen_tipo: 'canje', origen_id: idempotencyKey, leida_en: null, creado_en: ahora,
      datos: {
        canje_id: idempotencyKey, recompensa_nombre: recompensa.nombre, recompensa_imagen_url: recompensa.imagen_url,
        recompensa_tipo: recompensa.tipo, costo_puntos: recompensa.costo_puntos,
        saldo_anterior: saldoAnterior, saldo_posterior: saldoPosterior, puntos_ganados_en_esta_atencion: 0,
      },
    })
    return
  }
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_autocanjear_recompensa', {
    p_cliente_id: clienteId, p_recompensa_id: recompensaId, p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
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
  const { data, error } = await supabase!.from('configuracion_fidelizacion').select('*').eq('local_id', LOCAL_ID).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No hay configuración de fidelización para este local.')
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
  const { error } = await client.from('configuracion_fidelizacion').update(patch).eq('local_id', LOCAL_ID)
  if (error) throw error
}

export async function obtenerReglaPuntosVigente(): Promise<ReglaPuntos | null> {
  if (isDemoMode) return demoReglaPuntos
  const { data, error } = await supabase!
    .from('regla_puntos')
    .select('*')
    .eq('activa', true)
    .eq('local_id', LOCAL_ID)
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
  await client.from('regla_puntos').update({ vigente_hasta: new Date().toISOString(), activa: false }).eq('local_id', LOCAL_ID).is('vigente_hasta', null)
  const { error } = await client.from('regla_puntos').insert({
    activa: true,
    local_id: LOCAL_ID,
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
  const { data, error } = await supabase!.from('recompensa').select('*').eq('local_id', LOCAL_ID).order('orden_visualizacion').order('creado_en')
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
    local_id: LOCAL_ID,
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
    .eq('local_id', LOCAL_ID)
  if (error) throw error
}

export async function alternarRecompensaActiva(id: string, activa: boolean): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.from('recompensa').update({ activa, actualizado_en: new Date().toISOString() }).eq('id', id).eq('local_id', LOCAL_ID)
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

// --- Entregas de autocanjes (sección "Canjes por entregar" del admin) ----------------------
// Solo canjes SIN atención asociada (la clienta lo pidió ella misma desde su perfil) y aún sin
// entregar — uno aplicado durante un cobro ya se resolvió en esa misma visita.

export interface CanjePendienteEntrega extends CanjeRecompensa {
  cliente_nombre: string
  cliente_telefono: string | null
}

export async function listarCanjesPendientesEntrega(): Promise<CanjePendienteEntrega[]> {
  if (isDemoMode) {
    return demoCanjesExtra
      .filter((c) => !c.entregado)
      .map((c) => ({ ...c, cliente_nombre: demoClienteActual.nombre, cliente_telefono: demoClienteActual.telefono }))
  }
  const { data, error } = await supabase!.from('vista_canje_pendiente_entrega').select('*')
  if (error) throw error
  return data
}

export async function marcarCanjeEntregado(canjeId: string): Promise<void> {
  if (isDemoMode) {
    const canje = demoCanjesExtra.find((c) => c.id === canjeId)
    if (canje) canje.entregado = true
    return
  }
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_marcar_canje_entregado', { p_canje_id: canjeId })
  if (error) throw error
}
