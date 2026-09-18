import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
import {
  demoCategoriasGasto,
  demoCuentas,
  demoGastos,
  demoPlantillasGastoRecurrente,
  demoProveedoresGasto,
} from '../demoData'
import type {
  CategoriaGasto,
  Cuenta,
  FrecuenciaRecurrencia,
  Gasto,
  GastoEvento,
  GastoPago,
  GastoPagoReversion,
  MetodoPago,
  PlantillaGastoRecurrente,
  Proveedor,
} from '../types'

// --- Categorías --------------------------------------------------------------------------

export async function listarCategoriasGasto(): Promise<CategoriaGasto[]> {
  if (isDemoMode) return demoCategoriasGasto
  const { data, error } = await supabase!.from('categoria_gasto').select('id, nombre, activa').order('nombre')
  if (error) throw error
  return data
}

export async function crearCategoriaGasto(nombre: string): Promise<CategoriaGasto> {
  const client = supabaseRequerido()
  const { data, error } = await client.from('categoria_gasto').insert({ nombre: nombre.trim() }).select('id, nombre, activa').single()
  if (error) throw error
  return data
}

// Nunca se borra una categoría con historial: se desactiva (sigue apareciendo en gastos ya
// registrados con ella, pero no se ofrece para gastos nuevos) — igual que categoria_servicio.
export async function cambiarActivaCategoriaGasto(id: string, activa: boolean): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('categoria_gasto').update({ activa }).eq('id', id)
  if (error) throw error
}

// --- Cuentas -------------------------------------------------------------------------------

export async function listarCuentas(): Promise<Cuenta[]> {
  if (isDemoMode) return demoCuentas
  const { data, error } = await supabase!.from('vista_cuenta').select('*').order('nombre')
  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, saldo: Number(row.saldo) }))
}

export async function crearCuenta(nombre: string, tipo: Cuenta['tipo']): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('cuenta').insert({ nombre: nombre.trim(), tipo })
  if (error) throw error
}

// --- Proveedores / beneficiarios ------------------------------------------------------------

export async function buscarProveedores(texto = '', limite = 20): Promise<Proveedor[]> {
  if (isDemoMode) {
    const q = texto.toLowerCase()
    return demoProveedoresGasto.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, limite)
  }
  const client = supabaseRequerido()
  let query = client.from('proveedor').select('*').eq('activo', true).order('nombre').limit(limite)
  if (texto.trim()) query = query.ilike('nombre', `%${texto.trim()}%`)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function crearProveedor(nombre: string, telefono?: string | null): Promise<Proveedor> {
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('proveedor')
    .insert({ nombre: nombre.trim(), telefono: telefono?.trim() || null })
    .select('*')
    .single()
  if (error) throw error
  return data
}

// --- Gastos: lectura -------------------------------------------------------------------------

export interface FiltrosGasto {
  texto?: string // busca en concepto, proveedor y referencia
  categoriaId?: string
  estado?: 'pendiente' | 'pago_parcial' | 'pagado' | 'anulado' | 'vencido'
  origen?: 'manual' | 'compra' | 'liquidacion'
  desde?: string // yyyy-mm-dd
  hasta?: string
  campoFecha?: 'fecha' | 'fecha_vencimiento' // a cuál fecha aplica desde/hasta (el filtro "por pago" se resuelve aparte, ver listarPagosEnRango)
}

