import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import {
  listarBloqueosAusencias,
  obtenerHorarioVigente,
  obtenerProximoHorario,
  reservasAfectadasPorBloqueo,
  reservasAfectadasPorHorario,
  retirarSolicitudBloqueo,
  solicitarBloqueo,
  solicitarHorario,
} from '../../lib/api/agenda'
import { formatoFecha, formatoHora } from '../../lib/format'
import type { BloqueoAusencia, IntervaloHorario, Reserva, TipoBloqueoAusencia } from '../../lib/types'

const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

export function EmpleadaDisponibilidad() {
  const { profesional } = useAuth()
  const [tab, setTab] = useState<'horario' | 'ausencias'>('horario')

  if (!profesional) return <Cargando />

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Mi disponibilidad</h1>
      <div className="flex gap-2">
        <button
          onClick={() => setTab('horario')}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === 'horario' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
        >
          Horario habitual
        </button>
        <button
          onClick={() => setTab('ausencias')}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === 'ausencias' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
        >
          Ausencias y bloqueos
        </button>
      </div>
      {tab === 'horario' ? <HorarioHabitual profesionalId={profesional.id} /> : <AusenciasBloqueos profesionalId={profesional.id} />}
    </div>
  )
}

interface DiaEditable {
  activo: boolean
  intervalos: { horaInicio: string; horaFin: string }[]
}

function diasVacios(): DiaEditable[] {
  return NOMBRES_DIA.map(() => ({ activo: false, intervalos: [] }))
}

