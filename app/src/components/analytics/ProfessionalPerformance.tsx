import { Card, EmptyState } from '../ui/Estados'
import { formatoMoneda } from '../../lib/format'
import type { AnalyticsPorProfesional } from '../../lib/types'

// Comisión leída tal cual de `comision` (ver fn_analytics_resumen) — nunca un porcentaje
// recalculado acá, respeta la configuración real de cada profesional (regla general +
// excepciones por servicio, ver AdminComisiones/Equipo).
export function ProfessionalPerformance({ filas }: { filas: AnalyticsPorProfesional[] }) {
  return (
    <Card>
      <p className="mb-3 font-semibold text-carbon">Ventas por profesional</p>
      {filas.length === 0 ? (
        <EmptyState titulo="Sin ventas en este periodo" />
      ) : (
        <ul className="flex flex-col gap-3">
          {filas.map((f) => (
            <li key={f.profesional_id} className="flex items-center justify-between gap-3 border-b border-piedra/50 pb-3 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate font-medium text-carbon">{f.nombre}</p>
                <p className="text-xs text-carbon/50">
                  {f.clientes} {f.clientes === 1 ? 'cliente' : 'clientes'} · {f.servicios} {f.servicios === 1 ? 'servicio' : 'servicios'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-carbon">{formatoMoneda(f.ventas)}</p>
                <p className="text-xs text-carbon/50">Comisión: {formatoMoneda(f.comision)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
