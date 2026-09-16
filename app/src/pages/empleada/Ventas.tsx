import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Modal } from '../../components/ui/Modal'
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
  const [liquidacionAbierta, setLiquidacionAbierta] = useState(false)

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Mis ventas y ganancias</h1>
        <Button tamano="sm" onClick={() => setLiquidacionAbierta(true)}>Liquidar</Button>
      </div>

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

      <ModalLiquidar
        abierto={liquidacionAbierta}
        onCerrar={() => setLiquidacionAbierta(false)}
        profesionalId={profesional?.id}
      />
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

// "Liquidar" es un resumen informativo de cuánto se le debe: todas las comisiones generadas
// que todavía no pasaron por una liquidación oficial (estado != 'liquidada'), sin importar de
// qué fecha sean ni el filtro elegido arriba. No cambia el estado de ninguna comisión — la
// liquidación oficial que sí las marca como pagadas sigue siendo una acción exclusiva de
// administración (/admin/comisiones → "Liquidar periodo"), para no dejar que alguien se
// autoapruebe un pago.
function ModalLiquidar({
  abierto,
  onCerrar,
  profesionalId,
}: {
  abierto: boolean
  onCerrar: () => void
  profesionalId: string | undefined
}) {
  const [comisiones, setComisiones] = useState<ComisionResumen[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto || !profesionalId) return
    setComisiones(null)
    setError(null)
    // Rango amplio ("desde siempre" hasta ahora): lo que se debe puede venir de cualquier
    // fecha, no solo de hoy o del filtro que esté elegido arriba en la pantalla.
    listarComisiones(profesionalId, '2000-01-01T00:00:00', new Date().toISOString())
      .then(setComisiones)
      .catch((e) => setError(e.message))
  }, [abierto, profesionalId])

  const pendientes = (comisiones ?? []).filter((c) => c.estado !== 'liquidada')
  const totalPendiente = pendientes.reduce((acc, c) => acc + Number(c.valor), 0)

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Cuánto se te debe">
      <p className="mb-3 text-sm text-carbon/60">
        Comisiones generadas que todavía no han sido liquidadas. Es informativo: no marca nada
        como pagado, eso lo hace administración.
      </p>
      {error && <ErrorState mensaje={error} />}
      <div className="mb-4 rounded-lg bg-marfil px-4 py-3">
        <p className="text-xs text-carbon/50">Total que se te debe</p>
        <p className="font-marca text-3xl font-semibold text-oliva">{formatoMoneda(totalPendiente)}</p>
      </div>
      {!comisiones ? (
        <Cargando />
      ) : pendientes.length === 0 ? (
        <EmptyState titulo="No tienes comisiones pendientes de liquidar" />
      ) : (
        <div className="flex flex-col gap-1">
          {pendientes.map((c) => (
            <div key={c.id} className="flex items-center justify-between border-b border-piedra/60 py-2 text-sm last:border-0">
              <div>
                <p className="font-medium text-carbon">{c.servicio_nombre} · {c.cliente_nombre}</p>
                <p className="text-xs text-carbon/50">{formatoFecha(c.creado_en)}</p>
              </div>
              <span className={`font-semibold ${c.valor >= 0 ? 'text-exito' : 'text-error'}`}>{formatoMoneda(c.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
