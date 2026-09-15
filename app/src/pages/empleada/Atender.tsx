import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Campos'
import { Card, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { isDemoMode, supabase } from '../../lib/supabase'
import { listarProfesionales, listarServicios } from '../../lib/api/catalogo'
import { completarYCobrarAtencion, registrarAtencion } from '../../lib/api/empleada'
import { formatoMoneda } from '../../lib/format'
import type { Cliente, MetodoPago, Profesional, Servicio } from '../../lib/types'

interface Linea {
  servicioId: string
  nombre: string
  precio: number
  profesionalId: string
  descuento: number
}

export function EmpleadaAtender() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { profesional } = useAuth()

  const [servicios, setServicios] = useState<Servicio[]>([])
  const [equipo, setEquipo] = useState<Profesional[]>([])
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [clientesEncontrados, setClientesEncontrados] = useState<Cliente[]>([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null)
  const [nombreClienteNuevo, setNombreClienteNuevo] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [notas, setNotas] = useState('')
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo')
  const [paso, setPaso] = useState<'cliente' | 'servicios' | 'cobro' | 'listo'>('cliente')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    listarServicios().then(setServicios)
    listarProfesionales().then(setEquipo)
  }, [])

  useEffect(() => {
    if (isDemoMode || !busquedaCliente) {
      setClientesEncontrados([])
      return
    }
    const t = setTimeout(() => {
      supabase!
        .from('cliente')
        .select('*')
        .or(`nombre.ilike.%${busquedaCliente}%,telefono.ilike.%${busquedaCliente}%`)
        .limit(5)
        .then(({ data }) => setClientesEncontrados(data ?? []))
    }, 300)
    return () => clearTimeout(t)
  }, [busquedaCliente])

  function agregarLinea(s: Servicio) {
    setLineas((prev) => [
      ...prev,
      { servicioId: s.id, nombre: s.nombre, precio: s.precio ?? 0, profesionalId: profesional?.id ?? params.get('profesional') ?? '', descuento: 0 },
    ])
  }

  const total = lineas.reduce((acc, l) => acc + (l.precio - l.descuento), 0)

  async function crearClienteBasico() {
    if (isDemoMode) {
      setClienteSeleccionado({ id: 'demo-cliente-nuevo', usuario_id: null, nombre: nombreClienteNuevo, telefono: null, email: null, consentimiento_marketing: false, visitas_completadas: 0, gasto_acumulado: 0 })
      setPaso('servicios')
      return
    }
    // Un cliente creado desde recepción NO obtiene cuenta ni consentimiento de marketing
    // automáticos (ver docs/03-flujos.md §3.2) — se puede vincular a una cuenta después.
    const { data, error: err } = await supabase!
      .from('cliente')
      .insert({ nombre: nombreClienteNuevo, consentimiento_marketing: false })
      .select()
      .single()
    if (err) { setError(err.message); return }
    setClienteSeleccionado(data)
    setPaso('servicios')
  }

  async function finalizar() {
    if (!clienteSeleccionado || lineas.length === 0) return
    setCargando(true)
    setError(null)
    try {
      const { id: atencionId } = await registrarAtencion({
        clienteId: clienteSeleccionado.id,
        reservaId: params.get('reserva'),
        lineas: lineas.map((l) => ({ servicioId: l.servicioId, profesionalId: l.profesionalId, precioSnapshot: l.precio, descuento: l.descuento })),
      })
      await completarYCobrarAtencion({ atencionId, pagos: [{ metodo: metodoPago, monto: total }] })
      setPaso('listo')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 font-marca text-2xl font-semibold text-carbon">Registrar servicio</h1>
      {error && <div className="mb-4"><ErrorState mensaje={error} /></div>}

      {paso === 'cliente' && (
        <Card className="flex flex-col gap-3">
          <p className="font-semibold text-carbon">1. Cliente</p>
          <Input id="buscar" etiqueta="Buscar cliente por nombre o teléfono" value={busquedaCliente} onChange={(e) => setBusquedaCliente(e.target.value)} />
          {clientesEncontrados.map((c) => (
            <button key={c.id} onClick={() => { setClienteSeleccionado(c); setPaso('servicios') }} className="rounded-lg border border-piedra p-2 text-left text-sm hover:border-oliva">
              {c.nombre} {c.telefono && `· ${c.telefono}`}
            </button>
          ))}
          <div className="mt-2 border-t border-piedra pt-3">
            <p className="mb-2 text-sm text-carbon/60">¿No existe? Crea un registro básico (sin cuenta ni marketing):</p>
            <div className="flex gap-2">
              <Input id="nuevo" etiqueta="" value={nombreClienteNuevo} onChange={(e) => setNombreClienteNuevo(e.target.value)} placeholder="Nombre del cliente" />
              <Button onClick={crearClienteBasico} disabled={!nombreClienteNuevo}>Crear</Button>
            </div>
          </div>
        </Card>
      )}

      {paso === 'servicios' && (
        <Card className="flex flex-col gap-3">
          <p className="font-semibold text-carbon">2. Servicios para {clienteSeleccionado?.nombre}</p>
          <Select id="servicio" etiqueta="Añadir servicio" onChange={(e) => {
            const s = servicios.find((x) => x.id === e.target.value)
            if (s) agregarLinea(s)
            e.target.value = ''
          }}>
            <option value="">Elegir servicio…</option>
            {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </Select>

          {lineas.map((l, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border border-piedra p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium text-carbon">{l.nombre}</span>
              <Select id={`prof-${i}`} etiqueta="Profesional" value={l.profesionalId} onChange={(e) => {
                const v = e.target.value
                setLineas((prev) => prev.map((x, idx) => idx === i ? { ...x, profesionalId: v } : x))
              }}>
                {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Select>
              <Input id={`precio-${i}`} etiqueta="Precio" type="number" value={l.precio} onChange={(e) => {
                const v = Number(e.target.value)
                setLineas((prev) => prev.map((x, idx) => idx === i ? { ...x, precio: v } : x))
              }} />
              <button onClick={() => setLineas((prev) => prev.filter((_, idx) => idx !== i))} className="text-sm text-error">Quitar</button>
            </div>
          ))}

          <p className="text-right font-semibold text-oliva">Total: {formatoMoneda(total)}</p>
          <Input id="notas" etiqueta="Notas operativas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
          <Button onClick={() => setPaso('cobro')} disabled={lineas.length === 0}>Continuar al cobro</Button>
        </Card>
      )}

      {paso === 'cobro' && (
        <Card className="flex flex-col gap-3">
          <p className="font-semibold text-carbon">3. Cobro</p>
          <p className="text-sm text-carbon/60">Total a cobrar: <span className="font-semibold text-oliva">{formatoMoneda(total)}</span></p>
          <Select id="metodo" etiqueta="Método de pago" value={metodoPago} onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </Select>
          <Button onClick={finalizar} cargando={cargando}>Marcar como completado y cobrar</Button>
        </Card>
      )}

      {paso === 'listo' && (
        <Card className="flex flex-col items-center gap-3 text-center">
          <p className="text-3xl">✓</p>
          <p className="font-semibold text-carbon">Servicio registrado y cobrado</p>
          <p className="text-sm text-carbon/60">El historial del cliente, tus ventas, tu comisión y sus puntos ya se actualizaron.</p>
          <Button onClick={() => navigate('/equipo-app')}>Volver a Mi día</Button>
        </Card>
      )}
    </div>
  )
}
