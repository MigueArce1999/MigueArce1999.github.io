// Panel completo de "Registrar con voz" sobre la nueva arquitectura (CommandInterpreter →
// EntityResolver → AttentionDraft → confirmación explícita → ejecución). A propósito NO usa
// Modal/Drawer: el formulario manual de Atender sigue visible y editable detrás, igual que el
// panel anterior. Reemplaza a PanelAsistenteVoz.tsx cuando Atender.tsx se conecte a este nuevo
// pipeline (ver useVoiceRegistration) — hasta entonces conviven.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../ui/Button'
import { draftEstaCompleto } from '../../lib/voz/draftReducer'
import type { AttentionDraft } from '../../lib/voz/schema'
import { useVoiceRegistration, type EstadoRegistroVoz } from '../../lib/voz/useVoiceRegistration'
import type { VoiceExecutionDeps } from '../../lib/voz/VoiceExecutionService'
import { VoiceStatus } from './VoiceStatus'
import { VoiceTranscript } from './VoiceTranscript'
import { AttentionDraftCard } from './AttentionDraftCard'
import { ClarificationCard } from './ClarificationCard'
import { VoiceConfirmation } from './VoiceConfirmation'

export function VoiceRegistrationPanel({
  deps,
  onConfirmar,
  onCerrar,
}: {
  deps: VoiceExecutionDeps
  onConfirmar: (draft: AttentionDraft) => void | Promise<void>
  onCerrar: () => void
}) {
  const asistente = useVoiceRegistration({ deps, onConfirmar })
  const [textoManual, setTextoManual] = useState('')
  const anuncioRef = useRef<HTMLDivElement>(null)

  const draftTieneAlgo =
    asistente.draft.client.status !== 'none' || asistente.draft.services.length > 0 || asistente.draft.products.length > 0

  // Anuncio accesible del estado, sin leer la transcripción provisional palabra por palabra
  // (cambiaría muchas veces por segundo mientras la persona habla).
  useEffect(() => {
    if (anuncioRef.current) anuncioRef.current.textContent = TEXTO_ESTADO[asistente.fase]
  }, [asistente.fase])

  function onKeyDownManual(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && textoManual.trim()) {
      e.preventDefault()
      asistente.enviarTexto(textoManual.trim())
      setTextoManual('')
    }
  }

  function cerrar() {
    asistente.detenerMicrofono()
    onCerrar()
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-oliva/30 bg-oliva/5 p-5" role="region" aria-label="Asistente de registro por voz">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-marca text-lg font-semibold text-carbon">Registrar con voz</p>
          <VoiceStatus fase={asistente.fase} />
        </div>
        <button
          onClick={cerrar}
          aria-label="Cerrar asistente de voz"
          className="rounded-lg p-1.5 text-xl leading-none text-carbon/50 hover:bg-piedra/40 hover:text-carbon"
        >
          ×
        </button>
      </div>

      <div ref={anuncioRef} aria-live="polite" className="sr-only" />

      {!asistente.micDisponible && (
        <p className="rounded-lg bg-champan/20 px-3 py-2 text-sm text-carbon/80">
          Este navegador no permite el dictado. Puedes escribir la instrucción abajo o completar el formulario a mano.
        </p>
      )}

      {asistente.micDisponible && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variante={asistente.micEscuchando ? 'danger' : 'primary'}
              onClick={asistente.micEscuchando ? asistente.detenerMicrofono : asistente.iniciarMicrofono}
              aria-pressed={asistente.micEscuchando}
              disabled={asistente.fase === 'SAVING'}
            >
              <span aria-hidden>{asistente.micEscuchando ? '⏹' : '🎙️'}</span>
              {asistente.micEscuchando ? 'Detener' : 'Hablar'}
            </Button>
            {asistente.micEscuchando && <span className="text-xs text-carbon/50">Grabando solo mientras hablas — no se guarda ningún audio.</span>}
          </div>
          <VoiceTranscript texto={asistente.transcripcionProvisional} escuchando={asistente.micEscuchando} />
          {asistente.errorMicrofono && <p className="text-xs font-medium text-error">{asistente.errorMicrofono}</p>}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="instruccion-escrita-voz" className="text-xs font-semibold uppercase tracking-wide text-carbon/50">
          Escribe una instrucción
        </label>
        <div className="flex items-center gap-2">
          <input
            id="instruccion-escrita-voz"
            value={textoManual}
            onChange={(e) => setTextoManual(e.target.value)}
            onKeyDown={onKeyDownManual}
            disabled={asistente.fase === 'SAVING'}
            placeholder='Ej. "Busca a Laura Martínez"'
            className="w-full rounded-lg border border-piedra bg-blanco px-3 py-2 text-sm text-carbon outline-none focus:border-oliva disabled:opacity-60"
          />
          <Button type="button" tamano="sm" disabled={asistente.fase === 'SAVING' || !textoManual.trim()} onClick={() => { asistente.enviarTexto(textoManual.trim()); setTextoManual('') }}>
            Enviar
          </Button>
        </div>
      </div>

      {asistente.clarification && (
        <ClarificationCard clarification={asistente.clarification} disabled={asistente.fase === 'SAVING'} onResponder={asistente.responderClarificacion} />
      )}

      {draftTieneAlgo && (
        <AttentionDraftCard
          draft={asistente.draft}
          completo={draftEstaCompleto(asistente.draft)}
          guardando={asistente.fase === 'SAVING'}
          onEditar={() => { /* el draft sigue editable por voz/texto mientras esta tarjeta está visible */ }}
          onConfirmar={asistente.confirmar}
        />
      )}

      <VoiceConfirmation fase={asistente.fase} mensaje={asistente.mensaje} error={asistente.error} />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-oliva/20 pt-3">
        <Button type="button" tamano="sm" variante="ghost" onClick={asistente.deshacer} disabled={!asistente.hayHistorialParaDeshacer || asistente.fase === 'SAVING'}>
          ↩️ Deshacer último cambio
        </Button>
        <Button type="button" tamano="sm" variante="ghost" onClick={asistente.cancelar} disabled={asistente.fase === 'SAVING'}>
          Cancelar atención
        </Button>
      </div>
    </div>
  )
}

const TEXTO_ESTADO: Record<EstadoRegistroVoz, string> = {
  IDLE: 'Listo para escuchar',
  LISTENING: 'Escuchando',
  PROCESSING: 'Entendiendo la atención',
  NEEDS_CLARIFICATION: 'Necesita una respuesta',
  READY_TO_CONFIRM: 'Listo para confirmar',
  SAVING: 'Guardando la atención',
  SUCCESS: 'Atención registrada',
  ERROR: 'Hubo un problema',
}
