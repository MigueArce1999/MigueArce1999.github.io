// Panel admin de GlowDesk Live (sección 22 del pedido): activar la función, CRUD de zonas y
// asignación de profesionales a cada zona. Reutiliza las funciones de la Fase 3
// (lib/api/disponibilidadEnVivo.ts) sin tocar el motor ni el esquema.
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { Modal } from '../../components/ui/Modal'
import { listarProfesionales } from '../../lib/api/catalogo'
import {
  actualizarZona,
  asignarProfesionalAZona,
  crearZona,
  eliminarZona,
  limpiarEstadoManual,
  listarTodasLasAsignacionesZona,
  listarZonas,
  marcarEstadoManual,
  quitarProfesionalDeZona,
} from '../../lib/api/disponibilidadEnVivo'
import { useEstadoEquipoEnVivo } from '../../lib/disponibilidadEnVivo/useEstadoEquipoEnVivo'
import { textoMiEstadoAhora } from '../../lib/disponibilidadEnVivo/textoDisponibilidad'
import { isDemoMode, LOCAL_ID, supabase } from '../../lib/supabase'
import type { ConfiguracionNegocio, EstadoEquipoItem, EstadoManualProfesional, Profesional, ZonaSalon } from '../../lib/types'

type Pestana = 'equipo' | 'zonas' | 'configuracion'

export function AdminDisponibilidadEnVivo() {
  const [pestana, setPestana] = useState<Pestana>('equipo')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-marca text-2xl font-semibold text-carbon">GlowDesk Live</h1>
        <p className="text-sm text-carbon/60">Disponibilidad en tiempo real: zonas del salón y quién puede atender ahora.</p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-piedra">
        {([['equipo', 'Equipo'], ['zonas', 'Zonas'], ['configuracion', 'Configuración']] as [Pestana, string][]).map(([p, etiqueta]) => (
          <button
            key={p}
            onClick={() => setPestana(p)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              pestana === p ? 'border-oliva text-oliva' : 'border-transparent text-carbon/50 hover:text-carbon'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'equipo' && <PestanaEquipo />}
      {pestana === 'zonas' && <PestanaZonas />}
      {pestana === 'configuracion' && <PestanaConfiguracion />}
    </div>
  )
}

// --- Equipo (0066): la admin ve y ajusta la disponibilidad de cualquier profesional, sin
// depender de que ella misma abra la app en su celular. --------------------------------------

const OPCIONES_ESTADO_EQUIPO: { valor: Exclude<EstadoManualProfesional, 'disponible'>; etiqueta: string; emoji: string }[] = [
  { valor: 'descanso', etiqueta: 'Descanso', emoji: '☕' },
  { valor: 'almuerzo', etiqueta: 'Almuerzo', emoji: '🍽️' },
  { valor: 'no_disponible', etiqueta: 'No disponible', emoji: '🚫' },
]
const OPCIONES_MINUTOS_EQUIPO = [15, 30, 45, 60]

function PestanaEquipo() {
  const { equipo, cargando, error, recargar } = useEstadoEquipoEnVivo()
  const [accionando, setAccionando] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  async function aplicar(profesionalId: string, estado: Exclude<EstadoManualProfesional, 'disponible'>, minutos: number) {
    setAccionando(profesionalId)
    setErrorAccion(null)
    try {
      await marcarEstadoManual(estado, minutos, profesionalId)
      recargar()
    } catch (e: any) {
      setErrorAccion(e.message)
    } finally {
      setAccionando(null)
    }
  }

  async function limpiar(profesionalId: string) {
    setAccionando(profesionalId)
    setErrorAccion(null)
    try {
      await limpiarEstadoManual(profesionalId)
      recargar()
    } catch (e: any) {
      setErrorAccion(e.message)
    } finally {
      setAccionando(null)
    }
  }

  if (cargando && !equipo) return <Cargando filas={3} />

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorState mensaje={error} reintentar={recargar} />}
      {errorAccion && <ErrorState mensaje={errorAccion} />}

      {equipo && equipo.length === 0 ? (
        <Card><p className="text-sm text-carbon/60">No hay profesionales activas en el equipo todavía.</p></Card>
      ) : (
        equipo?.map((item) => <FilaEquipo key={item.profesional_id} item={item} accionando={accionando === item.profesional_id} onAplicar={aplicar} onLimpiar={limpiar} />)
      )}
    </div>
  )
}