// Trae el universo completo de gastos vigentes (no hay tanto volumen en un salón como para
// paginar de verdad); indicadores y pestañas se derivan de esta misma lista en el cliente,
// igual que ya hace Comisiones.tsx con el equipo.
export async function listarGastos(filtros: FiltrosGasto = {}): Promise<Gasto[]> {
  if (isDemoMode) return aplicarFiltrosDemo(demoGastos, filtros)
  const client = supabaseRequerido()
  let query = client.from('vista_gasto').select('*').order('fecha', { ascending: false })
  if (filtros.categoriaId) query = query.eq('categoria_id', filtros.categoriaId)
  if (filtros.origen) query = query.eq('origen', filtros.origen)
  if (filtros.estado === 'anulado') query = query.eq('anulado', true)
  else if (filtros.estado === 'vencido') query = query.eq('vencido', true)
  else if (filtros.estado) query = query.eq('estado', filtros.estado).eq('anulado', false)
  if (filtros.campoFecha && filtros.desde) query = query.gte(filtros.campoFecha, filtros.desde)
  if (filtros.campoFecha && filtros.hasta) query = query.lte(filtros.campoFecha, filtros.hasta)
  if (filtros.texto?.trim()) {
    const t = filtros.texto.trim()
    query = query.or(`concepto.ilike.%${t}%,proveedor_nombre.ilike.%${t}%,referencia.ilike.%${t}%`)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(mapVistaGasto)
}

function aplicarFiltrosDemo(gastos: Gasto[], filtros: FiltrosGasto): Gasto[] {
  return gastos.filter((g) => {
    if (filtros.categoriaId && g.categoria_id !== filtros.categoriaId) return false
    if (filtros.origen && g.origen !== filtros.origen) return false
    if (filtros.estado === 'anulado' && !g.anulado) return false
    if (filtros.estado === 'vencido' && !g.vencido) return false
    if (filtros.estado && filtros.estado !== 'anulado' && filtros.estado !== 'vencido' && (g.estado !== filtros.estado || g.anulado)) return false
    if (filtros.texto?.trim()) {
      const t = filtros.texto.trim().toLowerCase()
      const enTexto = g.concepto.toLowerCase().includes(t) || (g.proveedor_nombre ?? '').toLowerCase().includes(t) || (g.referencia ?? '').toLowerCase().includes(t)
      if (!enTexto) return false
    }
    return true
  })
}

export async function obtenerGasto(id: string): Promise<Gasto | null> {
  if (isDemoMode) return demoGastos.find((g) => g.id === id) ?? null
  const { data, error } = await supabase!.from('vista_gasto').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? mapVistaGasto(data) : null
}

function mapVistaGasto(row: any): Gasto {
  return {
    ...row,
    valor_total: Number(row.valor_total),
    total_pagado: Number(row.total_pagado),
    saldo_pendiente: Number(row.saldo_pendiente),
  }
}

// --- Indicadores ------------------------------------------------------------------------

export interface IndicadoresGasto {
  pagadoEnPeriodo: number
  pendientePorPagar: number
  vencido: number
  proximos7Dias: number
}

// vencido y proximos7Dias son SUBCONJUNTOS de pendientePorPagar (nunca se suman aparte) — ver
// vista_gasto.vencido y el criterio de fecha_vencimiento usado aquí.
export async function obtenerIndicadoresGastos(periodoDesdeISO: string, periodoHastaISO: string): Promise<IndicadoresGasto> {
  if (isDemoMode) return indicadoresDeDemo(periodoDesdeISO, periodoHastaISO)

  const gastos = await listarGastos()
  const vigentes = gastos.filter((g) => !g.anulado)
  const pendientePorPagar = vigentes.reduce((acc, g) => acc + Math.max(g.saldo_pendiente, 0), 0)
  const vencido = vigentes.filter((g) => g.vencido).reduce((acc, g) => acc + Math.max(g.saldo_pendiente, 0), 0)
  const en7Dias = fechaISOMasDias(7)
  const hoy = fechaISOHoy()
  const proximos7Dias = vigentes
    .filter((g) => !g.vencido && g.saldo_pendiente > 0 && g.fecha_vencimiento && g.fecha_vencimiento >= hoy && g.fecha_vencimiento <= en7Dias)
    .reduce((acc, g) => acc + g.saldo_pendiente, 0)

  const pagadoEnPeriodo = await obtenerPagadoNetoEnPeriodo(periodoDesdeISO, periodoHastaISO)

  return { pagadoEnPeriodo, pendientePorPagar, vencido, proximos7Dias }
}

// Pagado neto de un periodo (pagos menos reversiones registradas en ese mismo rango): no se
// puede derivar de vista_gasto (que solo trae el total pagado histórico por gasto), así que se
// consulta directo el libro de pagos/reversiones por fecha.
export async function obtenerPagadoNetoEnPeriodo(desdeISO: string, hastaISO: string): Promise<number> {
  const client = supabaseRequerido()
  const [{ data: pagos, error: errPagos }, { data: reversiones, error: errRev }] = await Promise.all([
    client.from('gasto_pago').select('importe, fecha').gte('fecha', desdeISO.slice(0, 10)).lte('fecha', hastaISO.slice(0, 10)),
    client.from('gasto_pago_reversion').select('importe, creado_en').gte('creado_en', desdeISO).lte('creado_en', hastaISO),
  ])
  if (errPagos) throw errPagos
  if (errRev) throw errRev
  const bruto = (pagos ?? []).reduce((acc, p: any) => acc + Number(p.importe), 0)
  const revertido = (reversiones ?? []).reduce((acc, r: any) => acc + Number(r.importe), 0)
  return bruto - revertido
}

function indicadoresDeDemo(desdeISO: string, hastaISO: string): IndicadoresGasto {
  const vigentes = demoGastos.filter((g) => !g.anulado)
  const pendientePorPagar = vigentes.reduce((acc, g) => acc + Math.max(g.saldo_pendiente, 0), 0)
  const vencido = vigentes.filter((g) => g.vencido).reduce((acc, g) => acc + Math.max(g.saldo_pendiente, 0), 0)
  const en7Dias = fechaISOMasDias(7)
  const hoy = fechaISOHoy()
  const proximos7Dias = vigentes
    .filter((g) => !g.vencido && g.saldo_pendiente > 0 && g.fecha_vencimiento && g.fecha_vencimiento >= hoy && g.fecha_vencimiento <= en7Dias)
    .reduce((acc, g) => acc + g.saldo_pendiente, 0)
  const pagadoEnPeriodo = vigentes
    .filter((g) => g.fecha >= desdeISO.slice(0, 10) && g.fecha <= hastaISO.slice(0, 10))
    .reduce((acc, g) => acc + g.total_pagado, 0)
  return { pagadoEnPeriodo, pendientePorPagar, vencido, proximos7Dias }
}

function fechaISOHoy(): string {
  return new Date().toISOString().slice(0, 10)
}
function fechaISOMasDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

// Para el filtro "por fecha de pago" (distinto de fecha del gasto o de vencimiento): un gasto
// puede tener varios pagos en fechas distintas, así que se resuelve aparte contra gasto_pago y
// se cruza con la lista ya cargada, en vez de forzarlo dentro de vista_gasto (una fila por
// gasto, no por pago).
export async function listarGastoIdsConPagoEnRango(desdeISO: string, hastaISO: string): Promise<Set<string>> {
  if (isDemoMode) return new Set(demoGastos.filter((g) => g.total_pagado > 0).map((g) => g.id))
  const client = supabaseRequerido()
  const { data, error } = await client.from('gasto_pago').select('gasto_id').gte('fecha', desdeISO).lte('fecha', hastaISO)
  if (error) throw error
  return new Set((data ?? []).map((row: any) => row.gasto_id))
}

// --- Gastos: escritura (todo pasa por RPC — nunca INSERT/UPDATE directo, ver 0034) ----------

export interface DatosPagoInicial {
  importe: number
  fecha: string
  metodo: MetodoPago
  cuentaId: string
  referencia?: string | null
  comprobantePath?: string | null
}

export async function crearGasto(params: {
  concepto: string
  categoriaId: string
  valorTotal: number
  proveedorId?: string | null
  referencia?: string | null
  fecha: string
  fechaVencimiento?: string | null
  notas?: string | null
  comprobantePath?: string | null
  pago?: DatosPagoInicial | null
  idempotencyKey: string
}): Promise<Gasto> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_crear_gasto', {
    p_concepto: params.concepto,
    p_categoria_id: params.categoriaId,
    p_valor_total: params.valorTotal,
    p_proveedor_id: params.proveedorId ?? null,
    p_referencia: params.referencia ?? null,
    p_fecha: params.fecha,
    p_fecha_vencimiento: params.fechaVencimiento ?? null,
    p_notas: params.notas ?? null,
    p_comprobante_path: params.comprobantePath ?? null,
    p_pago_importe: params.pago?.importe ?? null,
    p_pago_fecha: params.pago?.fecha ?? null,
    p_pago_metodo: params.pago?.metodo ?? null,
    p_pago_cuenta_id: params.pago?.cuentaId ?? null,
    p_pago_referencia: params.pago?.referencia ?? null,
    p_pago_comprobante_path: params.pago?.comprobantePath ?? null,
    p_idempotency_key: params.idempotencyKey,
  })
  if (error) throw error
  return mapVistaGasto(data)
}

