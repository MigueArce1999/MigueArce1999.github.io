import { useEffect, useRef } from 'react'
import { useBranding } from '../../state/BrandingContext'
import {
  SPLASH_DURACION_MS,
  esVideoSplash,
  guardarSplashCache,
  retirarPantallaCargaHtml,
  splashDesdeMarca,
} from '../../lib/splash'

function pintarMedia(url: string) {
  const box = document.getElementById('pantalla-carga-media')
  if (!box) return
  box.replaceChildren()
  if (esVideoSplash(url)) {
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    video.playsInline = true
    video.autoplay = true
    box.appendChild(video)
    void video.play().catch(() => {})
    return
  }
  const img = document.createElement('img')
  img.src = url
  img.alt = ''
  box.appendChild(img)
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
