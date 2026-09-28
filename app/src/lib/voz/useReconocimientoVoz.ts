// Captura y transcripción (Web Speech API, es-CO). Toda la lógica vive en
// ControladorReconocimiento (probado sin navegador); este hook solo lo conecta a React.
// En diálogo usa turnos cortos para que Chrome no deje el “sí” colgado como provisional.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ControladorReconocimiento,
  type EstadoMicrofono,
  type ReconocedorLike,
  type ResultadoReconocimiento,
} from './controladorReconocimiento'

export type { EstadoMicrofono, ResultadoReconocimiento } from './controladorReconocimiento'

interface OpcionesReconocimiento {
  onResultadoFinal: (resultado: ResultadoReconocimiento) => void
  onTranscripcionProvisional?: (texto: string) => void
  mantenerEscucha?: boolean
  anticipar?: (texto: string) => boolean
  /** Con el panel abierto: Chrome cierra el turno al callar, sin esperar más palabras. */
  turnosCortos?: boolean
  /** Mientras el asistente habla: no escuchar (si no, se oye a sí mismo). */
  pausado?: boolean
}

function obtenerConstructor(): (new () => ReconocedorLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function reconocimientoDisponible(): boolean {
  return obtenerConstructor() !== null
}

/** Para diagnosticar en el dispositivo real: localStorage.setItem('glowdesk-voz-debug', '1'). */
function logDepuracion(evento: string, datos?: unknown) {
  try {
    if (typeof localStorage === 'undefined' || localStorage.getItem('glowdesk-voz-debug') !== '1') return
  } catch {
    return
  }
  // eslint-disable-next-line no-console
  console.debug('[voz/mic]', new Date().toISOString().slice(11, 23), evento, datos ?? '')
}

export function useReconocimientoVoz({
  onResultadoFinal,
  onTranscripcionProvisional,
  mantenerEscucha = false,
  anticipar,
  turnosCortos = false,
  pausado = false,
}: OpcionesReconocimiento) {
  const [estado, setEstado] = useState<EstadoMicrofono>(() => (reconocimientoDisponible() ? 'inactivo' : 'no_disponible'))
  const [error, setError] = useState<string | null>(null)
  const onFinalRef = useRef(onResultadoFinal)
  const onProvRef = useRef(onTranscripcionProvisional)
  const anticiparRef = useRef(anticipar)
  useEffect(() => { onFinalRef.current = onResultadoFinal }, [onResultadoFinal])
  useEffect(() => { onProvRef.current = onTranscripcionProvisional }, [onTranscripcionProvisional])
  useEffect(() => { anticiparRef.current = anticipar }, [anticipar])

  const controladorRef = useRef<ControladorReconocimiento | null>(null)
  if (controladorRef.current === null) {
    controladorRef.current = new ControladorReconocimiento({
      crear: () => {
        const C = obtenerConstructor()
        return C ? new C() : null
      },
      onFinal: (r) => onFinalRef.current(r),
      onProvisional: (t) => onProvRef.current?.(t),
      anticipar: (t) => anticiparRef.current?.(t) ?? false,
      onEstado: (e, err) => {
        setEstado(e)
        setError(err)
      },
      log: logDepuracion,
    })
  }

  useEffect(() => {
    const c = controladorRef.current
    c?.revivir()
    return () => c?.destruir()
  }, [])

  useEffect(() => {
    controladorRef.current?.configurar({ mantener: mantenerEscucha, turnosCortos, pausado })
  }, [mantenerEscucha, turnosCortos, pausado])

  const iniciar = useCallback(() => controladorRef.current?.iniciar(), [])
  const detener = useCallback(() => controladorRef.current?.detener(), [])

  return { estado, error, iniciar, detener, disponible: reconocimientoDisponible() }
}
