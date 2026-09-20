// Hook de React que conecta la captura de voz (useReconocimientoVoz, capa 1) con el pipeline
// determinista (VoiceExecutionService, capas 4-8) y expone un único estado explícito para la
// UI (sección 20 del pedido): IDLE, LISTENING, PROCESSING, NEEDS_CLARIFICATION,
// READY_TO_CONFIRM, SAVING, SUCCESS, ERROR. La UI nunca lee el resultado del intérprete
// directamente — solo este estado y el AttentionDraft/aclaración pendiente.
//
// A propósito NO reemplaza useAsistenteRegistro.ts todavía: ese hook sigue siendo lo que usa
// Atender.tsx hoy. Este hook queda listo para que un siguiente paso lo conecte (confirmar aquí
// entrega un AttentionDraft completo; verterlo sobre cliente/lineas/productos/notas y disparar
// irACobrar es responsabilidad de quien lo use, nunca de este archivo).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReconocimientoVoz } from './useReconocimientoVoz'
import { procesarUtterance, type VoiceExecutionDeps } from './VoiceExecutionService'
import { crearDraftVacio, crearSesionVoz, type VoiceSessionState } from './VoiceSessionContext'
import type { AttentionDraft, PendingClarification } from './schema'

export type EstadoRegistroVoz =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'NEEDS_CLARIFICATION'
  | 'READY_TO_CONFIRM'
  | 'SAVING'
  | 'SUCCESS'
  | 'ERROR'

export interface UseVoiceRegistrationProps {
  deps: VoiceExecutionDeps
  /** Se llama con el AttentionDraft completo cuando la persona confirma y el draft está listo.
   * Nunca escribe nada por sí solo — el llamador decide qué hacer con él (verterlo sobre el
   * formulario manual y disparar irACobrar, en el uso real de Atender.tsx). */
  onConfirmar: (draft: AttentionDraft) => void | Promise<void>
}

interface EstadoInterno {
  fase: EstadoRegistroVoz
  draft: AttentionDraft
  clarification: PendingClarification | null
  mensaje: string | null
  error: string | null
}

function idUtterance(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function useVoiceRegistration({ deps, onConfirmar }: UseVoiceRegistrationProps) {
  const sesionRef = useRef<VoiceSessionState>(crearSesionVoz())
  const depsRef = useRef(deps)
  const onConfirmarRef = useRef(onConfirmar)
  useEffect(() => { depsRef.current = deps })
  useEffect(() => { onConfirmarRef.current = onConfirmar })

  const [transcripcionProvisional, setTranscripcionProvisional] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [historialLength, setHistorialLength] = useState(0)
  const [interno, setInterno] = useState<EstadoInterno>({
    fase: 'IDLE',
    draft: crearDraftVacio(),
    clarification: null,
    mensaje: null,
    error: null,
  })

  const ejecutarTurno = useCallback(async (texto: string, utteranceId: string) => {
    if (!texto.trim()) return
    setProcesando(true)
    setInterno((prev) => ({ ...prev, error: null }))
    try {
      const resultado = await procesarUtterance(texto, utteranceId, sesionRef.current, depsRef.current)
      setHistorialLength(sesionRef.current.undoStack.length)
      if (resultado.error) {
        setInterno({ fase: 'ERROR', draft: resultado.draft, clarification: null, mensaje: null, error: resultado.error })
        return
      }
      if (resultado.shouldExecute) {
        setGuardando(true)
        setInterno({ fase: 'SAVING', draft: resultado.draft, clarification: null, mensaje: null, error: null })
        try {
          await onConfirmarRef.current(resultado.draft)
          setInterno({ fase: 'SUCCESS', draft: resultado.draft, clarification: null, mensaje: resultado.summary, error: null })
        } catch (e: any) {
          setInterno({ fase: 'ERROR', draft: resultado.draft, clarification: null, mensaje: null, error: e?.message || 'No se pudo registrar la atención.' })
        } finally {
          setGuardando(false)
        }
        return
      }
      if (resultado.clarification) {
        setInterno({ fase: 'NEEDS_CLARIFICATION', draft: resultado.draft, clarification: resultado.clarification, mensaje: resultado.summary, error: null })
        return
      }
      setInterno({
        fase: resultado.readyToConfirm ? 'READY_TO_CONFIRM' : 'IDLE',
        draft: resultado.draft,
        clarification: null,
        mensaje: resultado.summary,
        error: null,
      })
    } finally {
      setProcesando(false)
    }
  }, [])

  const onResultadoFinal = useCallback((r: { id: string; texto: string }) => {
    setTranscripcionProvisional('')
    void ejecutarTurno(r.texto, r.id)
  }, [ejecutarTurno])

  const mic = useReconocimientoVoz({ onResultadoFinal, onTranscripcionProvisional: setTranscripcionProvisional })

  const enviarTexto = useCallback((texto: string) => { void ejecutarTurno(texto, idUtterance()) }, [ejecutarTurno])
  const responderClarificacion = useCallback((valor: string) => { void ejecutarTurno(valor, idUtterance()) }, [ejecutarTurno])
  const cancelar = useCallback(() => { void ejecutarTurno('cancelar', idUtterance()) }, [ejecutarTurno])
  const deshacer = useCallback(() => { void ejecutarTurno('deshacer', idUtterance()) }, [ejecutarTurno])
  const confirmar = useCallback(() => { void ejecutarTurno('confirmar', idUtterance()) }, [ejecutarTurno])

  const reiniciar = useCallback(() => {
    const nuevaSesion = crearSesionVoz()
    sesionRef.current = nuevaSesion
    setTranscripcionProvisional('')
    setHistorialLength(0)
    setInterno({ fase: 'IDLE', draft: nuevaSesion.draft, clarification: null, mensaje: null, error: null })
  }, [])

  // El estado visible prioriza: guardando > error > escuchando > procesando > lo último que
  // dejó procesarUtterance (aclaración pendiente / listo para confirmar / inactivo).
  const fase: EstadoRegistroVoz = useMemo(() => {
    if (guardando) return 'SAVING'
    if (interno.fase === 'ERROR') return 'ERROR'
    if (interno.fase === 'SUCCESS') return 'SUCCESS'
    if (mic.estado === 'escuchando') return 'LISTENING'
    if (procesando) return 'PROCESSING'
    return interno.fase
  }, [guardando, interno.fase, mic.estado, procesando])

  return {
    fase,
    draft: interno.draft,
    clarification: interno.clarification,
    mensaje: interno.mensaje,
    error: interno.error,
    transcripcionProvisional,
    micDisponible: mic.disponible,
    micEscuchando: mic.estado === 'escuchando',
    errorMicrofono: mic.error,
    iniciarMicrofono: mic.iniciar,
    detenerMicrofono: mic.detener,
    enviarTexto,
    responderClarificacion,
    confirmar,
    cancelar,
    deshacer,
    hayHistorialParaDeshacer: historialLength > 0,
    reiniciar,
  }
}
