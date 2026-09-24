// Widget resumido para la Home pública (sección 3 del pedido). No se muestra nada mientras carga
// ni si el local no activó la función — nunca una caja vacía en la portada.
import { Link } from 'react-router-dom'
import { useSalonEnVivo } from '../../lib/disponibilidadEnVivo/useSalonEnVivo'
import { textoDemandaSalon } from '../../lib/disponibilidadEnVivo/textoDisponibilidad'
import { Button } from '../ui/Button'

const FORMATO_HORA = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' })

export function WidgetSalonEnVivo() {
  const { salon } = useSalonEnVivo(null)

  if (!salon || !salon.activo || salon.zonas.length === 0) return null

  return (
    <section className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 sm:px-[40px]">
      <div className="flex flex-col gap-4 rounded-2xl border border-piedra bg-blanco p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-marca text-2xl text-carbon">Así está el salón ahora</p>
          <span className="flex items-center gap-2 text-sm font-semibold text-carbon">
            <span aria-hidden>{textoDemandaSalon(salon.demanda).emoji}</span>
            {textoDemandaSalon(salon.demanda).texto}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {salon.zonas.map((zona) => {
            const profesionalesDeZona = salon.profesionales.filter((p) => p.zonas.includes(zona.id))
            const disponibles = profesionalesDeZona.filter((p) => p.estado.status === 'available' || p.estado.status === 'upcoming_appointment')
            const proximaMs = profesionalesDeZona
              .map((p) => p.estado.proxima_disponible_en)
              .filter((v): v is string => v != null)
              .map((v) => new Date(v).getTime())
              .sort((a, b) => a - b)[0]
            return (
              <div key={zona.id} className="flex flex-col gap-1 rounded-lg bg-piedra/30 p-4">
                <p className="text-sm font-semibold text-carbon">{zona.nombre}</p>
                {disponibles.length > 0 ? (
                  <p className="text-sm text-exito">
                    {disponibles.length} profesional{disponibles.length === 1 ? '' : 'es'} disponible{disponibles.length === 1 ? '' : 's'}
                  </p>
                ) : proximaMs ? (
                  <p className="text-sm text-carbon/60">Próxima disponibilidad {FORMATO_HORA.format(proximaMs)}</p>
                ) : (
                  <p className="text-sm text-carbon/60">Sin disponibilidad hoy</p>
                )}
              </div>
            )
          })}
        </div>
        <Link to="/salon-en-vivo" className="self-start">
          <Button variante="secondary">Ver salón en vivo</Button>
        </Link>
      </div>
    </section>
  )
}
