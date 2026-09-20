import { formatoMoneda } from '../../lib/format'
import type { DraftCollaborator } from '../../lib/voz/schema'

export function CollaboratorDraftRow({ colaborador }: { colaborador: DraftCollaborator }) {
  return (
    <div className="flex items-center justify-between gap-2 pl-4 text-sm text-carbon/80">
      <span className="flex items-center gap-1.5">
        <span aria-hidden>🤝</span> {colaborador.displayName}
      </span>
      <span className={colaborador.compensation == null ? 'text-xs italic text-carbon/50' : 'font-medium'}>
        {colaborador.compensation == null ? 'Falta el monto' : formatoMoneda(colaborador.compensation)}
      </span>
    </div>
  )
}
