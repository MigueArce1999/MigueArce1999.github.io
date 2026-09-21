// Resumen visual del AttentionDraft (sección 16/20 del pedido): nada de esto se ha escrito
// todavía en Supabase — es lo que se escribirá SI la persona confirma. [Editar] no hace nada
// especial por sí mismo (el draft ya se sigue corrigiendo por voz o texto mientras esta tarjeta
// está visible); solo le recuerda a la empleada que puede seguir hablando antes de confirmar.

import { formatoMoneda } from '../../lib/format'
import { totalDraft } from '../../lib/voz/draftReducer'
import type { AttentionDraft } from '../../lib/voz/schema'
import { Button } from '../ui/Button'
import { ClientDraftSection } from './ClientDraftSection'
import { ServiceDraftCard } from './ServiceDraftCard'
import { ProductDraftRow } from './ProductDraftRow'

export function AttentionDraftCard({
  draft,
  completo,
  guardando,
  onEditar,
  onConfirmar,
}: {
  draft: AttentionDraft
  completo: boolean
  guardando: boolean
  onEditar: () => void
  onConfirmar: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-oliva/40 bg-blanco p-4">
      <ClientDraftSection client={draft.client} />

      {draft.services.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Servicios</p>
          {draft.services.map((s) => <ServiceDraftCard key={s.tempId} servicio={s} />)}
        </div>
      )}

      {draft.products.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Productos</p>
          {draft.products.map((p) => <ProductDraftRow key={p.tempId} producto={p} />)}
        </div>
      )}

      {draft.notes && (
        <div className="rounded-lg bg-marfil px-3 py-2 text-sm text-carbon/80">
          <span className="font-semibold">Nota: </span>{draft.notes}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-oliva/20 pt-3">
        <p className="text-sm font-semibold text-carbon">Total: {formatoMoneda(totalDraft(draft))}</p>
        <div className="flex items-center gap-2">
          <Button type="button" tamano="sm" variante="ghost" onClick={onEditar} disabled={guardando}>
            Editar
          </Button>
          <Button type="button" tamano="sm" onClick={onConfirmar} disabled={!completo || guardando} cargando={guardando}>
            Confirmar atención
          </Button>
        </div>
      </div>
      {!completo && (
        <p className="text-xs text-carbon/50">Falta información (clienta, precio o profesional) antes de poder confirmar.</p>
      )}
    </div>
  )
}
