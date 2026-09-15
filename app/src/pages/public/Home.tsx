import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { listarProfesionales, listarPromocionesVigentes, listarServicios } from '../../lib/api/catalogo'
import { formatoFecha, formatoMoneda } from '../../lib/format'
import type { Profesional, Promocion, Servicio } from '../../lib/types'

export function Home() {
  const [servicios, setServicios] = useState<Servicio[] | null>(null)
  const [promos, setPromos] = useState<Promocion[] | null>(null)
  const [equipo, setEquipo] = useState<Profesional[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listarServicios(), listarPromocionesVigentes(), listarProfesionales()])
      .then(([s, p, e]) => {
        setServicios(s.slice(0, 4))
        setPromos(p)
        setEquipo(e)
      })
      .catch((err) => setError(err.message))
  }, [])

  return (
    <div>
      <section className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-24">
        <h1 className="font-marca text-4xl font-semibold leading-tight text-carbon sm:text-6xl">
          Tu esencia, <br /> en buenas manos.
        </h1>
        <p className="max-w-xl text-lg text-carbon/70">
          Más que un salón, un espacio para sentirte bien. Cuidado, experiencia y belleza que realza lo mejor de ti.
        </p>
        <Link to="/reservar">
          <Button tamano="lg">Reservar cita →</Button>
        </Link>
      </section>

      {error && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <ErrorState mensaje={error} />
        </div>
      )}

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="mb-6 font-marca text-2xl font-semibold text-carbon">Servicios destacados</h2>
        {!servicios ? (
          <Cargando />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {servicios.map((s) => (
              <Card key={s.id} className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-champan">{s.categoria_nombre}</p>
                <p className="font-semibold text-carbon">{s.nombre}</p>
                <p className="text-sm text-carbon/60">{s.duracion_minutos} min</p>
                <p className="font-semibold text-oliva">
                  {s.tipo_precio === 'a_valorar' ? 'Valoración en salón' : `${s.tipo_precio === 'desde' ? 'Desde ' : ''}${formatoMoneda(s.precio)}`}
                </p>
                <Link to={`/servicios/${s.id}`} className="mt-1 text-sm font-semibold text-oliva underline underline-offset-2">
                  Ver y reservar
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>

      {promos && promos.length > 0 && (
        <section className="bg-piedra/30 px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-6 font-marca text-2xl font-semibold text-carbon">Promociones vigentes</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {promos.map((p) => (
                <Card key={p.id}>
                  <p className="font-semibold text-carbon">{p.nombre}</p>
                  <p className="text-sm text-carbon/70">{p.descripcion}</p>
                  <p className="mt-2 text-xs text-carbon/50">Vigente hasta {formatoFecha(p.vigente_hasta)}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="mb-6 font-marca text-2xl font-semibold text-carbon">Nuestro equipo</h2>
        {!equipo ? (
          <Cargando />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {equipo.map((p) => (
              <Link to={`/equipo/${p.slug}`} key={p.id} className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-piedra font-marca text-2xl text-oliva">
                  {p.nombre.charAt(0)}
                </div>
                <p className="text-sm font-semibold text-carbon">{p.nombre}</p>
                <p className="text-xs text-carbon/60">{p.especialidades.join(', ')}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-carbon">Cartagena, Colombia</p>
            <p className="text-sm text-carbon/60">Consulta horarios, ubicación y cómo llegar.</p>
          </div>
          <Link to="/ubicacion">
            <Button variante="secondary">Ver ubicación y horarios</Button>
          </Link>
        </Card>
      </section>
    </div>
  )
}
