import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { obtenerServicio } from '../../lib/api/catalogo'
import { formatoMoneda } from '../../lib/format'
import type { Servicio } from '../../lib/types'

export function ServicioDetalle() {
  const { id } = useParams<{ id: string }>()
  const [servicio, setServicio] = useState<Servicio | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    obtenerServicio(id).then(setServicio).catch((e) => setError(e.message))
  }, [id])

  if (error) return <div className="mx-auto max-w-3xl px-4 py-12"><ErrorState mensaje={error} /></div>
  if (servicio === undefined) return <div className="mx-auto max-w-3xl px-4 py-12"><Cargando /></div>
  if (servicio === null) return <div className="mx-auto max-w-3xl px-4 py-12"><EmptyState titulo="No encontramos este servicio" /></div>

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-champan">{servicio.categoria_nombre}</p>
      <h1 className="font-marca text-3xl font-semibold text-carbon sm:text-4xl">{servicio.nombre}</h1>
      {servicio.descripcion && <p className="mt-3 text-lg text-carbon/70">{servicio.descripcion}</p>}

      <div className="mt-6 flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-carbon/50">Duración estimada</p>
          <p className="font-semibold text-carbon">{servicio.duracion_minutos} minutos</p>
        </div>
        <div>
          <p className="text-carbon/50">Precio</p>
          <p className="font-semibold text-oliva">
            {servicio.tipo_precio === 'a_valorar'
              ? 'A valorar en salón'
              : `${servicio.tipo_precio === 'desde' ? 'Desde ' : ''}${formatoMoneda(servicio.precio)}`}
          </p>
        </div>
      </div>

      {servicio.tipo_precio === 'a_valorar' && (
        <p className="mt-4 rounded-xl bg-advertencia/10 p-4 text-sm text-carbon/80">
          Este servicio requiere valoración presencial: el valor final se acuerda contigo antes de realizarlo
          y se registra en el momento del cobro.
        </p>
      )}

      {servicio.profesionales && servicio.profesionales.length > 0 && (
        <div className="mt-8">
          <p className="mb-3 font-semibold text-carbon">Profesionales que lo realizan</p>
          <div className="flex flex-wrap gap-3">
            {servicio.profesionales.map((p) => (
              <Link key={p.id} to={`/equipo/${p.slug}`} className="rounded-full bg-piedra/40 px-4 py-1.5 text-sm font-medium text-carbon">
                {p.nombre}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link to={`/reservar?servicio=${servicio.id}`} className="mt-8 inline-block">
        <Button tamano="lg">Reservar este servicio →</Button>
      </Link>
    </div>
  )
}