export async function editarGasto(params: {
  gastoId: string
  concepto: string
  categoriaId: string
  valorTotal: number
  proveedorId?: string | null
  referencia?: string | null
  fecha: string
  fechaVencimiento?: string | null
  notas?: string | null
  comprobantePath?: string | null
}): Promise<Gasto> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_editar_gasto', {
    p_gasto_id: params.gastoId,
    p_concepto: params.concepto,
    p_categoria_id: params.categoriaId,
    p_valor_total: params.valorTotal,
    p_proveedor_id: params.proveedorId ?? null,
    p_referencia: params.referencia ?? null,
    p_fecha: params.fecha,
    p_fecha_vencimiento: params.fechaVencimiento ?? null,
    p_notas: params.notas ?? null,
    p_comprobante_path: params.comprobantePath ?? null,
  })
  if (error) throw error
  return mapVistaGasto(data)
}

export async function duplicarGasto(gastoId: string): Promise<Gasto> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_duplicar_gasto', { p_gasto_id: gastoId })
  if (error) throw error
  return mapVistaGasto(data)
}

export async function registrarPagoGasto(params: {
  gastoId: string
  importe: number
  fecha: string
  metodo: MetodoPago
  cuentaId: string
  referencia?: string | null
  comprobantePath?: string | null
  idempotencyKey: string
}): Promise<GastoPago> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_registrar_pago_gasto', {
    p_gasto_id: params.gastoId,
    p_importe: params.importe,
    p_fecha: params.fecha,
    p_metodo: params.metodo,
    p_cuenta_id: params.cuentaId,
    p_referencia: params.referencia ?? null,
    p_comprobante_path: params.comprobantePath ?? null,
    p_idempotency_key: params.idempotencyKey,
  })
  if (error) throw error
  return data
}

