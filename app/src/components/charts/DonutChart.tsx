import { useMemo, useState } from 'react'
import { EmptyState } from '../ui/Estados'
import { asignarColores } from '../../lib/charts/paleta'

export interface SegmentoDonut {
  etiqueta: string
  valor: number
}

const TAU = Math.PI * 2
const CENTRO = 100
const R_EXTERIOR = 90
const R_INTERIOR = 54
// Separación angular entre porciones — el mismo rol que el "surface gap" de 2px entre barras
// (ver skill de dataviz, marks-and-anatomy.md): el hueco es lo que separa, nunca un borde.
const HUECO_RAD = 0.028

function puntoEnCirculo(radio: number, anguloRad: number): [number, number] {
  return [CENTRO + radio * Math.cos(anguloRad), CENTRO + radio * Math.sin(anguloRad)]
}

function trazoArco(anguloInicio: number, anguloFin: number): string {
  const grande = anguloFin - anguloInicio > Math.PI ? 1 : 0
  const [x1, y1] = puntoEnCirculo(R_EXTERIOR, anguloInicio)
  const [x2, y2] = puntoEnCirculo(R_EXTERIOR, anguloFin)
  const [x3, y3] = puntoEnCirculo(R_INTERIOR, anguloFin)
  const [x4, y4] = puntoEnCirculo(R_INTERIOR, anguloInicio)
  return [
    `M ${x1} ${y1}`,
    `A ${R_EXTERIOR} ${R_EXTERIOR} 0 ${grande} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${R_INTERIOR} ${R_INTERIOR} 0 ${grande} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

// Gráfica de pastel (en anillo, para poder mostrar el total en el centro) con: color por
// identidad (nunca por posición), leyenda siempre presente, una sola porción con etiqueta
// directa (la más grande), tooltip en hover Y en foco de teclado (mismo contenido en los dos
// casos), y una vista de tabla equivalente — ver skill de dataviz, references/*.md.
export function DonutChart({
  titulo,
  subtitulo,
  segmentos,
  formatoValor,
}: {
  titulo: string
  subtitulo?: string
  segmentos: SegmentoDonut[]
  formatoValor: (valor: number) => string
}) {
  const [activo, setActivo] = useState<string | null>(null)
  const [mostrarTabla, setMostrarTabla] = useState(false)

  const total = segmentos.reduce((acc, s) => acc + s.valor, 0)

  const colores = useMemo(() => asignarColores(segmentos.map((s) => s.etiqueta)), [segmentos])

  const arcos = useMemo(() => {
    if (total <= 0) return []
    // "Otros" siempre al final, sin importar su tamaño — es relleno, no protagonista.
    const ordenados = [...segmentos]
      .filter((s) => s.etiqueta !== 'Otros')
      .sort((a, b) => b.valor - a.valor)
    const otros = segmentos.find((s) => s.etiqueta === 'Otros')
    if (otros) ordenados.push(otros)

    let anguloAcumulado = -Math.PI / 2
    return ordenados.map((s) => {
      const angulo = (s.valor / total) * TAU
      const inicio = anguloAcumulado
      const fin = anguloAcumulado + angulo
      anguloAcumulado = fin
      const inicioConHueco = inicio + HUECO_RAD / 2
      const finConHueco = Math.max(fin - HUECO_RAD / 2, inicioConHueco)
      const medio = (inicioConHueco + finConHueco) / 2
      const [xEtiqueta, yEtiqueta] = puntoEnCirculo((R_EXTERIOR + R_INTERIOR) / 2, medio)
      return {
        ...s,
        share: s.valor / total,
        d: trazoArco(inicioConHueco, finConHueco),
        color: colores.get(s.etiqueta) ?? '#c3c2b7',
        xEtiqueta,
        yEtiqueta,
      }
    })
  }, [segmentos, total, colores])

  const masGrande = arcos.length ? arcos.reduce((a, b) => (b.share > a.share ? b : a)) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-carbon">{titulo}</p>
          {subtitulo && <p className="text-xs text-carbon/50">{subtitulo}</p>}
        </div>
        {total > 0 && (
          <button
            onClick={() => setMostrarTabla((v) => !v)}
            className="shrink-0 text-xs font-semibold text-oliva underline underline-offset-2"
          >
            {mostrarTabla ? 'Ver gráfica' : 'Ver tabla'}
          </button>
        )}
      </div>

      {total <= 0 ? (
        <EmptyState titulo="Sin ventas en este periodo" />
      ) : mostrarTabla ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-piedra text-left text-xs text-carbon/50">
              <th className="py-1.5 font-medium">Categoría</th>
              <th className="py-1.5 pl-3 text-right font-medium">Valor</th>
              <th className="py-1.5 pl-3 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {arcos.map((s) => (
              <tr key={s.etiqueta} className="border-b border-piedra/50 last:border-0">
                <td className="flex items-center gap-2 py-1.5 text-carbon">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                  {s.etiqueta}
                </td>
                <td className="py-1.5 pl-3 text-right text-carbon">{formatoValor(s.valor)}</td>
                <td className="py-1.5 pl-3 text-right text-carbon/60">{Math.round(s.share * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-full max-w-[180px]">
            <svg viewBox="0 0 200 200" role="img" aria-label={`${titulo}: ${arcos.map((s) => `${s.etiqueta} ${Math.round(s.share * 100)}%`).join(', ')}`}>
              {arcos.map((s) => (
                <path
                  key={s.etiqueta}
                  d={s.d}
                  fill={s.color}
                  opacity={activo === null || activo === s.etiqueta ? 1 : 0.35}
                  tabIndex={0}
                  role="button"
                  aria-label={`${s.etiqueta}: ${formatoValor(s.valor)}, ${Math.round(s.share * 100)}%`}
                  onMouseEnter={() => setActivo(s.etiqueta)}
                  onMouseLeave={() => setActivo(null)}
                  onFocus={() => setActivo(s.etiqueta)}
                  onBlur={() => setActivo(null)}
                  className="cursor-pointer outline-none transition-opacity focus-visible:opacity-100 focus-visible:brightness-90"
                />
              ))}
              {/* Etiqueta directa: solo la porción más grande, y solo si cabe sin recortarse. */}
              {masGrande && masGrande.share >= 0.12 && (
                <text x={masGrande.xEtiqueta} y={masGrande.yEtiqueta} textAnchor="middle" dominantBaseline="middle" className="fill-carbon text-[11px] font-semibold">
                  {Math.round(masGrande.share * 100)}%
                </text>
              )}
              <text x={CENTRO} y={CENTRO - 6} textAnchor="middle" dominantBaseline="middle" className="fill-carbon/50 text-[9px] uppercase tracking-wide">
                Total
              </text>
              <text x={CENTRO} y={CENTRO + 10} textAnchor="middle" dominantBaseline="middle" className="fill-carbon text-[13px] font-semibold">
                {formatoValor(total)}
              </text>
            </svg>

            {activo && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-carbon px-2.5 py-1.5 text-xs text-blanco shadow-lg"
                style={{
                  left: `${(arcos.find((s) => s.etiqueta === activo)!.xEtiqueta / 200) * 100}%`,
                  top: `${(arcos.find((s) => s.etiqueta === activo)!.yEtiqueta / 200) * 100}%`,
                }}
              >
                <p className="font-semibold">{activo}</p>
                <p>{formatoValor(arcos.find((s) => s.etiqueta === activo)!.valor)} · {Math.round(arcos.find((s) => s.etiqueta === activo)!.share * 100)}%</p>
              </div>
            )}
          </div>

          <ul className="flex w-full flex-col gap-1">
            {arcos.map((s) => (
              <li
                key={s.etiqueta}
                onMouseEnter={() => setActivo(s.etiqueta)}
                onMouseLeave={() => setActivo(null)}
                className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-sm transition-opacity"
                style={{ opacity: activo === null || activo === s.etiqueta ? 1 : 0.5 }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                  <span className="truncate text-carbon">{s.etiqueta}</span>
                </span>
                {/* El valor exacto vive en el tooltip y en "Ver tabla"; aquí, con una fila para
                    cada categoría a lo ancho de toda la tarjeta, ya cabe sin recortarse. */}
                <span className="shrink-0 text-carbon/60">{formatoValor(s.valor)} · {Math.round(s.share * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
