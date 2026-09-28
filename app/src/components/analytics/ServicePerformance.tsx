import { Card, EmptyState } from '../ui/Estados'
import { formatoMoneda } from '../../lib/format'
import type { AnalyticsPorServicio } from '../../lib/types'

export function ServicePerformance({ filas }: { filas: AnalyticsPorServicio[] }) {
  return (
    <Card>
      <p className="mb-3 font-semibold text-carbon">Servicios</p>
      {filas.length === 0 ? (
        <EmptyState titulo="Sin servicios en este periodo" />
      ) : (
        <ul className="flex flex-col gap-3">
          {filas.map((f) => (
            <li key={f.servicio_id} className="flex items-center justify-between gap-3 border-b border-piedra/50 pb-3 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate font-medium text-carbon">{f.nombre}</p>
                <p className="text-xs text-carbon/50">
                  {f.cantidad} {f.cantidad === 1 ? 'realizado' : 'realizados'}
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
