import { useEffect, useRef, type ReactNode } from 'react'

// Compartido por Modal, Drawer y el menú móvil overlay (PortalLayout): cierre con Escape, foco
// inicial dentro del panel, foco atrapado con Tab/Shift+Tab mientras está abierto, y el foco
// vuelve a quien lo abrió al cerrarse — evita que, al cerrar, el teclado quede "perdido" en el
// fondo de la página.
function useDialogAccesible(abierto: boolean, onCerrar: () => void, panelRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!abierto) return
    const disparador = document.activeElement as HTMLElement | null
    const primerFocable = panelRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])')
    primerFocable?.focus()

    function manejar(e: KeyboardEvent) {
      if (e.key === 'Escape') { onCerrar(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'),
      )
      if (focables.length === 0) return
      const primero = focables[0]
      const ultimo = focables[focables.length - 1]
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
    }
    window.addEventListener('keydown', manejar)
    return () => {
      window.removeEventListener('keydown', manejar)
      disparador?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogAccesible(abierto, onCerrar, panelRef)
  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/40 p-4" onClick={onCerrar}>
      <div
        ref={panelRef}
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
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogAccesible(abierto, onCerrar, panelRef)
  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-carbon/40" onClick={onCerrar}>
      <div
        ref={panelRef}
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

export { useDialogAccesible }
