import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-piedra bg-blanco p-5 ${className}`}>{children}</div>
}

export function EmptyState({ titulo, descripcion, accion }: { titulo: string; descripcion?: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-piedra bg-blanco/60 px-6 py-10 text-center">
      <p className="font-semibold text-carbon">{titulo}</p>
      {descripcion && <p className="max-w-sm text-sm text-carbon/60">{descripcion}</p>}
      {accion}
    </div>
  )
}

export function ErrorState({ mensaje, reintentar }: { mensaje: string; reintentar?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-error/30 bg-error/5 px-6 py-8 text-center">
      <p className="font-semibold text-error">No se pudo cargar la información</p>
      <p className="max-w-sm text-sm text-carbon/70">{mensaje}</p>
      {reintentar && (
        <button onClick={reintentar} className="mt-1 text-sm font-semibold text-oliva underline underline-offset-2">
          Reintentar
        </button>
      )}
    </div>
  )
}

export function Cargando({ filas = 3 }: { filas?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Cargando">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-piedra/50" />
      ))}
    </div>
  )
}

export function DemoBanner() {
  return (
    <div className="bg-champan/30 px-4 py-2 text-center text-xs font-semibold text-carbon">
      MODO DEMOSTRACIÓN — estás viendo datos de ejemplo, ningún cambio se guarda de verdad.
    </div>
  )
}
