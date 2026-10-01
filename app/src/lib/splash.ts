export const SPLASH_CACHE_KEY = 'glowdesk-splash-url'
export const SPLASH_DURACION_MS = 3000
/** Valor guardado en caché cuando el salón no tiene logo ni splash: se muestra la marca GlowDesk. */
export const SPLASH_GLOWDESK = 'glowdesk'

export function esVideoSplash(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url)
}

/** Imagen/video propio del salón, o null si no tiene (entonces va la marca GlowDesk con su spinner). */
export function splashDesdeMarca(marca: { splash_url?: string | null; logo_url?: string | null }): string | null {
  return marca.splash_url || marca.logo_url || null
}

export function leerSplashCache(): string | null {
  try {
    return localStorage.getItem(SPLASH_CACHE_KEY)
  } catch {
    return null
  }
}

export function guardarSplashCache(url: string | null) {
  try {
    localStorage.setItem(SPLASH_CACHE_KEY, url || SPLASH_GLOWDESK)
  } catch {
    /* privado / cuota */
  }
}

export function retirarPantallaCargaHtml() {
  const p = document.getElementById('pantalla-carga')
  if (!p) return
  p.classList.add('oculta')
  window.setTimeout(() => p.remove(), 300)
}
