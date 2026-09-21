// Celebración de un canje reciente (sección 4 del pedido de mejora visual). Reutiliza
// FlorProgreso, Button, el mismo patrón de accesibilidad de Modal (useDialogAccesible) y el
// formato es-CO existente — no crea un segundo sistema de canje: solo interpreta el snapshot
// inmutable que el servidor ya guardó (canje_confirmado.datos, ver
// supabase/migrations/0048_celebracion_canje.sql). El saldo final SIEMPRE es el que confirmó el
// servidor; esta animación nunca lo calcula ni lo necesita para completarse.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { useDialogAccesible } from '../ui/Modal'
import { etapaPorProgreso, FlorProgreso } from './FlorProgreso'
import { anuncioAccesible, construirPasosCanje, mensajeResultadoFinal } from '../../lib/fidelizacion/celebracionCanje'
import { listarRecompensasDisponiblesPara } from '../../lib/api/fidelizacion'
import { formatoEnteroCOP } from '../../lib/format'
import type { CanjeConfirmadoDatos, MiFidelizacion, Recompensa } from '../../lib/types'

type Etapa = 'A' | 'B' | 'C' | 'D'

// Duraciones dentro del rango pedido (900–1300ms para la cuenta regresiva; 2–3s en total para el
// caso simple). Un solo conteo continuo de saldoAnterior a saldoFinal — "ganaste 45" aparece como
// una etiqueta que se desvanece hacia el final del conteo, en vez de una segunda animación
// superpuesta (más simple de seguir y de mantener, sin perder la narrativa de la sección 10).
const DURACION_A = 650
const DURACION_B = 500
const DURACION_C = 1100
const DURACION_TOTAL = DURACION_A + DURACION_B + DURACION_C

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

