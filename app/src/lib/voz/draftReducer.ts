// Operaciones puras sobre un AttentionDraft: cada función recibe un draft y devuelve uno NUEVO
// (nunca muta el original), lo que hace trivial guardar un snapshot antes de cada instrucción
// para "deshaz lo último" (ver VoiceSessionContext.guardarSnapshotDeshacer). Nunca tocan
// Supabase — eso ya pasó (resolución) o pasará (ejecución), nunca aquí.

import type { AttentionDraft, DraftClient, DraftCollaborator, DraftPriceStatus, DraftProductLine, DraftServiceLine } from './schema'

function idTemporal(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function tocar(): Pick<AttentionDraft, 'updatedAt'> {
  return { updatedAt: new Date().toISOString() }
}

export function setClienteResuelto(draft: AttentionDraft, cliente: { id: string; nombre: string; telefono: string | null }, esNuevo = false): AttentionDraft {
  const resuelto: DraftClient = { status: 'resolved', resolved: { ...cliente, isNew: esNuevo } }
  return { ...draft, client: resuelto, ...tocar() }
}

export function setClienteBuscando(draft: AttentionDraft, query: string): AttentionDraft {
  return { ...draft, client: { status: 'searching', query }, ...tocar() }
}

export function setClientePendienteCreacion(draft: AttentionDraft, nombre?: string, telefono?: string): AttentionDraft {
  const actual = draft.client.status === 'pending_creation' ? draft.client : { status: 'pending_creation' as const }
  return {
    ...draft,
    client: { ...actual, status: 'pending_creation', pendingName: nombre ?? actual.pendingName, pendingPhone: telefono ?? actual.pendingPhone },
    ...tocar(),
  }
}

export function limpiarCliente(draft: AttentionDraft): AttentionDraft {
  return { ...draft, client: { status: 'none' }, ...tocar() }
}

interface DatosNuevoServicio {
  servicioId?: string
  displayName: string
  price?: number
  priceStatus: DraftPriceStatus
  professionalId?: string
  professionalName?: string
}

// Si la única línea de servicio del borrador está completamente vacía (el estado inicial antes
// de decir nada), se completa esa misma línea en vez de sumar una tarjeta vacía debajo —mismo
// criterio que ya usaba el asistente MVP anterior, ahora aplicado al AttentionDraft.
function lineaVaciaReutilizable(draft: AttentionDraft): DraftServiceLine | null {
  if (draft.services.length !== 1) return null
  const unica = draft.services[0]
  return !unica.serviceId && unica.price == null && unica.collaborators.length === 0 ? unica : null
}

export function agregarServicio(draft: AttentionDraft, datos: DatosNuevoServicio): { draft: AttentionDraft; tempId: string } {
  const reutilizable = lineaVaciaReutilizable(draft)
  const nueva: DraftServiceLine = {
    tempId: reutilizable?.tempId ?? idTemporal(),
    query: datos.displayName,
    serviceId: datos.servicioId,
    displayName: datos.displayName,
    price: datos.price,
    priceStatus: datos.priceStatus,
    professionalId: datos.professionalId,
    professionalName: datos.professionalName,
    collaborators: reutilizable?.collaborators ?? [],
    resolved: !!datos.servicioId,
  }
  const services = reutilizable ? draft.services.map((s) => (s.tempId === nueva.tempId ? nueva : s)) : [...draft.services, nueva]
  return { draft: { ...draft, services, ...tocar() }, tempId: nueva.tempId }
}

export function actualizarServicio(draft: AttentionDraft, tempId: string, cambios: Partial<DraftServiceLine>): AttentionDraft {
  return {
    ...draft,
    services: draft.services.map((s) => (s.tempId === tempId ? { ...s, ...cambios } : s)),
    ...tocar(),
  }
}

export function quitarServicio(draft: AttentionDraft, tempId: string): AttentionDraft {
  return { ...draft, services: draft.services.filter((s) => s.tempId !== tempId), ...tocar() }
}

export function agregarColaborador(
  draft: AttentionDraft,
  servicioTempId: string,
  datos: { employeeId?: string; displayName: string; compensation?: number; compensationType?: DraftCollaborator['compensationType'] },
): { draft: AttentionDraft; tempId: string } {
  const tempId = idTemporal()
  const colaborador: DraftCollaborator = {
    tempId,
    query: datos.displayName,
    employeeId: datos.employeeId,
    displayName: datos.displayName,
    compensation: datos.compensation,
    compensationType: datos.compensationType,
    resolved: !!datos.employeeId,
  }
  return {
    draft: {
      ...draft,
      services: draft.services.map((s) => (s.tempId === servicioTempId ? { ...s, collaborators: [...s.collaborators, colaborador] } : s)),
      ...tocar(),
    },
    tempId,
  }
}

export function actualizarColaborador(
  draft: AttentionDraft,
  servicioTempId: string,
  colaboradorTempId: string,
  cambios: Partial<DraftCollaborator>,
): AttentionDraft {
  return {
    ...draft,
    services: draft.services.map((s) =>
      s.tempId !== servicioTempId
        ? s
        : { ...s, collaborators: s.collaborators.map((c) => (c.tempId === colaboradorTempId ? { ...c, ...cambios } : c)) },
    ),
    ...tocar(),
  }
}

export function quitarColaborador(draft: AttentionDraft, servicioTempId: string, colaboradorTempId: string): AttentionDraft {
  return {
    ...draft,
    services: draft.services.map((s) =>
      s.tempId !== servicioTempId ? s : { ...s, collaborators: s.collaborators.filter((c) => c.tempId !== colaboradorTempId) },
    ),
    ...tocar(),
  }
}

interface DatosNuevoProducto {
  productId?: string
  displayName: string
  quantity?: number
  price?: number
}

export function agregarProducto(draft: AttentionDraft, datos: DatosNuevoProducto): { draft: AttentionDraft; tempId: string } {
  const tempId = idTemporal()
  const nuevo: DraftProductLine = {
    tempId,
    query: datos.displayName,
    productId: datos.productId,
    displayName: datos.displayName,
    quantity: datos.quantity ?? 1,
    price: datos.price,
    resolved: !!datos.productId,
  }
  return { draft: { ...draft, products: [...draft.products, nuevo], ...tocar() }, tempId }
}

export function actualizarProducto(draft: AttentionDraft, tempId: string, cambios: Partial<DraftProductLine>): AttentionDraft {
  return { ...draft, products: draft.products.map((p) => (p.tempId === tempId ? { ...p, ...cambios } : p)), ...tocar() }
}

export function quitarProducto(draft: AttentionDraft, tempId: string): AttentionDraft {
  return { ...draft, products: draft.products.filter((p) => p.tempId !== tempId), ...tocar() }
}

export function agregarNota(draft: AttentionDraft, texto: string): AttentionDraft {
  const notas = draft.notes.trim() ? `${draft.notes}\n${texto}` : texto
  return { ...draft, notes: notas, ...tocar() }
}

// --- Consultas de solo lectura sobre el draft, usadas por la UI y por el resolutor de
// referencias ("el segundo servicio", "el último", el servicio/colaborador "activo"). ---

export function servicioMasReciente(draft: AttentionDraft): DraftServiceLine | null {
  return draft.services.length > 0 ? draft.services[draft.services.length - 1] : null
}

export function draftEstaCompleto(draft: AttentionDraft): boolean {
  const clienteOk = draft.client.status === 'resolved'
  const serviciosOk = draft.services.length > 0 && draft.services.every((s) => s.resolved && s.price != null && s.professionalId)
  return clienteOk && serviciosOk
}

export function totalDraft(draft: AttentionDraft): number {
  const totalServicios = draft.services.reduce((acc, s) => acc + (s.price ?? 0) + s.collaborators.reduce((a, c) => a + (c.compensation ?? 0), 0), 0)
  const totalProductos = draft.products.reduce((acc, p) => acc + p.quantity * (p.price ?? 0), 0)
  return totalServicios + totalProductos
}
