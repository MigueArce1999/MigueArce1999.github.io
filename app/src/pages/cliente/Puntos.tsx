import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { IconoTrofeo } from '../../components/ui/Icons'
import { TarjetaFidelizacion } from '../../components/fidelizacion/TarjetaFidelizacion'
import { CanjeCelebracion } from '../../components/fidelizacion/CanjeCelebracion'
import { useAuth } from '../../state/AuthContext'
import { useMiFidelizacion } from '../../lib/fidelizacion/useMiFidelizacion'
import { useCelebracionCanje } from '../../lib/fidelizacion/useCelebracionCanje'
import { calcularRangoMes, etiquetaMes } from '../../lib/analytics/rangoFecha'
import {
  autocanjearRecompensa,
  elegirMetaRecompensa,
  listarMisCanjes,
  listarMovimientosPuntosPagina,
  listarRecompensasActivas,
  obtenerRankingPuntosMes,
} from '../../lib/api/fidelizacion'
import { formatoEnteroCOP, formatoFecha } from '../../lib/format'
import type { CanjeRecompensa, MovimientoPuntos, PuestoRankingPuntos, Recompensa } from '../../lib/types'

const etiquetasMovimiento: Record<string, string> = {
  abono: 'Ganaste puntos',
  canje: 'Usaste puntos en un regalo',
  reversion: 'Ajuste por una devolución',
  ajuste: 'Ajuste del salón',
  vencimiento: 'Vencimiento',
}

