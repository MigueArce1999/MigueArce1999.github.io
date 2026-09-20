// Panel del asistente "Registrar con voz". A propósito NO usa Modal/Drawer (ambos bloquean el
// fondo con una capa oscura y atrapan el foco): el pedido exige que el formulario siga visible
// y editable mientras el panel está abierto, así que este es un bloque normal dentro del flujo
// de la página, no una superposición.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../ui/Button'
import type { useAsistenteRegistro } from '../../lib/voz/useAsistenteRegistro'
import type { EstadoAsistenteVoz } from '../../lib/voz/tipos'

type Asistente = ReturnType<typeof useAsistenteRegistro>

const ESTADOS: Record<EstadoAsistenteVoz, { texto: string; icono: string }> = {
  listo: { texto: 'Listo para escuchar', icono: '🎤' },
  escuchando: { texto: 'Escuchando…', icono: '🎙️' },
  interpretando: { texto: 'Interpretando…', icono: '⏳' },
  buscando: { texto: 'Buscando coincidencias…', icono: '🔎' },
  necesita_respuesta: { texto: 'Necesita una respuesta', icono: '❓' },
  aplicado: { texto: 'Cambios aplicados', icono: '✅' },
  sin_microfono: { texto: 'Micrófono no disponible', icono: '🚫' },
  error_conexion: { texto: 'Error de conexión', icono: '⚠️' },
}

const EJEMPLOS = [
  '"Busca a la clienta Laura Martínez"',
  '"Un blower de cuarenta y cinco mil con Claudia"',
  '"Ana colaboró en el blower"',
  '"Cambia el corte a treinta y cinco mil"',
  '"Agrega un champú de sesenta mil"',
  '"Listo" (para pasar a cobrar)',
]

