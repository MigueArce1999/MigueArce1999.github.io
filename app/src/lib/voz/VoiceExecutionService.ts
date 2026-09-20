// Orquestador del pipeline completo: COMMAND INTERPRETER → ENTITY RESOLUTION → VALIDATION →
// DRAFT. Nunca toca Supabase para ESCRIBIR una atención — solo para RESOLVER entidades
// (buscar clienta/servicio/profesional/producto) y, cuando la persona confirma explícitamente
// crear una clienta/servicio/producto nuevo, esa alta puntual sí se escribe (igual que el
// formulario manual permite crear sobre la marcha). La escritura de la ATENCIÓN en sí queda
// para cuando la persona confirma el draft completo: en ese momento este archivo entrega el
// draft ya armado a quien lo llamó (el hook de React), que lo vuelca sobre el MISMO
// cliente/lineas/productos/notas del formulario manual y dispara la MISMA validación
// (irACobrar) — la escritura real sigue siendo fn_registrar_atencion/fn_completar_y_cobrar_atencion,
// sin duplicar esa lógica aquí.

import { deterministicCommandInterpreter } from './CommandInterpreter'
import { resolverCliente, resolverProducto, resolverProfesional, resolverServicio } from './EntityResolver'
import {
  agregarColaborador,
  agregarNota,
  agregarProducto,
  agregarServicio,
  actualizarColaborador,
  actualizarServicio,
  draftEstaCompleto,
  quitarColaborador,
  quitarProducto,
  quitarServicio,
  servicioMasReciente,
  setClientePendienteCreacion,
  setClienteResuelto,
  totalDraft,
} from './draftReducer'
import {
  deshacerUltimoDraft,
  guardarSnapshotDeshacer,
  reiniciarSesionVoz,
  snapshotParaInterprete,
  type VoiceSessionState,
} from './VoiceSessionContext'
import { logTurnoVoz } from './logging'
import type {
  AttentionDraft,
  ClarificationOption,
  CommandInterpreter,
  DraftServiceLine,
  ParsedAttentionCommand,
  ParsedServiceRef,
  PendingClarification,
  VoiceCorrection,
} from './schema'
import type { Cliente, Profesional, Servicio } from '../types'
import type { Producto } from './schema'
import { ORDINALES, extraerMonto } from './MoneyNormalizer'
import { buscarCoincidencias, normalizar } from './texto'

export interface VoiceExecutionDeps {
  obtenerServicios: () => Servicio[]
  obtenerEquipo: () => Profesional[]
  obtenerProductos: () => Producto[]
  puedeCrearServicio: boolean
  puedeCrearProducto: boolean
  crearServicioRapido: (nombre: string) => Promise<Servicio>
  crearProductoRapido: (nombre: string, categoria?: string | null, precio?: number | null) => Promise<Producto>
  crearClienteRapido: (datos: { nombre: string; telefono: string | null }) => Promise<Cliente>
  interpreter?: CommandInterpreter
}

export interface ResultadoTurnoVoz {
  draft: AttentionDraft
  clarification: PendingClarification | null
  readyToConfirm: boolean
  shouldExecute: boolean
  shouldCancel: boolean
  summary: string | null
  error: string | null
}

