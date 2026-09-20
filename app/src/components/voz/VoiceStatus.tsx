// Estado explícito único (sección 20 del pedido): la empleada nunca ve detalles internos del
// intérprete, solo una de estas 8 frases. LISTENING trae además un punto animado (mic activo).

import type { EstadoRegistroVoz } from '../../lib/voz/useVoiceRegistration'

const INFO: Record<EstadoRegistroVoz, { texto: string; icono: string }> = {
  IDLE: { texto: 'Listo para escuchar', icono: '🎤' },
  LISTENING: { texto: 'Escuchando…', icono: '🎙️' },
  PROCESSING: { texto: 'Entendiendo la atención…', icono: '⏳' },
  NEEDS_CLARIFICATION: { texto: 'Necesita una respuesta', icono: '❓' },
  READY_TO_CONFIRM: { texto: 'Listo para confirmar', icono: '✅' },
  SAVING: { texto: 'Guardando la atención…', icono: '💾' },
  SUCCESS: { texto: 'Atención registrada', icono: '🎉' },
  ERROR: { texto: 'Hubo un problema', icono: '⚠️' },
}

export function VoiceStatus({ fase }: { fase: EstadoRegistroVoz }) {
  const info = INFO[fase]
  return (
    <p className="flex items-center gap-1.5 text-sm text-carbon/70">
      <span aria-hidden>{info.icono}</span>
      {info.texto}
      {fase === 'LISTENING' && <span className="h-2 w-2 animate-pulse rounded-full bg-error" aria-hidden />}
    </p>
  )
}
