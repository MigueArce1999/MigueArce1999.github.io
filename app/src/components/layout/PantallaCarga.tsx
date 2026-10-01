import { useEffect, useRef } from 'react'
import { useBranding } from '../../state/BrandingContext'
import {
  SPLASH_DURACION_MS,
  esVideoSplash,
  guardarSplashCache,
  retirarPantallaCargaHtml,
  splashDesdeMarca,
} from '../../lib/splash'

// La pantalla de carga vive en index.html (visible desde el primer byte). Aquí solo se
// ajusta a la marca real del salón:
//  - Con logo/splash propio → solo esa imagen o video, sin spinner.
//  - Sin nada → marca GlowDesk con su spinner (clase `modo-glowdesk`, ver index.html).

function marcaGlowdesk() {
  const marca = document.createElement('span')
  marca.className = 'gd-marca'
  const simbolo = document.createElement('img')
  simbolo.src = '/glowdesk/simbolo.png'
  simbolo.alt = ''
  simbolo.className = 'gd-simbolo'
  const nombre = document.createElement('img')
  nombre.src = '/glowdesk/glowdesk.svg'
  nombre.alt = 'GlowDesk'
  nombre.className = 'gd-nombre'
  marca.append(simbolo, nombre)
  return marca
}

function pintarMedia(url: string | null) {
  const pantalla = document.getElementById('pantalla-carga')
  const box = document.getElementById('pantalla-carga-media')
  if (!pantalla || !box) return

  if (!url) {
    pantalla.classList.add('modo-glowdesk')
    if (!box.querySelector('.gd-marca')) box.replaceChildren(marcaGlowdesk())
    return
  }

  pantalla.classList.remove('modo-glowdesk')
  if (esVideoSplash(url)) {
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    video.playsInline = true
    video.autoplay = true
    box.replaceChildren(video)
    void video.play().catch(() => {})
    return
  }
  const img = document.createElement('img')
  img.src = url
  img.alt = ''
  box.replaceChildren(img)
}

export function PantallaCarga() {
  const { marca, listo } = useBranding()
  const iniciado = useRef(false)

  useEffect(() => {
    if (!listo || iniciado.current) return
    iniciado.current = true
    const url = splashDesdeMarca(marca)
    guardarSplashCache(url)
    pintarMedia(url)
    const id = window.setTimeout(retirarPantallaCargaHtml, SPLASH_DURACION_MS)
    return () => window.clearTimeout(id)
  }, [listo, marca])

  return null
}
