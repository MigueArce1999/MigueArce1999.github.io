import { useEffect, useState } from 'react'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { resumenNegocio } from '../../lib/api/admin'
import { fechaBogotaISO, formatoMoneda } from '../../lib/format'

type Periodo = 'hoy' | 'semana' | 'mes'

function rango(periodo: Periodo) {
  const hoy = new Date()
  if (periodo === 'hoy') {
    const d = fechaBogotaISO(hoy)
    return { desde: `${d}T00:00:00`, hasta: `${d}T23:59:59` }
  }
  if (periodo === 'semana') {
    const inicio = new Date(hoy)
    inicio.setDate(inicio.getDate() - inicio.getDay())
    return { desde: inicio.toISOString(), hasta: new Date().toISOString() }
  }
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  return { desde: inicio.toISOString(), hasta: new Date().toISOString() }
}

export function AdminResumen() {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof resumenNegocio>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const { desde, hasta } = rango(periodo)
    setDatos(null)
    resumenNegocio(desde, hasta).then(setDatos).catch((e) => setError(e.message))
  }, [periodo])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Resumen del negocio</h1>
        <div className="flex gap-2">
          {(['hoy', 'semana', 'mes'] as Periodo[]).map((p) => (
            <button key={p} onClick={() => setPeriodo(p)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${periodo === p ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorState mensaje={error} />}
      {!datos ? (
        <Cargando filas={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi etiqueta="Ventas netas" valor={formatoMoneda(datos.ventasNetas)} nota="Suma de servicios completados, sin contar reservas futuras" />
            <Kpi etiqueta="Cobros recibidos" valor={formatoMoneda(datos.cobros)} nota="Dinero efectivamente recibido" />
            <Kpi etiqueta="Servicios completados" valor={String(datos.citasCompletadas)} />
            <Kpi etiqueta="Ticket promedio" valor={formatoMoneda(datos.ticketPromedio)} nota="Ventas netas ÷ servicios completados" />
            <Kpi etiqueta="Cancelaciones" valor={String(datos.cancelaciones)} />
            <Kpi etiqueta="Inasistencias" valor={String(datos.inasistencias)} />
            <Kpi etiqueta="Comisiones generadas" valor={formatoMoneda(datos.comisionesGeneradas)} />
            <Kpi etiqueta="Comisiones pendientes" valor={formatoMoneda(datos.comisionesPendientes)} nota="Aún no liquidadas" />
          </div>
          <p className="text-xs text-carbon/50">
            No se muestra utilidad neta porque este resumen todavía no incluye gastos (módulo de Fase 2).
            Los indicadores de clientes nuevos/recurrentes están pendientes de una consulta comparativa por periodo.
          </p>
        </>
      )}
    </div>
  )
}

function Kpi({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <Card>
      <p className="text-xs text-carbon/50">{etiqueta}</p>
      <p className="mt-1 font-marca text-xl font-semibold text-carbon">{valor}</p>
      {nota && <p className="mt-1 text-[11px] text-carbon/40">{nota}</p>}
    </Card>
  )
}