// Exportados para que Admin → Agenda los reutilice al gestionar el horario/ausencias de
// cualquier profesional (admin y la propia profesional aplican siempre directo — el servidor
// nunca deja una solicitud nueva pendiente — así que el mismo componente sirve para ambas
// pantallas sin duplicar nada).
export function HorarioHabitual({ profesionalId }: { profesionalId: string }) {
  const [dias, setDias] = useState<DiaEditable[] | null>(null)
  const [vigenteDesde, setVigenteDesde] = useState(hoyISO())
  const [motivo, setMotivo] = useState('')
  const [proximo, setProximo] = useState<{ vigenteDesde: string; intervalos: IntervaloHorario[] } | null>(null)
  const [conflictos, setConflictos] = useState<Reserva[] | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  function cargar() {
    setDias(null)
    setConflictos(null)
    setExito(null)
    Promise.all([obtenerHorarioVigente(profesionalId), obtenerProximoHorario(profesionalId)])
      .then(([vigente, prox]) => {
        const base = diasVacios()
        for (const fila of vigente) {
          base[fila.dia_semana].activo = true
          base[fila.dia_semana].intervalos.push({ horaInicio: fila.hora_inicio.slice(0, 5), horaFin: fila.hora_fin.slice(0, 5) })
        }
        setDias(base)
        setProximo(prox)
      })
      .catch((e) => setError(e.message))
  }

  useEffect(cargar, [profesionalId])

  function actualizarDia(i: number, cambios: Partial<DiaEditable>) {
    setDias((prev) => prev && prev.map((d, idx) => (idx === i ? { ...d, ...cambios } : d)))
    setConflictos(null)
    setExito(null)
  }

  function agregarIntervalo(i: number) {
    if (!dias) return
    actualizarDia(i, { intervalos: [...dias[i].intervalos, { horaInicio: '08:00', horaFin: '12:00' }] })
  }
  function quitarIntervalo(i: number, j: number) {
    if (!dias) return
    actualizarDia(i, { intervalos: dias[i].intervalos.filter((_, idx) => idx !== j) })
  }
  function cambiarIntervalo(i: number, j: number, cambios: Partial<{ horaInicio: string; horaFin: string }>) {
    if (!dias) return
    actualizarDia(i, { intervalos: dias[i].intervalos.map((iv, idx) => (idx === j ? { ...iv, ...cambios } : iv)) })
  }
  function copiarA(origen: number, destino: number) {
    if (!dias || origen === destino) return
    actualizarDia(destino, { activo: dias[origen].activo, intervalos: dias[origen].intervalos.map((iv) => ({ ...iv })) })
  }

  function construirIntervalos(): IntervaloHorario[] {
    if (!dias) return []
    const resultado: IntervaloHorario[] = []
    dias.forEach((d, dia_semana) => {
      if (!d.activo) return
      for (const iv of d.intervalos) resultado.push({ dia_semana, hora_inicio: iv.horaInicio, hora_fin: iv.horaFin })
    })
    return resultado
  }

  function validar(): string | null {
    if (!dias) return null
    for (let i = 0; i < dias.length; i++) {
      if (!dias[i].activo) continue
      if (dias[i].intervalos.length === 0) return `${NOMBRES_DIA[i]}: marca al menos un horario o desactiva el día.`
      for (const iv of dias[i].intervalos) {
        if (iv.horaFin <= iv.horaInicio) return `${NOMBRES_DIA[i]}: la hora final debe ser posterior a la inicial.`
      }
    }
    return null
  }

  async function revisar() {
    const problema = validar()
    if (problema) { setError(problema); return }
    setError(null)
    setRevisando(true)
    try {
      const afectadas = await reservasAfectadasPorHorario(profesionalId, construirIntervalos(), vigenteDesde)
      setConflictos(afectadas)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRevisando(false)
    }
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      await solicitarHorario({ profesionalId, intervalos: construirIntervalos(), vigenteDesde, motivo: motivo.trim() || null })
      setExito(`Listo: tu horario queda actualizado a partir del ${formatoFecha(vigenteDesde)}.`)
      setConflictos(null)
      cargar()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  if (!dias) return <Cargando filas={4} />

  const hayConflictos = (conflictos?.length ?? 0) > 0
  const puedeGuardar = conflictos !== null && !hayConflictos

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      {exito && <p className="rounded-lg bg-exito/10 px-3 py-2 text-sm font-medium text-exito">{exito}</p>}

      {proximo && (
        <Card className="bg-champan/10">
          <p className="text-sm font-semibold text-carbon">Ya tienes un cambio programado</p>
          <p className="text-xs text-carbon/60">A partir del {formatoFecha(proximo.vigenteDesde)} tu horario cambiará automáticamente.</p>
        </Card>
      )}

      <p className="text-xs text-carbon/60">Administras tu horario directamente: el cambio aplica de inmediato desde la fecha que elijas.</p>

      <div className="flex flex-col gap-2">
        {dias.map((d, i) => (
          <Card key={i} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-semibold text-carbon">
                <input type="checkbox" checked={d.activo} onChange={(e) => actualizarDia(i, { activo: e.target.checked, intervalos: e.target.checked && d.intervalos.length === 0 ? [{ horaInicio: '08:00', horaFin: '18:00' }] : d.intervalos })} />
                {NOMBRES_DIA[i]}
              </label>
              <select
                onChange={(e) => { if (e.target.value !== '') copiarA(Number(e.target.value), i); e.target.value = '' }}
                defaultValue=""
                className="rounded-lg border border-piedra bg-blanco px-2 py-1 text-xs text-carbon/70"
                aria-label={`Copiar horario a ${NOMBRES_DIA[i]}`}
              >
                <option value="">Copiar de…</option>
                {dias.map((_, j) => j !== i && <option key={j} value={j}>{NOMBRES_DIA[j]}</option>)}
              </select>
            </div>
            {d.activo && (
              <div className="flex flex-col gap-2 pl-6">
                {d.intervalos.map((iv, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <input type="time" value={iv.horaInicio} onChange={(e) => cambiarIntervalo(i, j, { horaInicio: e.target.value })} className="rounded-lg border border-piedra px-2 py-1 text-sm" />
                    <span className="text-carbon/40">–</span>
                    <input type="time" value={iv.horaFin} onChange={(e) => cambiarIntervalo(i, j, { horaFin: e.target.value })} className="rounded-lg border border-piedra px-2 py-1 text-sm" />
                    <button type="button" onClick={() => quitarIntervalo(i, j)} className="text-xs font-semibold text-error hover:underline">Quitar</button>
                  </div>
                ))}
                <button type="button" onClick={() => agregarIntervalo(i)} className="self-start text-xs font-semibold text-oliva hover:underline">
                  + Agregar otro horario (para un descanso, ej. mañana y tarde)
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-3">
        <Input id="vigenteDesde" etiqueta="Aplicar desde" type="date" min={hoyISO()} value={vigenteDesde} onChange={(e) => { setVigenteDesde(e.target.value); setConflictos(null) }} />
        <Textarea id="motivoHorario" etiqueta="Motivo (opcional)" value={motivo} onChange={(e) => { setMotivo(e.target.value); setConflictos(null) }} />

        {conflictos === null ? (
          <Button type="button" variante="secondary" onClick={revisar} cargando={revisando}>Revisar cambios</Button>
        ) : (
          <>
            {hayConflictos ? (
              <div className="rounded-lg border border-advertencia/40 bg-advertencia/10 p-3">
                <p className="text-sm font-semibold text-carbon">Este cambio afecta {conflictos!.length} cita(s):</p>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-carbon/70">
                  {conflictos!.map((c) => (
                    <li key={c.id}>{formatoFecha(c.rango_inicio)} · {formatoHora(c.rango_inicio)} — {c.cliente_nombre} ({c.servicio_nombre})</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-carbon/60">
                  Reprograma, reasigna o cancela estas citas antes de guardar — un cambio directo nunca las mueve solo.
                </p>
              </div>
            ) : (
              <p className="text-sm text-exito">Sin conflictos: ninguna cita vigente se ve afectada.</p>
            )}
            <div className="flex gap-2">
              <Button type="button" onClick={guardar} cargando={guardando} disabled={!puedeGuardar}>
                Guardar cambios
              </Button>
              <Button type="button" variante="ghost" onClick={() => setConflictos(null)}>Volver a editar</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

const ETIQUETA_TIPO: Record<TipoBloqueoAusencia, string> = {
  bloqueo: 'Bloquear unas horas',
  ausencia_dia: 'Día libre',
  ausencia_rango: 'Rango de fechas',
}

export function AusenciasBloqueos({ profesionalId }: { profesionalId: string }) {
  const [solicitudes, setSolicitudes] = useState<BloqueoAusencia[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formAbierto, setFormAbierto] = useState(false)

  function cargar() {
    listarBloqueosAusencias(profesionalId).then(setSolicitudes).catch((e) => setError(e.message))
  }
  useEffect(cargar, [profesionalId])

  async function retirar(id: string) {
    try {
      await retirarSolicitudBloqueo(id)
      cargar()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      {!formAbierto ? (
        <Button tamano="sm" onClick={() => setFormAbierto(true)} className="self-start">+ Nueva ausencia o bloqueo</Button>
      ) : (
        <FormularioAusencia
          profesionalId={profesionalId}
          onCancelar={() => setFormAbierto(false)}
          onCreado={() => { setFormAbierto(false); cargar() }}
        />
      )}

      <div>
        <p className="mb-2 font-semibold text-carbon">Mis solicitudes</p>
        {!solicitudes ? (
          <Cargando filas={2} />
        ) : solicitudes.length === 0 ? (
          <p className="text-sm text-carbon/60">Aún no has creado ninguna ausencia ni bloqueo.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {solicitudes.map((s) => (
              <Card key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium text-carbon">
                    {ETIQUETA_TIPO[s.tipo]} · {formatoFecha(s.rango_inicio)}
                    {!s.todo_el_dia && ` · ${formatoHora(s.rango_inicio)}–${formatoHora(s.rango_fin)}`}
                  </p>
                  {s.motivo && <p className="text-xs text-carbon/50">{s.motivo}</p>}
                  {s.estado === 'rechazada' && s.motivo_rechazo && <p className="text-xs text-error">Rechazada: {s.motivo_rechazo}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <EstadoSolicitudBadge estado={s.estado} />
                  {s.estado === 'pendiente' && (
                    <button onClick={() => retirar(s.id)} className="text-xs font-semibold text-error hover:underline">Retirar</button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function EstadoSolicitudBadge({ estado }: { estado: BloqueoAusencia['estado'] }) {
  const estilos: Record<BloqueoAusencia['estado'], string> = {
    pendiente: 'bg-advertencia/15 text-advertencia',
    aprobada: 'bg-exito/15 text-exito',
    rechazada: 'bg-error/15 text-error',
    retirada: 'bg-carbon/10 text-carbon/60',
  }
  const etiquetas: Record<BloqueoAusencia['estado'], string> = {
    pendiente: 'Pendiente',
    aprobada: 'Aprobada',
    rechazada: 'Rechazada',
    retirada: 'Retirada',
  }
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${estilos[estado]}`}>{etiquetas[estado]}</span>
}

function FormularioAusencia({ profesionalId, onCancelar, onCreado }: { profesionalId: string; onCancelar: () => void; onCreado: () => void }) {
  const [tipo, setTipo] = useState<TipoBloqueoAusencia>('bloqueo')
  const [fechaDesde, setFechaDesde] = useState(hoyISO())
  const [fechaHasta, setFechaHasta] = useState(hoyISO())
  const [horaInicio, setHoraInicio] = useState('08:00')
  const [horaFin, setHoraFin] = useState('09:00')
  const [motivo, setMotivo] = useState('')
  const [conflictos, setConflictos] = useState<Reserva[] | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function calcularRango(): { desdeISO: string; hastaISO: string; todoElDia: boolean } {
    if (tipo === 'bloqueo') {
      return { desdeISO: `${fechaDesde}T${horaInicio}:00`, hastaISO: `${fechaDesde}T${horaFin}:00`, todoElDia: false }
    }
    if (tipo === 'ausencia_dia') {
      return { desdeISO: `${fechaDesde}T00:00:00`, hastaISO: `${fechaDesde}T23:59:59`, todoElDia: true }
    }
    return { desdeISO: `${fechaDesde}T00:00:00`, hastaISO: `${fechaHasta}T23:59:59`, todoElDia: true }
  }

  async function revisar() {
    setError(null)
    if (tipo === 'ausencia_rango' && fechaHasta < fechaDesde) { setError('La fecha final debe ser posterior a la inicial.'); return }
    if (tipo === 'bloqueo' && horaFin <= horaInicio) { setError('La hora final debe ser posterior a la inicial.'); return }
    setRevisando(true)
    try {
      const { desdeISO, hastaISO } = calcularRango()
      const afectadas = await reservasAfectadasPorBloqueo(profesionalId, desdeISO, hastaISO)
      setConflictos(afectadas)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRevisando(false)
    }
  }

  async function confirmar() {
    setGuardando(true)
    setError(null)
    try {
      const { desdeISO, hastaISO, todoElDia } = calcularRango()
      await solicitarBloqueo({ profesionalId, tipo, desdeISO, hastaISO, todoElDia, motivo: motivo.trim() || null })
      onCreado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  const hayConflictos = (conflictos?.length ?? 0) > 0
  const puedeConfirmar = conflictos !== null && !hayConflictos

  return (
    <Card className="flex flex-col gap-3">
      {error && <ErrorState mensaje={error} />}
      <Select id="tipoAusencia" etiqueta="Tipo" value={tipo} onChange={(e) => { setTipo(e.target.value as TipoBloqueoAusencia); setConflictos(null) }}>
        <option value="bloqueo">Bloquear unas horas</option>
        <option value="ausencia_dia">Día libre</option>
        <option value="ausencia_rango">Rango de fechas</option>
      </Select>

      {tipo === 'ausencia_rango' ? (
        <div className="grid grid-cols-2 gap-2">
          <Input id="desde" etiqueta="Desde" type="date" min={hoyISO()} value={fechaDesde} onChange={(e) => { setFechaDesde(e.target.value); setConflictos(null) }} />
          <Input id="hasta" etiqueta="Hasta" type="date" min={fechaDesde} value={fechaHasta} onChange={(e) => { setFechaHasta(e.target.value); setConflictos(null) }} />
        </div>
      ) : (
        <Input id="fecha" etiqueta="Fecha" type="date" min={hoyISO()} value={fechaDesde} onChange={(e) => { setFechaDesde(e.target.value); setConflictos(null) }} />
      )}

      {tipo === 'bloqueo' && (
        <div className="grid grid-cols-2 gap-2">
          <Input id="horaInicio" etiqueta="Desde las" type="time" value={horaInicio} onChange={(e) => { setHoraInicio(e.target.value); setConflictos(null) }} />
          <Input id="horaFin" etiqueta="Hasta las" type="time" value={horaFin} onChange={(e) => { setHoraFin(e.target.value); setConflictos(null) }} />
        </div>
      )}

      <Textarea id="motivoAusencia" etiqueta="Motivo (opcional, solo lo ve el salón)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />

      <p className="text-xs text-carbon/60">Administras tu disponibilidad directamente: se aplica de inmediato.</p>

      {conflictos === null ? (
        <div className="flex gap-2">
          <Button type="button" onClick={revisar} cargando={revisando}>Revisar</Button>
          <Button type="button" variante="ghost" onClick={onCancelar}>Cancelar</Button>
        </div>
      ) : (
        <>
          {hayConflictos ? (
            <div className="rounded-lg border border-advertencia/40 bg-advertencia/10 p-3">
              <p className="text-sm font-semibold text-carbon">Esto afecta {conflictos!.length} cita(s):</p>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-carbon/70">
                {conflictos!.map((c) => (
                  <li key={c.id}>{formatoFecha(c.rango_inicio)} · {formatoHora(c.rango_inicio)} — {c.cliente_nombre} ({c.servicio_nombre})</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-carbon/60">Reprograma, reasigna o cancela estas citas antes de continuar.</p>
            </div>
          ) : (
            <p className="text-sm text-exito">Sin conflictos: ninguna cita vigente se ve afectada.</p>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={confirmar} cargando={guardando} disabled={!puedeConfirmar}>
              Aplicar bloqueo
            </Button>
            <Button type="button" variante="ghost" onClick={() => setConflictos(null)}>Volver a editar</Button>
          </div>
        </>
      )}
    </Card>
  )
}