export async function revertirPagoGasto(params: { gastoPagoId: string; importe: number; motivo: string }): Promise<GastoPagoReversion> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_revertir_pago_gasto', {
    p_gasto_pago_id: params.gastoPagoId,
    p_importe: params.importe,
    p_motivo: params.motivo,
  })
  if (error) throw error
  return data
}

export async function anularGasto(gastoId: string, motivo: string): Promise<Gasto> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_anular_gasto', { p_gasto_id: gastoId, p_motivo: motivo })
  if (error) throw error
  return mapVistaGasto(data)
}

// --- Detalle: historial de pagos / reversiones / eventos ------------------------------------

export async function listarPagosDeGasto(gastoId: string): Promise<GastoPago[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('gasto_pago')
    .select('*, cuenta:cuenta_id(nombre), perfil:registrado_por(nombre)')
    .eq('gasto_id', gastoId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: any) => ({
    ...row,
    importe: Number(row.importe),
    cuenta_nombre: row.cuenta?.nombre,
    registrado_por_nombre: row.perfil?.nombre,
  }))
}

export async function listarReversionesDePago(gastoPagoId: string): Promise<GastoPagoReversion[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('gasto_pago_reversion')
    .select('*, perfil:registrado_por(nombre)')
    .eq('gasto_pago_id', gastoPagoId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, importe: Number(row.importe), registrado_por_nombre: row.perfil?.nombre }))
}

export async function listarEventosDeGasto(gastoId: string): Promise<GastoEvento[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('gasto_evento')
    .select('*, perfil:usuario_id(nombre)')
    .eq('gasto_id', gastoId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row, usuario_nombre: row.perfil?.nombre }))
}

