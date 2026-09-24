// Detalle de una profesional en "Salón en vivo" (sección 10). Todavía sin el botón "Confirmar
// disponibilidad" — el flujo de solicitud (secciones 11-18) es la Fase 7, que se construye sobre
// esta misma pantalla sin tener que rehacerla.
import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Cargando } from '../ui/Estados'
import { InsigniaDisponibilidad } from './InsigniaDisponibilidad'
import { listarServiciosDeProfesional } from '../../lib/api/catalogo'
import type { ProfesionalEnVivo, Servicio } from '../../lib/types'

export function ModalDetalleProfesionalEnVivo({
  profesional,
  onCerrar,
}: {
  profesional: ProfesionalEnVivo | null
  onCerrar: () => void
}) {
  const [servicios, setServicios] = useState<Servicio[] | null>(null)

  useEffect(() => {
    if (!profesional) {
      setServicios(null)
      return
    }
    setServicios(null)
    listarServiciosDeProfesional(profesional.profesional_id)
      .then(setServicios)
      .catch(() => setServicios([]))
  }, [profesional])

  return (
    <Modal abierto={profesional !== null} onCerrar={onCerrar} titulo={profesional?.nombre ?? ''}>
      {profesional && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            {profesional.foto_url ? (
              <img src={profesional.foto_url} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-piedra font-marca text-2xl text-carbon">
                {profesional.nombre.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <p className="font-marca text-xl text-carbon">{profesional.nombre}</p>
              <InsigniaDisponibilidad estado={profesional.estado} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-carbon/60">Servicios</p>
            {servicios === null ? (
              <Cargando filas={2} />
            ) : servicios.length === 0 ? (
              <p className="text-sm text-carbon/60">No hay servicios configurados para esta profesional.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {servicios.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-sm text-carbon">
                    <span>{s.nombre}</span>
                    {s.duracion_minutos != null && <span className="text-carbon/50">{s.duracion_minutos} min</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