function FilaEquipo({
  item,
  accionando,
  onAplicar,
  onLimpiar,
}: {
  item: EstadoEquipoItem
  accionando: boolean
  onAplicar: (profesionalId: string, estado: Exclude<EstadoManualProfesional, 'disponible'>, minutos: number) => void
  onLimpiar: (profesionalId: string) => void
}) {
  const [estadoElegido, setEstadoElegido] = useState<Exclude<EstadoManualProfesional, 'disponible'>>('descanso')
  const [minutos, setMinutos] = useState(15)
  const texto = textoMiEstadoAhora(item.estado)

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-carbon">{item.nombre}</p>
        <div className={`rounded-full px-3 py-1 text-sm font-semibold ${texto.clase}`}>
          {texto.emoji} {texto.titulo}{texto.detalle ? ` · ${texto.detalle}` : ''}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <select
          value={estadoElegido}
          onChange={(e) => setEstadoElegido(e.target.value as typeof estadoElegido)}
          aria-label={`Marcar a ${item.nombre} como`}
          className="rounded-lg border border-piedra bg-blanco px-2 py-1.5 text-sm text-carbon"
        >
          {OPCIONES_ESTADO_EQUIPO.map((o) => (
            <option key={o.valor} value={o.valor}>{o.emoji} {o.etiqueta}</option>
          ))}
        </select>
        <select
          value={minutos}
          onChange={(e) => setMinutos(Number(e.target.value))}
          aria-label={`Minutos para ${item.nombre}`}
          className="rounded-lg border border-piedra bg-blanco px-2 py-1.5 text-sm text-carbon"
        >
          {OPCIONES_MINUTOS_EQUIPO.map((m) => (
            <option key={m} value={m}>{m} min</option>
          ))}
        </select>
        <Button type="button" tamano="sm" onClick={() => onAplicar(item.profesional_id, estadoElegido, minutos)} cargando={accionando}>Aplicar</Button>
        {texto.esManual && (
          <Button type="button" tamano="sm" variante="secondary" onClick={() => onLimpiar(item.profesional_id)} disabled={accionando}>
            Poner disponible
          </Button>
        )}
      </div>
    </Card>
  )
}

// --- Zonas -------------------------------------------------------------------------------

