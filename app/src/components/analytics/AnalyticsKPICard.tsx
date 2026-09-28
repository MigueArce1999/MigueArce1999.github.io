import { Card } from '../ui/Estados'
import type { Variacion } from '../../lib/analytics/rangoFecha'

// undefined = no se pidió comparación (no se muestra nada debajo del valor);
// null = sí se pidió, pero el periodo anterior fue $0 → "Sin referencia anterior", nunca +∞%.
export function AnalyticsKPICard({
  etiqueta,
  valor,
  variacion,
  etiquetaComparacion,
  nota,
}: {
  etiqueta: string
  valor: string
  variacion?: Variacion | null
  etiquetaComparacion?: string
  nota?: string
}) {
  return (
    <Card>
      <p className="text-xs text-carbon/50">{etiqueta}</p>
      <p className="mt-1 font-marca text-xl font-semibold text-carbon">{valor}</p>
      {variacion !== undefined &&
        (variacion === null ? (
          <p className="mt-1 text-[11px] text-carbon/40">Sin referencia anterior</p>
        ) : (
          <p
            className={`mt-1 text-xs font-semibold ${
              variacion.direccion === 'up' ? 'text-exito' : variacion.direccion === 'down' ? 'text-error' : 'text-carbon/50'
            }`}
          >
            <span aria-hidden>{variacion.direccion === 'up' ? '↑' : variacion.direccion === 'down' ? '↓' : '→'}</span>{' '}
            {Math.abs(variacion.valor).toFixed(1)}%
            {etiquetaComparacion && <span className="ml-1 font-normal text-carbon/40">{etiquetaComparacion}</span>}
          </p>
        ))}
      {nota && <p className="mt-1 text-[11px] text-carbon/40">{nota}</p>}
    </Card>
  )
}
