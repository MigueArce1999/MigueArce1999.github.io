import { useEffect, useState } from 'react'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { listarComisiones } from '../../lib/api/empleada'
import { fechaBogotaISO, formatoFecha, formatoMoneda } from '../../lib/format'
import type { ComisionResumen } from '../../lib/types'

type Filtro = 'hoy' | 'semana' | 'mes' | 'rango'

function rangoDeFiltro(filtro: Filtro, desdeManual: string, hastaManual: string) {
  const hoy = new Date()
  if (filtro === 'hoy') {
    const desde = fechaBogotaISO(hoy)
    return { desde: `${desde}T00:00:00`, hasta: `${desde}T23:59:59` }
  }
  if (filtro === 'semana') {
    const inicio = new Date(hoy)
    inicio.setDate(inicio.getDate() - inicio.getDay())
    return { desde: inicio.toISOString(), hasta: new Date().toISOString() }
  }
  if (filtro === 'mes') {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    return { desde: inicio.toISOString(), hasta: new Date().toISOString() }
  }
  return { desde: `${desdeManual}T00:00:00`, hasta: `${hastaManual}T23:59:59` }
}

export function EmpleadaVentas() {
  const { profesional } = useAuth()
  const [filtro, setFiltro] = useState<Filtro>('mes')
  const [desdeManual, setDesdeManual] = useState(fechaBogotaISO())
  const [hastaManual, setHastaManual] = useState(fechaBogotaISO())
  const [comisiones, setComisiones] = useState<ComisionResumen[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profesional) return
    const { desde, hasta } = rangoDeFiltro(filtro, desdeManual, hastaManual)
    setComisiones(null)
    listarComisiones(profesional.id, desde, hasta).then(setComisiones).catch((e) => setError(e.message))
  }, [profesional, filtro, desdeManual, hastaManual])

  const generadas = comisiones?.filter((c) => c.valor > 0) ?? []
  const devoluciones = comisiones?.filter((c) => c.valor < 0) ?? []
  const totalVendido = generadas.reduce((acc, c) => acc + Number(c.base_calculo), 0)
  const totalComisionGenerada = comisiones?.reduce((acc, c) => acc + Number(c.valor), 0) ?? 0
  const totalLiquidado = comisiones?.filter((c) => c.estado === 'liquidada').reduce((acc, c) => acc + Number(c.valor), 0) ?? 0
  const saldoPendiente = totalComisionGenerada - totalLiquidado

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Mis ventas y ganancias</h1>

      <div className="flex flex-wrap gap-2">
        {(['hoy', 'semana', 'mes', 'rango'] as Filtro[]).map((f) => (
          <button key={f} onClick={() => setFiltro(f)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${filtro === f ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
            {f}
          </button>
        ))}
      </div>
      {filtro === 'rango' && (
        <div className="flex gap-2">
          <input type="date" value={desdeManual} onChange={(e) => setDesdeManual(e.target.value)} className="rounded-lg border border-piedra px-3 py-2 text-sm" />
          <input type="date" value={hastaManual} onChange={(e) => setHastaManual(e.target.value)} className="rounded-lg border border-piedra px-3 py-2 text-sm" />
        </div>
      )}

      {error && <ErrorState mensaje={error} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Resumen etiqueta="Vendido" valor={formatoMoneda(totalVendido)} />
        <Resumen etiqueta="Comisión generada" valor={formatoMoneda(totalComisionGenerada)} />
        <Resumen etiqueta="Comisión liquidada" valor={formatoMoneda(totalLiquidado)} />
        <Resumen etiqueta="Saldo pendiente" valor={formatoMoneda(saldoPendiente)} />
      </div>
      <p className="text-xs text-carbon/50">
        "Vendido" es el valor del servicio, no tu ganancia — tu ganancia real es la comisión. Las propinas se
        registran aparte y no están incluidas en estos totales (módulo de caja, Fase 2).
      </p>

      {!comisiones ? (
        <Cargando />
      ) : comisiones.length === 0 ? (
        <EmptyState titulo="No hay operaciones en este periodo" />
      ) : (
        <div className="flex flex-col gap-2">
          {[...generadas, ...devoluciones].map((c) => (
            <Card key={c.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-carbon">{c.servicio_nombre} · {c.cliente_nombre}</p>
                <p className="text-xs text-carbon/50">
                  {formatoFecha(c.creado_en)} · base {formatoMoneda(c.base_calculo)} · {c.estado === 'liquidada' ? 'liquidada' : 'pendiente de liquidar'}
                </p>
              </div>
              <span className={`font-semibold ${c.valor >= 0 ? 'text-exito' : 'text-error'}`}>{formatoMoneda(c.valor)}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Card className="text-center">
      <p className="text-xs text-carbon/50">{etiqueta}</p>
      <p className="mt-1 font-marca text-lg font-semibold text-carbon">{valor}</p>
    </Card>
  )
}
