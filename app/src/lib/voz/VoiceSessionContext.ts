// Memoria conversacional del asistente de voz. Vive mientras el panel está abierto; se
// descarta al cerrarlo o confirmar la atención (nunca persiste entre sesiones). Es lo que
// permite que "Ana colaboró y se gana diez mil" y luego "No, fueron quince mil" se entiendan
// como una corrección sobre lo YA dicho, en vez de una instrucción nueva y desconectada.

import type { AttentionDraft, CorrectionField, InterpreterContextSnapshot, PendingClarification } from './schema'

export interface DraftSnapshot {
  draft: AttentionDraft
  description: string
}

export interface VoiceSessionState {
  draft: AttentionDraft
  lastServiceId: string | null
  lastServiceQuery: string | null
  lastProductId: string | null
  lastCollaboratorId: string | null
  lastCollaboratorQuery: string | null
  lastModifiedField: CorrectionField | null
  pendingClarification: PendingClarification | null
  /** Pila de estados previos del draft, uno por instrucción que sí cambió algo — "deshaz lo
   * último" saca el tope y restaura ese draft completo (el draft es descartable hasta que se
   * confirma, así que un deshacer de draft es mucho más simple que el deshacer quirúrgico que
   * necesita el formulario manual una vez los cambios ya están aplicados). */
  undoStack: DraftSnapshot[]
  idsProcesados: Set<string>
}

function idTemporal(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function crearDraftVacio(): AttentionDraft {
  const ahora = new Date().toISOString()
  return {
    id: idTemporal(),
    client: { status: 'none' },
    services: [],
    products: [],
    notes: '',
    createdAt: ahora,
    updatedAt: ahora,
  }
}

export function crearSesionVoz(): VoiceSessionState {
  return {
    draft: crearDraftVacio(),
    lastServiceId: null,
    lastServiceQuery: null,
    lastProductId: null,
    lastCollaboratorId: null,
    lastCollaboratorQuery: null,
    lastModifiedField: null,
    pendingClarification: null,
    undoStack: [],
    idsProcesados: new Set(),
  }
}

/** Lo que el intérprete puede leer del contexto (nunca lo muta directamente). */
export function snapshotParaInterprete(estado: VoiceSessionState): InterpreterContextSnapshot {
  return {
    hasClient: estado.draft.client.status === 'resolved' || estado.draft.client.status === 'pending_creation',
    lastServiceQuery: estado.lastServiceQuery ?? undefined,
    lastCollaboratorQuery: estado.lastCollaboratorQuery ?? undefined,
    pendingQuestionField: estado.pendingClarification?.field as InterpreterContextSnapshot['pendingQuestionField'],
  }
}

export function guardarSnapshotDeshacer(estado: VoiceSessionState, descripcion: string) {
  estado.undoStack.push({ draft: estado.draft, description: descripcion })
  if (estado.undoStack.length > 20) estado.undoStack.shift()
}

/** Restaura el draft anterior; devuelve la descripción de lo deshecho, o null si no hay nada. */
export function deshacerUltimoDraft(estado: VoiceSessionState): string | null {
  const anterior = estado.undoStack.pop()
  if (!anterior) return null
  estado.draft = anterior.draft
  return anterior.description
}

export function reiniciarSesionVoz(estado: VoiceSessionState) {
  estado.draft = crearDraftVacio()
  estado.lastServiceId = null
  estado.lastServiceQuery = null
  estado.lastProductId = null
  estado.lastCollaboratorId = null
  estado.lastCollaboratorQuery = null
  estado.lastModifiedField = null
  estado.pendingClarification = null
  estado.undoStack = []
}
