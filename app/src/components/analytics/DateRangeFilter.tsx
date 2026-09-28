import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { SelectorRangoPersonalizado } from './SelectorRangoPersonalizado'
import { useDateRange } from '../../state/DateRangeContext'
import { fechaBogotaISO, formatoFecha } from '../../lib/format'
import type { PresetRangoFecha } from '../../lib/types'

const OPCIONES: { valor: Exclude<PresetRangoFecha, 'personalizado'>; etiqueta: string }[] = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: 'ayer', etiqueta: 'Ayer' },
  { valor: 'semana', etiqueta: 'Esta semana' },
  { valor: 'mes', etiqueta: 'Este mes' },
]

// Filtro global de fecha: un solo lugar que decide qué periodo ve TODO el Dashboard (ver
// DateRangeContext) — nunca un selector de fecha por gráfica/tarjeta. El picker de rango
// personalizado se muestra en un Modal centrado tanto en desktop como en mobile: el proyecto no
// tiene un componente de popover anclado, y el Modal ya existente es accesible (foco atrapado,
// Escape, devuelve el foco) en los dos tamaños de pantalla — más simple que mantener dos
// presentaciones distintas para ganar un dropdown flotante en desktop.
export function DateRangeFilter() {
  const { preset, rango, personalizado, setPreset, setRangoPersonalizado } = useDateRange()
  const [abierto, setAbierto] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {OPCIONES.map((o) => (
          <button
            key={o.valor}
            onClick={() => setPreset(o.valor)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              preset === o.valor ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon hover:bg-piedra/60'
            }`}
          >
            {o.etiqueta}
          </button>
        ))}
        <button
          onClick={() => setAbierto(true)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
            preset === 'personalizado' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon hover:bg-piedra/60'
          }`}
        >
          Personalizado <span aria-hidden>📅</span>
        </button>
      </div>

      <p className="text-sm text-carbon/60">
        Período activo: <span className="font-semibold text-carbon">{etiquetaRangoActivo(rango.desde, rango.hasta)}</span>
      </p>

      <Modal abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Elegir periodo">
        <SelectorRangoPersonalizado
          valorInicial={personalizado}
          onCancelar={() => setAbierto(false)}
          onAplicar={(desde, hasta) => {
            setRangoPersonalizado(desde, hasta)
            setAbierto(false)
          }}
        />
      </Modal>
    </div>
  )
}

// "hasta" que llega acá es el límite EXCLUSIVO (medianoche del día siguiente) — se le resta un
// instante para mostrar el último día real incluido, no el siguiente. Comparar por el día
// calendario en BOGOTÁ (fechaBogotaISO), nunca con isSameDay/getUTCMonth directo sobre el Date:
// esos comparan en la zona horaria del navegador (o UTC), que no es necesariamente Bogotá, y
// "Hoy" podía mostrarse como "28 sept – 28 sept" en vez de una sola fecha.
function etiquetaRangoActivo(desde: Date, hastaExclusivo: Date): string {
  const ultimoDiaIncluido = new Date(hastaExclusivo.getTime() - 1)
  const diaDesde = fechaBogotaISO(desde)
  const diaHasta = fechaBogotaISO(ultimoDiaIncluido)
  if (diaDesde === diaHasta) {
    return formatoFecha(desde.toISOString(), { day: 'numeric', month: 'long', year: 'numeric' })
  }
  const mismoMes = diaDesde.slice(0, 7) === diaHasta.slice(0, 7)
  if (mismoMes) {
    return `${formatoFecha(desde.toISOString(), { day: 'numeric' })} – ${formatoFecha(ultimoDiaIncluido.toISOString(), { day: 'numeric', month: 'long', year: 'numeric' })}`
  }
  return `${formatoFecha(desde.toISOString(), { day: 'numeric', month: 'short' })} – ${formatoFecha(ultimoDiaIncluido.toISOString(), { day: 'numeric', month: 'short', year: 'numeric' })}`
}
