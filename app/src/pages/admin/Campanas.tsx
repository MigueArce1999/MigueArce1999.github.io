import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Campos'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Drawer } from '../../components/ui/Modal'
import {
  actualizarCampana,
  crearCampana,
  eliminarCampana,
  enlaceWhatsApp,
  listarCampanas,
  listarDestinatarios,
  marcarDestinatario,
  prepararDestinatarios,
} from '../../lib/api/campanas'
import { listarClientesAdmin } from '../../lib/api/clientes'
import type { Campana, CampanaDestinatario, CampanaTipo, ClienteResumen } from '../../lib/types'

const etiquetaEstadoDestinatario: Record<string, string> = {
  pendiente: 'Pendiente',
  whatsapp_abierto: 'WhatsApp abierto',
  marcado_enviado: 'Marcado como enviado',
  excluido: 'Excluido',
}

export function AdminCampanas() {
  const location = useLocation() as { state?: { clienteIdsPreseleccionados?: string[] } }
  const [campanas, setCampanas] = useState<Campana[] | null>(null)
  const [clientes, setClientes] = useState<ClienteResumen[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [panelAbierto, setPanelAbierto] = useState<'nueva' | Campana | null>(null)
  const [campanaSeleccionada, setCampanaSeleccionada] = useState<Campana | null>(null)

  function recargar() {
    listarCampanas().then(setCampanas).catch((e) => setError(e.message))
    listarClientesAdmin().then(setClientes).catch((e) => setError(e.message))
  }
  useEffect(recargar, [])

  useEffect(() => {
    if (location.state?.clienteIdsPreseleccionados?.length) {
      setPanelAbierto('nueva')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtradas = (campanas ?? []).filter((c) => c.nombre.toLowerCase().includes(busqueda.toLowerCase()))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-marca text-2xl font-semibold text-carbon">Campañas de WhatsApp</h1>
          <p className="text-sm text-carbon/60">
            Prepara mensajes y ábrelos en WhatsApp uno por uno. No hay envío masivo automático: abrir un
            chat no significa que el mensaje se envió.
          </p>
        </div>
        <Button tamano="sm" onClick={() => setPanelAbierto('nueva')}>+ Nueva campaña</Button>
      </div>

      <input
        placeholder="Buscar campaña por nombre…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="rounded-lg border border-piedra px-3 py-2 text-sm sm:max-w-sm"
      />

      {error && <ErrorState mensaje={error} />}
      {!campanas ? (
        <Cargando />
      ) : filtradas.length === 0 ? (
        <EmptyState titulo="No hay campañas todavía" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtradas.map((c) => (
            <Card key={c.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-carbon">{c.nombre}</p>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${c.tipo === 'promocional' ? 'bg-champan/30 text-carbon/70' : 'bg-piedra/40 text-carbon/60'}`}>
                    {c.tipo === 'promocional' ? 'Promocional' : 'General'}
                  </span>
                </div>
                <span className="rounded-full bg-piedra/30 px-2 py-0.5 text-xs font-medium text-carbon/60">{c.estado}</span>
              </div>
              <p className="line-clamp-2 text-sm text-carbon/70">{c.mensaje}</p>
              <div className="mt-1 flex flex-wrap gap-3 text-xs font-semibold">
                <button onClick={() => setCampanaSeleccionada(c)} className="text-oliva hover:underline">Ver destinatarios</button>
                <button onClick={() => setPanelAbierto(c)} className="text-oliva hover:underline">Editar</button>
                <button
                  onClick={async () => {
                    if (!confirm(`¿Eliminar la campaña "${c.nombre}"? Esto no borra los mensajes ya abiertos en WhatsApp.`)) return
                    await eliminarCampana(c.id)
                    recargar()
                  }}
                  className="text-error hover:underline"
                >
                  Eliminar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer abierto={panelAbierto !== null} onCerrar={() => setPanelAbierto(null)} titulo={panelAbierto === 'nueva' ? 'Nueva campaña' : 'Editar campaña'}>
        {panelAbierto && (
          <FormularioCampana
            campana={panelAbierto !== 'nueva' ? panelAbierto : null}
            clientes={clientes}
            clienteIdsPreseleccionados={panelAbierto === 'nueva' ? location.state?.clienteIdsPreseleccionados : undefined}
            onGuardado={() => { setPanelAbierto(null); recargar() }}
          />
        )}
      </Drawer>

      <Drawer abierto={campanaSeleccionada !== null} onCerrar={() => setCampanaSeleccionada(null)} titulo={campanaSeleccionada ? `Destinatarios · ${campanaSeleccionada.nombre}` : ''}>
        {campanaSeleccionada && <ListaDestinatarios campana={campanaSeleccionada} />}
      </Drawer>
    </div>
  )
}

function FormularioCampana({
  campana,
  clientes,
  clienteIdsPreseleccionados,
  onGuardado,
}: {
  campana: Campana | null
  clientes: ClienteResumen[]
  clienteIdsPreseleccionados?: string[]
  onGuardado: () => void
}) {
  const [nombre, setNombre] = useState(campana?.nombre ?? '')
  const [mensaje, setMensaje] = useState(campana?.mensaje ?? '')
  const [tipo, setTipo] = useState<CampanaTipo>(campana?.tipo ?? 'general')
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set(clienteIdsPreseleccionados ?? []))
  const [filtroClientes, setFiltroClientes] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ incluidos: number; excluidos: number } | null>(null)

  const clientesFiltrados = clientes.filter((c) => c.nombre.toLowerCase().includes(filtroClientes.toLowerCase()))
  const autorizadosSeleccionados = clientes.filter((c) => seleccionados.has(c.id) && c.consentimiento_marketing).length

  function alternar(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResultado(null)
    if (!nombre.trim() || !mensaje.trim()) { setError('Escribe un nombre y un mensaje para la campaña.'); return }
    setGuardando(true)
    try {
      const id = campana ? campana.id : await crearCampana(nombre.trim(), mensaje.trim(), tipo)
      if (campana) await actualizarCampana(id, nombre.trim(), mensaje.trim())
      if (seleccionados.size > 0) {
        const r = await prepararDestinatarios(id, Array.from(seleccionados), tipo)
        setResultado(r)
      }
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      {resultado && (
        <p className="rounded-lg bg-exito/10 px-3 py-2 text-sm font-medium text-exito">
          {resultado.incluidos} destinataria{resultado.incluidos !== 1 ? 's' : ''} lista{resultado.incluidos !== 1 ? 's' : ''}
          {resultado.excluidos > 0 && `, ${resultado.excluidos} excluida${resultado.excluidos !== 1 ? 's' : ''} (sin autorización o sin teléfono válido)`}.
        </p>
      )}
      <Input id="nombreCampana" etiqueta="Nombre de la campaña" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Select id="tipoCampana" etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as CampanaTipo)} disabled={!!campana}>
        <option value="general">General (a cualquiera)</option>
        <option value="promocional">Promocional (solo con autorización)</option>
      </Select>
      <Textarea id="mensajeCampana" etiqueta="Mensaje" required value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
      {mensaje.trim() && (
        <div className="rounded-lg bg-marfil p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-carbon/40">Vista previa</p>
          <p className="whitespace-pre-wrap text-sm text-carbon/80">{mensaje}</p>
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-semibold text-carbon">Destinatarios ({seleccionados.size} seleccionadas)</p>
        {tipo === 'promocional' && (
          <p className="mb-2 text-xs text-carbon/50">Solo se incluirán quienes autorizaron promociones ({autorizadosSeleccionados} de las seleccionadas).</p>
        )}
        <input
          placeholder="Buscar cliente…"
          value={filtroClientes}
          onChange={(e) => setFiltroClientes(e.target.value)}
          className="mb-2 w-full rounded-lg border border-piedra px-3 py-1.5 text-sm"
        />
        <div className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded-lg border border-piedra p-2">
          {clientesFiltrados.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm text-carbon hover:bg-piedra/20">
              <input type="checkbox" checked={seleccionados.has(c.id)} onChange={() => alternar(c.id)} />
              {c.nombre}
              {tipo === 'promocional' && !c.consentimiento_marketing && <span className="text-xs text-carbon/40">(sin autorización)</span>}
            </label>
          ))}
        </div>
      </div>

      <Button type="submit" cargando={guardando}>{campana ? 'Guardar y preparar destinatarios' : 'Crear y preparar destinatarios'}</Button>
    </form>
  )
}

function ListaDestinatarios({ campana }: { campana: Campana }) {
  const [destinatarios, setDestinatarios] = useState<CampanaDestinatario[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function recargar() {
    listarDestinatarios(campana.id).then(setDestinatarios).catch((e) => setError(e.message))
  }
  useEffect(recargar, [campana.id])

  async function abrirWhatsApp(d: CampanaDestinatario) {
    if (!d.cliente_telefono) return
    window.open(enlaceWhatsApp(d.cliente_telefono, campana.mensaje), '_blank', 'noopener,noreferrer')
    await marcarDestinatario(d.id, 'whatsapp_abierto')
    recargar()
  }

  async function marcarEnviado(d: CampanaDestinatario) {
    await marcarDestinatario(d.id, 'marcado_enviado')
    recargar()
  }

  if (error) return <ErrorState mensaje={error} />
  if (!destinatarios) return <Cargando />
  if (destinatarios.length === 0) return <EmptyState titulo="Todavía no se han preparado destinatarios para esta campaña" />

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg bg-marfil p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-carbon/40">Mensaje</p>
        <p className="whitespace-pre-wrap text-sm text-carbon/80">{campana.mensaje}</p>
      </div>
      {destinatarios.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-piedra px-3 py-2 text-sm">
          <div>
            <p className="font-medium text-carbon">{d.cliente_nombre}</p>
            <p className="text-xs text-carbon/50">
              {etiquetaEstadoDestinatario[d.estado]}
              {d.motivo_exclusion && ` · ${d.motivo_exclusion}`}
            </p>
          </div>
          {d.estado !== 'excluido' && (
            <div className="flex gap-2">
              <button onClick={() => abrirWhatsApp(d)} className="text-xs font-semibold text-oliva hover:underline">Abrir WhatsApp</button>
              {d.estado !== 'marcado_enviado' && (
                <button onClick={() => marcarEnviado(d)} className="text-xs font-semibold text-carbon/60 hover:underline">Marcar enviado</button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
