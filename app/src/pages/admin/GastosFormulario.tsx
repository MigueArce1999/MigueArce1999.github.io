import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { CampoMoneda, Input, Select, Textarea } from '../../components/ui/Campos'
import { ErrorState } from '../../components/ui/Estados'
import {
  buscarProveedores,
  crearGasto,
  crearProveedor,
  editarGasto,
  subirComprobante,
  TAMANO_MAXIMO_COMPROBANTE,
  TIPOS_COMPROBANTE_PERMITIDOS,
} from '../../lib/api/gastos'
import { fechaBogotaISO } from '../../lib/format'
import type { CategoriaGasto, Cuenta, Gasto, MetodoPago, Proveedor } from '../../lib/types'

function claveTemporal() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

type EstadoPago = 'no' | 'parcial' | 'completo'

export function GastosFormulario({
  gasto,
  categorias,
  cuentas,
  onGuardado,
  onCancelar,
}: {
  gasto?: Gasto | null
  categorias: CategoriaGasto[]
  cuentas: Cuenta[]
  onGuardado: (gasto: Gasto) => void
  onCancelar: () => void
}) {
  const editando = !!gasto
  const [idempotencyKey] = useState(() => claveTemporal())
  const [claveComprobante] = useState(() => claveTemporal())
  const [clavePagoComprobante] = useState(() => claveTemporal())

  const [concepto, setConcepto] = useState(gasto?.concepto ?? '')
  const [valorTotal, setValorTotal] = useState<number | null>(gasto?.valor_total ?? null)
  const [categoriaId, setCategoriaId] = useState(gasto?.categoria_id ?? '')
  const [fecha, setFecha] = useState(gasto?.fecha ?? fechaBogotaISO())
  const [proveedorId, setProveedorId] = useState<string | null>(gasto?.proveedor_id ?? null)
  const [proveedorTexto, setProveedorTexto] = useState(gasto?.proveedor_nombre ?? '')
  const [referencia, setReferencia] = useState(gasto?.referencia ?? '')
  const [notas, setNotas] = useState(gasto?.notas ?? '')
  const [archivoComprobante, setArchivoComprobante] = useState<File | null>(null)
  const [comprobantePathExistente] = useState(gasto?.comprobante_path ?? null)

  const [estadoPago, setEstadoPago] = useState<EstadoPago>('no')
  const [pagoImporte, setPagoImporte] = useState<number | null>(null)
  const [pagoFecha, setPagoFecha] = useState(fechaBogotaISO())
  const [pagoMetodo, setPagoMetodo] = useState<MetodoPago>('efectivo')
  const [pagoCuentaId, setPagoCuentaId] = useState(cuentas[0]?.id ?? '')
  const [pagoReferencia, setPagoReferencia] = useState('')
  const [pagoArchivoComprobante, setPagoArchivoComprobante] = useState<File | null>(null)
  const [fechaVencimiento, setFechaVencimiento] = useState(gasto?.fecha_vencimiento ?? '')

  const [errores, setErrores] = useState<Record<string, string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // "Completo" precarga el importe con el valor total; cambiar el valor total mientras está en
  // "Completo" lo vuelve a igualar, para que nunca quede un pago completo con un importe viejo.
  useEffect(() => {
    if (estadoPago === 'completo') setPagoImporte(valorTotal)
    if (estadoPago === 'no') setPagoImporte(null)
  }, [estadoPago, valorTotal])

  const categoriasDisponibles = categorias.filter((c) => c.activa || c.id === categoriaId)
  const quedaSaldo = estadoPago !== 'completo'

  function validar(): boolean {
    const nuevos: Record<string, string> = {}
    if (!concepto.trim()) nuevos.concepto = 'El concepto es obligatorio.'
    if (!valorTotal || valorTotal <= 0) nuevos.valorTotal = 'Ingresa un valor mayor que cero.'
    if (!categoriaId) nuevos.categoriaId = 'Elige una categoría.'
    if (!fecha) nuevos.fecha = 'Elige la fecha del gasto.'
    if (!editando && estadoPago !== 'no') {
      if (!pagoImporte || pagoImporte <= 0) nuevos.pagoImporte = 'Ingresa el importe pagado.'
      else if (estadoPago === 'parcial' && valorTotal != null && pagoImporte >= valorTotal) {
        nuevos.pagoImporte = 'Un pago parcial debe ser menor que el valor total.'
      }
      if (!pagoCuentaId) nuevos.pagoCuentaId = 'Elige la cuenta de origen.'
      if (!pagoFecha) nuevos.pagoFecha = 'Elige la fecha del pago.'
    }
    setErrores(nuevos)
    return Object.keys(nuevos).length === 0
  }

  async function guardar() {
    setErrorGeneral(null)
    if (!validar()) return
    setGuardando(true)
    try {
      let comprobantePath = comprobantePathExistente
      if (archivoComprobante) {
        comprobantePath = await subirComprobante(archivoComprobante, claveComprobante)
      }

      let idProveedor = proveedorId
      if (!idProveedor && proveedorTexto.trim()) {
        const nuevo = await crearProveedor(proveedorTexto.trim())
        idProveedor = nuevo.id
      }

      let pagoComprobantePath: string | null = null
      if (estadoPago !== 'no' && pagoArchivoComprobante) {
        pagoComprobantePath = await subirComprobante(pagoArchivoComprobante, clavePagoComprobante)
      }

      if (editando) {
        const actualizado = await editarGasto({
          gastoId: gasto!.id,
          concepto: concepto.trim(),
          categoriaId,
          valorTotal: valorTotal as number,
          proveedorId: idProveedor,
          referencia: referencia.trim() || null,
          fecha,
          fechaVencimiento: fechaVencimiento || null,
          notas: notas.trim() || null,
          comprobantePath,
        })
        onGuardado(actualizado)
        return
      }

      const nuevo = await crearGasto({
        concepto: concepto.trim(),
        categoriaId,
        valorTotal: valorTotal as number,
        proveedorId: idProveedor,
        referencia: referencia.trim() || null,
        fecha,
        fechaVencimiento: quedaSaldo ? fechaVencimiento || null : null,
        notas: notas.trim() || null,
        comprobantePath,
        pago:
          estadoPago === 'no'
            ? null
            : {
                importe: pagoImporte as number,
                fecha: pagoFecha,
                metodo: pagoMetodo,
                cuentaId: pagoCuentaId,
                referencia: pagoReferencia.trim() || null,
                comprobantePath: pagoComprobantePath,
              },
        idempotencyKey,
      })
      onGuardado(nuevo)
    } catch (e: any) {
      // El formulario se conserva tal cual quedó escrito: la persona no pierde lo que llevaba.
      setErrorGeneral(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {errorGeneral && <ErrorState mensaje={errorGeneral} />}

      <Input id="gConcepto" etiqueta="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} error={errores.concepto} placeholder="Ej: Arriendo local, insumos, transporte…" />

      <div className="grid grid-cols-2 gap-3">
        <CampoMoneda id="gValor" etiqueta="Valor total" value={valorTotal} onChange={setValorTotal} error={errores.valorTotal} />
        <Input id="gFecha" etiqueta="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} error={errores.fecha} />
      </div>

      <Select id="gCategoria" etiqueta="Categoría" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} error={errores.categoriaId}>
        <option value="">Elige una categoría</option>
        {categoriasDisponibles.map((c) => (
          <option key={c.id} value={c.id}>{c.nombre}</option>
        ))}
      </Select>

      <ComboProveedor
        valorId={proveedorId}
        valorTexto={proveedorTexto}
        onCambiar={(id, texto) => {
          setProveedorId(id)
          setProveedorTexto(texto)
        }}
      />

      <Input id="gReferencia" etiqueta="Referencia o factura (opcional)" value={referencia} onChange={(e) => setReferencia(e.target.value)} />

      <div>
        <label htmlFor="gComprobante" className="mb-1.5 block text-sm font-semibold text-carbon">Comprobante (opcional)</label>
        <input
          id="gComprobante"
          type="file"
          accept={TIPOS_COMPROBANTE_PERMITIDOS.join(',')}
          onChange={(e) => setArchivoComprobante(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-carbon/70 file:mr-3 file:rounded-full file:border-0 file:bg-piedra file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-carbon hover:file:bg-piedra/70"
        />
        <p className="mt-1 text-xs text-carbon/50">Imagen o PDF, máximo {Math.round(TAMANO_MAXIMO_COMPROBANTE / 1024 / 1024)} MB.</p>
        {comprobantePathExistente && !archivoComprobante && <p className="mt-1 text-xs text-oliva">Ya tiene un comprobante adjunto; sube uno nuevo para reemplazarlo.</p>}
      </div>

      <Textarea id="gNotas" etiqueta="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />

      {!editando && (
        <div className="flex flex-col gap-3 rounded-xl border border-piedra p-3.5">
          <p className="text-sm font-semibold text-carbon">¿Ya se pagó?</p>
          <div className="flex gap-2">
            {(['no', 'parcial', 'completo'] as EstadoPago[]).map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => setEstadoPago(op)}
                className={`flex-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  estadoPago === op ? 'border-oliva bg-oliva text-blanco' : 'border-piedra text-carbon/70 hover:border-oliva'
                }`}
              >
                {op === 'no' ? 'No' : op === 'parcial' ? 'Parcial' : 'Completo'}
              </button>
            ))}
          </div>

          {estadoPago !== 'no' && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <CampoMoneda
                  id="gPagoImporte"
                  etiqueta="Importe pagado"
                  value={pagoImporte}
                  onChange={setPagoImporte}
                  disabled={estadoPago === 'completo'}
                  error={errores.pagoImporte}
                />
                <Input id="gPagoFecha" etiqueta="Fecha de pago" type="date" value={pagoFecha} onChange={(e) => setPagoFecha(e.target.value)} error={errores.pagoFecha} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select id="gPagoMetodo" etiqueta="Método" value={pagoMetodo} onChange={(e) => setPagoMetodo(e.target.value as MetodoPago)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </Select>
                <Select id="gPagoCuenta" etiqueta="Cuenta de origen" value={pagoCuentaId} onChange={(e) => setPagoCuentaId(e.target.value)} error={errores.pagoCuentaId}>
                  <option value="">Elige una cuenta</option>
                  {cuentas.filter((c) => c.activa).map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </Select>
              </div>
              <Input id="gPagoReferencia" etiqueta="Referencia del pago (opcional)" value={pagoReferencia} onChange={(e) => setPagoReferencia(e.target.value)} />
              <div>
                <label htmlFor="gPagoComprobante" className="mb-1.5 block text-sm font-semibold text-carbon">Comprobante de este pago (opcional)</label>
                <input
                  id="gPagoComprobante"
                  type="file"
                  accept={TIPOS_COMPROBANTE_PERMITIDOS.join(',')}
                  onChange={(e) => setPagoArchivoComprobante(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-carbon/70 file:mr-3 file:rounded-full file:border-0 file:bg-piedra file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-carbon hover:file:bg-piedra/70"
                />
                <p className="mt-1 text-xs text-carbon/50">Distinto del comprobante del gasto de arriba: este es el soporte de este abono puntual.</p>
              </div>
            </div>
          )}

          {quedaSaldo && (
            <Input
              id="gVencimiento"
              etiqueta="Fecha de vencimiento del saldo (opcional)"
              type="date"
              value={fechaVencimiento}
              onChange={(e) => setFechaVencimiento(e.target.value)}
              ayuda="Si la dejas vacía, el saldo queda pendiente sin fecha límite y no contará como vencido."
            />
          )}
        </div>
      )}

      <div className="mt-2 flex gap-3">
        <Button onClick={guardar} cargando={guardando} className="flex-1">Guardar gasto</Button>
        <Button variante="secondary" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
      </div>
    </div>
  )
}

// Proveedor/beneficiario: buscar entre existentes o escribir uno nuevo (se crea al guardar el
// gasto, mismo patrón que el buscador de clientes en "Atender").
function ComboProveedor({
  valorId,
  valorTexto,
  onCambiar,
}: {
  valorId: string | null
  valorTexto: string
  onCambiar: (id: string | null, texto: string) => void
}) {
  const [texto, setTexto] = useState(valorTexto)
  const [resultados, setResultados] = useState<Proveedor[]>([])
  const [abierto, setAbierto] = useState(false)
  const contenedorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const manejador = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', manejador)
    return () => document.removeEventListener('mousedown', manejador)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      buscarProveedores(texto).then(setResultados).catch(() => setResultados([]))
    }, 200)
    return () => clearTimeout(t)
  }, [texto])

  return (
    <div ref={contenedorRef} className="relative flex flex-col gap-1.5">
      <label htmlFor="gProveedor" className="text-sm font-semibold text-carbon">Proveedor o beneficiario (opcional)</label>
      <input
        id="gProveedor"
        value={texto}
        onFocus={() => setAbierto(true)}
        onChange={(e) => {
          setTexto(e.target.value)
          onCambiar(null, e.target.value)
          setAbierto(true)
        }}
        placeholder="Busca uno existente o escribe uno nuevo"
        className="w-full rounded-lg border border-piedra bg-blanco px-3 py-2.5 text-sm text-carbon outline-none transition-colors focus:border-oliva"
        autoComplete="off"
      />
      {abierto && texto.trim() && (
        <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-lg border border-piedra bg-blanco shadow-lg">
          {resultados.length === 0 ? (
            <p className="px-3 py-2 text-xs text-carbon/50">Sin coincidencias — se creará "{texto.trim()}" al guardar.</p>
          ) : (
            resultados.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onCambiar(p.id, p.nombre)
                  setTexto(p.nombre)
                  setAbierto(false)
                }}
                className="block w-full px-3 py-2 text-left text-sm text-carbon hover:bg-piedra/40"
              >
                {p.nombre}
              </button>
            ))
          )}
        </div>
      )}
      {valorId && <p className="text-xs text-oliva">Proveedor existente seleccionado.</p>}
    </div>
  )
}
