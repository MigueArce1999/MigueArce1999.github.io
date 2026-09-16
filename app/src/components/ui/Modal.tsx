import { useEffect, type ReactNode } from 'react'

function useCerrarConEscape(abierto: boolean, onCerrar: () => void) {
  useEffect(() => {
    if (!abierto) return
    function manejar(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', manejar)
    return () => window.removeEventListener('keydown', manejar)
  }, [abierto, onCerrar])
}

export function Modal({
  abierto,
  onCerrar,
  titulo,
  children,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  children: ReactNode
}) {
  useCerrarConEscape(abierto, onCerrar)
  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/40 p-4" onClick={onCerrar}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-blanco p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-marca font-semibold text-carbon">{titulo}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-2xl leading-none text-carbon/50 hover:text-carbon">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Drawer({
  abierto,
  onCerrar,
  titulo,
  children,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  children: ReactNode
}) {
  useCerrarConEscape(abierto, onCerrar)
  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-carbon/40" onClick={onCerrar}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-blanco p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-marca font-semibold text-carbon">{titulo}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-2xl leading-none text-carbon/50 hover:text-carbon">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
