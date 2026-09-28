import { useDateRange } from '../../state/DateRangeContext'
import type { ModoComparacion } from '../../lib/types'

// "Rango personalizado" como periodo de comparación (un segundo selector de fechas aparte)
// queda pendiente para una siguiente vuelta — las 5 comparaciones calculables sin pedirle nada
// más a la persona ya cubren el caso de uso principal ("cómo nos fue vs. antes").
const OPCIONES: { valor: ModoComparacion; etiqueta: string }[] = [
  { valor: 'ninguna', etiqueta: 'Sin comparación' },
  { valor: 'periodo_anterior', etiqueta: 'Período anterior' },
  { valor: 'dia_anterior', etiqueta: 'Día anterior' },
  { valor: 'semana_anterior', etiqueta: 'Semana anterior' },
  { valor: 'mes_anterior', etiqueta: 'Mes anterior' },
  { valor: 'mismo_dia_semana_anterior', etiqueta: 'Mismo día de la semana anterior' },
]

export function ComparisonSelector() {
  const { comparacion, setComparacion } = useDateRange()
  return (
    <label className="flex items-center gap-2 text-sm text-carbon/70">
      Comparar con:
      <select
        value={comparacion}
        onChange={(e) => setComparacion(e.target.value as ModoComparacion)}
        className="rounded-full border border-piedra bg-blanco px-3 py-1.5 text-xs font-semibold text-carbon outline-none focus:border-oliva"
        aria-label="Comparar con"
      >
        {OPCIONES.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
    </label>
  )
}
