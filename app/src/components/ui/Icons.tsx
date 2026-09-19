import type { SVGProps } from 'react'

// Set de iconos de línea (estilo feather/lucide) para la navegación de los 3 portales,
// reemplazando los emoji anteriores por un estilo minimalista y consistente entre plataformas
// (un emoji se renderiza distinto en cada sistema operativo; un trazo SVG no).
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  )
}

export function IconoInicio(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" />
    </Svg>
  )
}

export function IconoAgenda(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2" />
    </Svg>
  )
}

export function IconoAtender(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="m8.5 7.5 12 12M8.5 16.5 12 13M14 10l6.5-6.5" />
    </Svg>
  )
}

export function IconoVentas(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="15" rx="3" />
      <path d="M3 10h18M7 15h4" />
    </Svg>
  )
}

export function IconoPerfil(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </Svg>
  )
}

export function IconoHistorial(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </Svg>
  )
}

export function IconoPuntos(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m12 3 2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 16.9 6.4 20l1.4-6.2L3 9.5l6.4-.6L12 3Z" />
    </Svg>
  )
}

export function IconoResumen(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </Svg>
  )
}

export function IconoDashboard(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l7 4" />
    </Svg>
  )
}

export function IconoClientes(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  )
}

export function IconoEquipo(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Svg>
  )
}

export function IconoComisiones(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </Svg>
  )
}

export function IconoGastos(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m23 18-9.5-9.5-5 5L1 6" />
      <path d="M17 18h6v-6" />
    </Svg>
  )
}

export function IconoPromociones(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7" cy="7" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconoContenido(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Svg>
  )
}

export function IconoReportes(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m1 18 8.5-8.5 5 5L23 6" />
      <path d="M17 6h6v6" />
    </Svg>
  )
}

export function IconoCampanas(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m3 3 18 9-18 9 4-9-4-9Z" />
      <path d="M7 12h11" />
    </Svg>
  )
}

export function IconoMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  )
}

export function IconoX(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  )
}

export function IconoChevronIzquierda(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  )
}

export function IconoChevronDerecha(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  )
}

export function IconoConfiguracion(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </Svg>
  )
}

// Página web / layout: ventana de navegador con una franja de encabezado y un bloque de
// contenido — usado por "Configuración de la homepage".
export function IconoHomepage(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18" />
      <path d="M7 12h4M7 15h7" />
    </Svg>
  )
}
