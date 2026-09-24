// Cada zona se siente como una pequeña sección física del salón (sección 4 del pedido) — una
// card simple, no un plano de arquitectura.
import { Card } from '../ui/Estados'
import { TarjetaProfesionalEnVivo } from './TarjetaProfesionalEnVivo'
import type { ProfesionalEnVivo } from '../../lib/types'

export function TarjetaZonaSalon({
  zona,
  profesionales,
  onVerDetalle,
}: {
  zona: { id: string; nombre: string }
  profesionales: ProfesionalEnVivo[]
  onVerDetalle: (profesionalId: string) => void
}) {
  if (profesionales.length === 0) return null
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-carbon/60">{zona.nombre}</p>
      <div className="flex flex-col gap-2">
        {profesionales.map((p) => (
          <TarjetaProfesionalEnVivo key={p.profesional_id} profesional={p} onVerDetalle={() => onVerDetalle(p.profesional_id)} />
        ))}
      </div>
    </Card>
  )
}
