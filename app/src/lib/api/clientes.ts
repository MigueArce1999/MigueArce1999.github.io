import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
import { demoClientesAdmin } from '../demoData'
import { soloDigitos } from '../telefono'
import type { ClienteResumen } from '../types'

// Trae TODO el histórico de clientes de una vez (activos + archivados): para el tamaño de un
// salón (decenas/cientos, no millones), es más simple y igual de correcto filtrar/paginar en
// memoria que reconstruir la misma lógica de filtros en cada consulta — mismo patrón que ya
// usan AdminVentas/AdminComisiones en este proyecto. listarClientesAdmin es la única fuente:
// los indicadores y la tabla siempre leen del mismo arreglo, así nunca se desincronizan.
export async function listarClientesAdmin(): Promise<ClienteResumen[]> {
  if (isDemoMode) return demoClientesAdmin
  const client = supabaseRequerido()
  const { data, error } = await client.from('vista_cliente_resumen').select('*').order('nombre')
  if (error) throw error
  return data
}

export async function obtenerClienteAdmin(id: string): Promise<ClienteResumen | null> {
  if (isDemoMode) return demoClientesAdmin.find((c) => c.id === id) ?? null
  const client = supabaseRequerido()
  const { data, error } = await client.from('vista_cliente_resumen').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export interface DatosCliente {
  nombre: string
  telefono: string | null
  email: string | null
  consentimientoMarketing: boolean
  notas?: string | null
}

export async function crearClienteAdmin(datos: DatosCliente): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.from('cliente').insert({
    nombre: datos.nombre,
    telefono: datos.telefono,
    email: datos.email,
    consentimiento_marketing: datos.consentimientoMarketing,
    notas: datos.notas ?? null,
    origen_registro: 'admin',
    consentimiento_marketing_fecha: datos.consentimientoMarketing ? new Date().toISOString() : null,
    consentimiento_marketing_version: datos.consentimientoMarketing ? 'registro-admin-v1' : null,
  })
  if (error) throw error
}

export async function actualizarClienteAdmin(id: string, datos: DatosCliente): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client
    .from('cliente')
    .update({
      nombre: datos.nombre,
      telefono: datos.telefono,
      email: datos.email,
      consentimiento_marketing: datos.consentimientoMarketing,
      notas: datos.notas ?? null,
    })
    .eq('id', id)
  if (error) throw error
}

export async function archivarCliente(id: string, activo: boolean): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.from('cliente').update({ activo }).eq('id', id)
  if (error) throw error
}

// Confirmación manual de que alguien del salón vio la reseña — nunca una verificación
// automática contra la API de Google (no hay ninguna integración así en este proyecto).
export async function marcarResenaGoogle(id: string, confirmada: boolean): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.from('cliente').update({ resena_google_confirmada: confirmada }).eq('id', id)
  if (error) throw error
}

// Advertencia de posible duplicado ANTES de crear (nunca crea nada silenciosamente): busca por
// los últimos 7 dígitos del teléfono, suficiente para acotar candidatos en la tabla de un
// salón; la comparación definitiva de "son el mismo número" la hace telefonosEquivalentes.
export async function buscarPosiblesDuplicados(telefono: string): Promise<ClienteResumen[]> {
  const digitos = soloDigitos(telefono)
  if (isDemoMode || digitos.length < 7) return []
  const client = supabaseRequerido()
  const { data, error } = await client.from('vista_cliente_resumen').select('*').ilike('telefono', `%${digitos.slice(-7)}%`)
  if (error) throw error
  return data
}

// Única puerta pública (sin sesión) hacia la tabla cliente — ver fn_registrar_cliente_publico
// en supabase/migrations/0024. No existe un "modo demo" con persistencia real aquí: en demo no
// hay proyecto Supabase conectado, así que solo se simula el éxito visual.
export async function registrarClientePublico(datos: {
  nombre: string
  telefono: string
  email?: string | null
  aceptaMarketing: boolean
}): Promise<void> {
  if (isDemoMode) return
  if (!supabase) throw new Error('No hay conexión a Supabase configurada.')
  const { error } = await supabase.rpc('fn_registrar_cliente_publico', {
    p_nombre: datos.nombre,
    p_telefono: datos.telefono,
    p_email: datos.email || null,
    p_acepta_marketing: datos.aceptaMarketing,
  })
  if (error) throw error
}

// CSV protegido contra inyección de fórmulas (una celda que empiece con = + - @ se antepone
// con un apóstrofo, como hacen Excel/Sheets/Google al importar) y con comillas dobles
// escapadas para que nombres con comas o acentos no rompan las columnas.
function celdaCSV(valor: string | number | null | undefined): string {
  const texto = valor === null || valor === undefined ? '' : String(valor)
  const protegida = /^[=+\-@]/.test(texto) ? `'${texto}` : texto
  return `"${protegida.replace(/"/g, '""')}"`
}

export function exportarClientesCSV(clientes: ClienteResumen[]): void {
  const encabezados = ['Nombre', 'WhatsApp', 'Correo', 'Última visita', 'Último servicio', 'Autoriza promociones', 'Estado', 'Visitas', 'Gasto acumulado']
  const filas = clientes.map((c) => [
    celdaCSV(c.nombre),
    celdaCSV(c.telefono),
    celdaCSV(c.email),
    celdaCSV(c.ultima_visita ? new Date(c.ultima_visita).toLocaleDateString('es-CO') : 'Sin visitas'),
    celdaCSV(c.ultimo_servicio_nombre ?? 'Sin registrar'),
    celdaCSV(c.consentimiento_marketing ? 'Sí' : 'No'),
    celdaCSV(c.activo ? 'Activo' : 'Archivado'),
    celdaCSV(c.visitas_completadas),
    celdaCSV(c.gasto_acumulado),
  ])
  const contenido = '﻿' + [encabezados.map(celdaCSV).join(','), ...filas.map((f) => f.join(','))].join('\r\n')
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
