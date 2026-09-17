import { useEffect, useState } from 'react'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { DonutChart } from '../../components/charts/DonutChart'
import { metricasVentasDashboard, resumenNegocio } from '../../lib/api/admin'
import { formatoMoneda, rangoPeriodo, type PeriodoResumen } from '../../lib/format'

export function AdminDashboard() {
  const [periodo, setPeriodo] = useState<PeriodoResumen>('mes')
  const [resumen, setResumen] = useState<Awaited<ReturnType<typeof resumenNegocio>> | null>(null)
  const [metricas, setMetricas] = useState<Awaited<ReturnType<typeof metricasVentasDashboard>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const { desde, hasta } = rangoPeriodo(periodo)
    setResumen(null)
    setMetricas(null)
    setError(null)
    Promise.all([resumenNegocio(desde, hasta), metricasVentasDashboard(desde, hasta)])
      .then(([r, m]) => {
        setResumen(r)
        setMetricas(m)
      })
      .catch((e) => setError(e.message))
  }, [periodo])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Dashboard</h1>
        <div className="flex gap-2">
          {(['hoy', 'semana', 'mes'] as PeriodoResumen[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${periodo === p ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorState mensaje={error} />}
      {!resumen || !metricas ? (
        <Cargando filas={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi etiqueta="Ventas netas" valor={formatoMoneda(resumen.ventasNetas)} />
            <Kpi etiqueta="Cobros recibidos" valor={formatoMoneda(resumen.cobros)} />
            <Kpi etiqueta="Servicios completados" valor={String(resumen.citasCompletadas)} />
            <Kpi etiqueta="Ticket promedio" valor={formatoMoneda(resumen.ticketPromedio)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <DonutChart
                titulo="Ventas por profesional"
                subtitulo="Servicios completados, sin contar productos"
                segmentos={metricas.ventasPorProfesional}
                formatoValor={formatoMoneda}
              />
            </Card>
            <Card>
              <DonutChart
                titulo="Ventas por servicio"
                subtitulo="Los 5 más vendidos; el resto en “Otros”"
                segmentos={metricas.ventasPorServicio}
                formatoValor={formatoMoneda}
              />
            </Card>
            <Card>
              <DonutChart
                titulo="Por método de pago"
                subtitulo="Dinero efectivamente cobrado"
                segmentos={metricas.ventasPorMetodoPago}
                formatoValor={formatoMoneda}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Card>
      <p className="text-xs text-carbon/50">{etiqueta}</p>
      <p className="mt-1 font-marca text-xl font-semibold text-carbon">{valor}</p>
    </Card>
  )
}
