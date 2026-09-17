import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { listarServiciosDeProfesional, obtenerProfesional } from '../../lib/api/catalogo'
import { formatoPrecioServicio } from '../../lib/format'
import type { Profesional, Servicio } from '../../lib/types'

export function ProfesionalDetalle() {
  const { slug } = useParams<{ slug: string }>()
  const [profesional, setProfesional] = useState<Profesional | null | undefined>(undefined)
  const [servicios, setServicios] = useState<Servicio[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    obtenerProfesional(slug)
      .then((p) => {
        setProfesional(p)
        if (p) return listarServiciosDeProfesional(p.id).then(setServicios)
      })
      .catch((e) => setError(e.message))
  }, [slug])

  if (error) return <div className="mx-auto max-w-4xl px-4 py-12"><ErrorState mensaje={error} /></div>
  if (profesional === undefined) return <div className="mx-auto max-w-4xl px-4 py-12"><Cargando /></div>
  if (profesional === null) return <div className="mx-auto max-w-4xl px-4 py-12"><EmptyState titulo="No encontramos a esta profesional" /></div>

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-piedra font-marca text-4xl text-oliva">
          {profesional.nombre.charAt(0)}
        </div>
        <div>
          <h1 className="font-marca text-3xl font-semibold text-carbon">{profesional.nombre}</h1>
          <p className="mt-1 text-carbon/60">{profesional.especialidades.join(' · ')}</p>
          {profesional.bio && <p className="mt-3 max-w-xl text-carbon/70">{profesional.bio}</p>}
          <Link to={`/reservar?profesional=${profesional.id}`} className="mt-4 inline-block">
            <Button>Reservar con {profesional.nombre}</Button>
          </Link>
        </div>
      </div>

      <h2 className="mb-4 mt-10 font-marca text-2xl font-semibold text-carbon">Servicios que realiza</h2>
      {!servicios ? (
        <Cargando />
      ) : servicios.length === 0 ? (
        <p className="text-carbon/60">Aún no tiene servicios asignados.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {servicios.map((s) => (
            <Link
              key={s.id}
              to={`/reservar?servicio=${s.id}&profesional=${profesional.id}`}
              className="flex items-center justify-between rounded-xl border border-piedra bg-blanco p-4 hover:border-oliva"
            >
              <div>
                <p className="font-semibold text-carbon">{s.nombre}</p>
                {s.duracion_minutos != null && <p className="text-xs text-carbon/60">{s.duracion_minutos} min</p>}
              </div>
              <p className="font-semibold text-oliva">{formatoPrecioServicio(s)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