function PestanaZonas() {
  const [zonas, setZonas] = useState<ZonaSalon[] | null>(null)
  const [profesionales, setProfesionales] = useState<Profesional[]>([])
  const [asignaciones, setAsignaciones] = useState<{ profesional_id: string; zona_id: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [zonaEnEdicion, setZonaEnEdicion] = useState<ZonaSalon | 'nueva' | null>(null)
  const [zonaExpandida, setZonaExpandida] = useState<string | null>(null)

  function cargar() {
    setError(null)
    Promise.all([listarZonas(), listarProfesionales(), listarTodasLasAsignacionesZona()])
      .then(([z, p, a]) => {
        setZonas(z)
        setProfesionales(p)
        setAsignaciones(a)
      })
      .catch((e) => setError(e.message))
  }

  useEffect(cargar, [])

  async function alternarActiva(zona: ZonaSalon) {
    await actualizarZona(zona.id, { activa: !zona.activa })
    cargar()
  }

  async function eliminar(zona: ZonaSalon) {
    if (!confirm(`¿Eliminar la zona "${zona.nombre}"? Las profesionales asignadas dejarán de aparecer en ella.`)) return
    await eliminarZona(zona.id)
    cargar()
  }

  async function alternarProfesionalEnZona(profesionalId: string, zonaId: string, asignada: boolean) {
    if (asignada) await quitarProfesionalDeZona(profesionalId, zonaId)
    else await asignarProfesionalAZona(profesionalId, zonaId)
    cargar()
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} reintentar={cargar} />}
      {!zonas ? (
        <Cargando filas={3} />
      ) : (
        <>
          <Button className="self-start" onClick={() => setZonaEnEdicion('nueva')}>+ Nueva zona</Button>
          {zonas.length === 0 ? (
            <Card>
              <p className="text-sm text-carbon/60">
                Todavía no hay zonas configuradas. Crea una (por ejemplo "Cabello" o "Manicura") y asígnale profesionales.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {zonas.map((zona) => {
                const idsDeEstaZona = new Set(asignaciones.filter((a) => a.zona_id === zona.id).map((a) => a.profesional_id))
                return (
                  <Card key={zona.id} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {zona.icono && <span aria-hidden>{zona.icono}</span>}
                        <p className="font-semibold text-carbon">{zona.nombre}</p>
                        {!zona.activa && <span className="rounded-full bg-carbon/10 px-2 py-0.5 text-xs text-carbon/60">Inactiva</span>}
                        <span className="text-xs text-carbon/50">{idsDeEstaZona.size} profesional{idsDeEstaZona.size === 1 ? '' : 'es'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setZonaExpandida(zonaExpandida === zona.id ? null : zona.id)}
                          className="text-sm font-semibold text-oliva underline underline-offset-2"
                        >
                          {zonaExpandida === zona.id ? 'Ocultar profesionales' : 'Asignar profesionales'}
                        </button>
                        <Button tamano="sm" variante="secondary" onClick={() => setZonaEnEdicion(zona)}>Editar</Button>
                        <Button tamano="sm" variante="secondary" onClick={() => alternarActiva(zona)}>
                          {zona.activa ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button tamano="sm" variante="danger" onClick={() => eliminar(zona)}>Eliminar</Button>
                      </div>
                    </div>

                    {zonaExpandida === zona.id && (
                      <div className="grid grid-cols-1 gap-2 border-t border-piedra pt-3 sm:grid-cols-2">
                        {profesionales.length === 0 ? (
                          <p className="text-sm text-carbon/60">No hay profesionales en el equipo todavía.</p>
                        ) : (
                          profesionales.map((p) => {
                            const asignada = idsDeEstaZona.has(p.id)
                            return (
                              <label key={p.id} className="flex items-center gap-2 text-sm text-carbon" style={{ minHeight: 44 }}>
                                <input
                                  type="checkbox"
                                  checked={asignada}
                                  onChange={() => alternarProfesionalEnZona(p.id, zona.id, asignada)}
                                  className="h-4 w-4 accent-oliva"
                                />
                                {p.nombre}
                              </label>
                            )
                          })
                        )}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      <FormularioZona
        zona={zonaEnEdicion}
        onCerrar={() => setZonaEnEdicion(null)}
        onGuardado={() => {
          setZonaEnEdicion(null)
          cargar()
        }}
      />
    </div>
  )
}

function FormularioZona({
  zona,
  onCerrar,
  onGuardado,
}: {
  zona: ZonaSalon | 'nueva' | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [icono, setIcono] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (zona && zona !== 'nueva') {
      setNombre(zona.nombre)
      setIcono(zona.icono ?? '')
    } else {
      setNombre('')
      setIcono('')
    }
    setError(null)
  }, [zona])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setGuardando(true)
    setError(null)
    try {
      if (zona === 'nueva') {
        await crearZona({ nombre: nombre.trim(), icono: icono.trim() || null })
      } else if (zona) {
        await actualizarZona(zona.id, { nombre: nombre.trim(), icono: icono.trim() || null })
      }
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal abierto={zona !== null} onCerrar={onCerrar} titulo={zona === 'nueva' ? 'Nueva zona' : `Editar "${zona ? zona.nombre : ''}"`}>
      <form onSubmit={guardar} className="flex flex-col gap-4">
        {error && <ErrorState mensaje={error} />}
        <Input id="zona-nombre" etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
        <Input
          id="zona-icono"
          etiqueta="Ícono (opcional)"
          value={icono}
          onChange={(e) => setIcono(e.target.value)}
          ayuda="Un emoji corto, por ejemplo 💇 o 💅 — se muestra junto al nombre de la zona."
        />
        <Button type="submit" cargando={guardando}>Guardar</Button>
      </form>
    </Modal>
  )
}

// --- Configuración -------------------------------------------------------------------------

const configDemo: Pick<
  ConfiguracionNegocio,
  'live_disponibilidad_activo' | 'live_umbral_termina_pronto_minutos' | 'live_umbral_disponible_limitado_minutos' | 'live_expiracion_solicitud_minutos' | 'live_hold_minutos'
> = {
  live_disponibilidad_activo: true,
  live_umbral_termina_pronto_minutos: 20,
  live_umbral_disponible_limitado_minutos: 45,
  live_expiracion_solicitud_minutos: 3,
  live_hold_minutos: 20,
}

function PestanaConfiguracion() {
  const [config, setConfig] = useState(configDemo)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode) return
    supabase!
      .from('configuracion_negocio')
      .select('live_disponibilidad_activo, live_umbral_termina_pronto_minutos, live_umbral_disponible_limitado_minutos, live_expiracion_solicitud_minutos, live_hold_minutos')
      .eq('local_id', LOCAL_ID)
      .maybeSingle()
      .then(({ data }) => data && setConfig(data))
  }, [])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    setGuardado(false)
    try {
      if (!isDemoMode) {
        const { error: err } = await supabase!.from('configuracion_negocio').update(config).eq('local_id', LOCAL_ID)
        if (err) throw err
      }
      setGuardado(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card>
      {error && <ErrorState mensaje={error} />}
      <form onSubmit={guardar} className="flex flex-col gap-4">
        <label className="flex items-center gap-3 text-sm font-semibold text-carbon" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={config.live_disponibilidad_activo}
            onChange={(e) => setConfig({ ...config, live_disponibilidad_activo: e.target.checked })}
            className="h-5 w-5 accent-oliva"
          />
          Activar "Salón en vivo" para las clientas
        </label>
        <p className="-mt-2 text-xs text-carbon/60">
          Mientras esté apagado, el widget de la Home y la pantalla "/salon-en-vivo" quedan ocultos por completo.
        </p>

        <Input
          id="umbral-termina-pronto"
          etiqueta="Minutos para mostrar 'Termina pronto'"
          type="number"
          min={1}
          value={config.live_umbral_termina_pronto_minutos}
          onChange={(e) => setConfig({ ...config, live_umbral_termina_pronto_minutos: Number(e.target.value) })}
          ayuda="Si a una profesional le faltan menos de estos minutos para terminar su atención actual, se muestra 'Termina pronto' en vez de 'Atendiendo'."
        />
        <Input
          id="umbral-limitado"
          etiqueta="Minutos para mostrar 'Disponible por tiempo limitado'"
          type="number"
          min={1}
          value={config.live_umbral_disponible_limitado_minutos}
          onChange={(e) => setConfig({ ...config, live_umbral_disponible_limitado_minutos: Number(e.target.value) })}
          ayuda="Si una profesional está libre pero su próxima cita empieza antes de este tiempo, se distingue de 'Disponible ahora' sin más."
        />
        <Input
          id="expiracion-solicitud"
          etiqueta="Minutos para que expire una solicitud sin responder"
          type="number"
          min={1}
          value={config.live_expiracion_solicitud_minutos}
          onChange={(e) => setConfig({ ...config, live_expiracion_solicitud_minutos: Number(e.target.value) })}
          ayuda="Si la profesional no responde 'Sí puedo atenderla' / 'No puedo ahora' en este tiempo, la solicitud de la clienta expira sola."
        />
        <Input
          id="hold-minutos"
          etiqueta="Minutos de reserva temporal al aceptar una solicitud"
          type="number"
          min={1}
          value={config.live_hold_minutos}
          onChange={(e) => setConfig({ ...config, live_hold_minutos: Number(e.target.value) })}
          ayuda="Cuánto tiempo queda la profesional marcada como 'ocupada temporalmente' mientras esa clienta va en camino, para que nadie más reciba confirmación de disponibilidad al mismo tiempo."
        />

        <Button type="submit" cargando={guardando}>Guardar configuración</Button>
        {guardado && <p className="text-sm font-medium text-exito">Configuración guardada.</p>}
      </form>
    </Card>
  )
}
