// Captura y transcripción (Web Speech API, es-CO). En diálogo usa turnos cortos para que
// Chrome no deje el “sí” colgado como transcripción provisional.

import { contieneWakeWord, esComandoCorto } from './conversacionGlowdesk'
import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionInstancia extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onresult: ((e: SpeechRecognitionEvent) => void) | null
}

export type EstadoMicrofono = 'inactivo' | 'escuchando' | 'no_disponible' | 'error'

export interface ResultadoReconocimiento {
  id: string
  texto: string
}

interface OpcionesReconocimiento {
  onResultadoFinal: (resultado: ResultadoReconocimiento) => void
  onTranscripcionProvisional?: (texto: string) => void
  mantenerEscucha?: boolean
  anticipar?: (texto: string) => boolean
  /** Con el panel abierto: Chrome cierra el turno al callar, sin esperar más palabras. */
  turnosCortos?: boolean
}

const IDIOMA_VOZ = 'es-CO'

function obtenerConstructor(): (new () => SpeechRecognitionInstancia) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function reconocimientoDisponible(): boolean {
  return obtenerConstructor() !== null
}

function claveNorm(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function useReconocimientoVoz({
  onResultadoFinal,
  onTranscripcionProvisional,
  mantenerEscucha = false,
  anticipar,
  turnosCortos = false,
}: OpcionesReconocimiento) {
  const [estado, setEstado] = useState<EstadoMicrofono>(() => (reconocimientoDisponible() ? 'inactivo' : 'no_disponible'))
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstancia | null>(null)
  const mantenerRef = useRef(mantenerEscucha)
  const silenciadoRef = useRef(false)
  const sesionRef = useRef(0)
  const anticiparRef = useRef(anticipar)
  const turnosCortosRef = useRef(turnosCortos)
  const ultimoCortoRef = useRef<{ clave: string; t: number } | null>(null)
  const provisionalRef = useRef('')
  const flushTimerRef = useRef<number | null>(null)
  const onFinalRef = useRef(onResultadoFinal)
  const onProvRef = useRef(onTranscripcionProvisional)
  const resultadosFinalesVistos = useRef<Set<string>>(new Set())

  useEffect(() => { mantenerRef.current = mantenerEscucha }, [mantenerEscucha])
  useEffect(() => { anticiparRef.current = anticipar }, [anticipar])
  useEffect(() => { turnosCortosRef.current = turnosCortos }, [turnosCortos])
  useEffect(() => { onFinalRef.current = onResultadoFinal }, [onResultadoFinal])
  useEffect(() => { onProvRef.current = onTranscripcionProvisional }, [onTranscripcionProvisional])

  const emitir = useCallback((texto: string) => {
    const recorte = texto.trim()
    if (!recorte) return
    const clave = claveNorm(recorte)
    if (contieneWakeWord(recorte)) {
      onFinalRef.current({ id: `wake-${Date.now()}`, texto: recorte })
      return
    }
    const corto = esComandoCorto(recorte) || (anticiparRef.current?.(recorte) ?? false)
    if (corto) {
      const ahora = Date.now()
      if (ultimoCortoRef.current && ultimoCortoRef.current.clave === clave && ahora - ultimoCortoRef.current.t < 450) return
      ultimoCortoRef.current = { clave, t: ahora }
    } else {
      if (resultadosFinalesVistos.current.has(clave)) return
      resultadosFinalesVistos.current.add(clave)
    }
    onFinalRef.current({ id: clave, texto: recorte })
  }, [])

  const cancelarFlush = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }, [])

  const valeFlushRapido = useCallback((texto: string) => {
    if (esComandoCorto(texto) || (anticiparRef.current?.(texto) ?? false)) return true
    return /^(si|sip|s|se|no|nop|listo|ya|dale|ok|okay|uno|dos|tres)$/.test(claveNorm(texto))
  }, [])

  const flushProvisional = useCallback(() => {
    cancelarFlush()
    const t = provisionalRef.current.trim()
    provisionalRef.current = ''
    if (!t || !valeFlushRapido(t)) {
      onProvRef.current?.('')
      return
    }
    emitir(t)
    onProvRef.current?.('')
  }, [cancelarFlush, emitir, valeFlushRapido])

  const programarFlush = useCallback((texto: string) => {
    provisionalRef.current = texto
    cancelarFlush()
    if (!valeFlushRapido(texto)) return
    flushTimerRef.current = window.setTimeout(flushProvisional, 280)
  }, [cancelarFlush, flushProvisional, valeFlushRapido])

  const detener = useCallback(() => {
    sesionRef.current += 1
    silenciadoRef.current = true
    cancelarFlush()
    provisionalRef.current = ''
    recognitionRef.current?.stop()
  }, [cancelarFlush])

  const iniciar = useCallback(() => {
    const Constructor = obtenerConstructor()
    if (!Constructor) { setEstado('no_disponible'); return }
    setError(null)
    sesionRef.current += 1
    const sesion = sesionRef.current
    silenciadoRef.current = true
    cancelarFlush()
    resultadosFinalesVistos.current.clear()
    ultimoCortoRef.current = null
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
    silenciadoRef.current = false
    const recognition = new Constructor()
    recognition.lang = IDIOMA_VOZ
    recognition.continuous = !turnosCortosRef.current
    recognition.interimResults = true
    recognition.maxAlternatives = 3

    recognition.onstart = () => setEstado('escuchando')
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Se necesita permiso del micrófono.' : `Error de reconocimiento: ${e.error}`)
      setEstado('error')
    }
    recognition.onend = () => {
      if (sesion !== sesionRef.current) return
      flushProvisional()
      if (silenciadoRef.current) {
        setEstado((actual) => (actual === 'error' ? actual : 'inactivo'))
        return
      }
      if (mantenerRef.current) {
        window.setTimeout(() => {
          if (sesion !== sesionRef.current || silenciadoRef.current || !mantenerRef.current) return
          try {
            recognition.start()
          } catch {
            window.setTimeout(() => {
              if (sesion !== sesionRef.current || silenciadoRef.current || !mantenerRef.current) return
              try { recognition.start() } catch { setEstado('inactivo') }
            }, 350)
          }
        }, 150)
        return
      }
      setEstado((actual) => (actual === 'error' ? actual : 'inactivo'))
    }

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      if (sesion !== sesionRef.current) return
      let provisional = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const resultado = e.results[i]
        let texto = (resultado[0]?.transcript ?? '').trim()
        if (!texto) continue
        for (let a = 0; a < resultado.length; a++) {
          const alt = (resultado[a]?.transcript ?? '').trim()
          if (alt && (esComandoCorto(alt) || anticiparRef.current?.(alt))) {
            texto = alt
            break
          }
        }
        if (resultado.isFinal || esComandoCorto(texto) || anticiparRef.current?.(texto)) {
          provisionalRef.current = ''
          cancelarFlush()
          emitir(texto)
        } else {
          provisional += (provisional ? ' ' : '') + texto
          programarFlush(texto)
        }
      }
      if (provisional) onProvRef.current?.(provisional)
    }

    recognitionRef.current = recognition
    window.setTimeout(() => {
      if (sesion !== sesionRef.current) return
      try {
        recognition.start()
      } catch {
        window.setTimeout(() => {
          if (sesion !== sesionRef.current || silenciadoRef.current) return
          try { recognition.start() } catch { setEstado('inactivo') }
        }, 300)
      }
    }, 80)
  }, [cancelarFlush, emitir, flushProvisional, programarFlush])

  const turnosPrevRef = useRef(turnosCortos)
  useEffect(() => {
    const cambio = turnosPrevRef.current !== turnosCortos
    turnosPrevRef.current = turnosCortos
    if (!cambio || !recognitionRef.current || silenciadoRef.current) return
    iniciar()
  }, [turnosCortos, iniciar])

  useEffect(() => () => {
    cancelarFlush()
    recognitionRef.current?.stop()
  }, [cancelarFlush])

  return { estado, error, iniciar, detener, disponible: reconocimientoDisponible() }
}
