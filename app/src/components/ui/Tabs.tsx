import { useState, type ReactNode } from 'react'

export interface Pestana {
  id: string
  etiqueta: string
  contenido: ReactNode
  // Numerito discreto junto a la etiqueta (p. ej. cantidad de recomendaciones pendientes) —
  // mismo patrón visual que BadgeContador en el menú lateral, pero local a este set de pestañas.
  contador?: number
}

// Componente de pestañas genérico: no existía ninguno reutilizable en el proyecto (todas las
// pantallas con secciones las apilaban en Cards verticales). Sigue el mismo lenguaje visual que
// el filtro de fecha del Dashboard (píldoras, bg-oliva activa) en vez de inventar un estilo
// nuevo de tabs con subrayado.
export function Tabs({ pestanas, inicial }: { pestanas: Pestana[]; inicial?: string }) {
  const [activa, setActiva] = useState(inicial ?? pestanas[0]?.id)
  const pestanaActiva = pestanas.find((p) => p.id === activa) ?? pestanas[0]

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-2 overflow-x-auto pb-1">
        {pestanas.map((p) => (
          <button
            key={p.id}
            role="tab"
            type="button"
            aria-selected={p.id === activa}
            onClick={() => setActiva(p.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              p.id === activa ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon hover:bg-piedra/60'
            }`}
          >
            {p.etiqueta}
            {!!p.contador && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold ${
                  p.id === activa ? 'bg-blanco/20 text-blanco' : 'bg-oliva/15 text-oliva'
                }`}
              >
                {p.contador}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel">{pestanaActiva?.contenido}</div>
    </div>
  )
}
