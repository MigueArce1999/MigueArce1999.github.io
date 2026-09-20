// NEEDS_CLARIFICATION (sección 20): se muestra SOLO la pregunta y las opciones necesarias para
// responderla — nunca detalles técnicos del intérprete ("no entendí: ...").

import { useState, type KeyboardEvent } from 'react'
import { Button } from '../ui/Button'
import type { PendingClarification } from '../../lib/voz/schema'

export function ClarificationCard({
  clarification,
  disabled,
  onResponder,
}: {
  clarification: PendingClarification
  disabled?: boolean
  onResponder: (valor: string) => void
}) {
  const [respuesta, setRespuesta] = useState('')

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && respuesta.trim() && !disabled) {
      e.preventDefault()
      onResponder(respuesta.trim())
      setRespuesta('')
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-oliva bg-blanco p-3" role="alert">
      <p className="text-sm font-semibold text-carbon">{clarification.question}</p>
      {clarification.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {clarification.options.map((op) => (
            <Button key={op.value} type="button" tamano="sm" variante="outline" disabled={disabled} onClick={() => onResponder(op.value)}>
              {op.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            placeholder="Escribe tu respuesta"
            aria-label="Respuesta a la pregunta pendiente"
            className="w-full rounded-lg border border-piedra bg-marfil px-3 py-2 text-sm text-carbon outline-none focus:border-oliva disabled:opacity-60"
          />
          <Button
            type="button"
            tamano="sm"
            disabled={disabled || !respuesta.trim()}
            onClick={() => { if (respuesta.trim()) { onResponder(respuesta.trim()); setRespuesta('') } }}
          >
            Responder
          </Button>
        </div>
      )}
    </div>
  )
}
