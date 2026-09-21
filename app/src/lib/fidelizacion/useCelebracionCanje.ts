// Decide CUÁL notificación de canje (si alguna) debe animarse en vivo ahora mismo. Reutiliza tal
// cual las celebraciones/el reconocimiento que ya expone useMiFidelizacion — no crea un segundo
// mecanismo de notificaciones. Ver lib/fidelizacion/celebracionCanje.ts para la lógica pura de
// "reciente vs. histórico".

import { useEffect, useMemo, useState } from 'react'
import { esEventoReciente } from './celebracionCanje'
import type { CanjeConfirmadoDatos, MiFidelizacion, NotificacionFidelizacion } from '../types'

type NotificacionCanje = NotificacionFidelizacion & { tipo: 'canje_confirmado'; datos: CanjeConfirmadoDatos }

export function useCelebracionCanje(
  celebraciones: NotificacionFidelizacion[],
  fidelizacion: MiFidelizacion | null,
  reconocer: (id: string) => Promise<void>,
) {
  // listarNotificacionesNoVistas ya viene ordenada por creado_en ascendente (ver
  // lib/api/fidelizacion.ts) — la última del arreglo es la más reciente.
  const canjes = useMemo(
    () => celebraciones.filter((c): c is NotificacionCanje => c.tipo === 'canje_confirmado' && !!c.datos),
    [celebraciones],
  )
  const masReciente = canjes.length > 0 ? canjes[canjes.length - 1] : null
  const antiguosIds = canjes.slice(0, -1).map((c) => c.id).join(',')

  const [reconociendo, setReconociendo] = useState(false)

  // Si hay varios canjes pendientes de ver, solo se anima el más reciente (sección 11 del
  // pedido: "no encadenar varias animaciones") — los anteriores se reconocen en silencio, sin
  // perder su detalle: sigue disponible siempre en "Recompensa canjeada" (sección 8), que lee
  // directo de canje_recompensa, no de esta notificación.
  useEffect(() => {
    if (!antiguosIds || reconociendo) return
    setReconociendo(true)
    Promise.all(antiguosIds.split(',').map((id) => reconocer(id))).finally(() => setReconociendo(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [antiguosIds])

  const esReciente = !!masReciente && !!fidelizacion && esEventoReciente(masReciente.datos, fidelizacion.saldo)

  // Si el más reciente YA NO es reciente (hubo compras/ajustes/devoluciones después de ese
  // canje), también se reconoce en silencio en vez de animar un saldo que ya cambió — la tarjeta
  // "Recompensa canjeada" sigue mostrando ese canje con sus propios números, sin mezclarlo con el
  // saldo vigente (sección 11).
  useEffect(() => {
    if (!masReciente || !fidelizacion || esReciente) return
    reconocer(masReciente.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masReciente?.id, esReciente, !!fidelizacion])

  return {
    celebracionActiva: esReciente ? masReciente : null,
  }
}
