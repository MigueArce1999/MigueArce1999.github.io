import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cargando, ErrorState } from '../../components/ui/Estados'
import { listarProfesionales } from '../../lib/api/catalogo'
import type { Profesional } from '../../lib/types'

export function Equipo() {
  const [equipo, setEquipo] = useState<Profesional[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarProfesionales().then(setEquipo).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-marca text-3xl font-semibold text-carbon sm:text-4xl">Nuestro equipo</h1>
      <p className="mb-8 text-carbon/60">Elige una profesional para ver sus servicios y reservar directamente con ella.</p>

      {error && <ErrorState mensaje={error} />}
      {!equipo ? (
        <Cargando />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {equipo.map((p) => (
            <Link
              key={p.id}
              to={`/equipo/${p.slug}`}
              className="flex flex-col items-center gap-3 rounded-2xl border border-piedra bg-blanco p-6 text-center transition-shadow hover:shadow-md"
            >
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-piedra font-marca text-3xl text-oliva">
                {p.nombre.charAt(0)}
              </div>
              <p className="font-marca text-lg font-semibold text-carbon">{p.nombre}</p>
              <p className="text-sm text-carbon/60">{p.especialidades.join(' · ')}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
