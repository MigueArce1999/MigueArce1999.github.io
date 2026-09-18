import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { CampoMoneda, Input, Select, Textarea } from '../../components/ui/Campos'
import { Cargando, ErrorState } from '../../components/ui/Estados'
import {
  anularGasto,
  duplicarGasto,
  listarEventosDeGasto,
  listarPagosDeGasto,
  obtenerUrlComprobante,
  registrarPagoGasto,
  revertirPagoGasto,
  subirComprobante,
  TIPOS_COMPROBANTE_PERMITIDOS,
} from '../../lib/api/gastos'
import { fechaBogotaISO, formatoFecha, formatoFechaHora, formatoMoneda } from '../../lib/format'
import type { Gasto, GastoEvento, GastoPago, MetodoPago } from '../../lib/types'

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente',
  pago_parcial: 'Pago parcial',
  pagado: 'Pagado',
  anulado: 'Anulado',
}

const ETIQUETA_EVENTO: Record<string, string> = {
  creado: 'Gasto creado',
  editado: 'Gasto editado',
  pago_registrado: 'Pago registrado',
  pago_revertido: 'Pago revertido',
  anulado: 'Gasto anulado',
}

function claveTemporal() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function GastosDetalle({
  gasto,
  cuentas,
  onEditar,
  onDuplicado,
  onCambio,
  onCerrar,
}: {
  gasto: Gasto
  cuentas: { id: string; nombre: string; activa: boolean }[]
  onEditar: () => void
  onDuplicado: (nuevo: Gasto) => void
  onCambio: (actualizado: Gasto) => void
  onCerrar: () => void
}) {
  const [pagos, setPagos] = useState<GastoPago[]>([])
  const [eventos, setEventos] = useState<GastoEvento[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [urlComprobante, setUrlComprobante] = useState<string | null>(null)

  const [mostrarFormularioPago, setMostrarFormularioPago] = useState(false)
  const [mostrarAnular, setMostrarAnular] = useState(false)
  const [pagoARevertir, setPagoARevertir] = useState<GastoPago | null>(null)
  const [accionEnCurso, setAccionEnCurso] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const [p, e] = await Promise.all([listarPagosDeGasto(gasto.id), listarEventosDeGasto(gasto.id)])
      setPagos(p)
      setEventos(e)
      if (gasto.comprobante_path) {
        obtenerUrlComprobante(gasto.comprobante_path).then(setUrlComprobante).catch(() => setUrlComprobante(null))
      } else {
        setUrlComprobante(null)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gasto.id])

  async function duplicar() {
    setAccionEnCurso(true)
    setErrorAccion(null)
    try {
      const nuevo = await duplicarGasto(gasto.id)
      onDuplicado(nuevo)
    } catch (e: any) {
      setErrorAccion(e.message)
    } finally {
      setAccionEnCurso(false)
    }
  }

  const puedeAnular = !gasto.anulado && gasto.total_pagado <= 0
  const puedeEditar = !gasto.anulado

  return (
    <div className="flex flex-col gap-5">
      {error && <ErrorState mensaje={error} reintentar={cargar} />}
      {errorAccion && <ErrorState mensaje={errorAccion} />}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-carbon">{gasto.concepto}</h3>
          <p className="text-sm text-carbon/60">{gasto.categoria_nombre}{gasto.proveedor_nombre ? ` · ${gasto.proveedor_nombre}` : ''}</p>
        </div>
        <EtiquetaEstado gasto={gasto} />
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-xl border border-piedra p-3.5 text-center">
        <div>
          <p className="text-xs text-carbon/50">Valor total</p>
          <p className="font-semibold text-carbon">{formatoMoneda(gasto.valor_total)}</p>
        </div>
        <div>
          <p className="text-xs text-carbon/50">Pagado</p>
          <p className="font-semibold text-oliva">{formatoMoneda(gasto.total_pagado)}</p>
        </div>
        <div>
          <p className="text-xs text-carbon/50">Saldo</p>
          <p className={`font-semibold ${gasto.saldo_pendiente > 0 && !gasto.anulado ? 'text-carbon' : 'text-carbon/40'}`}>
            {gasto.anulado ? '—' : formatoMoneda(Math.max(gasto.saldo_pendiente, 0))}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <p className="text-carbon/50">Fecha del gasto</p>
        <p className="text-carbon">{formatoFecha(gasto.fecha)}</p>
        <p className="text-carbon/50">Vencimiento</p>
        <p className="text-carbon">{gasto.fecha_vencimiento ? formatoFecha(gasto.fecha_vencimiento) : '—'}</p>
        <p className="text-carbon/50">Referencia</p>
        <p className="text-carbon">{gasto.referencia || '—'}</p>
        <p className="text-carbon/50">Origen</p>
        <p className="text-carbon">
          {gasto.origen === 'manual' ? 'Manual' : gasto.origen === 'liquidacion' ? 'Liquidación de comisiones' : 'Compra'}
          {gasto.origen !== 'manual' && <span className="ml-1 text-xs text-carbon/40">(vinculado, no editable a mano)</span>}
        </p>
        <p className="text-carbon/50">Registrado por</p>
        <p className="text-carbon">{gasto.creado_por_nombre || '—'}</p>
        {gasto.notas && (
          <>
            <p className="text-carbon/50">Notas</p>
            <p className="text-carbon">{gasto.notas}</p>
          </>
        )}
        {urlComprobante && (
          <>
            <p className="text-carbon/50">Comprobante</p>
            <a href={urlComprobante} target="_blank" rel="noreferrer" className="font-medium text-oliva underline underline-offset-2">Ver comprobante</a>
          </>
        )}
        {gasto.anulado && (
          <>
            <p className="text-carbon/50">Motivo de anulación</p>
            <p className="text-error">{gasto.anulado_motivo}</p>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!gasto.anulado && gasto.saldo_pendiente > 0 && (
          <Button tamano="sm" onClick={() => setMostrarFormularioPago(true)}>Registrar pago</Button>
        )}
        {puedeEditar && <Button tamano="sm" variante="secondary" onClick={onEditar}>Editar</Button>}
        <Button tamano="sm" variante="secondary" onClick={duplicar} cargando={accionEnCurso}>Duplicar</Button>
        {!gasto.anulado && (
          <Button tamano="sm" variante="danger" onClick={() => setMostrarAnular(true)} disabled={!puedeAnular} title={!puedeAnular ? 'Revierte primero los pagos vigentes para poder anular' : undefined}>
            Anular
          </Button>
        )}
      </div>
      {!gasto.anulado && !puedeAnular && (
        <p className="-mt-3 text-xs text-carbon/50">Para anular este gasto primero revierte sus pagos vigentes (abajo, en el historial).</p>
      )}

      {mostrarFormularioPago && (
        <FormularioPagoInline
          gasto={gasto}
          cuentas={cuentas}
          onCancelar={() => setMostrarFormularioPago(false)}
          onRegistrado={(actualizado) => {
            setMostrarFormularioPago(false)
            onCambio(actualizado)
            cargar()
          }}
        />
      )}

      {mostrarAnular && (
        <FormularioAnularInline
          gastoId={gasto.id}
          onCancelar={() => setMostrarAnular(false)}
          onAnulado={(actualizado) => {
            setMostrarAnular(false)
            onCambio(actualizado)
            cargar()
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-carbon">Historial de pagos</h4>
        {cargando ? (
          <Cargando filas={2} />
        ) : pagos.length === 0 ? (
          <p className="text-sm text-carbon/50">Todavía no se ha registrado ningún pago.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pagos.map((p) => (
              <FilaPago key={p.id} pago={p} onRevertir={() => setPagoARevertir(p)} />
            ))}
          </div>
        )}
      </div>

      {pagoARevertir && (
        <FormularioRevertirInline
          pago={pagoARevertir}
          onCancelar={() => setPagoARevertir(null)}
          onRevertido={() => {
            setPagoARevertir(null)
            listarPagosDeGasto(gasto.id).then(setPagos)
            cargar()
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-carbon">Historial de cambios</h4>
        {eventos.length === 0 ? (
          <p className="text-sm text-carbon/50">Sin eventos registrados.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {eventos.map((e) => (
              <li key={e.id} className="flex justify-between gap-2 border-b border-piedra/60 pb-1.5 text-carbon/70">
                <span>{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.motivo ? ` — ${e.motivo}` : ''}</span>
                <span className="shrink-0 text-xs text-carbon/40">{formatoFechaHora(e.creado_en)} · {e.usuario_nombre ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button variante="ghost" onClick={onCerrar}>Cerrar</Button>
    </div>
  )
}

function EtiquetaEstado({ gasto }: { gasto: Gasto }) {
  if (gasto.anulado) return <span className="rounded-full bg-carbon/10 px-3 py-1 text-xs font-semibold text-carbon/60">Anulado</span>
  const base = ETIQUETA_ESTADO[gasto.estado] ?? gasto.estado
  const color = gasto.estado === 'pagado' ? 'bg-oliva/15 text-oliva' : gasto.estado === 'pago_parcial' ? 'bg-champan/40 text-carbon' : 'bg-piedra text-carbon/70'
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{base}</span>
      {gasto.vencido && <span className="rounded-full bg-error/10 px-3 py-1 text-xs font-semibold text-error">Vencido</span>}
    </div>
  )
}

function FilaPago({ pago, onRevertir }: { pago: GastoPago; onRevertir: () => void }) {
  const [abriendoComprobante, setAbriendoComprobante] = useState(false)
  const [errorComprobante, setErrorComprobante] = useState<string | null>(null)

  async function verComprobante() {
    if (!pago.comprobante_path) return
    setAbriendoComprobante(true)
    setErrorComprobante(null)
    try {
      const url = await obtenerUrlComprobante(pago.comprobante_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      setErrorComprobante(e.message)
    } finally {
      setAbriendoComprobante(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-piedra px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-carbon">{formatoMoneda(pago.importe)} · {pago.metodo}</p>
          <p className="text-xs text-carbon/50">
            {formatoFecha(pago.fecha)} · {pago.cuenta_nombre ?? 'cuenta'} · {pago.registrado_por_nombre ?? '—'}
            {pago.referencia ? ` · ref. ${pago.referencia}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pago.comprobante_path && (
            <button onClick={verComprobante} disabled={abriendoComprobante} className="text-xs font-semibold text-oliva underline underline-offset-2 disabled:opacity-50">
              {abriendoComprobante ? 'Abriendo…' : 'Ver comprobante'}
            </button>
          )}
          <button onClick={onRevertir} className="text-xs font-semibold text-error underline underline-offset-2">Revertir</button>
        </div>
      </div>
      {errorComprobante && <p className="text-xs text-error">{errorComprobante}</p>}
    </div>
  )
}

function FormularioPagoInline({
  gasto,
  cuentas,
  onCancelar,
  onRegistrado,
}: {
  gasto: Gasto
  cuentas: { id: string; nombre: string; activa: boolean }[]
  onCancelar: () => void
  onRegistrado: (actualizado: Gasto) => void
}) {
  const [idempotencyKey] = useState(() => claveTemporal())
  const [claveComprobante] = useState(() => claveTemporal())
  const [importe, setImporte] = useState<number | null>(gasto.saldo_pendiente)
  const [fecha, setFecha] = useState(fechaBogotaISO())
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo')
  const [cuentaId, setCuentaId] = useState(cuentas.find((c) => c.activa)?.id ?? '')
  const [referencia, setReferencia] = useState('')
  const [archivoComprobante, setArchivoComprobante] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function registrar() {
    setError(null)
    if (!importe || importe <= 0) { setError('Ingresa un importe mayor que cero.'); return }
    if (importe > gasto.saldo_pendiente) { setError(`El importe no puede superar el saldo pendiente (${formatoMoneda(gasto.saldo_pendiente)}).`); return }
    if (!cuentaId) { setError('Elige la cuenta de origen.'); return }
    setGuardando(true)
    try {
      let comprobantePath: string | null = null
      if (archivoComprobante) {
        comprobantePath = await subirComprobante(archivoComprobante, claveComprobante)
      }
      await registrarPagoGasto({ gastoId: gasto.id, importe, fecha, metodo, cuentaId, referencia: referencia.trim() || null, comprobantePath, idempotencyKey })
      const actualizado: Gasto = {
        ...gasto,
        total_pagado: gasto.total_pagado + importe,
        saldo_pendiente: gasto.saldo_pendiente - importe,
        estado: gasto.saldo_pendiente - importe <= 0 ? 'pagado' : 'pago_parcial',
      }
      onRegistrado(actualizado)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-oliva/40 bg-oliva/5 p-3.5">
      <p className="text-sm font-semibold text-carbon">Registrar pago</p>
      {error && <ErrorState mensaje={error} />}
      <div className="grid grid-cols-2 gap-3">
        <CampoMoneda id="rpImporte" etiqueta="Importe" value={importe} onChange={setImporte} />
        <Input id="rpFecha" etiqueta="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select id="rpMetodo" etiqueta="Método" value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoPago)}>
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="otro">Otro</option>
        </Select>
        <Select id="rpCuenta" etiqueta="Cuenta de origen" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
          <option value="">Elige una cuenta</option>
          {cuentas.filter((c) => c.activa).map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </Select>
      </div>
      <Input id="rpReferencia" etiqueta="Referencia (opcional)" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
      <div>
        <label htmlFor="rpComprobante" className="mb-1.5 block text-sm font-semibold text-carbon">Comprobante de este pago (opcional)</label>
        <input
          id="rpComprobante"
          type="file"
          accept={TIPOS_COMPROBANTE_PERMITIDOS.join(',')}
          onChange={(e) => setArchivoComprobante(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-carbon/70 file:mr-3 file:rounded-full file:border-0 file:bg-piedra file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-carbon hover:file:bg-piedra/70"
        />
        <p className="mt-1 text-xs text-carbon/50">Sube la foto o el PDF de la factura de este abono, si la tienes.</p>
      </div>
      <div className="flex gap-2">
        <Button tamano="sm" onClick={registrar} cargando={guardando}>Confirmar pago</Button>
        <Button tamano="sm" variante="secondary" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
      </div>
    </div>
  )
}

function FormularioRevertirInline({ pago, onCancelar, onRevertido }: { pago: GastoPago; onCancelar: () => void; onRevertido: () => void }) {
  const [importe, setImporte] = useState<number | null>(pago.importe)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function revertir() {
    setError(null)
    if (!importe || importe <= 0) { setError('Ingresa un importe mayor que cero.'); return }
    if (!motivo.trim()) { setError('Indica el motivo de la reversión.'); return }
    setGuardando(true)
    try {
      await revertirPagoGasto({ gastoPagoId: pago.id, importe, motivo: motivo.trim() })
      onRevertido()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-error/30 bg-error/5 p-3.5">
      <p className="text-sm font-semibold text-carbon">Revertir pago de {formatoMoneda(pago.importe)}</p>
      {error && <ErrorState mensaje={error} />}
      <CampoMoneda id="revImporte" etiqueta="Importe a revertir" value={importe} onChange={setImporte} />
      <Textarea id="revMotivo" etiqueta="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <div className="flex gap-2">
        <Button tamano="sm" variante="danger" onClick={revertir} cargando={guardando}>Confirmar reversión</Button>
        <Button tamano="sm" variante="secondary" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
      </div>
    </div>
  )
}

function FormularioAnularInline({ gastoId, onCancelar, onAnulado }: { gastoId: string; onCancelar: () => void; onAnulado: (g: Gasto) => void }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function anular() {
    setError(null)
    if (!motivo.trim()) { setError('Indica el motivo de la anulación.'); return }
    setGuardando(true)
    try {
      const actualizado = await anularGasto(gastoId, motivo.trim())
      onAnulado(actualizado)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-error/30 bg-error/5 p-3.5">
      <p className="text-sm font-semibold text-carbon">Anular gasto</p>
      <p className="text-xs text-carbon/60">Esta acción cancela la obligación pendiente. No devuelve dinero: si ya hay pagos, revierte esos pagos primero.</p>
      {error && <ErrorState mensaje={error} />}
      <Textarea id="anMotivo" etiqueta="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <div className="flex gap-2">
        <Button tamano="sm" variante="danger" onClick={anular} cargando={guardando}>Confirmar anulación</Button>
        <Button tamano="sm" variante="secondary" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
      </div>
    </div>
  )
}
