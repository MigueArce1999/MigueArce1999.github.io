// Capa 1 de 7: captura y transcripción. Envuelve la Web Speech API del navegador (español de
// Colombia cuando el navegador lo soporta) detrás de una interfaz desacoplada del resto del
// asistente — motor.ts e interprete.ts no saben ni les importa de dónde vino el texto, así que
// mañana se podría cambiar de proveedor sin tocarlos.
//
// Límites reales de esta primera versión (ver entrega): la Web Speech API no es un estándar
// formal; en Chrome/Edge (de escritorio y Android) usa un servicio de reconocimiento en la nube
// del navegador para transformar el audio en texto — el audio sale del dispositivo hacia ese
// servicio, pero esta app nunca lo graba ni lo retiene. Safari la soporta parcialmente y
// Firefox no la soporta en absoluto: por eso todo en este módulo empieza comprobando
// disponibilidad real, nunca asumiéndola.

import { useCallback, useEffect, useRef, useState } from 'react'

// La interfaz SpeechRecognition en sí (a diferencia de SpeechRecognitionEvent/ErrorEvent, que sí
// trae lib.dom.d.ts) todavía no es parte del set ambiental de TypeScript por no ser un estándar
// formal del W3C — se declara aquí, mínima, solo con lo que este módulo usa.
interface SpeechRecognitionInstancia extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
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
}

function obtenerConstructor(): (new () => SpeechRecognitionInstancia) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function reconocimientoDisponible(): boolean {
  return obtenerConstructor() !== null
}

export function useReconocimientoVoz({ onResultadoFinal, onTranscripcionProvisional }: OpcionesReconocimiento) {
  const [estado, setEstado] = useState<EstadoMicrofono>(() => (reconocimientoDisponible() ? 'inactivo' : 'no_disponible'))
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstancia | null>(null)
  // Los resultados "final" de la Web Speech API pueden repetirse ante ciertos reinicios del
  // motor de reconocimiento; se descarta cualquier resultado final ya visto por su índice de
  // resultado + su texto exacto (ver sección 5: "evitar procesar dos veces un mismo resultado
  // final").
  const resultadosFinalesVistos = useRef<Set<string>>(new Set())

  const detener = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const iniciar = useCallback(() => {
    const Constructor = obtenerConstructor()
    if (!Constructor) { setEstado('no_disponible'); return }
    setError(null)
    const recognition = new Constructor()
    recognition.lang = 'es-CO'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onstart = () => setEstado('escuchando')
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Se necesita permiso del micrófono.' : `Error de reconocimiento: ${e.error}`)
      setEstado('error')
    }
    // No se reinicia solo: al terminar (silencio, pausa, o "detener" manual) vuelve a
    // "inactivo" — nunca escucha en segundo plano sin que la persona lo haya pedido de nuevo.
    recognition.onend = () => setEstado((actual) => (actual === 'error' ? actual : 'inactivo'))

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let provisional = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const resultado = e.results[i]
        const texto = resultado[0]?.transcript ?? ''
        if (resultado.isFinal) {
          const clave = `${i}:${texto.trim().toLowerCase()}`
          if (resultadosFinalesVistos.current.has(clave)) continue
          resultadosFinalesVistos.current.add(clave)
          if (texto.trim()) onResultadoFinal({ id: clave, texto: texto.trim() })
        } else {
          provisional += texto
        }
      }
      if (provisional) onTranscripcionProvisional?.(provisional)
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [onResultadoFinal, onTranscripcionProvisional])

  // Liberar el micrófono siempre: al cerrar el panel, salir de la pantalla o desmontar el
  // componente — nunca queda escuchando de fondo (sección 5).
  useEffect(() => () => { recognitionRef.current?.stop() }, [])

  return { estado, error, iniciar, detener, disponible: reconocimientoDisponible() }
}
