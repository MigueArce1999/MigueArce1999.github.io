export function Proximamente({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">{titulo}</h1>
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-piedra bg-blanco/60 px-6 py-14 text-center">
        <span className="text-3xl" aria-hidden>🚧</span>
        <p className="font-semibold text-carbon">Próximamente (Fase 2)</p>
        <p className="max-w-md text-sm text-carbon/60">{descripcion}</p>
      </div>
    </div>
  )
}
