// Retroalimentación de las etapas finales del pipeline (EXECUTION, sección 20): guardando /
// éxito / error. Nunca muestra el mensaje técnico crudo de una excepción de red — `error` ya
// llega convertido a un texto pensado para la empleada (ver useVoiceRegistration).

import type { EstadoRegistroVoz } from '../../lib/voz/useVoiceRegistration'

export function VoiceConfirmation({
  fase,
  mensaje,
  error,
}: {
  fase: EstadoRegistroVoz
  mensaje: string | null
  error: string | null
}) {
  if (fase === 'SAVING') {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-champan/20 px-3 py-2 text-sm font-medium text-carbon">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
        Guardando la atención…
      </p>
    )
  }
  if (fase === 'SUCCESS') {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-oliva/10 px-3 py-2 text-sm font-medium text-oliva">
        <span aria-hidden>🎉</span> {mensaje || 'Atención registrada correctamente.'}
      </p>
    )
  }
  if (fase === 'ERROR') {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-error/10 px-3 py-2 text-sm font-medium text-error">
        <span aria-hidden>⚠️</span> {error || 'No se pudo completar la acción. Inténtalo de nuevo.'}
      </p>
    )
  }
  return null
}
