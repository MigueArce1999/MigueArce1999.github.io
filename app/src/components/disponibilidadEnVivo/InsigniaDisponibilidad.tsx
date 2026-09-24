// Insignia de estado reutilizable (sección 6 del pedido): emoji + color + texto, nunca solo
// color, igual que StatusBadge.tsx del resto del proyecto.
import { textoEstadoDisponibilidad } from '../../lib/disponibilidadEnVivo/textoDisponibilidad'
import type { EstadoProfesionalAhora } from '../../lib/types'

export function InsigniaDisponibilidad({ estado, conDetalle = true }: { estado: EstadoProfesionalAhora; conDetalle?: boolean }) {
  const { emoji, titulo, detalle, clase } = textoEstadoDisponibilidad(estado)
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${clase}`}>
        <span aria-hidden>{emoji}</span>
        {titulo}
      </span>
      {conDetalle && detalle && <span className="text-xs text-carbon/60">{detalle}</span>}
    </div>
  )
}