// --- Comprobantes (Storage privado) ---------------------------------------------------------

const BUCKET_COMPROBANTES = 'comprobantes-gastos'
export const TIPOS_COMPROBANTE_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const TAMANO_MAXIMO_COMPROBANTE = 10 * 1024 * 1024 // 10 MB, igual al límite del bucket (0035)

export async function subirComprobante(archivo: File, claveTemporal: string): Promise<string> {
  if (!TIPOS_COMPROBANTE_PERMITIDOS.includes(archivo.type)) {
    throw new Error('Formato no admitido: sube una imagen (JPG, PNG, WEBP) o un PDF.')
  }
  if (archivo.size > TAMANO_MAXIMO_COMPROBANTE) {
    throw new Error('El archivo supera el tamaño máximo permitido (10 MB).')
  }
  const client = supabaseRequerido()
  const extension = archivo.name.split('.').pop() || 'bin'
  const ruta = `${claveTemporal}/${Date.now()}.${extension}`
  const { error } = await client.storage.from(BUCKET_COMPROBANTES).upload(ruta, archivo, { upsert: false })
  if (error) throw error
  return ruta
}

export async function obtenerUrlComprobante(path: string): Promise<string> {
  const client = supabaseRequerido()
  const { data, error } = await client.storage.from(BUCKET_COMPROBANTES).createSignedUrl(path, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

// --- Recurrentes -----------------------------------------------------------------------------

export async function listarPlantillasRecurrentes(): Promise<PlantillaGastoRecurrente[]> {
  if (isDemoMode) return demoPlantillasGastoRecurrente
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('plantilla_gasto_recurrente')
    .select('*, categoria:categoria_id(nombre), proveedor:proveedor_id(nombre)')
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: any) => ({
    ...row,
    valor_total: Number(row.valor_total),
    categoria_nombre: row.categoria?.nombre,
    proveedor_nombre: row.proveedor?.nombre ?? null,
  }))
}

export async function crearPlantillaRecurrente(params: {
  concepto: string
  categoriaId: string
  proveedorId?: string | null
  valorTotal: number
  frecuencia: FrecuenciaRecurrencia
  primeraFechaVencimiento: string
  fechaFin?: string | null
}): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('plantilla_gasto_recurrente').insert({
    concepto: params.concepto.trim(),
    categoria_id: params.categoriaId,
    proveedor_id: params.proveedorId ?? null,
    valor_total: params.valorTotal,
    frecuencia: params.frecuencia,
    primera_fecha_vencimiento: params.primeraFechaVencimiento,
    fecha_fin: params.fechaFin ?? null,
  })
  if (error) throw error
}

// Editar una plantilla solo cambia ocurrencias FUTURAS: las ya generadas son gastos
// independientes (fn_generar_siguiente_gasto_recurrente copió sus valores al crearlas) y no se
// tocan retroactivamente.
export async function editarPlantillaRecurrente(params: {
  id: string
  concepto: string
  categoriaId: string
  proveedorId?: string | null
  valorTotal: number
  frecuencia: FrecuenciaRecurrencia
  fechaFin?: string | null
}): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client
    .from('plantilla_gasto_recurrente')
    .update({
      concepto: params.concepto.trim(),
      categoria_id: params.categoriaId,
      proveedor_id: params.proveedorId ?? null,
      valor_total: params.valorTotal,
      frecuencia: params.frecuencia,
      fecha_fin: params.fechaFin ?? null,
    })
    .eq('id', params.id)
  if (error) throw error
}

export async function cambiarActivaPlantillaRecurrente(id: string, activa: boolean): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('plantilla_gasto_recurrente').update({ activa }).eq('id', id)
  if (error) throw error
}

export async function generarSiguienteGastoRecurrente(plantillaId: string): Promise<Gasto> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_generar_siguiente_gasto_recurrente', { p_plantilla_id: plantillaId })
  if (error) throw error
  return mapVistaGasto(data)
}
