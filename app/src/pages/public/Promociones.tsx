import { useEffect, useState } from 'react'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { listarPromocionesVigentes } from '../../lib/api/catalogo'
import { formatoFecha } from '../../lib/format'
import type { Promocion } from '../../lib/types'

export function Promociones() {
  const [promos, setPromos] = useState<Promocion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarPromocionesVigentes().then(setPromos).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-marca text-3xl font-semibold text-carbon sm:text-4xl">Promociones</h1>
      <p className="mb-8 text-carbon/60">
        Solo mostramos promociones vigentes: nunca vas a encontrar aquí una que ya venció.
      </p>

      {error && <ErrorState mensaje={error} />}
      {!promos ? (
        <Cargando />
      ) : promos.length === 0 ? (
        <EmptyState titulo="No hay promociones vigentes en este momento" descripcion="Vuelve pronto o consulta nuestros servicios y su valor habitual." />
      ) : (
        <div className="flex flex-col gap-4">
          {promos.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-marca text-xl font-semibold text-carbon">{p.nombre}</p>
                <span className="rounded-full bg-champan/25 px-3 py-1 text-xs font-semibold text-carbon">
                  Hasta {formatoFecha(p.vigente_hasta)}
                </span>
              </div>
              <p className="mt-2 text-carbon/70">{p.descripcion}</p>
              {p.condiciones && <p className="mt-2 text-sm text-carbon/50">Condiciones: {p.condiciones}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
