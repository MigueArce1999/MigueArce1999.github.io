import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Campos'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Tabs } from '../../components/ui/Tabs'
import { EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { FormularioObservacionSeguimiento } from '../../components/clientes/FormularioObservacionSeguimiento'
import { HistorialVisitas } from '../../components/clientes/HistorialVisitas'
import { listarProductosYPagosPorAtencion, listarVentasDeCliente, type VentaExtraPorAtencion } from '../../lib/api/admin'
import { listarMovimientosPuntos } from '../../lib/api/cliente'
import {
  actualizarClienteAdmin,
  actualizarEstadoRecomendacion,
  archivarCliente,
  listarNotasCliente,
  listarRecomendacionesCliente,
  obtenerClienteAdmin,
  obtenerEstadoEnVivoCliente,
} from '../../lib/api/clientes'
import { listarServicios } from '../../lib/api/catalogo'
import { obtenerMiFidelizacion } from '../../lib/api/fidelizacion'
import { listarReservasDeCliente } from '../../lib/api/reservas'
import { agruparVisitas, profesionalHabitual } from '../../lib/clientes/historial'
import { formatoFecha, formatoFechaCorta, formatoFechaHora, formatoMoneda } from '../../lib/format'
import { supabaseRequerido, isDemoMode } from '../../lib/supabase'
import type {
  ClienteNota,
  ClienteRecomendacion,
  ClienteResumen,
  EstadoEnVivoCliente,
  MiFidelizacion,
  MovimientoPuntos,
  Reserva,
  Servicio,
  VentaLinea,
} from '../../lib/types'

// Ficha 360° de la clienta: consolida lo que YA genera el resto del sistema (Atender, Agenda,
// Fidelización, Peluquería en Vivo) en un solo lugar, en vez de duplicarlo. Cada pestaña reutiliza
// una función de API ya existente (listarVentasDeCliente, listarReservasDeCliente,
// obtenerMiFidelizacion) más las 3 piezas nuevas de 0072 (notas, recomendaciones, estado en vivo).
export function ClientePerfilAdmin() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [cliente, setCliente] = useState<ClienteResumen | null | undefined>(undefined)
  const [ventas, setVentas] = useState<VentaLinea[] | null>(null)
  const [extra, setExtra] = useState<Record<string, VentaExtraPorAtencion>>({})
  const [notas, setNotas] = useState<ClienteNota[]>([])
  const [recomendaciones, setRecomendaciones] = useState<ClienteRecomendacion[]>([])
  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [fidelizacion, setFidelizacion] = useState<MiFidelizacion | null>(null)
  const [movimientosPuntos, setMovimientosPuntos] = useState<MovimientoPuntos[] | null>(null)
  const [estadoEnVivo, setEstadoEnVivo] = useState<EstadoEnVivoCliente | null>(null)
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [campanas, setCampanas] = useState<{ nombre: string; estado: string; actualizado: string }[] | null>(null)
  const [notasInternas, setNotasInternas] = useState('')
  const [guardandoNotas, setGuardandoNotas] = useState(false)
  const [mostrarNuevaObservacion, setMostrarNuevaObservacion] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cargar() {
    if (!id) return
    obtenerClienteAdmin(id)
      .then((c) => {
        setCliente(c)
        setNotasInternas(c?.notas ?? '')
      })
      .catch((e) => setError(e.message))
    listarVentasDeCliente(id)
      .then((data) => {
        setVentas(data)
        const atencionIds = [...new Set(data.map((v) => v.atencion_id))]
        listarProductosYPagosPorAtencion(atencionIds).then(setExtra).catch((e) => setError(e.message))
      })
      .catch((e) => setError(e.message))
    listarNotasCliente(id).then(setNotas).catch((e) => setError(e.message))
    listarRecomendacionesCliente(id).then(setRecomendaciones).catch((e) => setError(e.message))
    listarReservasDeCliente(id).then(setReservas).catch((e) => setError(e.message))
    obtenerMiFidelizacion(id).then(setFidelizacion).catch((e) => setError(e.message))
    listarMovimientosPuntos(id).then(setMovimientosPuntos).catch((e) => setError(e.message))
    obtenerEstadoEnVivoCliente(id).then(setEstadoEnVivo).catch(() => {})
    listarServicios().then(setServicios).catch(() => {})
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

  async function guardarNotasInternas() {
    if (!cliente) return
    setGuardandoNotas(true)
    try {
      await actualizarClienteAdmin(cliente.id, {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        consentimientoMarketing: cliente.consentimiento_marketing,
        notas: notasInternas,
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

  async function marcarSeguimiento(recomendacionId: string, estado: 'completada' | 'cancelada') {
    try {
      await actualizarEstadoRecomendacion(recomendacionId, estado)
      cargar()
    } catch (e: any) {
      setError(e.message)
    }
  }

  function irAAgendar(servicioId?: string | null) {
    if (!id) return
    navigate(`/admin/agenda?nuevaCitaClienteId=${id}${servicioId ? `&servicioId=${servicioId}` : ''}`)
  }

  if (cliente === undefined) return <Cargando />
  if (cliente === null) return <EmptyState titulo="No se encontró este cliente" />

  const visitas = ventas ? agruparVisitas(ventas, extra, notas, recomendaciones) : null
  const notasGenerales = notas.filter((n) => n.atencion_id === null)
  const habitual = ventas ? profesionalHabitual(ventas) : null
  const ahora = Date.now()
  const proximasCitas = (reservas ?? [])
    .filter((r) => new Date(r.rango_inicio).getTime() > ahora && ['pendiente', 'confirmada', 'en_atencion'].includes(r.estado))
    .sort((a, b) => new Date(a.rango_inicio).getTime() - new Date(b.rango_inicio).getTime())
  const citasAnteriores = (reservas ?? []).filter((r) => !proximasCitas.includes(r))
  const recomendacionesPendientes = recomendaciones.filter((r) => r.estado === 'pendiente')

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
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cliente.activo ? 'bg-exito/15 text-exito' : 'bg-carbon/10 text-carbon/60'}`}>
                {cliente.activo ? 'Activo' : 'Archivado'}
              </span>
              {estadoEnVivo?.en_salon && (
                <span className="inline-flex items-center gap-1 rounded-full bg-exito/15 px-2 py-0.5 text-xs font-semibold text-exito">
                  <span aria-hidden>●</span> En el salón
                </span>
              )}
            </div>
          </div>
        </div>
        <Button variante="secondary" tamano="sm" onClick={alternarArchivado}>{cliente.activo ? 'Archivar' : 'Reactivar'}</Button>
      </div>

      {error && <ErrorState mensaje={error} />}

      {estadoEnVivo?.en_salon && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-exito/40 bg-exito/5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-exito">En servicio ahora</p>
            <p className="font-semibold text-carbon">{estadoEnVivo.servicio_nombre ?? 'Servicio'} · {estadoEnVivo.profesional_nombre ?? '—'}</p>
            {estadoEnVivo.inicio && <p className="text-xs text-carbon/50">Inicio: {formatoFechaHora(estadoEnVivo.inicio)}</p>}
          </div>
          <Link to="/admin/disponibilidad-en-vivo" className="text-sm font-semibold text-oliva hover:underline">Ver en Peluquería en Vivo →</Link>
        </Card>
      )}

      <Tabs
        inicial="resumen"
        pestanas={[
          {
            id: 'resumen',
            etiqueta: 'Resumen',
            contenido: (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <IndicadorResumen etiqueta="Última visita" valor={cliente.ultima_visita ? formatoFecha(cliente.ultima_visita) : 'Sin información'} />
                  <IndicadorResumen etiqueta="Próxima cita" valor={proximasCitas[0] ? formatoFechaHora(proximasCitas[0].rango_inicio) : 'Sin información'} />
                  <IndicadorResumen
                    etiqueta="Próximo seguimiento"
                    valor={cliente.proximo_seguimiento_fecha ? `${formatoFechaCorta(cliente.proximo_seguimiento_fecha)} · ${cliente.proximo_seguimiento_descripcion}` : 'Sin información'}
                  />
                  <IndicadorResumen etiqueta="Profesional habitual" valor={habitual ?? 'Sin información'} />
                  <IndicadorResumen etiqueta="Visitas" valor={String(cliente.visitas_completadas)} />
                  <IndicadorResumen etiqueta="Puntos disponibles" valor={`${fidelizacion?.saldo ?? cliente.saldo_puntos} pts`} />
                  <IndicadorResumen etiqueta="Gasto acumulado" valor={formatoMoneda(cliente.gasto_acumulado)} />
                </div>

                <Card className="flex flex-col gap-2">
                  <p className="font-semibold text-carbon">Actividad reciente</p>
                  {!visitas ? (
                    <Cargando filas={2} />
                  ) : visitas.length === 0 ? (
                    <p className="text-sm text-carbon/50">Aún no hay visitas registradas para esta clienta.</p>
                  ) : (
                    visitas.slice(0, 3).map((v) => (
                      <div key={v.atencionId} className="flex items-center justify-between border-b border-piedra/60 py-2 text-sm last:border-0">
                        <div>
                          <p className="font-medium text-carbon">{v.servicios.map((s) => s.nombre).join(' + ')}</p>
                          <p className="text-xs text-carbon/50">{formatoFecha(v.fecha)} · {v.profesionales.join(', ') || '—'}</p>
                        </div>
                        <span className="font-semibold text-carbon">{formatoMoneda(v.total)}</span>
                      </div>
                    ))
                  )}
                </Card>
              </div>
            ),
          },
          {
            id: 'historial',
            etiqueta: 'Historial',
            contenido: <HistorialVisitas visitas={visitas} clienteId={cliente.id} servicios={servicios} onCambio={cargar} />,
          },
          {
            id: 'recomendaciones',
            etiqueta: 'Recomendaciones',
            contador: recomendacionesPendientes.length,
            contenido: (
              <div className="flex flex-col gap-3">
                {mostrarNuevaObservacion ? (
                  <Card>
                    <FormularioObservacionSeguimiento
                      clienteId={cliente.id}
                      atencionId={null}
                      servicios={servicios}
                      onCancelar={() => setMostrarNuevaObservacion(false)}
                      onGuardado={() => {
                        setMostrarNuevaObservacion(false)
                        cargar()
                      }}
                    />
                  </Card>
                ) : (
                  <Button variante="secondary" tamano="sm" className="self-start" onClick={() => setMostrarNuevaObservacion(true)}>
                    + Nueva observación o recomendación
                  </Button>
                )}

                {notasGenerales.map((n) => (
                  <Card key={n.id} className="bg-champan/10">
                    <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Observación · {formatoFecha(n.creado_en)}</p>
                    <p className="text-sm text-carbon/80">{n.nota}</p>
                  </Card>
                ))}

                {recomendaciones.length === 0 && notasGenerales.length === 0 ? (
                  <EmptyState titulo="No hay seguimientos pendientes." />
                ) : (
                  recomendaciones.map((r) => (
                    <Card key={r.id} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-carbon">{r.descripcion}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            r.estado === 'pendiente' ? 'bg-advertencia/15 text-advertencia' : r.estado === 'completada' ? 'bg-exito/15 text-exito' : 'bg-carbon/10 text-carbon/60'
                          }`}
                        >
                          {r.estado === 'pendiente' ? 'Pendiente' : r.estado === 'completada' ? 'Completada' : 'Cancelada'}
                        </span>
                      </div>
                      {r.fecha_recomendada_regreso && <p className="text-sm text-carbon/70">Volver el {formatoFechaCorta(r.fecha_recomendada_regreso)}</p>}
                      {r.estado === 'pendiente' && (
                        <div className="flex flex-wrap gap-2">
                          <Button tamano="sm" onClick={() => irAAgendar(r.servicio_recomendado_id)}>Agendar cita</Button>
                          <Button variante="ghost" tamano="sm" onClick={() => marcarSeguimiento(r.id, 'completada')}>Marcar completado</Button>
                          <Button variante="ghost" tamano="sm" onClick={() => marcarSeguimiento(r.id, 'cancelada')}>Cancelar</Button>
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </div>
            ),
          },
          {
            id: 'citas',
            etiqueta: 'Citas',
            contenido: (
              <div className="flex flex-col gap-4">
                <Card className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-carbon">Próximas</p>
                    <Button tamano="sm" onClick={() => irAAgendar()}>Agendar cita</Button>
                  </div>
                  {!reservas ? (
                    <Cargando filas={2} />
                  ) : proximasCitas.length === 0 ? (
                    <p className="text-sm text-carbon/50">No tiene próximas citas.</p>
                  ) : (
                    proximasCitas.map((r) => (
                      <div key={r.id} className="flex items-center justify-between border-b border-piedra/60 py-2 text-sm last:border-0">
                        <div>
                          <p className="font-medium text-carbon">{r.servicio_nombre}</p>
                          <p className="text-xs text-carbon/50">{formatoFechaHora(r.rango_inicio)} · {r.profesional_nombre}</p>
                        </div>
                        <EstadoReservaBadge estado={r.estado} />
                      </div>
                    ))
                  )}
                </Card>
                <Card className="flex flex-col gap-3">
                  <p className="font-semibold text-carbon">Historial</p>
                  {!reservas ? (
                    <Cargando filas={2} />
                  ) : citasAnteriores.length === 0 ? (
                    <p className="text-sm text-carbon/50">Sin citas anteriores.</p>
                  ) : (
                    citasAnteriores.map((r) => (
                      <div key={r.id} className="flex items-center justify-between border-b border-piedra/60 py-2 text-sm last:border-0">
                        <div>
                          <p className="font-medium text-carbon">{r.servicio_nombre}</p>
                          <p className="text-xs text-carbon/50">{formatoFechaHora(r.rango_inicio)} · {r.profesional_nombre}</p>
                        </div>
                        <EstadoReservaBadge estado={r.estado} />
                      </div>
                    ))
                  )}
                </Card>
              </div>
            ),
          },
          {
            id: 'fidelizacion',
            etiqueta: 'Fidelización',
            contenido: (
              <div className="flex flex-col gap-4">
                <Card className="flex flex-col gap-2">
                  {!fidelizacion ? (
                    <Cargando filas={2} />
                  ) : (
                    <>
                      <p className="font-marca text-2xl font-semibold text-oliva">{fidelizacion.saldo} pts</p>
                      {fidelizacion.meta && (
                        <>
                          <p className="text-sm text-carbon/70">Meta: {fidelizacion.meta.nombre} ({fidelizacion.meta.costo_puntos} pts)</p>
                          {fidelizacion.progreso !== null && (
                            <div className="h-2 w-full overflow-hidden rounded-full bg-piedra/50">
                              <div className="h-full rounded-full bg-oliva" style={{ width: `${Math.round(fidelizacion.progreso * 100)}%` }} />
                            </div>
                          )}
                          {fidelizacion.puntos_faltantes !== null && fidelizacion.puntos_faltantes > 0 && (
                            <p className="text-xs text-carbon/50">Faltan {fidelizacion.puntos_faltantes} pts para esta meta.</p>
                          )}
                        </>
                      )}
                      <Link to="/admin/fidelizacion" className="self-start text-sm font-semibold text-oliva hover:underline">Ver fidelización →</Link>
                    </>
                  )}
                </Card>
                <Card className="flex flex-col gap-2">
                  <p className="font-semibold text-carbon">Historial de puntos</p>
                  {!movimientosPuntos ? (
                    <Cargando filas={2} />
                  ) : movimientosPuntos.length === 0 ? (
                    <p className="text-sm text-carbon/50">Sin movimientos de puntos todavía.</p>
                  ) : (
                    movimientosPuntos.slice(0, 8).map((m) => (
                      <div key={m.id} className="flex items-center justify-between border-b border-piedra/60 py-1.5 text-sm last:border-0">
                        <span className="text-carbon/70">{formatoFecha(m.creado_en)} · {m.tipo}</span>
                        <span className={`font-semibold ${m.puntos >= 0 ? 'text-exito' : 'text-error'}`}>{m.puntos >= 0 ? '+' : ''}{m.puntos}</span>
                      </div>
                    ))
                  )}
                </Card>
              </div>
            ),
          },
        ]}
      />

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
        <Textarea id="notasCliente" etiqueta="" value={notasInternas} onChange={(e) => setNotasInternas(e.target.value)} />
        <Button tamano="sm" onClick={guardarNotasInternas} cargando={guardandoNotas} className="self-start">Guardar notas</Button>
      </Card>
    </div>
  )
}

function IndicadorResumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-xl border border-piedra bg-blanco p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">{etiqueta}</p>
      <p className="mt-1 text-sm font-semibold text-carbon">{valor}</p>
    </div>
  )
}
