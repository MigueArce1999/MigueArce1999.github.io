import { formatoMoneda } from '../../lib/format'
import type { DraftServiceLine } from '../../lib/voz/schema'
import { CollaboratorDraftRow } from './CollaboratorDraftRow'

export function ServiceDraftCard({ servicio }: { servicio: DraftServiceLine }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-piedra/60 bg-blanco px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-carbon">{servicio.displayName || 'Servicio sin nombre'}</p>
        <span className={servicio.priceStatus === 'confirmed' ? 'text-sm font-medium text-carbon' : 'text-xs italic text-carbon/50'}>
          {servicio.price != null ? formatoMoneda(servicio.price) : 'Falta el precio'}
          {servicio.priceStatus === 'needs_confirmation' && servicio.price != null ? ' (por confirmar)' : ''}
        </span>
      </div>
      <p className="text-xs text-carbon/60">
        {servicio.professionalName ? `Con ${servicio.professionalName}` : 'Falta el profesional'}
      </p>
      {servicio.collaborators.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-piedra/40 pt-1.5">
          {servicio.collaborators.map((c) => <CollaboratorDraftRow key={c.tempId} colaborador={c} />)}
        </div>
      )}
    </div>
  )
}
