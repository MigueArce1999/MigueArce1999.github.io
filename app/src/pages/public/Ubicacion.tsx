import { useEffect, useState } from 'react'
import { isDemoMode, supabase } from '../../lib/supabase'
import { Card, Cargando, EmptyState } from '../../components/ui/Estados'
import { formatoFechaHora } from '../../lib/format'

interface Evento {
  id: string
  titulo: string
  descripcion: string | null
  fecha_inicio: string
}

export function Ubicacion() {
  const [eventos, setEventos] = useState<Evento[] | null>(null)

  useEffect(() => {
    if (isDemoMode) {
      setEventos([
        {
          id: 'demo-evento-1',
          titulo: 'Jornada de bienestar capilar [DEMO]',
          descripcion: 'Diagnóstico capilar gratuito con cada servicio de color.',
          fecha_inicio: new Date(Date.now() + 10 * 86400000).toISOString(),
        },
      ])
      return
    }
    supabase!
      .from('contenido_evento')
      .select('id, titulo, descripcion, fecha_inicio')
      .eq('activo', true)
      .gte('fecha_inicio', new Date().toISOString())
      .order('fecha_inicio')
      .then(({ data }) => setEventos(data ?? []))
  }, [])

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="mb-8 font-marca text-3xl font-semibold text-carbon sm:text-4xl">Ubicación y horarios</h1>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <p className="font-semibold text-carbon">Dirección</p>
          <p className="mt-1 text-carbon/70">[DEMO] Cartagena, Colombia — dirección exacta pendiente de confirmar por administración.</p>
          <p className="mt-4 font-semibold text-carbon">Horarios de atención</p>
          <p className="mt-1 text-carbon/70">[DEMO] Martes a sábado, 9:00 a.m. – 6:00 p.m.</p>
          <p className="mt-4 font-semibold text-carbon">Contacto</p>
          <p className="mt-1 text-carbon/70">[DEMO] WhatsApp y teléfono pendientes de confirmar por administración.</p>
        </Card>
        <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-piedra bg-piedra/30 text-sm text-carbon/50">
          Mapa (pendiente de embeber la ubicación real desde administración)
        </div>
      </div>

      <h2 className="mb-4 mt-12 font-marca text-2xl font-semibold text-carbon">Eventos y jornadas</h2>
      {!eventos ? (
        <Cargando />
      ) : eventos.length === 0 ? (
        <EmptyState titulo="No hay eventos programados por ahora" />
      ) : (
        <div className="flex flex-col gap-3">
          {eventos.map((e) => (
            <Card key={e.id}>
              <p className="font-semibold text-carbon">{e.titulo}</p>
              {e.descripcion && <p className="text-sm text-carbon/70">{e.descripcion}</p>}
              <p className="mt-1 text-xs text-carbon/50">{formatoFechaHora(e.fecha_inicio)}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
