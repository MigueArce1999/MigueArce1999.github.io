// Metáfora visual del programa de fidelización: una flor que abre sus pétalos conforme la
// clienta avanza hacia su recompensa. Cinco etapas con umbrales explícitos (sección 7 del
// pedido) — la quinta queda reservada EXCLUSIVAMENTE para el 100%, nunca se alcanza por
// redondeo antes de tiempo.
//
// Dimensiones del SVG siempre las mismas (viewBox fijo): solo cambian transform/opacity de
// cada pétalo, así que nunca hay saltos de layout al pasar de una etapa a otra. Los pétalos
// están dibujados siempre en el DOM; format-checkers y lectores de pantalla no necesitan
// recorrer 5 variantes distintas del árbol.

export type EtapaFlor = 1 | 2 | 3 | 4 | 5

export function etapaPorProgreso(progreso: number): EtapaFlor {
  if (progreso >= 1) return 5
  if (progreso >= 0.75) return 4
  if (progreso >= 0.5) return 3
  if (progreso >= 0.25) return 2
  return 1
}

const CHAMPAN = '#b6a17b'
const OLIVA = '#394638'

// Por pétalo: [escala, rotación adicional (grados), opacidad] en cada una de las 5 etapas.
const ESTADOS_PETALO: Record<EtapaFlor, { escala: number; giro: number; opacidad: number }> = {
  1: { escala: 0.22, giro: -18, opacidad: 0.55 },
  2: { escala: 0.45, giro: -10, opacidad: 0.75 },
  3: { escala: 0.7, giro: -4, opacidad: 0.9 },
  4: { escala: 0.9, giro: -1, opacidad: 1 },
  5: { escala: 1, giro: 0, opacidad: 1 },
}

const NUM_PETALOS = 5

function Petalo({ indice, etapa }: { indice: number; etapa: EtapaFlor }) {
  const anguloBase = (360 / NUM_PETALOS) * indice
  const estado = ESTADOS_PETALO[etapa]
  return (
    <g
      className="fp-petalo"
      style={{
        transform: `rotate(${anguloBase + estado.giro}deg) scale(${estado.escala})`,
        opacity: estado.opacidad,
        transformOrigin: '50px 50px',
      }}
    >
      <path
        d="M50 50 C 46 34, 40 20, 50 6 C 60 20, 54 34, 50 50 Z"
        fill={indice % 2 === 0 ? CHAMPAN : `${CHAMPAN}cc`}
        stroke={OLIVA}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </g>
  )
}

export function FlorProgreso({
  etapa,
  tamano = 96,
  className = '',
  brillo = false,
}: {
  etapa: EtapaFlor
  tamano?: number
  className?: string
  /** Brillo suave al alcanzar una recompensa (sección 7): nunca bloquea la interacción. */
  brillo?: boolean
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={tamano}
      height={tamano}
      className={`fp-flor ${brillo ? 'fp-flor--brillo' : ''} ${className}`}
      role="img"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="fp-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={CHAMPAN} stopOpacity="0.55" />
          <stop offset="100%" stopColor={CHAMPAN} stopOpacity="0" />
        </radialGradient>
      </defs>
      {brillo && <circle cx="50" cy="50" r="46" fill="url(#fp-glow)" className="fp-glow" />}
      <line x1="50" y1="50" x2="50" y2="88" stroke={OLIVA} strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      {Array.from({ length: NUM_PETALOS }, (_, i) => (
        <Petalo key={i} indice={i} etapa={etapa} />
      ))}
      <circle cx="50" cy="50" r={6 + ESTADOS_PETALO[etapa].escala * 2} fill={OLIVA} />
    </svg>
  )
}
