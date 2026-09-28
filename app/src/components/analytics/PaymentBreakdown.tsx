import { DonutChart } from '../charts/DonutChart'
import { METODO_PAGO_ETIQUETA } from '../../lib/api/admin'
import { formatoMoneda } from '../../lib/format'
import type { AnalyticsPorMetodoPago } from '../../lib/types'

// Reutiliza DonutChart y el mismo mapeo de etiquetas que ya usa el Dashboard viejo — nada nuevo.
export function PaymentBreakdown({ filas }: { filas: AnalyticsPorMetodoPago[] }) {
  const segmentos = filas.map((f) => ({ etiqueta: METODO_PAGO_ETIQUETA[f.metodo] ?? f.metodo, valor: f.valor }))
  return <DonutChart titulo="Métodos de pago" subtitulo="Servicios y productos cobrados en el periodo" segmentos={segmentos} formatoValor={formatoMoneda} />
}
