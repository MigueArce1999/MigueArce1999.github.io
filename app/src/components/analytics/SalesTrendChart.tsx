import { Card, EmptyState } from '../ui/Estados'
import { formatoMoneda } from '../../lib/format'
import type { PuntoSerie } from '../../lib/analytics/serieTemporal'

// Barras simples (divs, no SVG: la altura relativa alcanza y es más simple de mantener
// responsive). Colores de marca, no arbitrarios: oliva para el periodo actual, champán para el
// comparado — mismo criterio que el resto del Dashboard (ver DonutChart/paleta.ts), nunca un
// color nuevo por gráfica.
export function SalesTrendChart({
  puntos,
  puntosComparacion,
  tituloComparacion,
}: {
  puntos: PuntoSerie[]
  puntosComparacion?: PuntoSerie[] | null
  tituloComparacion?: string
}) {
  const hayDatos = puntos.some((p) => p.ventas > 0) || (puntosComparacion?.some((p) => p.ventas > 0) ?? false)
  const maximo = Math.max(1, ...puntos.map((p) => p.ventas), ...(puntosComparacion ?? []).map((p) => p.ventas))

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-carbon">Evolución de ventas</p>
          <p className="text-xs text-carbon/50">Solo servicios completados, igual que el resto del Dashboard</p>
        </div>
        {puntosComparacion && (
          <div className="flex shrink-0 items-center gap-3 text-xs text-carbon/60">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-oliva" aria-hidden /> Actual
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-champan" aria-hidden /> {tituloComparacion ?? 'Comparado'}
            </span>
          </div>
        )}
      </div>

      {!hayDatos ? (
        <EmptyState titulo="Sin ventas en este periodo" />
      ) : (
        <div className="flex h-48 items-end gap-1.5 overflow-x-auto">
          {puntos.map((p, i) => {
            const comp = puntosComparacion?.[i]
            return (
              <div key={i} className="flex min-w-[28px] flex-1 flex-col items-center gap-1">
                <div className="flex h-40 w-full items-end justify-center gap-0.5">
                  <div
                    className="w-full rounded-t bg-oliva transition-[height]"
                    style={{ height: `${Math.max(2, (p.ventas / maximo) * 100)}%` }}
                    role="img"
                    aria-label={`${p.etiqueta}: ${formatoMoneda(p.ventas)}`}
                  />
                  {puntosComparacion && (
                    <div
                      className="w-full rounded-t bg-champan transition-[height]"
                      style={{ height: `${Math.max(2, ((comp?.ventas ?? 0) / maximo) * 100)}%` }}
                      role="img"
                      aria-label={`${tituloComparacion ?? 'Comparado'} ${p.etiqueta}: ${formatoMoneda(comp?.ventas ?? 0)}`}
                    />
                  )}
                </div>
                <span className="whitespace-nowrap text-[10px] text-carbon/50">{p.etiqueta}</span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
