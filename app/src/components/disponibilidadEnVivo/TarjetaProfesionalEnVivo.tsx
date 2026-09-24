import { InsigniaDisponibilidad } from './InsigniaDisponibilidad'
import type { ProfesionalEnVivo } from '../../lib/types'

export function TarjetaProfesionalEnVivo({ profesional, onVerDetalle }: { profesional: ProfesionalEnVivo; onVerDetalle: () => void }) {
  return (
    <button
      onClick={onVerDetalle}
      className="flex w-full items-center gap-3 rounded-xl border border-piedra bg-blanco p-3 text-left transition-colors hover:border-oliva"
      style={{ minHeight: 44 }}
    >
      {profesional.foto_url ? (
        <img src={profesional.foto_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-piedra font-marca text-lg text-carbon">
          {profesional.nombre.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate font-semibold text-carbon">{profesional.nombre}</p>
        <InsigniaDisponibilidad estado={profesional.estado} />
      </div>
    </button>
  )
}
