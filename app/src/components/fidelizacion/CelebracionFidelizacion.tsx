// Celebración al ganar puntos o alcanzar una recompensa (sección 7 del pedido). Nunca bloquea
// la app (no es un modal obligatorio), y si hay varias notificaciones pendientes se agrupan en
// UN solo mensaje en vez de una fila de celebraciones repetidas.

import { useEffect, useState } from 'react'
import { FlorProgreso } from './FlorProgreso'
import type { NotificacionFidelizacion } from '../../lib/types'

export function CelebracionFidelizacion({
  celebraciones,
  onReconocer,
}: {
  celebraciones: NotificacionFidelizacion[]
  onReconocer: (id: string) => Promise<void>
}) {
  const [visible, setVisible] = useState(false)
  const [cerrando, setCerrando] = useState(false)

  useEffect(() => {
    if (celebraciones.length > 0) setVisible(true)
  }, [celebraciones.length])

  if (celebraciones.length === 0 || !visible) return null

  const puntosGanados = celebraciones.filter((c) => c.tipo === 'puntos_ganados')
  const metaAlcanzada = celebraciones.find((c) => c.tipo === 'meta_alcanzada')
  const totalPuntos = puntosGanados.reduce((acc, c) => {
    const match = c.mensaje.match(/(\d+(?:\.\d+)?)/)
    return acc + (match ? Number(match[1]) : 0)
  }, 0)

  async function cerrar() {
    setCerrando(true)
    try {
      await Promise.all(celebraciones.map((c) => onReconocer(c.id)))
    } finally {
      setVisible(false)
      setCerrando(false)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl border border-champan/50 bg-champan/15 px-4 py-3 shadow-sm"
    >
      <FlorProgreso etapa={metaAlcanzada ? 5 : 3} tamano={48} brillo />
      <div className="min-w-0 flex-1">
        {totalPuntos > 0 && (
          <p className="font-marca text-base font-semibold text-carbon">¡Ganaste {totalPuntos} puntos!</p>
        )}
        {metaAlcanzada && <p className="text-sm font-medium text-oliva">{metaAlcanzada.mensaje}</p>}
        {totalPuntos === 0 && !metaAlcanzada && <p className="text-sm text-carbon">Tienes novedades en tus puntos.</p>}
      </div>
      <button
        onClick={cerrar}
        disabled={cerrando}
        aria-label="Cerrar aviso"
        className="shrink-0 rounded-lg px-2 py-1.5 text-carbon/50 hover:bg-champan/20 hover:text-carbon disabled:opacity-50"
      >
        ×
      </button>
    </div>
  )
}
