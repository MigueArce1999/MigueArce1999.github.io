import { useEffect, useState } from 'react'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { resumenNegocio } from '../../lib/api/admin'
import { obtenerPagadoNetoEnPeriodo } from '../../lib/api/gastos'
import { formatoMoneda, rangoPeriodo, type PeriodoResumen } from '../../lib/format'
import { isDemoMode } from '../../lib/supabase'

export function AdminResumen() {
  const [periodo, setPeriodo] = useState<PeriodoResumen>('mes')
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof resumenNegocio>> | null>(null)
  // Pagos de gastos del mismo periodo (efectivo Y banco, netos de reversiones) — nunca se
  // vuelve a restar aparte una comisión o una compra: ambas ya llegan aquí como un pago de
  // gasto más (liquidación/compra), así que restarlas de nuevo sería descontarlas dos veces.
  const [pagosGastos, setPagosGastos] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const { desde, hasta } = rangoPeriodo(periodo)
    setDatos(null)
    setPagosGastos(null)
    resumenNegocio(desde, hasta).then(setDatos).catch((e) => setError(e.message))
    if (isDemoMode) {
      setPagosGastos(0)
    } else {
      obtenerPagadoNetoEnPeriodo(desde, hasta).then(setPagosGastos).catch((e) => setError(e.message))
    }
  }, [periodo])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Resumen del negocio</h1>
        <div className="flex gap-2">
          {(['hoy', 'semana', 'mes'] as PeriodoResumen[]).map((p) => (
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
            <Kpi
              etiqueta="Flujo neto"
              valor={pagosGastos === null ? '—' : formatoMoneda(datos.cobros - pagosGastos)}
              nota="Cobros recibidos menos pagos de gastos del periodo (efectivo y banco, netos de reversiones)"
            />
          </div>
          <p className="text-xs text-carbon/50">
            "Flujo neto" es cobros menos pagos de gastos — no es ganancia real: no descuenta el costo de los insumos
            consumidos en cada servicio (ese módulo de compras/inventario todavía no existe) ni distingue retiros del
            dueño de gastos operativos. Los indicadores de clientes nuevos/recurrentes están pendientes de una
            consulta comparativa por periodo.
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