export function ClientePuntos() {
  const { cliente, perfil } = useAuth()
  const { fidelizacion, cargando: cargandoFidelizacion, error: errorFidelizacion, celebraciones, recargar, reconocerCelebracion } =
    useMiFidelizacion(cliente?.id)
  const { celebracionActiva } = useCelebracionCanje(celebraciones, fidelizacion, reconocerCelebracion)
  const [recompensas, setRecompensas] = useState<Recompensa[] | null>(null)
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Recompensa | null>(null)
  const [guardandoMeta, setGuardandoMeta] = useState<string | null>(null)
  const [ultimoCanje, setUltimoCanje] = useState<CanjeRecompensa | null | undefined>(undefined)
  const [autocanjeando, setAutocanjeando] = useState(false)
  const [errorAutocanje, setErrorAutocanje] = useState<string | null>(null)

  function recargarUltimoCanje() {
    if (!cliente) return
    listarMisCanjes(cliente.id)
      .then((canjes) => setUltimoCanje(canjes.find((c) => c.estado === 'confirmado') ?? null))
      .catch(() => setUltimoCanje(null))
  }

  useEffect(recargarUltimoCanje, [cliente])

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

  // Autocanje desde el propio perfil (sin pasar por un cobro de Atender): la clienta pide su
  // recompensa ella misma. Después de que el servidor confirme, se recarga la fidelización —
  // eso trae el saldo nuevo Y la notificación canje_confirmado, que useCelebracionCanje ya
  // detecta sola y dispara la MISMA animación que el canje hecho durante un cobro (ninguna
  // lógica de celebración nueva, se reutiliza tal cual).
  async function autocanjear(recompensa: Recompensa) {
    if (!cliente || autocanjeando) return
    setAutocanjeando(true)
    setErrorAutocanje(null)
    const idempotencyKey = `autocanje-${cliente.id}-${recompensa.id}-${Date.now()}`
    try {
      await autocanjearRecompensa(cliente.id, recompensa.id, idempotencyKey)
      setDetalle(null)
      recargar()
      recargarUltimoCanje()
      cargarCatalogo()
    } catch (e: any) {
      setErrorAutocanje(e.message)
    } finally {
      setAutocanjeando(false)
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

      <RankingPuntosMes />

      {ultimoCanje && <TarjetaUltimoCanje canje={ultimoCanje} saldoActual={fidelizacion?.saldo ?? null} />}

      {celebracionActiva && (
        <CanjeCelebracion
          datos={celebracionActiva.datos}
          fidelizacion={fidelizacion}
          onCerrar={() => reconocerCelebracion(celebracionActiva.id)}
        />
      )}

      <div id="catalogo">
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

      <DetalleRecompensaModal
        recompensa={detalle}
        saldo={fidelizacion?.saldo ?? 0}
        canjesActivos={fidelizacion?.canjes_activo ?? false}
        autocanjeando={autocanjeando}
        error={errorAutocanje}
        onCerrar={() => { setDetalle(null); setErrorAutocanje(null) }}
        onCanjear={autocanjear}
      />
    </div>
  )
}

// "Clienta del mes": motiva mostrando quién va ganando más puntos este mes (nunca el saldo
// disponible — un canje a mitad de mes no baja a nadie del ranking). Si falla, se oculta sola en
// vez de romper el resto de la página — es un extra motivacional, no algo crítico para cobrar o
// canjear. Los nombres de las demás clientas ya vienen abreviados desde el servidor
// (fn_ranking_puntos_mes, 0074); nunca se le pide o recorta nada acá.
function RankingPuntosMes() {
  const [ranking, setRanking] = useState<PuestoRankingPuntos[] | null>(null)

  useEffect(() => {
    setRanking(null)
    const { desde, hasta } = calcularRangoMes(0)
    obtenerRankingPuntosMes(desde.toISOString(), hasta.toISOString(), 5)
      .then(setRanking)
      .catch(() => setRanking([]))
  }, [])

  if (ranking === null) return <Cargando filas={2} />
  if (ranking.length === 0) return null

  const top = ranking.filter((f) => f.dentro_del_top)
  const miFila = ranking.find((f) => f.soy_yo && !f.dentro_del_top)

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <IconoTrofeo className="h-5 w-5 text-oliva" />
        <p className="font-semibold text-carbon">Clienta del mes · {etiquetaMes(0)}</p>
      </div>
      <p className="text-xs text-carbon/60">Quién más puntos ha ganado este mes — ¡gánate el premio siendo la número 1!</p>
      <div className="flex flex-col gap-1.5">
        {top.map((fila) => (
          <div key={fila.cliente_id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${fila.soy_yo ? 'bg-oliva/10' : ''}`}>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                fila.posicion === 1 ? 'bg-oliva text-blanco' : 'bg-piedra/50 text-carbon/70'
              }`}
            >
              {fila.posicion}
            </span>
            <p className={`flex-1 text-sm ${fila.soy_yo ? 'font-semibold text-carbon' : 'text-carbon/80'}`}>
              {fila.nombre}
              {fila.soy_yo ? ' (tú)' : ''}
            </p>
            <p className="text-sm font-semibold text-oliva">{formatoEnteroCOP(fila.puntos_ganados)} pts</p>
          </div>
        ))}
      </div>
      {miFila && (
        <p className="border-t border-piedra pt-2 text-sm text-carbon/70">
          Vas en el puesto <span className="font-semibold text-carbon">#{miFila.posicion}</span> con {formatoEnteroCOP(miFila.puntos_ganados)} puntos este mes.
        </p>
      )}
    </Card>
  )
}

