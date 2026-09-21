// Capa de resolución de entidades: convierte un texto dictado ("Valery", "blowr", "Verónica")
// en un registro REAL de Supabase, o dice honestamente que no lo encontró. Nunca inventa una
// entidad ni la selecciona a ciegas cuando hay ambigüedad — de eso se encarga
// VoiceExecutionService, mostrando la pregunta correspondiente.
//
// Orden de resolución (sección 5 del pedido): 1) exacto, 2) exacto normalizado, 3) alias,
// 4) parcial, 5) fuzzy (pg_trgm en Supabase + similitud local), 6) pedir aclaración.

import { normalizar, buscarCoincidencias, type ResultadoBusqueda } from './texto'
import {
  buscarAliasVoz,
  buscarClientesFuzzy,
  buscarProductosFuzzy,
  buscarProfesionalesFuzzy,
  buscarServiciosFuzzy,
  type CandidatoFuzzy,
  type EntityType,
} from './voiceApi'
import { buscarClientes } from '../api/empleada'
import { obtenerClienteAdmin } from '../api/clientes'
import type { Cliente, Profesional, Servicio } from '../types'
import type { Producto } from './schema'

// Centralizado y fácil de ajustar (sección 6 del pedido): por encima de ALTO, una única
// coincidencia se puede tomar sola; entre MEDIO y ALTO, se muestra para confirmar; por debajo
// de MEDIO, "no encontrado". Empírico, no viene de ningún estándar externo.
export const UMBRALES_FUZZY = { alto: 0.85, medio: 0.65 }

function clasificarPorScore<T extends { score: number }>(candidatos: T[]): ResultadoBusqueda<T> {
  const filtrados = candidatos.filter((c) => c.score >= UMBRALES_FUZZY.medio).sort((a, b) => b.score - a.score)
  if (filtrados.length === 0) return { tipo: 'ninguna' }
  const [mejor, segundo] = filtrados
  if (mejor.score >= UMBRALES_FUZZY.alto && (!segundo || mejor.score - segundo.score > 0.05)) {
    return { tipo: 'unica', item: mejor }
  }
  if (filtrados.length === 1) return { tipo: 'aproximada', item: mejor, puntaje: mejor.score }
  return { tipo: 'multiple', opciones: filtrados.slice(0, 5).map((c) => ({ item: c, puntaje: c.score })) }
}

// Etapas 1-5 sobre una lista YA CARGADA en memoria (servicios/profesionales/productos: Atender
// siempre trae el catálogo completo al abrir la pantalla, igual que el formulario manual). Si
// nada calza localmente, se intenta también el fuzzy remoto (pg_trgm) — cubre el caso de que el
// catálogo en memoria haya quedado desactualizado frente a Supabase.
async function resolverConListaLocal<T>(
  texto: string,
  lista: T[],
  obtenerTexto: (item: T) => string,
  obtenerId: (item: T) => string,
  entityType: EntityType,
  buscarFuzzyRemoto: (texto: string) => Promise<CandidatoFuzzy[]>,
): Promise<ResultadoBusqueda<T>> {
  const normalizado = normalizar(texto)

  const exacto = lista.find((i) => obtenerTexto(i) === texto)
  if (exacto) return { tipo: 'unica', item: exacto }

  const exactoNorm = lista.find((i) => normalizar(obtenerTexto(i)) === normalizado)
  if (exactoNorm) return { tipo: 'unica', item: exactoNorm }

  const aliasId = await buscarAliasVoz(entityType, normalizado)
  if (aliasId) {
    const porAlias = lista.find((i) => obtenerId(i) === aliasId)
    if (porAlias) return { tipo: 'unica', item: porAlias }
  }

  const local = buscarCoincidencias(texto, lista, obtenerTexto)
  if (local.tipo !== 'ninguna') return local

  const fuzzyRemoto = await buscarFuzzyRemoto(texto)
  const idsAceptables = new Set(fuzzyRemoto.filter((c) => c.score >= UMBRALES_FUZZY.medio).map((c) => c.id))
  const candidatosRemotosEnLista = lista.filter((i) => idsAceptables.has(obtenerId(i)))
  if (candidatosRemotosEnLista.length > 0) {
    return buscarCoincidencias(texto, candidatosRemotosEnLista, obtenerTexto)
  }
  return { tipo: 'ninguna' }
}

