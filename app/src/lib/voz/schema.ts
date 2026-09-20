// Schema tipado del intérprete de comandos de voz. Esta es la ÚNICA forma en la que el
// intérprete puede comunicarse con el resto del sistema: nunca texto libre, nunca SQL, nunca
// código — solo estos tipos. Si en el futuro se conecta un proveedor de IA con structured
// output, debe devolver exactamente esta forma (ver CommandInterpreter.ts).

/** Fila del catálogo real de productos (migración 0044) — no existía antes del asistente de
 * voz; ver docs de entrega para por qué se creó. */
export interface Producto {
  id: string
  nombre: string
  categoria: string | null
  precio: number | null
  activo?: boolean
}

export type VoiceIntent =
  | 'REGISTER_ATTENTION'
  | 'FIND_CLIENT'
  | 'CREATE_CLIENT'
  | 'ADD_SERVICE'
  | 'REMOVE_SERVICE'
  | 'UPDATE_SERVICE'
  | 'ADD_PRODUCT'
  | 'REMOVE_PRODUCT'
  | 'SET_PROFESSIONAL'
  | 'ADD_COLLABORATOR'
  | 'REMOVE_COLLABORATOR'
  | 'UPDATE_COLLABORATOR_COMPENSATION'
  | 'ADD_NOTE'
  | 'CONFIRM'
  | 'CANCEL'
  | 'UNDO'
  | 'UNKNOWN'

export type CompensationType = 'fixed' | 'percentage'

export interface ParsedClientRef {
  query?: string
  phone?: string
  id?: string
  /** Solo presente en CREATE_CLIENT: datos dictados explícitamente para el alta. */
  createName?: string
  createPhone?: string
}

export interface ParsedProfessionalRef {
  query?: string
  professionalId?: string
}

export interface ParsedCollaboratorRef {
  query: string
  employeeId?: string
  compensation?: number
  compensationAmbiguous?: boolean
  compensationType?: CompensationType
}

export interface ParsedServiceRef {
  /** Cómo se referencia el servicio dentro de esta expresión (nunca los dos a la vez). */
  query?: string
  ordinal?: number
  refersToLast?: boolean
  serviceId?: string
  price?: number
  priceAmbiguous?: boolean
  professional?: ParsedProfessionalRef
  collaborators: ParsedCollaboratorRef[]
}

export interface ParsedProductRef {
  query?: string
  ordinal?: number
  refersToLast?: boolean
  productId?: string
  quantity?: number
  price?: number
}

export type CorrectionField =
  | 'client'
  | 'service_name'
  | 'service_price'
  | 'service_professional'
  | 'collaborator_compensation'
  | 'collaborator_name'
  | 'notes'

export interface VoiceCorrection {
  field: CorrectionField
  value: string | number
  /** Referencia explícita del objetivo si la persona la dio ("el precio DEL BLOWER a 50 mil");
   * si falta, se resuelve contra VoiceSessionContext (lastServiceId, lastCollaboratorId, …). */
  targetQuery?: string
}

/**
 * Resultado completo de interpretar UNA expresión hablada o escrita. Una sola expresión puede
 * describir varias piezas de una misma atención (cliente + servicios + productos) — eso NO son
 * "múltiples comandos desconectados", es una intención compuesta (REGISTER_ATTENTION) con varias
 * partes. `services`/`products` normalmente tienen 0-1 elementos salvo en REGISTER_ATTENTION.
 */
export interface ParsedAttentionCommand {
  utteranceId: string
  rawText: string
  normalizedText: string
  intent: VoiceIntent
  client?: ParsedClientRef
  services: ParsedServiceRef[]
  products: ParsedProductRef[]
  corrections: VoiceCorrection[]
  /** "Quita a Ana del blower" (sección 12): a diferencia de REMOVE_SERVICE/REMOVE_PRODUCT, esto
   * quita solo a una colaboradora de un servicio, sin tocar el servicio en sí. */
  removeCollaborator?: { collaboratorQuery: string; serviceQuery?: string }
  notes?: string
  /** 0-1: qué tan segura está la interpretación GRAMATICAL (no la resolución de entidades,
   * que es responsabilidad de EntityResolver). Baja confianza → se ofrece como aclaración. */
  confidence: number
  missingFields: string[]
  ambiguities: string[]
}

// --- Interfaz desacoplada del intérprete --------------------------------------------------
// Cualquier implementación (determinista hoy, un proveedor de IA con structured output mañana)
// debe cumplir este contrato. Nunca se ejecuta nada a partir de su resultado sin pasar por
// EntityResolver + validación + confirmación explícita.
export interface CommandInterpreter {
  interpret(input: InterpreterInput): Promise<ParsedAttentionCommand> | ParsedAttentionCommand
}

export interface InterpreterInput {
  utteranceId: string
  text: string
  /** Contexto conversacional para resolver referencias ("Ana colaboró Y SE GANA diez mil",
   * luego "no, fueron quince mil" sin repetir a quién). Ver VoiceSessionContext.ts. */
  context: InterpreterContextSnapshot
}

/** Lo mínimo del contexto de sesión que el intérprete necesita leer (nunca lo muta él mismo). */
export interface InterpreterContextSnapshot {
  hasClient: boolean
  lastServiceQuery?: string
  lastCollaboratorQuery?: string
  pendingQuestionField?: CorrectionField | 'client' | 'service' | 'compensation'
}

// --- AttentionDraft: el estado acumulado ANTES de escribir nada en Supabase ------------------

export type DraftClientStatus = 'none' | 'searching' | 'needs_clarification' | 'pending_creation' | 'resolved'

export interface DraftClient {
  status: DraftClientStatus
  query?: string
  pendingName?: string
  pendingPhone?: string
  resolved?: {
    id: string
    nombre: string
    telefono: string | null
    isNew: boolean
  }
}

export interface DraftCollaborator {
  tempId: string
  query: string
  employeeId?: string
  displayName: string
  compensation?: number
  compensationType?: CompensationType
  resolved: boolean
}

export type DraftPriceStatus = 'confirmed' | 'needs_confirmation' | 'missing'

export interface DraftServiceLine {
  tempId: string
  query: string
  serviceId?: string
  displayName: string
  price?: number
  priceStatus: DraftPriceStatus
  professionalId?: string
  professionalName?: string
  collaborators: DraftCollaborator[]
  resolved: boolean
}

export interface DraftProductLine {
  tempId: string
  query: string
  productId?: string
  displayName: string
  quantity: number
  price?: number
  resolved: boolean
}

export interface AttentionDraft {
  id: string
  client: DraftClient
  services: DraftServiceLine[]
  products: DraftProductLine[]
  notes: string
  createdAt: string
  updatedAt: string
}

export interface ClarificationOption {
  label: string
  value: string
}

export interface PendingClarification {
  id: string
  question: string
  /** Vacío = pregunta abierta (espera un valor libre: un precio, un teléfono, un nombre). */
  options: ClarificationOption[]
  field: CorrectionField | 'client' | 'service' | 'collaborator' | 'compensation' | 'create_client_confirm' | 'create_service_confirm'
}
