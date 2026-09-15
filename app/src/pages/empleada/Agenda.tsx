import { useEffect, useState } from 'react'
import { Card, Cargando, EmptyState } from '../../components/ui/Estados'
import { EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { useAuth } from '../../state/AuthContext'
import { listarReservasDeProfesional } from '../../lib/api/reservas'
import { fechaBogotaISO, formatoFecha, formatoHora } from '../../lib/format'
import type { Reserva } from '../../lib/types'

type Vista = 'dia' | 'semana' | 'mes'

function inicioSemana(fecha: Date) {
  const d = new Date(fecha)
  const dia = d.getDay()
  d.setDate(d.getDate() - dia)
  d.setHours(0, 0, 0, 0)
  return d
}

export function EmpleadaAgenda() {
  const { profesional } = useAuth()
  const [vista, setVista] = useState<Vista>('semana')
  const [referencia, setReferencia] = useState(new Date())
  const [reservas, setReservas] = useState<Reserva[] | null>(null)

  useEffect(() => {
    if (!profesional) return
    const desde = new Date(referencia)
    const hasta = new Date(referencia)
    if (vista === 'dia') {
      hasta.setDate(hasta.getDate() + 1)
    } else if (vista === 'semana') {
      desde.setTime(inicioSemana(referencia).getTime())
      hasta.setTime(desde.getTime())
      hasta.setDate(hasta.getDate() + 7)
    } else {
      desde.setDate(1)
      hasta.setMonth(hasta.getMonth() + 1, 1)
    }
    setReservas(null)
    listarReservasDeProfesional(profesional.id, desde.toISOString(), hasta.toISOString()).then(setReservas)
  }, [profesional, vista, referencia])

  const agrupadas = reservas?.reduce<Record<string, Reserva[]>>((acc, r) => {
    const clave = fechaBogotaISO(new Date(r.rango_inicio))
    acc[clave] = acc[clave] ?? []
    acc[clave].push(r)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Mi agenda</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReferencia((f) => {
              const d = new Date(f)
              d.setDate(d.getDate() - (vista === 'mes' ? 30 : vista === 'semana' ? 7 : 1))
              return d
            })}
            className="rounded-full bg-piedra/40 px-3 py-1 text-sm"
          >
            ←
          </button>
          <button onClick={() => setReferencia(new Date())} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">Hoy</button>
          <button
            onClick={() => setReferencia((f) => {
              const d = new Date(f)
              d.setDate(d.getDate() + (vista === 'mes' ? 30 : vista === 'semana' ? 7 : 1))
              return d
            })}
            className="rounded-full bg-piedra/40 px-3 py-1 text-sm"
          >
            →
          </button>
        </div>
        <div className="flex gap-2">
          {(['dia', 'semana', 'mes'] as Vista[]).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${vista === v ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-carbon/50">
        Cambiar tu disponibilidad no mueve ni cancela citas ya agendadas — eso siempre requiere una acción explícita.
      </p>

      {!agrupadas ? (
        <Cargando />
      ) : Object.keys(agrupadas).length === 0 ? (
        <EmptyState titulo="No hay citas en este periodo" />
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(agrupadas)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([fecha, lista]) => (
              <div key={fecha}>
                <p className="mb-2 text-sm font-semibold text-carbon/70">{formatoFecha(lista[0].rango_inicio, { weekday: 'long', day: '2-digit', month: 'long', year: undefined })}</p>
                <div className="flex flex-col gap-2">
                  {lista
                    .sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio))
                    .map((r) => (
                      <Card key={r.id} className="flex items-center justify-between py-3">
                        <div>
                          <p className="font-medium text-carbon">{formatoHora(r.rango_inicio)} · {r.servicio_nombre}</p>
                          <p className="text-xs text-carbon/60">{r.cliente_nombre}</p>
                        </div>
                        <EstadoReservaBadge estado={r.estado} />
                      </Card>
                    ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