export function resolverServicio(texto: string, servicios: Servicio[]): Promise<ResultadoBusqueda<Servicio>> {
  return resolverConListaLocal(texto, servicios, (s) => s.nombre, (s) => s.id, 'service', buscarServiciosFuzzy)
}

export function resolverProfesional(texto: string, equipo: Profesional[]): Promise<ResultadoBusqueda<Profesional>> {
  return resolverConListaLocal(texto, equipo, (p) => p.nombre, (p) => p.id, 'employee', buscarProfesionalesFuzzy)
}

export function resolverProducto(texto: string, productos: Producto[]): Promise<ResultadoBusqueda<Producto>> {
  return resolverConListaLocal(texto, productos, (p) => p.nombre, (p) => p.id, 'product', buscarProductosFuzzy)
}

// Cliente es distinto de los otros tres: Atender NUNCA precarga el listado completo de
// clientas (podrían ser miles) — cada búsqueda pega contra Supabase (mismo buscarClientes que
// ya usa el formulario manual, `ilike '%texto%'`). Un typo de transcripción ("Beronica" en vez
// de "Verónica") puede no aparecer en ese resultado por sustring, así que el fuzzy remoto SÍ
// puede aportar candidatos que el ilike no trajo — a diferencia de servicio/profesional/
// producto, aquí si hace falta se reconstruye el registro completo con obtenerClienteAdmin.
export async function resolverCliente(texto: string): Promise<ResultadoBusqueda<Cliente>> {
  const normalizado = normalizar(texto)
  const candidatosServidor = await buscarClientes(texto)

  const exacto = candidatosServidor.find((c) => c.nombre === texto)
  if (exacto) return { tipo: 'unica', item: exacto }
  const exactoNorm = candidatosServidor.find((c) => normalizar(c.nombre) === normalizado)
  if (exactoNorm) return { tipo: 'unica', item: exactoNorm }

  const aliasId = await buscarAliasVoz('client', normalizado)
  if (aliasId) {
    const porAlias = candidatosServidor.find((c) => c.id === aliasId) ?? (await obtenerClienteAdmin(aliasId))
    if (porAlias) return { tipo: 'unica', item: porAlias as Cliente }
  }

  const local = buscarCoincidencias(texto, candidatosServidor, (c) => c.nombre)
  if (local.tipo !== 'ninguna') return local

  const fuzzy = await buscarClientesFuzzy(texto)
  const clasificado = clasificarPorScore(fuzzy)
  if (clasificado.tipo === 'ninguna') return { tipo: 'ninguna' }

  async function aCliente(c: { id: string; nombre: string; telefono: string | null }): Promise<Cliente> {
    const yaConocido = candidatosServidor.find((x) => x.id === c.id)
    if (yaConocido) return yaConocido
    const completo = await obtenerClienteAdmin(c.id)
    return (
      completo ?? {
        id: c.id, usuario_id: null, nombre: c.nombre, telefono: c.telefono, email: null,
        consentimiento_marketing: false, visitas_completadas: 0, gasto_acumulado: 0, activo: true,
        origen_registro: 'admin', notas: null, resena_google_confirmada: false, meta_recompensa_id: null, creado_en: '',
      }
    )
  }

  if (clasificado.tipo === 'unica') return { tipo: 'unica', item: await aCliente(clasificado.item) }
  if (clasificado.tipo === 'aproximada') return { tipo: 'aproximada', item: await aCliente(clasificado.item), puntaje: clasificado.puntaje }
  const opciones = await Promise.all(clasificado.opciones.map(async (o) => ({ item: await aCliente(o.item), puntaje: o.puntaje })))
  return { tipo: 'multiple', opciones }
}
