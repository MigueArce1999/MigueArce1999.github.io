import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Campos'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { listarVentasDeCliente } from '../../lib/api/admin'
import { listarMovimientosPuntos, saldoPuntos } from '../../lib/api/cliente'
import { actualizarClienteAdmin, archivarCliente, obtenerClienteAdmin } from '../../lib/api/clientes'
import { formatoFecha, formatoMoneda } from '../../lib/format'
import { supabaseRequerido, isDemoMode } from '../../lib/supabase'
import type { ClienteResumen, MovimientoPuntos, VentaLinea } from '../../lib/types'

// Perfil de cliente para administración: solo datos reales de tablas ya existentes
// (atenciones, puntos, campañas) — nada de saldos ni historiales inventados para rellenar la
// pantalla. Si un módulo no tiene datos, se muestra su estado vacío en vez de un número falso.
export function ClientePerfilAdmin() {
  const { id } = useParams<{ id: string }>()
  const [cliente, setCliente] = useState<ClienteResumen | null | undefined>(undefined)
  const [ventas, setVentas] = useState<VentaLinea[] | null>(null)
  const [puntos, setPuntos] = useState<MovimientoPuntos[] | null>(null)
  const [campanas, setCampanas] = useState<{ nombre: string; estado: string; actualizado: string }[] | null>(null)
  const [notas, setNotas] = useState('')
  const [guardandoNotas, setGuardandoNotas] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cargar() {
    if (!id) return
    obtenerClienteAdmin(id).then((c) => { setCliente(c); setNotas(c?.notas ?? '') }).catch((e) => setError(e.message))
    listarVentasDeCliente(id).then(setVentas).catch((e) => setError(e.message))
    listarMovimientosPuntos(id).then(setPuntos).catch((e) => setError(e.message))
    if (!isDemoMode) {
      supabaseRequerido()
        .from('campana_destinatario')
        .select('estado, actualizado_en, campana:campana_id(nombre)')
        .eq('cliente_id', id)
        .then(({ data }) => setCampanas((data ?? []).map((r: any) => ({ nombre: r.campana?.nombre ?? '—', estado: r.estado, actualizado: r.actualizado_en }))))
    } else {
      setCampanas([])
    }
  }
  useEffect(cargar, [id])

  async function guardarNotas() {
    if (!cliente) return
    setGuardandoNotas(true)
    try {
      await actualizarClienteAdmin(cliente.id, {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        consentimientoMarketing: cliente.consentimiento_marketing,
        notas,
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardandoNotas(false)
    }
  }

  async function alternarArchivado() {
    if (!cliente) return
    await archivarCliente(cliente.id, !cliente.activo)
    cargar()
  }

  if (cliente === undefined) return <Cargando />
  if (cliente === null) return <EmptyState titulo="No se encontró este cliente" />

  const totalCobrado = (ventas ?? []).reduce((acc, v) => acc + (v.precio_snapshot - v.descuento) * v.cantidad, 0)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/admin/clientes" className="text-sm font-semibold text-oliva hover:underline">← Clientes</Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-piedra font-marca text-xl text-oliva">{cliente.nombre.charAt(0)}</div>
          <div>
            <h1 className="font-marca text-2xl font-semibold text-carbon">{cliente.nombre}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cliente.activo ? 'bg-exito/15 text-exito' : 'bg-carbon/10 text-carbon/60'}`}>
              {cliente.activo ? 'Activo' : 'Archivado'}
            </span>
          </div>
        </div>
        <Button variante="secondary" tamano="sm" onClick={alternarArchivado}>{cliente.activo ? 'Archivar' : 'Reactivar'}</Button>
      </div>

      {error && <ErrorState mensaje={error} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <p className="font-semibold text-carbon">Contacto</p>
          <p className="text-sm text-carbon/70">WhatsApp: {cliente.telefono ?? '—'}</p>
          <p className="text-sm text-carbon/70">Correo: {cliente.email ?? '—'}</p>
          <p className="text-sm text-carbon/70">Autoriza promociones: {cliente.consentimiento_marketing ? 'Sí' : 'No'}</p>
          <p className="text-xs text-carbon/40">Registrado por: {cliente.origen_registro === 'publico' ? 'formulario público' : 'panel administrativo'}</p>
          {cliente.telefono && (
            <a
              href={`https://wa.me/${cliente.telefono.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 self-start text-sm font-semibold text-oliva hover:underline"
            >
              Abrir WhatsApp
            </a>
          )}
        </Card>

        <Card className="flex flex-col gap-2">
          <p className="font-semibold text-carbon">Puntos y beneficios</p>
          {puntos === null ? (
            <Cargando filas={1} />
          ) : puntos.length === 0 ? (
            <p className="text-sm text-carbon/50">Sin movimientos de puntos todavía.</p>
          ) : (
            <p className="font-marca text-2xl font-semibold text-oliva">{saldoPuntos(puntos)} pts</p>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-carbon">Historial de servicios</p>
          {ventas && ventas.length > 0 && <span className="text-sm font-semibold text-oliva">Total cobrado: {formatoMoneda(totalCobrado)}</span>}
        </div>
        {!ventas ? (
          <Cargando />
        ) : ventas.length === 0 ? (
          <p className="text-sm text-carbon/50">Sin visitas registradas todavía.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {ventas.map((v) => (
              <div key={v.id} className="flex items-center justify-between border-b border-piedra/60 py-2 text-sm last:border-0">
                <div>
                  <p className="font-medium text-carbon">{v.nombre_snapshot}</p>
                  <p className="text-xs text-carbon/50">{formatoFecha(v.atencion_completado_en ?? v.atencion_creado_en)} · {v.profesional_nombre ?? '—'}</p>
                </div>
                <span className="font-semibold text-carbon">{formatoMoneda((v.precio_snapshot - v.descuento) * v.cantidad)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <p className="font-semibold text-carbon">Campañas</p>
        {campanas === null ? (
          <Cargando filas={1} />
        ) : campanas.length === 0 ? (
          <p className="text-sm text-carbon/50">No se le ha incluido en ninguna campaña todavía.</p>
        ) : (
          campanas.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-carbon">{c.nombre}</span>
              <span className="text-carbon/60">{c.estado}</span>
            </div>
          ))
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <p className="font-semibold text-carbon">Notas internas</p>
        <p className="text-xs text-carbon/50">Solo visibles para administración.</p>
        <Textarea id="notasCliente" etiqueta="" value={notas} onChange={(e) => setNotas(e.target.value)} />
        <Button tamano="sm" onClick={guardarNotas} cargando={guardandoNotas} className="self-start">Guardar notas</Button>
      </Card>
    </div>
  )
}
