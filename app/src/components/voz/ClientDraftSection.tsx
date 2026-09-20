import type { DraftClient } from '../../lib/voz/schema'

function ocultarTelefono(telefono: string | null): string {
  if (!telefono) return 'sin teléfono'
  const digitos = telefono.replace(/\D/g, '')
  if (digitos.length < 5) return telefono
  return `${digitos.slice(0, 3)}${'*'.repeat(digitos.length - 5)}${digitos.slice(-2)}`
}

export function ClientDraftSection({ client }: { client: DraftClient }) {
  if (client.status === 'none') {
    return <p className="text-sm text-carbon/50">Aún no se ha buscado una clienta.</p>
  }
  if (client.status === 'searching' || client.status === 'needs_clarification') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-carbon/60">
        <span aria-hidden>🔎</span> Buscando a “{client.query}”…
      </p>
    )
  }
  if (client.status === 'pending_creation') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-champan/20 px-3 py-2">
        <span aria-hidden>🆕</span>
        <div>
          <p className="text-sm font-semibold text-carbon">{client.pendingName || 'Clienta nueva'}</p>
          <p className="text-xs text-carbon/60">{client.pendingPhone ? ocultarTelefono(client.pendingPhone) : 'Sin teléfono'} · aún no se ha creado</p>
        </div>
      </div>
    )
  }
  // resolved
  const c = client.resolved!
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden>👤</span>
      <div>
        <p className="text-sm font-semibold text-carbon">
          {c.nombre} {c.isNew && <span className="ml-1 rounded-full bg-oliva/15 px-2 py-0.5 text-xs font-semibold text-oliva">Nueva</span>}
        </p>
        <p className="text-xs text-carbon/60">{ocultarTelefono(c.telefono)}</p>
      </div>
    </div>
  )
}
