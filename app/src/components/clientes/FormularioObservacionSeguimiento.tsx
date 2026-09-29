import { useState } from 'react'
import { Button } from '../ui/Button'
import { Select, Textarea } from '../ui/Campos'
import { crearNotaCliente, crearRecomendacionCliente } from '../../lib/api/clientes'
import { fechaBogotaISO, formatoFechaCorta } from '../../lib/format'
import type { Servicio } from '../../lib/types'

// Formulario compartido: se usa tanto al finalizar una atención (Atender.tsx, opcional, no
// bloquea el cobro) como desde el perfil de la clienta en cualquier momento (sección 13 y 23 del
// pedido — "máximo esfuerzo mínimo"). Observación y recomendación son conceptos separados a
// propósito (sección 7): la primera describe un hecho, la segunda es una sugerencia con fecha.
export function FormularioObservacionSeguimiento({
  clienteId,
  atencionId,
  servicios,
  onGuardado,
  onCancelar,
}: {
  clienteId: string
  atencionId: string | null
  servicios: Servicio[]
  onGuardado: () => void
  onCancelar?: () => void
}) {
  const [observacion, setObservacion] = useState('')
  const [recomendacion, setRecomendacion] = useState('')
  const [recomendarRegreso, setRecomendarRegreso] = useState(false)
  const [volverEnDias, setVolverEnDias] = useState(15)
  const [servicioId, setServicioId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fechaCalculada = recomendarRegreso ? fechaBogotaISO(new Date(Date.now() + volverEnDias * 24 * 60 * 60 * 1000)) : null
  const hayAlgoQueGuardar = observacion.trim() !== '' || recomendacion.trim() !== ''

  async function guardar() {
    if (!hayAlgoQueGuardar) {
      onCancelar?.()
      return
    }
    setGuardando(true)
    setError(null)
    try {
      if (observacion.trim()) {
        await crearNotaCliente(clienteId, atencionId, observacion.trim())
      }
      if (recomendacion.trim()) {
        await crearRecomendacionCliente({
          clienteId,
          atencionId,
          servicioId: servicioId || null,
          descripcion: recomendacion.trim(),
          fechaRegreso: fechaCalculada,
        })
      }
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        id="observacionCliente"
        etiqueta="Observación"
        value={observacion}
        onChange={(e) => setObservacion(e.target.value)}
        placeholder="Cabello reseco, principalmente en las puntas."
      />
      <Textarea
        id="recomendacionCliente"
        etiqueta="Recomendación"
        value={recomendacion}
        onChange={(e) => setRecomendacion(e.target.value)}
        placeholder="Realizar hidratación profunda."
      />
      {recomendacion.trim() && (
        <Select id="servicioRecomendado" etiqueta="Servicio recomendado (opcional)" value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
          <option value="">Sin servicio específico</option>
          {servicios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </Select>
      )}
      <label className="flex items-center gap-2 text-sm font-semibold text-carbon">
        <input
          type="checkbox"
          checked={recomendarRegreso}
          onChange={(e) => setRecomendarRegreso(e.target.checked)}
          className="h-4 w-4 rounded border-piedra text-oliva focus:ring-oliva"
        />
        Recomendar regreso
      </label>
      {recomendarRegreso && (
        <div className="flex items-center gap-2 rounded-lg bg-piedra/30 px-3 py-2 text-sm">
          <span className="text-carbon/70">Volver en</span>
          <input
            type="number"
            min={1}
            max={365}
            value={volverEnDias}
            onChange={(e) => setVolverEnDias(Math.max(1, Number(e.target.value) || 1))}
            className="w-16 rounded-md border border-piedra bg-blanco px-2 py-1 text-center text-sm outline-none focus:border-oliva"
          />
          <span className="text-carbon/70">días</span>
          {fechaCalculada && <span className="ml-auto font-semibold text-oliva">{formatoFechaCorta(fechaCalculada)}</span>}
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancelar && (
          <Button variante="ghost" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
        <Button onClick={guardar} cargando={guardando}>
          Guardar
        </Button>
      </div>
    </div>
  )
}
