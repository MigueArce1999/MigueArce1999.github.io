import { useEffect, useState } from 'react'
import { ErrorState } from '../../components/ui/Estados'
import { AnalyticsKPICard } from '../../components/analytics/AnalyticsKPICard'
import { ComparisonSelector } from '../../components/analytics/ComparisonSelector'
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter'
import { PaymentBreakdown } from '../../components/analytics/PaymentBreakdown'
import { ProductPerformance } from '../../components/analytics/ProductPerformance'
import { ProfessionalPerformance } from '../../components/analytics/ProfessionalPerformance'
import { SalesTable } from '../../components/analytics/SalesTable'
import { SalesTrendChart } from '../../components/analytics/SalesTrendChart'
import { ServicePerformance } from '../../components/analytics/ServicePerformance'
import { obtenerAnalytics } from '../../lib/api/analytics'
import { listarProfesionales } from '../../lib/api/catalogo'
import { calcularVariacion, elegirGranularidad } from '../../lib/analytics/rangoFecha'
import { agruparSerieDiaria, bucketPorHora } from '../../lib/analytics/serieTemporal'
import { listarVentasDetalle } from '../../lib/api/admin'
import { formatoMoneda } from '../../lib/format'
import { useDateRange } from '../../state/DateRangeContext'
import type { AnalyticsResumen, Profesional } from '../../lib/types'

export function AdminDashboard() {
  const { rango, rangoComparacion, comparacion } = useDateRange()
  const [datos, setDatos] = useState<AnalyticsResumen | null>(null)
  const [datosComparacion, setDatosComparacion] = useState<AnalyticsResumen | null>(null)
  const [puntosHora, setPuntosHora] = useState<ReturnType<typeof bucketPorHora> | null>(null)
  const [equipo, setEquipo] = useState<Profesional[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarProfesionales().then(setEquipo).catch(() => {})
  }, [])

  useEffect(() => {
    setDatos(null)
    setDatosComparacion(null)
    setError(null)
    obtenerAnalytics(rango).then(setDatos).catch((e) => setError(e.message))
    if (rangoComparacion) {
      obtenerAnalytics(rangoComparacion).then(setDatosComparacion).catch(() => setDatosComparacion(null))
    }
  }, [rango, rangoComparacion])

  const granularidad = elegirGranularidad(rango)

  // Granularidad "hora" (un solo día): fn_analytics_resumen agrega por día en el servidor, no
  // por hora — se arma aparte a partir de listarVentasDetalle, reutilizada tal cual (misma
  // función que ya usa la tabla de Ventas), sin pedirle una segunda cosa al servidor.
  useEffect(() => {
    if (granularidad !== 'hora') {
      setPuntosHora(null)
      return
    }
    listarVentasDetalle(rango.desde.toISOString(), rango.hasta.toISOString())
      .then((filas) => setPuntosHora(bucketPorHora(filas)))
      .catch(() => setPuntosHora(null))
  }, [granularidad, rango])

  const puntosSerie = granularidad === 'hora' ? puntosHora : datos ? agruparSerieDiaria(datos.serie_diaria, granularidad) : null
  const puntosSerieComparacion =
    datosComparacion && granularidad !== 'hora' ? agruparSerieDiaria(datosComparacion.serie_diaria, granularidad) : null

  const hayComparacion = comparacion !== 'ninguna'
  const variacion = (actual: number, campo: keyof AnalyticsResumen['kpis']) =>
    hayComparacion && datosComparacion ? calcularVariacion(actual, datosComparacion.kpis[campo] as number) : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-marca text-2xl font-semibold text-carbon">Dashboard</h1>
          <DateRangeFilter />
        </div>
        <ComparisonSelector />
      </div>

      {error && <ErrorState mensaje={error} />}

      {!datos ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-piedra/50" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <AnalyticsKPICard etiqueta="Ventas totales" valor={formatoMoneda(datos.kpis.ventas_totales)} variacion={variacion(datos.kpis.ventas_totales, 'ventas_totales')} />
            <AnalyticsKPICard etiqueta="Clientes atendidos" valor={String(datos.kpis.clientes_atendidos)} variacion={variacion(datos.kpis.clientes_atendidos, 'clientes_atendidos')} />
            <AnalyticsKPICard etiqueta="Servicios realizados" valor={String(datos.kpis.servicios_realizados)} variacion={variacion(datos.kpis.servicios_realizados, 'servicios_realizados')} />
            <AnalyticsKPICard etiqueta="Ticket promedio" valor={formatoMoneda(datos.kpis.ticket_promedio)} variacion={variacion(datos.kpis.ticket_promedio, 'ticket_promedio')} />
            <AnalyticsKPICard
              etiqueta="Productos"
              valor={formatoMoneda(datos.kpis.productos_valor)}
              variacion={variacion(datos.kpis.productos_valor, 'productos_valor')}
              nota={`${datos.kpis.productos_unidades} unidades`}
            />
          </div>

          {puntosSerie && (
            <SalesTrendChart
              puntos={puntosSerie}
              puntosComparacion={hayComparacion ? puntosSerieComparacion : null}
              tituloComparacion="Periodo anterior"
            />
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ProfessionalPerformance filas={datos.por_profesional} />
            <ServicePerformance filas={datos.por_servicio} />
            <PaymentBreakdown filas={datos.por_metodo_pago} />
          </div>

          <ProductPerformance filas={datos.por_producto} />

          <SalesTable rango={rango} equipo={equipo} />
        </>
      )}
    </div>
  )
}