// Resumen persistente del último canje (sección 8 del pedido de mejora visual): queda
// disponible SIEMPRE, sin depender de la animación ni de si ya se reconoció la notificación —
// lee directo de canje_recompensa, la fuente de verdad que el servidor congeló en ese instante.
function TarjetaUltimoCanje({ canje, saldoActual }: { canje: CanjeRecompensa; saldoActual: number | null }) {
  const saldoDistinto = canje.saldo_posterior != null && saldoActual != null && canje.saldo_posterior !== saldoActual
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Recompensa canjeada</p>
        {canje.entregado && (
          <span className="rounded-full bg-exito/15 px-2 py-0.5 text-xs font-semibold text-exito">Entregada</span>
        )}
      </div>
      <p className="font-semibold text-carbon">{canje.condiciones_snapshot.nombre}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-carbon/70 sm:grid-cols-4">
        {canje.saldo_anterior != null && (
          <div>
            <p className="text-xs text-carbon/50">Saldo anterior</p>
            <p className="font-medium text-carbon">{formatoEnteroCOP(canje.saldo_anterior)}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-carbon/50">Puntos utilizados</p>
          <p className="font-medium text-error">−{formatoEnteroCOP(canje.costo_puntos_snapshot)}</p>
        </div>
        {canje.saldo_posterior != null && (
          <div>
            <p className="text-xs text-carbon/50">Saldo al finalizar</p>
            <p className="font-medium text-carbon">{formatoEnteroCOP(canje.saldo_posterior)}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-carbon/50">Fecha</p>
          <p className="font-medium text-carbon">{formatoFecha(canje.creado_en)}</p>
        </div>
      </div>
      {saldoDistinto && (
        <p className="text-xs text-carbon/50">
          Tu saldo disponible ahora es {formatoEnteroCOP(saldoActual!)} puntos — cambió por movimientos posteriores a este canje.
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <a href="#catalogo"><Button tamano="sm" variante="secondary">Ver recompensas</Button></a>
        <a href="#historial"><Button tamano="sm" variante="ghost">Ver movimiento</Button></a>
      </div>
    </Card>
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

function DetalleRecompensaModal({
  recompensa,
  saldo,
  canjesActivos,
  autocanjeando,
  error,
  onCerrar,
  onCanjear,
}: {
  recompensa: Recompensa | null
  saldo: number
  canjesActivos: boolean
  autocanjeando: boolean
  error: string | null
  onCerrar: () => void
  onCanjear: (recompensa: Recompensa) => void
}) {
  const [confirmando, setConfirmando] = useState(false)

  // El estado de confirmación es propio de CADA recompensa que se está viendo — si se cierra el
  // modal o se abre una distinta, nunca debe quedar "armado" un canje de la anterior.
  useEffect(() => setConfirmando(false), [recompensa?.id])

  if (!recompensa) return null

  const agotada = !recompensa.stock_ilimitado && (recompensa.cantidad_disponible ?? 0) <= 0
  const alcanza = saldo >= recompensa.costo_puntos

  return (
    <Modal abierto={true} onCerrar={onCerrar} titulo={recompensa.nombre}>
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

        {error && <ErrorState mensaje={error} />}

        {agotada ? (
          <p className="rounded-lg bg-champan/15 px-3 py-2 text-carbon/80">Esta recompensa se agotó por ahora.</p>
        ) : !canjesActivos ? (
          <p className="rounded-lg bg-champan/15 px-3 py-2 text-carbon/80">Los canjes están en pausa por ahora — vuelve a intentarlo más tarde.</p>
        ) : !alcanza ? (
          <p className="rounded-lg bg-champan/15 px-3 py-2 text-carbon/80">
            Te faltan {formatoEnteroCOP(recompensa.costo_puntos - saldo)} puntos para poder canjearla.
          </p>
        ) : confirmando ? (
          <div className="flex flex-col gap-2 rounded-lg border border-oliva/30 bg-oliva/5 px-3 py-3">
            <p className="text-carbon">
              ¿Confirmas usar <span className="font-semibold">{formatoEnteroCOP(recompensa.costo_puntos)} puntos</span> en esta recompensa?
              Preséntate en el salón para reclamarla.
            </p>
            <div className="flex gap-2">
              <Button tamano="sm" onClick={() => onCanjear(recompensa)} cargando={autocanjeando}>Sí, canjear</Button>
              <Button tamano="sm" variante="ghost" onClick={() => setConfirmando(false)} disabled={autocanjeando}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button tamano="md" onClick={() => setConfirmando(true)} className="self-start">Canjear ahora</Button>
        )}
      </div>
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