export function CanjeCelebracion({
  datos,
  fidelizacion,
  onCerrar,
}: {
  datos: CanjeConfirmadoDatos
  fidelizacion: MiFidelizacion | null
  onCerrar: () => void
}) {
  const pasos = useMemo(() => construirPasosCanje(datos), [datos])
  const prefiereMenosMovimiento = useRef(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  ).current

  const [etapa, setEtapa] = useState<Etapa>(prefiereMenosMovimiento ? 'D' : 'A')
  const [valorContador, setValorContador] = useState(prefiereMenosMovimiento ? pasos.saldoFinal : pasos.saldoAnterior)
  const [mostrarGanancia, setMostrarGanancia] = useState(prefiereMenosMovimiento && pasos.huboGanancia)
  const [anuncio, setAnuncio] = useState(prefiereMenosMovimiento ? anuncioAccesible(pasos) : '')
  const [disponibles, setDisponibles] = useState<Recompensa[] | null>(null)
  const rafRef = useRef<number | undefined>(undefined)
  const cerradoRef = useRef(false)

  // Estado + animación: un único requestAnimationFrame basado en tiempo transcurrido (no en
  // conteo de frames), así que si la pestaña pasa a segundo plano y vuelve después de que ya
  // pasó la duración total, el primer frame siguiente cae directo en la etapa D — nunca reproduce
  // frames atrasados (sección 12 del pedido).
  useEffect(() => {
    if (prefiereMenosMovimiento) return
    const inicio = performance.now()
    function paso(ahora: number) {
      const elapsed = ahora - inicio
      if (elapsed < DURACION_A) {
        setEtapa('A')
      } else if (elapsed < DURACION_A + DURACION_B) {
        setEtapa('B')
      } else if (elapsed < DURACION_TOTAL) {
        setEtapa('C')
        const t = Math.min((elapsed - DURACION_A - DURACION_B) / DURACION_C, 1)
        const suavizado = easeOutCubic(t)
        setValorContador(Math.max(0, Math.round(pasos.saldoAnterior + (pasos.saldoFinal - pasos.saldoAnterior) * suavizado)))
        if (pasos.huboGanancia && t >= 0.6) setMostrarGanancia(true)
        rafRef.current = requestAnimationFrame(paso)
        return
      } else {
        setEtapa('D')
        setValorContador(pasos.saldoFinal)
        setMostrarGanancia(pasos.huboGanancia)
        setAnuncio(anuncioAccesible(pasos))
        return
      }
      rafRef.current = requestAnimationFrame(paso)
    }
    rafRef.current = requestAnimationFrame(paso)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function omitirAnimacion() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setEtapa('D')
    setValorContador(pasos.saldoFinal)
    setMostrarGanancia(pasos.huboGanancia)
    setAnuncio(anuncioAccesible(pasos))
  }

  // "Todavía tienes puntos para otra recompensa" solo se afirma si de verdad hay una alcanzable
  // ahora mismo (stock/elegibilidad reales) — nunca un texto genérico inventado.
  useEffect(() => {
    if (etapa !== 'D' || disponibles !== null) return
    let activo = true
    listarRecompensasDisponiblesPara(pasos.saldoFinal)
      .then((r) => { if (activo) setDisponibles(r) })
      .catch(() => { if (activo) setDisponibles([]) })
    return () => { activo = false }
  }, [etapa, disponibles, pasos.saldoFinal])

  function cerrar() {
    if (cerradoRef.current) return
    cerradoRef.current = true
    onCerrar()
  }

  const panelRef = useRef<HTMLDivElement>(null)
  useDialogAccesible(true, cerrar, panelRef)

  // Al llegar a D el botón "Omitir" (si tenía el foco) desaparece del DOM — se lleva el foco al
  // panel una sola vez, en vez de dejarlo perdido en <body> (sección 12: "evitar cambios bruscos
  // de foco", "mantener navegación por teclado").
  useEffect(() => {
    if (etapa === 'D') panelRef.current?.focus()
  }, [etapa])

  const etapaFlorFinal = etapaPorProgreso(fidelizacion?.progreso ?? 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Recompensa canjeada"
        className="w-full max-w-sm rounded-2xl bg-blanco p-6 text-center shadow-xl outline-none"
      >
        <p role="status" aria-live="assertive" className="sr-only">{anuncio}</p>

        <div className="mb-1 flex justify-end">
          {etapa !== 'D' && (
            <button type="button" onClick={omitirAnimacion} className="text-xs font-semibold text-carbon/40 hover:text-carbon">
              Omitir animación
            </button>
          )}
        </div>

        {etapa === 'A' && (
          <div className="flex flex-col items-center gap-2">
            <p className="font-marca text-xl font-semibold text-carbon">¡Disfruta tu recompensa!</p>
            {datos.recompensa_imagen_url && (
              <img src={datos.recompensa_imagen_url} alt="" className="h-20 w-20 rounded-xl object-cover" />
            )}
            <p className="font-semibold text-carbon">{datos.recompensa_nombre}</p>
            <p className="mt-2 text-xs uppercase tracking-wide text-carbon/50">Antes del canje</p>
            <p className="font-marca text-2xl font-semibold text-carbon/70">{formatoEnteroCOP(pasos.saldoAnterior)} puntos</p>
          </div>
        )}

        {etapa === 'B' && (
          <div className="cc-etiqueta flex flex-col items-center gap-2">
            <span className="rounded-full bg-oliva/10 px-4 py-1.5 text-base font-semibold text-oliva">
              −{formatoEnteroCOP(pasos.costoPuntos)} puntos
            </span>
            <span className="text-sm text-carbon/60">Canjeados por {datos.recompensa_nombre}</span>
          </div>
        )}

        {(etapa === 'C' || etapa === 'D') && (
          <div className="flex flex-col items-center gap-2">
            <FlorProgreso etapa={etapaFlorFinal} brillo={etapa === 'D'} tamano={64} />
            <p className="cc-contador font-marca text-4xl font-semibold text-carbon">
              {formatoEnteroCOP(valorContador)} <span className="text-base font-normal text-carbon/50">puntos</span>
            </p>
            {mostrarGanancia && (
              <p className="text-sm font-medium text-exito">+{formatoEnteroCOP(pasos.puntosGanados)} por tu visita</p>
            )}
          </div>
        )}

        {etapa === 'D' && (
          <div className="mt-4 flex flex-col items-center gap-3 border-t border-piedra pt-4">
            <p className="text-lg font-semibold text-carbon">Te quedan {formatoEnteroCOP(pasos.saldoFinal)} puntos</p>
            <p className="text-sm text-carbon/70">{mensajeResultadoFinal(pasos.saldoFinal, (disponibles?.length ?? 0) > 0)}</p>
            <div className="flex gap-2">
              <Link to="/cliente/puntos" onClick={cerrar}>
                <Button tamano="sm">Ver recompensas</Button>
              </Link>
              <Button tamano="sm" variante="ghost" onClick={cerrar}>Cerrar</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
