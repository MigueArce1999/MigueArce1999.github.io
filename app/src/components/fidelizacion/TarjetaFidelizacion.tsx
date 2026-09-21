// Tarjeta protagonista de fidelización — sección 5 del pedido. Vive cerca de la parte superior
// del panorama de la clienta (Inicio), sin tapar el acceso a reservas ni al resto del portal.
// Los números vienen SIEMPRE del servidor (fn_mi_fidelizacion); nada aquí se inventa ni se deja
// fijo en el código.

import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Card, ErrorState } from '../ui/Estados'
import { formatoEnteroCOP } from '../../lib/format'
import { etapaPorProgreso, FlorProgreso } from './FlorProgreso'
import type { MiFidelizacion } from '../../lib/types'

// El contador anima suavemente hacia el saldo nuevo en ~1.2s (sección 7: "animar suavemente su
// llegada al contador") — una mejora puramente visual: si el navegador no soporta
// requestAnimationFrame por algún motivo raro, el efecto simplemente no interpola y ya.
function useContadorAnimado(valorFinal: number, duracionMs = 1200) {
  const [valor, setValor] = useState(valorFinal)
  const anterior = useRef(valorFinal)
  const prefiereMenosMovimiento = useRef(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const desde = anterior.current
    anterior.current = valorFinal
    if (prefiereMenosMovimiento.current || desde === valorFinal) {
      setValor(valorFinal)
      return
    }
    const inicio = performance.now()
    let cuadro: number
    function paso(ahora: number) {
      const t = Math.min((ahora - inicio) / duracionMs, 1)
      const suavizado = 1 - (1 - t) * (1 - t)
      setValor(Math.round(desde + (valorFinal - desde) * suavizado))
      if (t < 1) cuadro = requestAnimationFrame(paso)
    }
    cuadro = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(cuadro)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorFinal])

  return valor
}

export function TarjetaFidelizacion({
  nombreClienta,
  fidelizacion,
  cargando,
  error,
  onReintentar,
}: {
  nombreClienta: string | undefined
  fidelizacion: MiFidelizacion | null
  cargando: boolean
  error: string | null
  onReintentar: () => void
}) {
  const saldoAnimado = useContadorAnimado(fidelizacion?.saldo ?? 0)

  if (error) {
    return (
      <Card>
        <ErrorState mensaje={error} reintentar={onReintentar} />
      </Card>
    )
  }

  if (cargando || !fidelizacion) {
    return (
      <Card className="animate-pulse">
        <div className="flex items-center gap-4">
          <div className="h-24 w-24 shrink-0 rounded-full bg-piedra/60" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-piedra/60" />
            <div className="h-6 w-28 rounded bg-piedra/60" />
            <div className="h-3 w-full rounded bg-piedra/60" />
          </div>
        </div>
      </Card>
    )
  }

  if (!fidelizacion.acumulacion_activa && !fidelizacion.canjes_activo && fidelizacion.saldo === 0) {
    // Programa todavía no activado por administración (sección 20 del pedido) — nunca se
    // insinúan metas ni recompensas que no existen de verdad.
    return null
  }

  const primerNombre = nombreClienta?.split(' ')[0] ?? ''
  const sinPuntos = fidelizacion.saldo <= 0
  const meta = fidelizacion.meta
  const progreso = fidelizacion.progreso
  const yaAlcanzada = progreso !== null && progreso >= 1

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-marca text-xl font-semibold text-carbon">Tu belleza florece{primerNombre ? `, ${primerNombre}` : ''}</p>
          {(!fidelizacion.acumulacion_activa || !fidelizacion.canjes_activo) && (
            <p className="mt-1 inline-block rounded-full bg-champan/20 px-2.5 py-0.5 text-xs font-semibold text-carbon/70">
              {!fidelizacion.acumulacion_activa && !fidelizacion.canjes_activo
                ? 'Programa en pausa'
                : !fidelizacion.acumulacion_activa
                  ? 'Acumulación en pausa · canjes disponibles'
                  : 'Acumulación activa · canjes en pausa'}
            </p>
          )}
        </div>
        <FlorProgreso etapa={etapaPorProgreso(progreso ?? 0)} brillo={yaAlcanzada} />
      </div>

      <div>
        <p className="font-marca text-3xl font-semibold text-oliva">{formatoEnteroCOP(saldoAnimado)} puntos</p>
        <p className="text-xs text-carbon/50">{sinPuntos ? 'disponibles' : 'disponibles para canjear'}</p>
      </div>

      {sinPuntos && !meta && (
        <p className="text-sm text-carbon/70">Tu próxima visita puede convertirse en un regalo.</p>
      )}

      {!meta && fidelizacion.canjes_activo === false && !sinPuntos && (
        <p className="text-sm text-carbon/70">{fidelizacion.texto_programa}</p>
      )}

      {!meta && fidelizacion.canjes_activo && (
        <p className="text-sm text-carbon/70">Pronto encontrarás nuevos regalos aquí.</p>
      )}

      {meta && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            {meta.imagen_url && (
              <img src={meta.imagen_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-carbon">{meta.nombre}</p>
              <p className="text-xs text-carbon/50">{meta.costo_puntos} puntos</p>
            </div>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-piedra">
            <div
              className="h-full rounded-full bg-oliva transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round((progreso ?? 0) * 100)}%` }}
              role="progressbar"
              aria-valuenow={Math.round((progreso ?? 0) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progreso hacia ${meta.nombre}`}
            />
          </div>
          {yaAlcanzada ? (
            <p className="text-sm font-semibold text-oliva">¡Tu regalo ya está disponible!</p>
          ) : (
            <p className="text-sm text-carbon/70">Te faltan {formatoEnteroCOP(fidelizacion.puntos_faltantes ?? 0)} puntos para tu próximo regalo.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Link to="/cliente/puntos">
          <Button tamano="sm">{yaAlcanzada ? 'Ver cómo canjear' : 'Ver mis recompensas'}</Button>
        </Link>
        <Link to="/cliente/puntos#historial" className="text-sm font-semibold text-oliva underline underline-offset-2">
          Historial de puntos
        </Link>
      </div>
    </Card>
  )
}
