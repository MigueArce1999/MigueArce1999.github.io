// Logging de desarrollo del asistente de voz (sección 21 del pedido): utteranceId, transcripts,
// intención/entidades interpretadas, confianza, ambigüedades, resultado de ejecución y tiempo de
// procesamiento — para depurar y mejorar el intérprete. NUNCA se muestra en la interfaz de la
// empleada (eso vive en components/voz/*, que solo lee el AttentionDraft y la aclaración
// pendiente, jamás estos registros). Solo va a la consola del navegador, nunca a un backend de
// analítica ni a ningún lugar donde pudiera acabar en un reporte — la transcripción es
// potencialmente información personal de la clienta (su nombre, a veces su teléfono).

export interface RegistroTurnoVoz {
  utteranceId: string
  rawTranscript: string
  normalizedTranscript?: string
  parsedIntent?: string
  parsedEntities?: unknown
  resolvedEntities?: unknown
  confidence?: number
  ambiguities?: string[]
  clarification?: string
  executionResult?: string
  processingTime?: number
}

// Se puede desactivar por completo (p. ej. en producción) sin tocar cada punto de llamada.
let habilitado = typeof window !== 'undefined' && (window as any).__VOZ_DEBUG__ !== false

export function activarLogVoz(valor: boolean) {
  habilitado = valor
}

export function logTurnoVoz(registro: RegistroTurnoVoz): void {
  if (!habilitado) return
  // console.debug (no .log): se puede filtrar fácil en devtools y no ensucia el log general.
  // eslint-disable-next-line no-console
  console.debug('[voz]', registro)
}
