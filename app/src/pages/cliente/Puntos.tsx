import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { TarjetaFidelizacion } from '../../components/fidelizacion/TarjetaFidelizacion'
import { useAuth } from '../../state/AuthContext'
import { useMiFidelizacion } from '../../lib/fidelizacion/useMiFidelizacion'
import {
  elegirMetaRecompensa,
  listarMovimientosPuntosPagina,
  listarRecompensasActivas,
} from '../../lib/api/fidelizacion'
import { formatoEnteroCOP, formatoFecha } from '../../lib/format'
import type { MovimientoPuntos, Recompensa } from '../../lib/types'

const etiquetasMovimiento: Record<string, string> = {
  abono: 'Ganaste puntos',
  canje: 'Usaste puntos en un regalo',
  reversion: 'Ajuste por una devolución',
  ajuste: 'Ajuste del salón',
  vencimiento: 'Vencimiento',
}

export function ClientePuntos() {
  const { cliente, perfil } = useAuth()
  const { fidelizacion, cargando: cargandoFidelizacion, error: errorFidelizacion, recargar } = useMiFidelizacion(cliente?.id)
  const [recompensas, setRecompensas] = useState<Recompensa[] | null>(null)
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Recompensa | null>(null)
  const [guardandoMeta, setGuardandoMeta] = useState<string | null>(null)

  function cargarCatalogo() {
    setErrorCatalogo(null)
    setRecompensas(null)
    listarRecompensasActivas().then(setRecompensas).catch((e) => setErrorCatalogo(e.message))
  }

  useEffect(cargarCatalogo, [])

  async function elegirMeta(recompensaId: string) {
    if (!cliente) return
    setGuardandoMeta(recompensaId)
    try {
      await elegirMetaRecompensa(cliente.id, recompensaId)
      recargar()
    } finally {
      setGuardandoMeta(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-marca text-2xl font-semibold text-carbon">Mis recompensas</h1>
        <p className="text-sm text-carbon/60">Elige tu próxima meta y descubre qué puedes canjear con tus puntos.</p>
      </div>

      <TarjetaFidelizacion
        nombreClienta={perfil?.nombre}
        fidelizacion={fidelizacion}
        cargando={cargandoFidelizacion}
        error={errorFidelizacion}
        onReintentar={recargar}
      />

      <div>
        <p className="mb-3 font-semibold text-carbon">Catálogo de recompensas</p>
        {!fidelizacion?.canjes_activo && fidelizacion && (
          <p className="mb-3 rounded-lg bg-champan/15 px-3 py-2 text-sm text-carbon/70">
            Los canjes están en pausa por ahora — puedes ver el catálogo, pero no se pueden usar puntos todavía.
          </p>
        )}
        {errorCatalogo && <ErrorState mensaje={errorCatalogo} reintentar={cargarCatalogo} />}
        {!recompensas && !errorCatalogo ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Cargando filas={2} /><Cargando filas={2} />
          </div>
        ) : recompensas && recompensas.length === 0 ? (
          <EmptyState titulo="Pronto encontrarás nuevos regalos aquí" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recompensas?.map((r) => (
              <TarjetaRecompensa
                key={r.id}
                recompensa={r}
                saldo={fidelizacion?.saldo ?? 0}
                esMeta={fidelizacion?.meta?.id === r.id}
                canjesActivos={fidelizacion?.canjes_activo ?? false}
                guardandoMeta={guardandoMeta === r.id}
                onVerDetalle={() => setDetalle(r)}
                onElegirMeta={() => elegirMeta(r.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div id="historial">
        <HistorialPuntos clienteId={cliente?.id} />
      </div>

      <DetalleRecompensaModal recompensa={detalle} onCerrar={() => setDetalle(null)} />
    </div>
  )
}

function TarjetaRecompensa({
  recompensa,
  saldo,
  esMeta,
  canjesActivos,
  guardandoMeta,
  onVerDetalle,
  onElegirMeta,
}: {
  recompensa: Recompensa
  saldo: number
  esMeta: boolean
  canjesActivos: boolean
  guardandoMeta: boolean
  onVerDetalle: () => void
  onElegirMeta: () => void
}) {
  const agotada = !recompensa.stock_ilimitado && (recompensa.cantidad_disponible ?? 0) <= 0
  const alcanza = saldo >= recompensa.costo_puntos

  let estado: { texto: string; clase: string }
  if (agotada) {
    estado = { texto: 'Agotada', clase: 'bg-piedra text-carbon/60' }
  } else if (!canjesActivos) {
    estado = { texto: 'No disponible temporalmente', clase: 'bg-piedra text-carbon/60' }
  } else if (alcanza) {
    estado = { texto: 'Disponible para canjear', clase: 'bg-exito/15 text-exito' }
  } else {
    estado = { texto: `Te faltan ${formatoEnteroCOP(recompensa.costo_puntos - saldo)} puntos`, clase: 'bg-champan/20 text-carbon/70' }
  }

  return (
    <Card className="flex flex-col gap-3">
      {recompensa.imagen_url && (
        <img src={recompensa.imagen_url} alt="" className="h-32 w-full rounded-lg object-cover" />
      )}
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-carbon">{recompensa.nombre}</p>
          {esMeta && <span className="shrink-0 rounded-full bg-oliva px-2 py-0.5 text-xs font-semibold text-blanco">Tu meta</span>}
        </div>
        {recompensa.descripcion && <p className="mt-1 text-sm text-carbon/60">{recompensa.descripcion}</p>}
      </div>
      <p className="text-sm font-semibold text-oliva">{formatoEnteroCOP(recompensa.costo_puntos)} puntos</p>
      <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${estado.clase}`}>{estado.texto}</span>
      <div className="flex flex-wrap gap-2">
        <Button tamano="sm" variante="secondary" onClick={onVerDetalle}>Ver detalle</Button>
        {!esMeta && !agotada && (
          <Button tamano="sm" variante="outline" onClick={onElegirMeta} cargando={guardandoMeta}>Elegir como meta</Button>
        )}
      </div>
    </Card>
  )
}

function DetalleRecompensaModal({ recompensa, onCerrar }: { recompensa: Recompensa | null; onCerrar: () => void }) {
  return (
    <Modal abierto={recompensa !== null} onCerrar={onCerrar} titulo={recompensa?.nombre ?? ''}>
      {recompensa && (
        <div className="flex flex-col gap-3 text-sm text-carbon">
          {recompensa.imagen_url && <img src={recompensa.imagen_url} alt="" className="h-40 w-full rounded-lg object-cover" />}
          {recompensa.descripcion && <p>{recompensa.descripcion}</p>}
          <p className="font-semibold text-oliva">{formatoEnteroCOP(recompensa.costo_puntos)} puntos</p>
          {recompensa.tipo === 'beneficio' && recompensa.servicio_nombre && (
            <p><span className="font-semibold">Incluye:</span> {recompensa.servicio_nombre}</p>
          )}
          {recompensa.tipo === 'descuento_fijo' && recompensa.monto_descuento && (
            <p><span className="font-semibold">Descuento:</span> {formatoEnteroCOP(recompensa.monto_descuento)} COP sobre servicios elegibles.</p>
          )}
          {recompensa.condiciones && (
            <p className="text-carbon/60"><span className="font-semibold text-carbon">Condiciones:</span> {recompensa.condiciones}</p>
          )}
          <p className="rounded-lg bg-champan/15 px-3 py-2 text-carbon/80">
            Solicita esta recompensa durante tu próxima visita. La aplicaremos al confirmar tu atención.
          </p>
        </div>
      )}
    </Modal>
  )
}

function HistorialPuntos({ clienteId }: { clienteId: string | undefined }) {
  const [pagina, setPagina] = useState(0)
  const [movimientos, setMovimientos] = useState<MovimientoPuntos[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const porPagina = 10

  useEffect(() => {
    if (!clienteId) return
    setMovimientos(null)
    setError(null)
    listarMovimientosPuntosPagina(clienteId, pagina, porPagina)
      .then(({ movimientos, total }) => { setMovimientos(movimientos); setTotal(total) })
      .catch((e) => setError(e.message))
  }, [clienteId, pagina])

  return (
    <div>
      <p className="mb-3 font-semibold text-carbon">Historial de puntos</p>
      {error && <ErrorState mensaje={error} />}
      {!movimientos ? (
        <Cargando />
      ) : movimientos.length === 0 ? (
        <EmptyState titulo="Todavía no tienes movimientos de puntos" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {movimientos.map((m) => (
              <Card key={m.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-carbon">{etiquetasMovimiento[m.tipo] ?? m.tipo}</p>
                  <p className="text-xs text-carbon/50">{formatoFecha(m.creado_en)}</p>
                  {m.motivo && <p className="text-xs text-carbon/50">Motivo: {m.motivo}</p>}
                </div>
                <span className={`font-semibold ${Number(m.puntos) >= 0 ? 'text-exito' : 'text-error'}`}>
                  {Number(m.puntos) >= 0 ? '+' : ''}{formatoEnteroCOP(Number(m.puntos))}
                </span>
              </Card>
            ))}
          </div>
          {total > porPagina && (
            <div className="mt-3 flex items-center justify-between">
              <Button tamano="sm" variante="ghost" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>← Más recientes</Button>
              <span className="text-xs text-carbon/50">Página {pagina + 1} de {Math.ceil(total / porPagina)}</span>
              <Button tamano="sm" variante="ghost" disabled={(pagina + 1) * porPagina >= total} onClick={() => setPagina((p) => p + 1)}>Más antiguos →</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
