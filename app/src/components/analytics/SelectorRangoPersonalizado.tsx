import { useState } from 'react'
import { addMonths, endOfMonth, endOfWeek, format, isSameDay, isWithinInterval, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '../ui/Button'

const DIAS_SEMANA = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

function mismoDia(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && isSameDay(a, b)
}

// Los Date de este componente son SOLO días de calendario (construidos con año/mes/día locales,
// nunca con un offset de zona horaria) — se muestran y se entregan con date-fns `format`, que lee
// esos mismos campos locales tal cual, sin reinterpretarlos contra Bogotá ni contra UTC. Pasarlos
// por formatoFecha (que sí asume un instante real en UTC y lo convierte a hora de Bogotá) los
// corría un día si el navegador no estaba en la zona horaria de Bogotá — de ahí que este
// componente entregue "yyyy-MM-dd" hacia afuera (ver onAplicar) en vez de un Date ya construido.
function aYyyyMmDd(dia: Date): string {
  return format(dia, 'yyyy-MM-dd')
}

// Calendario de un mes, sin librería nueva (solo date-fns, ya instalado). Selecciona un día
// específico (clic + clic en el mismo día, o un solo clic y "Aplicar" sin tocar nada más) o un
// rango (clic en el primer día, clic en el segundo). No dispara nada mientras se navega o se
// pasa el mouse por encima — solo "Aplicar" confirma.
export function SelectorRangoPersonalizado({
  valorInicial,
  onCancelar,
  onAplicar,
}: {
  valorInicial: { desde: string; hasta: string } | null
  onCancelar: () => void
  onAplicar: (desdeDia: string, hastaDia: string) => void
}) {
  const inicialDesde = valorInicial ? new Date(`${valorInicial.desde}T00:00:00`) : null
  const inicialHasta = valorInicial ? new Date(`${valorInicial.hasta}T00:00:00`) : null

  const [mesVisible, setMesVisible] = useState(inicialDesde ?? new Date())
  const [inicio, setInicio] = useState<Date | null>(inicialDesde)
  const [fin, setFin] = useState<Date | null>(inicialHasta && !mismoDia(inicialDesde, inicialHasta) ? inicialHasta : null)
  const [hover, setHover] = useState<Date | null>(null)

  function clicDia(dia: Date) {
    if (!inicio || fin) {
      setInicio(dia)
      setFin(null)
      return
    }
    if (dia < inicio) {
      setFin(inicio)
      setInicio(dia)
      return
    }
    if (isSameDay(dia, inicio)) {
      // Segundo clic en el mismo día = confirma que es un día específico, no un rango.
      setFin(dia)
      return
    }
    setFin(dia)
  }

  const inicioGrid = startOfWeek(startOfMonth(mesVisible))
  const finGrid = endOfWeek(endOfMonth(mesVisible))
  const dias: Date[] = []
  for (let d = inicioGrid; d <= finGrid; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dias.push(d)

  const finEfectivo = fin ?? hover
  const finalDesde = inicio
  const finalHasta = fin ?? inicio

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMesVisible((m) => subMonths(m, 1))}
          aria-label="Mes anterior"
          className="rounded-full p-1.5 text-carbon/60 hover:bg-piedra/40"
        >
          ‹
        </button>
        <p className="font-semibold capitalize text-carbon">{format(mesVisible, 'MMMM yyyy', { locale: es })}</p>
        <button
          type="button"
          onClick={() => setMesVisible((m) => addMonths(m, 1))}
          aria-label="Mes siguiente"
          className="rounded-full p-1.5 text-carbon/60 hover:bg-piedra/40"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-carbon/40">
        {DIAS_SEMANA.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map((dia) => {
          const esDelMes = dia.getMonth() === mesVisible.getMonth()
          const esInicio = mismoDia(dia, inicio)
          const esFin = mismoDia(dia, fin)
          const enRango =
            inicio && finEfectivo && !mismoDia(inicio, finEfectivo) && isWithinInterval(dia, { start: inicio < finEfectivo ? inicio : finEfectivo, end: inicio < finEfectivo ? finEfectivo : inicio })
          return (
            <button
              key={dia.toISOString()}
              type="button"
              onClick={() => clicDia(dia)}
              onMouseEnter={() => setHover(dia)}
              disabled={!esDelMes}
              aria-pressed={esInicio || esFin}
              aria-label={format(dia, "d 'de' MMMM", { locale: es })}
              className={`aspect-square rounded-lg text-sm transition-colors ${
                !esDelMes
                  ? 'text-carbon/20'
                  : esInicio || esFin
                    ? 'bg-oliva font-semibold text-blanco'
                    : enRango
                      ? 'bg-oliva/15 text-carbon'
                      : 'text-carbon hover:bg-piedra/40'
              }`}
            >
              {dia.getDate()}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between rounded-lg bg-piedra/30 px-3 py-2 text-sm">
        <span className="text-carbon">{finalDesde ? format(finalDesde, "d MMM yyyy", { locale: es }) : 'Elige una fecha'}</span>
        {finalDesde && !mismoDia(finalDesde, finalHasta) && (
          <>
            <span className="text-carbon/40">→</span>
            <span className="text-carbon">{finalHasta ? format(finalHasta, "d MMM yyyy", { locale: es }) : ''}</span>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variante="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button disabled={!finalDesde} onClick={() => finalDesde && onAplicar(aYyyyMmDd(finalDesde), aYyyyMmDd(finalHasta ?? finalDesde))}>
          Aplicar
        </Button>
      </div>
    </div>
  )
}
