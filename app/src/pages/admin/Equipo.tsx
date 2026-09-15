import { useEffect, useState } from 'react'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { listarEquipoConRendimiento } from '../../lib/api/admin'

export function AdminEquipo() {
  const [equipo, setEquipo] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarEquipoConRendimiento().then(setEquipo).catch((e) => setError(e.message))
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Equipo</h1>
      <p className="text-sm text-carbon/60">
        Horarios, comisiones y permisos de cada profesional se configuran individualmente. Ninguno de estos
        datos se asume: Claudia, Naldi, Ana y Valery aparecen aquí solo cuando su cuenta y perfil existan.
      </p>

      {error && <ErrorState mensaje={error} />}
      {!equipo ? (
        <Cargando />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {equipo.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-piedra font-marca text-oliva">{p.nombre?.charAt(0)}</div>
                <div>
                  <p className="font-semibold text-carbon">{p.nombre}</p>
                  <p className="text-xs text-carbon/60">{(p.especialidades ?? []).join(', ') || 'Sin especialidades configuradas'}</p>
                </div>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${p.activo ? 'bg-exito/15 text-exito' : 'bg-carbon/10 text-carbon/60'}`}>
                  {p.activo ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-carbon/50">Horarios</p>
                  <p className="text-carbon/70">Configurar en /admin/equipo/{p.slug} (pendiente de UI detallada)</p>
                </div>
                <div>
                  <p className="text-carbon/50">Regla de comisión</p>
                  <p className="text-carbon/70">Configurar en /admin/comisiones</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