export function PanelAsistenteVoz({ asistente }: { asistente: Asistente }) {
  const [mostrarEjemplos, setMostrarEjemplos] = useState(false)
  const [respuestaAbierta, setRespuestaAbierta] = useState('')
  const anuncioRef = useRef<HTMLDivElement>(null)
  const estadoInfo = ESTADOS[asistente.estado]

  // Anuncio accesible de cambios de estado, SIN leer continuamente la transcripción
  // provisional (eso cambiaría muchas veces por segundo mientras la persona habla).
  useEffect(() => {
    if (anuncioRef.current) anuncioRef.current.textContent = estadoInfo.texto
  }, [estadoInfo.texto])

  function onKeyDownManual(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); asistente.enviarTextoManual() }
  }

  function onKeyDownRespuestaAbierta(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && respuestaAbierta.trim()) {
      e.preventDefault()
      asistente.responderPregunta(respuestaAbierta.trim())
      setRespuestaAbierta('')
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-oliva/30 bg-oliva/5 p-5" role="region" aria-label="Asistente de registro por voz">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-marca text-lg font-semibold text-carbon">Registrar con voz</p>
          <p className="flex items-center gap-1.5 text-sm text-carbon/70">
            <span aria-hidden>{estadoInfo.icono}</span> {estadoInfo.texto}
          </p>
        </div>
        <button
          onClick={asistente.cerrar}
          aria-label="Cerrar asistente de voz"
          className="rounded-lg p-1.5 text-xl leading-none text-carbon/50 hover:bg-piedra/40 hover:text-carbon"
        >
          ×
        </button>
      </div>

      {/* Región viva para lectores de pantalla: anuncia el estado sin leer la transcripción
          provisional palabra por palabra. */}
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
            >
              <span aria-hidden>{asistente.micEscuchando ? '⏹' : '🎙️'}</span>
              {asistente.micEscuchando ? 'Detener' : 'Hablar'}
            </Button>
            {asistente.micEscuchando && <span className="text-xs text-carbon/50">Grabando solo mientras hablas — no se guarda ningún audio.</span>}
          </div>
          {asistente.transcripcionProvisional && (
            <p className="rounded-lg bg-blanco px-3 py-2 text-sm italic text-carbon/60">{asistente.transcripcionProvisional}…</p>
          )}
          {asistente.errorMicrofono && <p className="text-xs font-medium text-error">{asistente.errorMicrofono}</p>}
        </div>
      )}

      {asistente.transcripcionFinal && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="transcripcion-final" className="text-xs font-semibold uppercase tracking-wide text-carbon/50">
            Última transcripción (editable)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="transcripcion-final"
              value={asistente.transcripcionFinal}
              onChange={(e) => asistente.setTranscripcionFinal(e.target.value)}
              className="w-full rounded-lg border border-piedra bg-blanco px-3 py-2 text-sm text-carbon outline-none focus:border-oliva"
            />
            <Button type="button" tamano="sm" variante="secondary" onClick={asistente.reenviarTranscripcionFinal}>
              Aplicar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="instruccion-escrita" className="text-xs font-semibold uppercase tracking-wide text-carbon/50">
          Escribe una instrucción
        </label>
        <div className="flex items-center gap-2">
          <input
            id="instruccion-escrita"
            value={asistente.textoManual}
            onChange={(e) => asistente.setTextoManual(e.target.value)}
            onKeyDown={onKeyDownManual}
            placeholder='Ej. "Busca a Laura Martínez"'
            className="w-full rounded-lg border border-piedra bg-blanco px-3 py-2 text-sm text-carbon outline-none focus:border-oliva"
          />
          <Button type="button" tamano="sm" onClick={asistente.enviarTextoManual}>
            Enviar
          </Button>
        </div>
      </div>

      {asistente.preguntaPendiente && (
        <div className="flex flex-col gap-2 rounded-xl border border-oliva bg-blanco p-3" role="alert">
          <p className="text-sm font-semibold text-carbon">{asistente.preguntaPendiente.texto}</p>
          {asistente.preguntaPendiente.opciones.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {asistente.preguntaPendiente.opciones.map((op) => (
                <Button key={op.valor} type="button" tamano="sm" variante="outline" onClick={() => asistente.responderPregunta(op.valor)}>
                  {op.etiqueta}
                </Button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={respuestaAbierta}
                onChange={(e) => setRespuestaAbierta(e.target.value)}
                onKeyDown={onKeyDownRespuestaAbierta}
                placeholder="Escribe tu respuesta"
                aria-label="Respuesta a la pregunta pendiente"
                className="w-full rounded-lg border border-piedra bg-marfil px-3 py-2 text-sm text-carbon outline-none focus:border-oliva"
              />
              <Button
                type="button"
                tamano="sm"
                onClick={() => { if (respuestaAbierta.trim()) { asistente.responderPregunta(respuestaAbierta.trim()); setRespuestaAbierta('') } }}
              >
                Responder
              </Button>
            </div>
          )}
        </div>
      )}

      {asistente.errorConexion && <p className="text-sm font-medium text-error">{asistente.errorConexion}</p>}

      {asistente.mensajes.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-oliva/20 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Acciones aplicadas</p>
          <ul className="flex flex-col gap-1">
            {asistente.mensajes.map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-sm text-carbon/80">
                <span aria-hidden>{m.icono}</span> <span>{m.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-oliva/20 pt-3">
        <button type="button" onClick={() => setMostrarEjemplos((v) => !v)} className="text-xs font-semibold text-oliva hover:underline">
          {mostrarEjemplos ? 'Ocultar ejemplos' : 'Ver ejemplos de comandos'}
        </button>
        <Button type="button" tamano="sm" variante="ghost" onClick={asistente.deshacerUltimo} disabled={!asistente.hayHistorialParaDeshacer}>
          ↩️ Deshacer último cambio
        </Button>
      </div>
      {mostrarEjemplos && (
        <ul className="flex flex-col gap-1 text-xs text-carbon/60">
          {EJEMPLOS.map((ej) => <li key={ej}>{ej}</li>)}
        </ul>
      )}
    </div>
  )
}
