import { Card, EmptyState } from '../ui/Estados'
import { formatoMoneda } from '../../lib/format'
import type { AnalyticsPorProducto } from '../../lib/types'

export function ProductPerformance({ filas }: { filas: AnalyticsPorProducto[] }) {
  return (
    <Card>
      <p className="mb-3 font-semibold text-carbon">Productos</p>
      {filas.length === 0 ? (
        <EmptyState titulo="Sin productos vendidos en este periodo" />
      ) : (
        <ul className="flex flex-col gap-3">
          {filas.map((f) => (
            <li key={f.nombre} className="flex items-center justify-between gap-3 border-b border-piedra/50 pb-3 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate font-medium text-carbon">{f.nombre}</p>
                <p className="text-xs text-carbon/50">
                  {f.categoria ?? 'Sin categoría'} · {f.cantidad} {f.cantidad === 1 ? 'unidad' : 'unidades'}
                </p>
              </div>
              <p className="shrink-0 font-semibold text-carbon">{formatoMoneda(f.ingresos)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
