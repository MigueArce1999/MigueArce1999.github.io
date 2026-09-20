import { formatoMoneda } from '../../lib/format'
import type { DraftProductLine } from '../../lib/voz/schema'

export function ProductDraftRow({ producto }: { producto: DraftProductLine }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-piedra/60 bg-blanco px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 text-carbon">
        <span aria-hidden>🧴</span> {producto.displayName || 'Producto sin nombre'}
        {producto.quantity > 1 && <span className="text-carbon/50"> ×{producto.quantity}</span>}
      </span>
      <span className={producto.price == null ? 'text-xs italic text-carbon/50' : 'font-medium text-carbon'}>
        {producto.price != null ? formatoMoneda(producto.price * producto.quantity) : 'Falta el precio'}
      </span>
    </div>
  )
}