function idTemporal(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function opcion(etiqueta: string, valor: string): ClarificationOption {
  return { label: etiqueta, value: valor }
}

export async function procesarUtterance(
  texto: string,
  utteranceId: string,
  sesion: VoiceSessionState,
  deps: VoiceExecutionDeps,
): Promise<ResultadoTurnoVoz> {
  const inicio = performance.now()
  const draftAntes = sesion.draft
  let shouldExecute = false
  let shouldCancel = false
  let error: string | null = null

  // Idempotencia (sección 2 del pedido): la Web Speech API puede reentregar el mismo resultado
  // final ante ciertos reinicios del motor de reconocimiento. useReconocimientoVoz ya filtra la
  // mayoría de esos casos por índice+texto, pero esta es la última barrera antes de mutar el
  // draft — nunca se procesa dos veces el mismo utteranceId.
  if (sesion.idsProcesados.has(utteranceId)) {
    return construirResultado(sesion, draftAntes, false, false, null)
  }
  sesion.idsProcesados.add(utteranceId)

  try {
    // 1) Si hay una aclaración visible, se intenta resolver contra ELLA primero — nunca se
    // reinterpreta como instrucción nueva mientras algo sigue pendiente de responder.
    if (sesion.pendingClarification) {
      const consumida = await intentarResponderClarificacion(texto, sesion, deps)
      if (consumida) {
        logTurnoVoz({ utteranceId, rawTranscript: texto, normalizedTranscript: texto.toLowerCase(), executionResult: 'clarification_resuelta', processingTime: performance.now() - inicio })
        return construirResultado(sesion, draftAntes, false, false, null)
      }
    }

    const interpreter = deps.interpreter ?? deterministicCommandInterpreter
    const comando = await interpreter.interpret({ utteranceId, text: texto, context: snapshotParaInterprete(sesion) })

    logTurnoVoz({
      utteranceId,
      rawTranscript: comando.rawText,
      normalizedTranscript: comando.normalizedText,
      parsedIntent: comando.intent,
      parsedEntities: { client: comando.client, services: comando.services, products: comando.products, corrections: comando.corrections },
      confidence: comando.confidence,
      ambiguities: comando.ambiguities,
    })

    if (comando.intent === 'CANCEL') {
      reiniciarSesionVoz(sesion)
      shouldCancel = true
      return construirResultado(sesion, draftAntes, false, shouldCancel, null)
    }

    if (comando.intent === 'UNDO') {
      const deshecho = deshacerUltimoDraft(sesion)
      return construirResultado(sesion, draftAntes, false, false, deshecho ? `Deshecho: ${deshecho}` : 'No hay nada que deshacer.')
    }

    guardarSnapshotDeshacer(sesion, comando.rawText)

    if (comando.intent === 'CONFIRM') {
      shouldExecute = draftEstaCompleto(sesion.draft)
      if (!shouldExecute) {
        sesion.undoStack.pop() // no hubo cambio real, no vale la pena un peldaño de deshacer
        return construirResultado(sesion, draftAntes, false, false, 'Todavía falta información antes de poder continuar — revisa el resumen.')
      }
      return construirResultado(sesion, draftAntes, false, false, null, true)
    }

    await procesarComando(comando, sesion, deps)

    if (sesion.draft === draftAntes && !sesion.pendingClarification) {
      sesion.undoStack.pop() // instrucción sin efecto (p. ej. no se reconoció nada) — no ensucia el historial
    }
  } catch (e: any) {
    error = e?.message || 'No se pudo procesar la instrucción.'
  }

  return construirResultado(sesion, draftAntes, false, shouldCancel, error, shouldExecute)
}

function construirResultado(
  sesion: VoiceSessionState,
  draftAntes: AttentionDraft,
  _unused: boolean,
  shouldCancel: boolean,
  mensajeOInfo: string | null,
  shouldExecute = false,
): ResultadoTurnoVoz {
  void draftAntes
  return {
    draft: sesion.draft,
    clarification: sesion.pendingClarification,
    readyToConfirm: draftEstaCompleto(sesion.draft),
    shouldExecute,
    shouldCancel,
    summary: mensajeOInfo,
    error: null,
  }
}

// --- Procesamiento del comando estructurado -------------------------------------------------

async function procesarComando(comando: ParsedAttentionCommand, sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<void> {
  if (comando.client) {
    await procesarCliente(comando.client, sesion, deps)
    if (sesion.pendingClarification) return
  }

  for (const servicioRef of fusionarServiciosPorNombre(comando.services)) {
    await procesarServicio(servicioRef, comando.intent, sesion, deps)
    if (sesion.pendingClarification) return
  }

  for (const productoRef of comando.products) {
    await procesarProducto(productoRef, comando.intent, sesion, deps)
    if (sesion.pendingClarification) return
  }

  for (const correccion of comando.corrections) {
    await procesarCorreccion(correccion, sesion, deps)
    if (sesion.pendingClarification) return
  }

  if (comando.removeCollaborator) {
    await procesarQuitarColaborador(comando.removeCollaborator, sesion, deps)
    if (sesion.pendingClarification) return
  }

  if (comando.notes) {
    sesion.draft = agregarNota(sesion.draft, comando.notes)
  }
}

// Una misma expresión puede mencionar el mismo servicio dos veces con distintos datos ("se hizo
// un blower... con Valery" y más adelante "Ana colaboró en el blower..."): eso es UNA sola
// línea de servicio con dos piezas de información, no dos servicios repetidos. Se fusionan por
// nombre normalizado ANTES de procesarlos, conservando el orden de la primera aparición.
function fusionarServiciosPorNombre(servicios: ParsedServiceRef[]): ParsedServiceRef[] {
  const resultado: ParsedServiceRef[] = []
  const indicePorNombre = new Map<string, number>()
  for (const ref of servicios) {
    const clave = ref.query ? normalizar(ref.query) : null
    const existenteIdx = clave != null ? indicePorNombre.get(clave) : undefined
    if (existenteIdx == null) {
      if (clave != null) indicePorNombre.set(clave, resultado.length)
      resultado.push({ ...ref, collaborators: [...ref.collaborators] })
      continue
    }
    const existente = resultado[existenteIdx]
    resultado[existenteIdx] = {
      ...existente,
      price: existente.price ?? ref.price,
      priceAmbiguous: existente.priceAmbiguous ?? ref.priceAmbiguous,
      professional: existente.professional ?? ref.professional,
      collaborators: [...existente.collaborators, ...ref.collaborators],
    }
  }
  return resultado
}

// --- Cliente ---------------------------------------------------------------------------------

async function procesarCliente(
  clienteRef: NonNullable<ParsedAttentionCommand['client']>,
  sesion: VoiceSessionState,
  deps: VoiceExecutionDeps,
): Promise<void> {
  if (clienteRef.createName) {
    sesion.draft = setClientePendienteCreacion(sesion.draft, clienteRef.createName, clienteRef.createPhone)
    if (sesion.draft.client.pendingName) {
      preguntarConfirmarCreacionCliente(sesion, deps)
    }
    return
  }

  const texto = clienteRef.query ?? clienteRef.phone
  if (!texto) return

  const resultado = await resolverCliente(texto)
  if (resultado.tipo === 'unica') {
    sesion.draft = setClienteResuelto(sesion.draft, resultado.item)
    return
  }
  if (resultado.tipo === 'aproximada') {
    sesion.draft = { ...sesion.draft, client: { status: 'needs_clarification', query: texto } }
    sesion.pendingClarification = {
      id: idTemporal(),
      field: 'client',
      question: `¿Es "${resultado.item.nombre}"${resultado.item.telefono ? ` (${ocultarTelefono(resultado.item.telefono)})` : ''}?`,
      options: [opcion('Sí', 'si'), opcion('No, buscar de nuevo', 'no')],
    }
    ;(sesion as any)._candidatoClientePendiente = resultado.item
    return
  }
  if (resultado.tipo === 'multiple') {
    sesion.draft = { ...sesion.draft, client: { status: 'needs_clarification', query: texto } }
    sesion.pendingClarification = {
      id: idTemporal(),
      field: 'client',
      question: `Encontré ${resultado.opciones.length} clientas parecidas a "${texto}". ¿Cuál es?`,
      options: resultado.opciones.map((o, i) => opcion(`${o.item.nombre} · ${ocultarTelefono(o.item.telefono)}`, String(i + 1))),
    }
    ;(sesion as any)._candidatosClientePendientes = resultado.opciones.map((o) => o.item)
    return
  }
  // Ninguna coincidencia: nunca se crea sola (puede ser un error de transcripción).
  sesion.draft = { ...sesion.draft, client: { status: 'needs_clarification', query: texto } }
  sesion.pendingClarification = {
    id: idTemporal(),
    field: 'client',
    question: `No encontré a nadie llamado "${texto}". ¿Buscamos de nuevo o creamos una clienta nueva?`,
    options: [opcion('Buscar de nuevo', 'buscar'), opcion('Crear clienta', 'crear')],
  }
  ;(sesion as any)._nombreClienteNoEncontrado = texto
}

function preguntarConfirmarCreacionCliente(sesion: VoiceSessionState, deps: VoiceExecutionDeps): void {
  void deps
  const datos = sesion.draft.client.status === 'pending_creation' ? sesion.draft.client : null
  if (!datos?.pendingName) return
  sesion.pendingClarification = {
    id: idTemporal(),
    field: 'create_client_confirm',
    question: `¿Creo a "${datos.pendingName}"${datos.pendingPhone ? ` con teléfono ${datos.pendingPhone}` : ' sin teléfono'}?`,
    options: [opcion('Sí, crear', 'si'), opcion('Editar', 'no')],
  }
}

function ocultarTelefono(telefono: string | null): string {
  if (!telefono) return 'sin teléfono'
  const digitos = telefono.replace(/\D/g, '')
  if (digitos.length < 5) return telefono
  return `${digitos.slice(0, 3)}${'*'.repeat(digitos.length - 5)}${digitos.slice(-2)}`
}

// --- Servicios --------------------------------------------------------------------------------

const MAX_COLABORADORES_POR_SERVICIO = 5

async function procesarServicio(
  ref: ParsedServiceRef,
  intent: ParsedAttentionCommand['intent'],
  sesion: VoiceSessionState,
  deps: VoiceExecutionDeps,
): Promise<void> {
  if (intent === 'REMOVE_SERVICE') return procesarQuitarServicioOProducto(ref, sesion, deps)

  // Intenciones de MODIFICACIÓN (colaborar/asignar profesional/actualizar) nombran el servicio
  // solo para UBICARLO entre los ya agregados al draft — nunca para crear una línea nueva. Solo
  // ADD_SERVICE/REGISTER_ATTENTION crean una línea nueva a partir del nombre dictado.
  const esModificacion = intent !== 'ADD_SERVICE' && intent !== 'REGISTER_ATTENTION' && intent !== 'UNKNOWN'
  if (esModificacion && ref.query) {
    const existente = buscarCoincidencias(ref.query, sesion.draft.services, (s) => s.displayName)
    if (existente.tipo === 'unica' || existente.tipo === 'aproximada') return aplicarDatosSobreServicio(existente.item, ref, sesion, deps)
    if (existente.tipo === 'multiple') return preguntarCualServicio(existente.opciones, sesion, (linea) => aplicarDatosSobreServicioSync(linea, ref, sesion))
    // Ninguna línea del draft calza con ese nombre: cae al flujo normal (podría ser un
    // servicio que aún no se había mencionado en esta atención).
  }

  if (!ref.query) {
    // Referencia implícita a un servicio ya existente (p. ej. colaborador sin nombre de
    // servicio en la frase): se resuelve contra el servicio activo del draft/contexto.
    const objetivo = resolverReferenciaServicio(undefined, sesion)
    if (objetivo.tipo === 'unica') return aplicarDatosSobreServicio(objetivo.item, ref, sesion, deps)
    if (objetivo.tipo === 'multiple') return preguntarCualServicio(objetivo.opciones, sesion, (linea) => aplicarDatosSobreServicioSync(linea, ref, sesion))
    return // nada que hacer si no hay ningún servicio en curso
  }

  const resultado = await resolverServicio(ref.query, deps.obtenerServicios())

  if (resultado.tipo === 'unica' || (resultado.tipo === 'aproximada' && resultado.puntaje >= 0.8)) {
    return crearLineaServicioDesdeResolucion(resultado.item, ref, sesion, deps)
  }
  if (resultado.tipo === 'aproximada') {
    sesion.pendingClarification = {
      id: idTemporal(),
      field: 'service',
      question: `No encontré un servicio llamado "${ref.query}". ¿Te refieres a "${resultado.item.nombre}"?`,
      options: [opcion('Sí', 'si'), opcion('No', 'no')],
    }
    ;(sesion as any)._servicioCandidatoPendiente = { servicio: resultado.item, ref }
    return
  }
  if (resultado.tipo === 'multiple') {
    sesion.pendingClarification = {
      id: idTemporal(),
      field: 'service',
      question: `Encontré varios servicios parecidos a "${ref.query}". ¿Cuál es?`,
      options: resultado.opciones.map((o, i) => opcion(o.item.nombre, String(i + 1))),
    }
    ;(sesion as any)._serviciosCandidatosPendientes = { candidatos: resultado.opciones.map((o) => o.item), ref }
    return
  }

  // Ninguna coincidencia en el catálogo real: ofrecer crear, si el rol lo permite.
  if (!deps.puedeCrearServicio) return
  sesion.pendingClarification = {
    id: idTemporal(),
    field: 'create_service_confirm',
    question: `No encontré "${ref.query}" en el catálogo. ¿Lo creo como servicio nuevo?`,
    options: [opcion('Sí, crear servicio', 'si'), opcion('No', 'no')],
  }
  ;(sesion as any)._servicioNuevoPendiente = ref
}

async function crearLineaServicioDesdeResolucion(servicio: Servicio, ref: ParsedServiceRef, sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<void> {
  const profesionalId = ref.professional?.professionalId ?? (ref.professional?.query ? await resolverIdProfesional(ref.professional.query, deps) : undefined)
  const necesitaConfirmarPrecio = (ref.priceAmbiguous || servicio.tipo_precio === 'desde' || servicio.tipo_precio === 'rango') && ref.price != null
  const necesitaImporte = ref.price == null && servicio.tipo_precio === 'a_valorar'

  if (necesitaImporte) {
    sesion.pendingClarification = { id: idTemporal(), field: 'service_price', question: `¿Cuánto se cobró por ${servicio.nombre}?`, options: [] }
    ;(sesion as any)._servicioEsperandoPrecio = { servicio, profesionalId }
    return
  }

  if (necesitaConfirmarPrecio) {
    const sugerido = ref.priceAmbiguous ? ref.price! : ref.price!
    sesion.pendingClarification = {
      id: idTemporal(),
      field: 'service_price',
      question:
        servicio.tipo_precio === 'a_valorar'
          ? `¿Cuánto se cobró por ${servicio.nombre}?`
          : `${servicio.nombre} tiene precio ${servicio.tipo_precio === 'rango' ? 'en rango' : 'desde'}. ¿Confirmas ${formatoCOP(sugerido)} como el precio cobrado?`,
      options: [opcion('Sí, confirmar', 'si'), opcion('Cambiar el valor', 'no')],
    }
    ;(sesion as any)._servicioEsperandoConfirmarPrecio = { servicio, profesionalId, precio: sugerido }
    return
  }

  const { draft, tempId } = agregarServicio(sesion.draft, {
    servicioId: servicio.id,
    displayName: servicio.nombre,
    price: ref.price ?? servicio.precio ?? undefined,
    priceStatus: 'confirmed',
    professionalId: profesionalId,
    professionalName: profesionalId ? deps.obtenerEquipo().find((p) => p.id === profesionalId)?.nombre : undefined,
  })
  sesion.draft = draft
  sesion.lastServiceId = tempId
  sesion.lastServiceQuery = servicio.nombre

  await procesarColaboradoresDeReferencia(ref, tempId, sesion, deps)
}

async function procesarColaboradoresDeReferencia(ref: ParsedServiceRef, servicioTempId: string, sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<void> {
  for (const colabRef of ref.collaborators) {
    await agregarColaboradorAServicio(servicioTempId, colabRef.query, colabRef.compensation, sesion, deps)
    if (sesion.pendingClarification) return
  }
}

async function agregarColaboradorAServicio(
  servicioTempId: string,
  nombreColaborador: string,
  compensacion: number | undefined,
  sesion: VoiceSessionState,
  deps: VoiceExecutionDeps,
): Promise<void> {
  const linea = sesion.draft.services.find((s) => s.tempId === servicioTempId)
  if (!linea) return
  if (linea.collaborators.length >= MAX_COLABORADORES_POR_SERVICIO) return

  const equipoDisponible = deps.obtenerEquipo().filter((p) => p.id !== linea.professionalId && !linea.collaborators.some((c) => c.employeeId === p.id))
  const resultado = await resolverProfesional(nombreColaborador, equipoDisponible)
  if (resultado.tipo === 'ninguna') return

  const continuarCon = (colaboradora: Profesional) => {
    if (compensacion != null) {
      sesion.draft = agregarColaborador(sesion.draft, servicioTempId, { employeeId: colaboradora.id, displayName: colaboradora.nombre, compensation: compensacion, compensationType: 'fixed' }).draft
      sesion.lastCollaboratorId = colaboradora.id
      sesion.lastCollaboratorQuery = colaboradora.nombre
    } else {
      sesion.pendingClarification = { id: idTemporal(), field: 'compensation', question: `¿Cuánto se le asigna a ${colaboradora.nombre} por colaborar en ${linea.displayName}?`, options: [] }
      ;(sesion as any)._colaboradorEsperandoCompensacion = { servicioTempId, colaboradora }
    }
  }

  if (resultado.tipo === 'multiple') {
    sesion.pendingClarification = {
      id: idTemporal(),
      field: 'collaborator',
      question: `¿Cuál "${nombreColaborador}"?`,
      options: resultado.opciones.map((o, i) => opcion(o.item.nombre, String(i + 1))),
    }
    ;(sesion as any)._colaboradoresCandidatosPendientes = { servicioTempId, candidatos: resultado.opciones.map((o) => o.item) }
    return
  }
  continuarCon(resultado.item)
}

async function procesarQuitarColaborador(
  datos: NonNullable<ParsedAttentionCommand['removeCollaborator']>,
  sesion: VoiceSessionState,
  deps: VoiceExecutionDeps,
): Promise<void> {
  void deps
  const objetivo = resolverReferenciaServicio(datos.serviceQuery ? { query: datos.serviceQuery } : undefined, sesion)
  const quitarDe = (linea: DraftServiceLine) => {
    const resultado = buscarCoincidencias(datos.collaboratorQuery, linea.collaborators, (c) => c.displayName)
    if (resultado.tipo === 'unica' || resultado.tipo === 'aproximada') {
      sesion.draft = quitarColaborador(sesion.draft, linea.tempId, resultado.item.tempId)
    }
  }
  if (objetivo.tipo === 'unica') return quitarDe(objetivo.item)
  if (objetivo.tipo === 'multiple') {
    // Busca en TODOS los servicios candidatos cuál tiene realmente a esa colaboradora, en vez
    // de preguntar "¿cuál servicio?" cuando el nombre de la colaboradora ya lo deja claro.
    const conEsaColaboradora = objetivo.opciones.filter((o) => o.item.collaborators.some((c) => buscarCoincidencias(datos.collaboratorQuery, [c], (x) => x.displayName).tipo !== 'ninguna'))
    if (conEsaColaboradora.length === 1) return quitarDe(conEsaColaboradora[0].item)
    preguntarCualServicio(objetivo.opciones, sesion, quitarDe)
  }
}

function aplicarDatosSobreServicioSync(linea: DraftServiceLine, ref: ParsedServiceRef, sesion: VoiceSessionState): void {
  void aplicarDatosSobreServicio(linea, ref, sesion, undefined as any)
}

async function aplicarDatosSobreServicio(linea: DraftServiceLine, ref: ParsedServiceRef, sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<void> {
  for (const colabRef of ref.collaborators) {
    await agregarColaboradorAServicio(linea.tempId, colabRef.query, colabRef.compensation, sesion, deps)
    if (sesion.pendingClarification) return
  }
  if (ref.price != null) {
    sesion.draft = actualizarServicio(sesion.draft, linea.tempId, { price: ref.price })
  }
}

async function resolverIdProfesional(texto: string, deps: VoiceExecutionDeps): Promise<string | undefined> {
  const resultado = await resolverProfesional(texto, deps.obtenerEquipo())
  if (resultado.tipo === 'unica') return resultado.item.id
  if (resultado.tipo === 'aproximada' && resultado.puntaje >= 0.75) return resultado.item.id
  return undefined
}

function resolverReferenciaServicio(ref: { query?: string; ordinal?: number; refersToLast?: boolean } | undefined, sesion: VoiceSessionState) {
  const principales = sesion.draft.services
  if (ref?.ordinal) {
    const l = principales[ref.ordinal - 1]
    return l ? ({ tipo: 'unica', item: l } as const) : ({ tipo: 'ninguna' } as const)
  }
  if (ref?.refersToLast) {
    const l = servicioMasReciente(sesion.draft)
    return l ? ({ tipo: 'unica', item: l } as const) : ({ tipo: 'ninguna' } as const)
  }
  if (ref?.query) {
    return buscarCoincidencias(ref.query, principales, (s) => s.displayName)
  }
  if (principales.length === 1) return { tipo: 'unica', item: principales[0] } as const
  const activo = principales.find((s) => s.tempId === sesion.lastServiceId)
  if (activo) return { tipo: 'unica', item: activo } as const
  if (principales.length === 0) return { tipo: 'ninguna' } as const
  return { tipo: 'multiple', opciones: principales.map((s) => ({ item: s, puntaje: 1 })) } as const
}

function preguntarCualServicio(opciones: { item: DraftServiceLine; puntaje: number }[], sesion: VoiceSessionState, onResolver: (linea: DraftServiceLine) => void): void {
  sesion.pendingClarification = {
    id: idTemporal(),
    field: 'service',
    question: `¿Cuál servicio? ${opciones.map((o) => o.item.displayName).join(' / ')}`,
    options: opciones.map((o, i) => opcion(o.item.displayName, String(i + 1))),
  }
  ;(sesion as any)._resolverServicioActivo = { opciones: opciones.map((o) => o.item), onResolver }
}

// --- Productos --------------------------------------------------------------------------------

async function procesarProducto(ref: ParsedAttentionCommand['products'][number], intent: ParsedAttentionCommand['intent'], sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<void> {
  if (intent === 'REMOVE_SERVICE' || intent === 'REMOVE_PRODUCT') return procesarQuitarServicioOProducto(ref, sesion, deps)
  if (!ref.query) return

  const resultado = await resolverProducto(ref.query, deps.obtenerProductos())
  if (resultado.tipo === 'unica' || (resultado.tipo === 'aproximada' && resultado.puntaje >= 0.8)) {
    const p = resultado.tipo === 'unica' ? resultado.item : resultado.item
    const { draft } = agregarProducto(sesion.draft, { productId: p.id, displayName: p.nombre, quantity: ref.quantity ?? 1, price: ref.price ?? p.precio ?? undefined })
    sesion.draft = draft
    return
  }
  if (resultado.tipo === 'multiple') {
    sesion.pendingClarification = {
      id: idTemporal(),
      field: 'service',
      question: `Encontré varios productos parecidos a "${ref.query}". ¿Cuál es?`,
      options: resultado.opciones.map((o, i) => opcion(o.item.nombre, String(i + 1))),
    }
    ;(sesion as any)._productosCandidatosPendientes = { candidatos: resultado.opciones.map((o) => o.item), ref }
    return
  }
  if (!deps.puedeCrearProducto) return
  sesion.pendingClarification = {
    id: idTemporal(),
    field: 'create_service_confirm',
    question: `No encontré "${ref.query}" en el catálogo de productos. ¿Lo agrego igual con ese nombre?`,
    options: [opcion('Sí', 'si'), opcion('No', 'no')],
  }
  ;(sesion as any)._productoNuevoPendiente = ref
}

async function procesarQuitarServicioOProducto(ref: { query?: string; ordinal?: number; refersToLast?: boolean }, sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<void> {
  void deps
  const resultadoServicio = resolverReferenciaServicio(ref, sesion)
  if (resultadoServicio.tipo === 'unica') {
    sesion.draft = quitarServicio(sesion.draft, resultadoServicio.item.tempId)
    return
  }
  if (resultadoServicio.tipo === 'multiple') {
    preguntarCualServicio(resultadoServicio.opciones, sesion, (l) => { sesion.draft = quitarServicio(sesion.draft, l.tempId) })
    return
  }
  if (ref.query) {
    const resultadoProducto = buscarCoincidencias(ref.query, sesion.draft.products, (p) => `${p.displayName}`.trim())
    if (resultadoProducto.tipo === 'unica' || resultadoProducto.tipo === 'aproximada') {
      sesion.draft = quitarProducto(sesion.draft, resultadoProducto.item.tempId)
      return
    }
    if (resultadoProducto.tipo === 'multiple') {
      sesion.pendingClarification = {
        id: idTemporal(),
        field: 'service',
        question: '¿Cuál producto quitar?',
        options: resultadoProducto.opciones.map((o, i) => opcion(o.item.displayName, String(i + 1))),
      }
      ;(sesion as any)._productosParaQuitarPendientes = resultadoProducto.opciones.map((o) => o.item)
    }
  }
}

// --- Correcciones -----------------------------------------------------------------------------

async function procesarCorreccion(correccion: VoiceCorrection, sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<void> {
  switch (correccion.field) {
    case 'service_price': {
      const objetivo = resolverReferenciaServicio(correccion.targetQuery ? { query: correccion.targetQuery } : undefined, sesion)
      if (objetivo.tipo === 'unica') {
        sesion.draft = actualizarServicio(sesion.draft, objetivo.item.tempId, { price: correccion.value as number })
      } else if (objetivo.tipo === 'multiple') {
        preguntarCualServicio(objetivo.opciones, sesion, (l) => { sesion.draft = actualizarServicio(sesion.draft, l.tempId, { price: correccion.value as number }) })
      }
      return
    }
    case 'service_professional': {
      const objetivo = resolverReferenciaServicio(correccion.targetQuery ? { query: correccion.targetQuery } : undefined, sesion)
      const nombreProf = String(correccion.value)
      if (objetivo.tipo === 'unica') {
        const idProf = await resolverIdProfesional(nombreProf, deps)
        sesion.draft = actualizarServicio(sesion.draft, objetivo.item.tempId, { professionalId: idProf, professionalName: nombreProf })
      } else if (objetivo.tipo === 'multiple') {
        preguntarCualServicio(objetivo.opciones, sesion, async (l) => {
          const idProf = await resolverIdProfesional(nombreProf, deps)
          sesion.draft = actualizarServicio(sesion.draft, l.tempId, { professionalId: idProf, professionalName: nombreProf })
        })
      }
      return
    }
    case 'collaborator_compensation': {
      const servicioTempId = sesion.lastServiceId
      const colaboradorId = sesion.lastCollaboratorId
      if (!servicioTempId || !colaboradorId) return
      const linea = sesion.draft.services.find((s) => s.tempId === servicioTempId)
      const colaborador = linea?.collaborators.find((c) => c.employeeId === colaboradorId)
      if (!colaborador) return
      sesion.draft = actualizarColaborador(sesion.draft, servicioTempId, colaborador.tempId, { compensation: correccion.value as number })
      return
    }
    default:
      return
  }
}

// --- Respuesta a una aclaración pendiente ----------------------------------------------------

async function intentarResponderClarificacion(texto: string, sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<boolean> {
  const pregunta = sesion.pendingClarification
  if (!pregunta) return false

  let valor: string | null = null
  if (pregunta.options.length > 0) {
    const idx = resolverIndiceDeSeleccion(texto, pregunta.options.length)
    if (idx != null) valor = pregunta.options[idx].value
    else {
      const coincidencia = buscarCoincidencias(texto, pregunta.options, (o) => o.label)
      if (coincidencia.tipo === 'unica' || coincidencia.tipo === 'aproximada') valor = coincidencia.item.value
    }
    if (valor == null) return false
  } else {
    valor = texto.trim()
  }

  sesion.pendingClarification = null
  await aplicarRespuestaClarificacion(pregunta, valor, sesion, deps)
  return true
}

function resolverIndiceDeSeleccion(seleccion: string, cantidad: number): number | null {
  const s = seleccion.trim().toLowerCase()
  const num = Number(s)
  if (!Number.isNaN(num) && Number.isInteger(num) && num >= 1 && num <= cantidad) return num - 1
  const ordinal = ORDINALES[s]
  if (ordinal && ordinal > 0 && ordinal <= cantidad) return ordinal - 1
  return null
}

async function aplicarRespuestaClarificacion(pregunta: PendingClarification, valor: string, sesion: VoiceSessionState, deps: VoiceExecutionDeps): Promise<void> {
  const s = sesion as any
  const afirmativo = valor.toLowerCase() === 'si' || valor.toLowerCase() === 'sí'

  switch (pregunta.field) {
    case 'client': {
      if (s._candidatoClientePendiente) {
        if (afirmativo) sesion.draft = setClienteResuelto(sesion.draft, s._candidatoClientePendiente)
        delete s._candidatoClientePendiente
        return
      }
      if (s._candidatosClientePendientes) {
        const idx = Number(valor) - 1
        const elegido = s._candidatosClientePendientes[idx]
        if (elegido) sesion.draft = setClienteResuelto(sesion.draft, elegido)
        delete s._candidatosClientePendientes
        return
      }
      if (s._nombreClienteNoEncontrado) {
        if (valor === 'crear') {
          sesion.draft = setClientePendienteCreacion(sesion.draft, s._nombreClienteNoEncontrado)
          preguntarConfirmarCreacionCliente(sesion, deps)
        }
        delete s._nombreClienteNoEncontrado
        return
      }
      return
    }
    case 'create_client_confirm': {
      if (afirmativo && sesion.draft.client.status === 'pending_creation') {
        const nombre = sesion.draft.client.pendingName!
        const telefono = sesion.draft.client.pendingPhone ?? null
        const nuevo = await deps.crearClienteRapido({ nombre, telefono })
        sesion.draft = setClienteResuelto(sesion.draft, { id: nuevo.id, nombre: nuevo.nombre, telefono: nuevo.telefono }, true)
      }
      return
    }
    case 'service': {
      if (s._servicioCandidatoPendiente) {
        const { servicio, ref } = s._servicioCandidatoPendiente
        if (afirmativo) await crearLineaServicioDesdeResolucion(servicio, ref, sesion, deps)
        delete s._servicioCandidatoPendiente
        return
      }
      if (s._serviciosCandidatosPendientes) {
        const { candidatos, ref } = s._serviciosCandidatosPendientes
        const idx = Number(valor) - 1
        const elegido = candidatos[idx]
        if (elegido) await crearLineaServicioDesdeResolucion(elegido, ref, sesion, deps)
        delete s._serviciosCandidatosPendientes
        return
      }
      if (s._resolverServicioActivo) {
        const { opciones, onResolver } = s._resolverServicioActivo
        const idx = Number(valor) - 1
        const elegido = opciones[idx]
        if (elegido) onResolver(elegido)
        delete s._resolverServicioActivo
        return
      }
      if (s._productosCandidatosPendientes) {
        const { candidatos, ref } = s._productosCandidatosPendientes
        const idx = Number(valor) - 1
        const elegido = candidatos[idx]
        if (elegido) sesion.draft = agregarProducto(sesion.draft, { productId: elegido.id, displayName: elegido.nombre, quantity: ref.quantity ?? 1, price: ref.price ?? elegido.precio ?? undefined }).draft
        delete s._productosCandidatosPendientes
        return
      }
      if (s._productosParaQuitarPendientes) {
        const idx = Number(valor) - 1
        const elegido = s._productosParaQuitarPendientes[idx]
        if (elegido) sesion.draft = quitarProducto(sesion.draft, elegido.tempId)
        delete s._productosParaQuitarPendientes
        return
      }
      return
    }
    case 'create_service_confirm': {
      if (s._servicioNuevoPendiente) {
        const ref = s._servicioNuevoPendiente
        if (afirmativo) {
          const nuevo = await deps.crearServicioRapido(ref.query)
          await crearLineaServicioDesdeResolucion(nuevo, ref, sesion, deps)
        }
        delete s._servicioNuevoPendiente
        return
      }
      if (s._productoNuevoPendiente) {
        const ref = s._productoNuevoPendiente
        if (afirmativo) {
          const nuevo = await deps.crearProductoRapido(ref.query)
          sesion.draft = agregarProducto(sesion.draft, { productId: nuevo.id, displayName: nuevo.nombre, quantity: ref.quantity ?? 1, price: ref.price ?? undefined }).draft
        }
        delete s._productoNuevoPendiente
        return
      }
      return
    }
    case 'service_price': {
      if (s._servicioEsperandoPrecio) {
        const { servicio, profesionalId } = s._servicioEsperandoPrecio
        const monto = extraerMonto(valor)
        if (monto) {
          await crearLineaServicioDesdeResolucion(servicio, { price: monto.ambiguo ? monto.valorSugerido : monto.valor, priceAmbiguous: monto.ambiguo, professional: profesionalId ? { professionalId: profesionalId } : undefined, collaborators: [] }, sesion, deps)
        }
        delete s._servicioEsperandoPrecio
        return
      }
      if (s._servicioEsperandoConfirmarPrecio) {
        const { servicio, profesionalId, precio } = s._servicioEsperandoConfirmarPrecio
        if (afirmativo) {
          const { draft, tempId } = agregarServicio(sesion.draft, { servicioId: servicio.id, displayName: servicio.nombre, price: precio, priceStatus: 'confirmed', professionalId: profesionalId })
          sesion.draft = draft
          sesion.lastServiceId = tempId
          sesion.lastServiceQuery = servicio.nombre
        }
        delete s._servicioEsperandoConfirmarPrecio
        return
      }
      return
    }
    case 'collaborator': {
      if (s._colaboradoresCandidatosPendientes) {
        const { servicioTempId, candidatos } = s._colaboradoresCandidatosPendientes
        const idx = Number(valor) - 1
        const elegido = candidatos[idx]
        if (elegido) {
          sesion.pendingClarification = { id: idTemporal(), field: 'compensation', question: `¿Cuánto se le asigna a ${elegido.nombre}?`, options: [] }
          ;(sesion as any)._colaboradorEsperandoCompensacion = { servicioTempId, colaboradora: elegido }
        }
        delete s._colaboradoresCandidatosPendientes
      }
      return
    }
    case 'compensation': {
      if (s._colaboradorEsperandoCompensacion) {
        const { servicioTempId, colaboradora } = s._colaboradorEsperandoCompensacion
        const monto = extraerMonto(valor)
        if (monto && (monto.valor > 0 || monto.valorSugerido)) {
          const valorFinal = monto.ambiguo ? monto.valorSugerido! : monto.valor
          sesion.draft = agregarColaborador(sesion.draft, servicioTempId, { employeeId: colaboradora.id, displayName: colaboradora.nombre, compensation: valorFinal, compensationType: 'fixed' }).draft
          sesion.lastCollaboratorId = colaboradora.id
          sesion.lastCollaboratorQuery = colaboradora.nombre
        }
        delete s._colaboradorEsperandoCompensacion
      }
      return
    }
  }
}

function formatoCOP(valor: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor)
}

export { totalDraft }
