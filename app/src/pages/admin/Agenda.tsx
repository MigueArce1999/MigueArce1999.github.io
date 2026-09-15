import { useEffect, useState } from 'react'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { listarProfesionales } from '../../lib/api/catalogo'
import { listarAgendaGeneral } from '../../lib/api/reservas'
import { fechaBogotaISO, formatoFecha, formatoHora } from '../../lib/format'
import type { EstadoReserva, Profesional, Reserva } from '../../lib/types'

export function AdminAgenda() {
  const [equipo, setEquipo] = useState<Profesional[]>([])
  const [profesionalFiltro, setProfesionalFiltro] = useState<string>('todas')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoReserva | 'todos'>('todos')
  const [semana, setSemana] = useState(0)
  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarProfesionales().then(setEquipo)
  }, [])

  useEffect(() => {
    const hoy = new Date()
    const inicio = new Date(hoy)
    inicio.setDate(inicio.getDate() - inicio.getDay() + semana * 7)
    inicio.setHours(0, 0, 0, 0)
    const fin = new Date(inicio)
    fin.setDate(fin.getDate() + 7)
    setReservas(null)
    listarAgendaGeneral(inicio.toISOString(), fin.toISOString()).then(setReservas).catch((e) => setError(e.message))
  }, [semana])

  const visibles = reservas?.filter(
    (r) => (profesionalFiltro === 'todas' || r.profesional_id === profesionalFiltro) && (estadoFiltro === 'todos' || r.estado === estadoFiltro),
  )

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Agenda general</h1>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setSemana((s) => s - 1)} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">← Semana</button>
        <button onClick={() => setSemana(0)} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">Hoy</button>
        <button onClick={() => setSemana((s) => s + 1)} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">Semana →</button>

        <select value={profesionalFiltro} onChange={(e) => setProfesionalFiltro(e.target.value)} className="ml-2 rounded-lg border border-piedra px-3 py-1.5 text-sm">
          <option value="todas">Todas las profesionales</option>
          {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value as any)} className="rounded-lg border border-piedra px-3 py-1.5 text-sm">
          <option value="todos">Todos los estados</option>
          {['pendiente', 'confirmada', 'en_atencion', 'completada', 'cancelada', 'no_asistio'].map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      </div>

      {error && <ErrorState mensaje={error} />}
      {!visibles ? (
        <Cargando />
      ) : visibles.length === 0 ? (
        <EmptyState titulo="No hay citas con estos filtros" />
      ) : (
        <div className="flex flex-col gap-2">
          {visibles
            .sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio))
            .map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium text-carbon">
                    {formatoFecha(r.rango_inicio)} · {formatoHora(r.rango_inicio)} · {r.servicio_nombre}
                  </p>
                  <p className="text-xs text-carbon/60">{r.cliente_nombre} con {r.profesional_nombre}</p>
                </div>
                <EstadoReservaBadge estado={r.estado} />
              </Card>
            ))}
        </div>
      )}
      <p className="text-xs text-carbon/50">
        Fecha de referencia: {fechaBogotaISO()} (America/Bogota). Crear, reprogramar y cancelar citas desde aquí
        usa las mismas funciones que el portal de empleadas — no hay una ruta paralela que las desincronice.
      </p>
    </div>
  )
}
