import { useEffect, useState } from 'react'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { listarNotasCliente, listarRecomendacionesCliente } from '../../lib/api/clientes'
import { formatoFecha, formatoFechaCorta } from '../../lib/format'
import type { ClienteNota, ClienteRecomendacion } from '../../lib/types'

type Entrada = ({ tipo: 'nota' } & ClienteNota) | ({ tipo: 'recomendacion' } & ClienteRecomendacion)

const ESTADO_ETIQUETA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-advertencia/15 text-advertencia' },
  completada: { texto: 'Completada', clase: 'bg-exito/15 text-exito' },
  cancelada: { texto: 'Cancelada', clase: 'bg-carbon/10 text-carbon/60' },
}

// Bitácora de lo que el salón va anotando sobre cada visita — observaciones ("cabello en
// proceso") y recomendaciones ("volver en 15 días") — para que la clienta entienda su propia
// evolución sin tener que preguntar. Reutiliza cliente_nota/cliente_recomendacion (0072) y la
// política de lectura propia agregada en 0073 — nunca una tabla nueva solo para esto.
export function ClienteDiarioBelleza() {
  const { cliente } = useAuth()
  const [notas, setNotas] = useState<ClienteNota[] | null>(null)
  const [recomendaciones, setRecomendaciones] = useState<ClienteRecomendacion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cliente) return
    listarNotasCliente(cliente.id).then(setNotas).catch((e) => setError(e.message))
    listarRecomendacionesCliente(cliente.id).then(setRecomendaciones).catch((e) => setError(e.message))
  }, [cliente])

  const cargando = notas === null || recomendaciones === null
  const entradas: Entrada[] = cargando
    ? []
    : [
        ...notas.map((n): Entrada => ({ tipo: 'nota', ...n })),
        ...recomendaciones.map((r): Entrada => ({ tipo: 'recomendacion', ...r })),
      ].sort((a, b) => b.creado_en.localeCompare(a.creado_en))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-marca text-2xl font-semibold text-carbon">Diario de belleza</h1>
        <p className="text-sm text-carbon/60">Lo que tu profesional va anotando en cada visita: cómo está tu cabello y cuándo conviene que vuelvas.</p>
      </div>
      {error && <ErrorState mensaje={error} />}
      {cargando ? (
        <Cargando />
      ) : entradas.length === 0 ? (
        <EmptyState titulo="Aún no hay anotaciones." descripcion="Después de tu próxima visita, tu profesional podrá dejarte aquí observaciones y recomendaciones." />
      ) : (
        <div className="flex flex-col gap-3">
          {entradas.map((e) => (
            <Card key={`${e.tipo}-${e.id}`} className={e.tipo === 'nota' ? 'bg-champan/10' : 'bg-oliva/5'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">
                  {e.tipo === 'nota' ? 'Observación' : 'Recomendación'} · {formatoFecha(e.creado_en)}
                </p>
                {e.tipo === 'recomendacion' && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_ETIQUETA[e.estado].clase}`}>{ESTADO_ETIQUETA[e.estado].texto}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-carbon/80">{e.tipo === 'nota' ? e.nota : e.descripcion}</p>
              {e.tipo === 'recomendacion' && e.fecha_recomendada_regreso && (
                <p className="mt-1 text-xs font-semibold text-oliva">Te recomendamos volver el {formatoFechaCorta(e.fecha_recomendada_regreso)}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
