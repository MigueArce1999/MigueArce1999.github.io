import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { listarCategorias, listarServicios } from '../../lib/api/catalogo'
import { formatoMoneda } from '../../lib/format'
import type { CategoriaServicio, Servicio } from '../../lib/types'

export function Servicios() {
  const [categorias, setCategorias] = useState<CategoriaServicio[] | null>(null)
  const [servicios, setServicios] = useState<Servicio[] | null>(null)
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listarCategorias(), listarServicios()])
      .then(([c, s]) => {
        setCategorias(c)
        setServicios(s)
      })
      .catch((e) => setError(e.message))
  }, [])

  const visibles = servicios?.filter((s) => !categoriaActiva || s.categoria_id === categoriaActiva)

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-marca text-3xl font-semibold text-carbon sm:text-4xl">Servicios</h1>
      <p className="mb-8 text-carbon/60">Explora nuestro catálogo y reserva el que más se ajuste a ti.</p>

      {error && <ErrorState mensaje={error} />}

      {categorias && (
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setCategoriaActiva(null)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${!categoriaActiva ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
          >
            Todas
          </button>
          {categorias.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoriaActiva(c.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${categoriaActiva === c.id ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      {!visibles ? (
        <Cargando filas={4} />
      ) : visibles.length === 0 ? (
        <p className="text-carbon/60">No hay servicios en esta categoría todavía.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((s) => (
            <Card key={s.id} className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-champan">{s.categoria_nombre}</p>
              <p className="font-marca text-lg font-semibold text-carbon">{s.nombre}</p>
              {s.descripcion && <p className="text-sm text-carbon/60">{s.descripcion}</p>}
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-carbon/60">{s.duracion_minutos} min</span>
                <span className="font-semibold text-oliva">
                  {s.tipo_precio === 'a_valorar' ? 'Valoración en salón' : `${s.tipo_precio === 'desde' ? 'Desde ' : ''}${formatoMoneda(s.precio)}`}
                </span>
              </div>
              {s.tipo_precio === 'a_valorar' && (
                <p className="text-xs text-carbon/50">El valor se acuerda en salón antes de confirmar el cobro.</p>
              )}
              <Link to={`/servicios/${s.id}`} className="mt-2">
                <span className="inline-block rounded-full bg-oliva px-4 py-2 text-sm font-semibold text-blanco">Ver y reservar</span>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
