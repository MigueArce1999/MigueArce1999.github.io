import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { marcaFallback, obtenerMarcaPublica } from '../lib/api/plataforma'
import type { LocalMarca } from '../lib/types'

interface BrandingState {
  marca: LocalMarca
  listo: boolean
}

const BrandingContext = createContext<BrandingState | null>(null)

function hexValido(valor: string | null | undefined): string | null {
  if (!valor) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(valor.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

function oscurecerHex(hex: string, factor = 0.78): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * factor)
  const g = Math.round(((n >> 8) & 255) * factor)
  const b = Math.round((n & 255) * factor)
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function aplicarColores(marca: LocalMarca) {
  const root = document.documentElement
  const primario = hexValido(marca.color_primario)
  const acento = hexValido(marca.color_acento)
  if (primario) {
    root.style.setProperty('--color-oliva', primario)
    root.style.setProperty('--color-oliva-hover', oscurecerHex(primario))
  } else {
    root.style.removeProperty('--color-oliva')
    root.style.removeProperty('--color-oliva-hover')
  }
  if (acento) {
    root.style.setProperty('--color-champan', acento)
  } else {
    root.style.removeProperty('--color-champan')
  }
}

function aplicarFaviconYTitulo(marca: LocalMarca) {
  const titulo = marca.eslogan ? `${marca.nombre} · ${marca.eslogan}` : marca.nombre
  document.title = titulo

  const favicon = marca.favicon_url || marca.logo_url || '/favicon.png'
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = favicon.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
  link.href = favicon

  let apple = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']")
  if (!apple) {
    apple = document.createElement('link')
    apple.rel = 'apple-touch-icon'
    document.head.appendChild(apple)
  }
  apple.href = favicon

  const appTitle = document.querySelector<HTMLMetaElement>("meta[name='apple-mobile-web-app-title']")
  if (appTitle) appTitle.content = marca.nombre_corto || marca.nombre

  const desc = document.querySelector<HTMLMetaElement>("meta[name='description']")
  if (desc) {
    desc.content = marca.eslogan
      ? `${marca.nombre}, ${marca.eslogan}.`
      : marca.nombre
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [marca, setMarca] = useState<LocalMarca>(marcaFallback)
  const [listo, setListo] = useState(false)

  useEffect(() => {
    let vivo = true
    obtenerMarcaPublica()
      .then((m) => {
        if (vivo) setMarca(m)
      })
      .catch(() => {
        if (vivo) setMarca(marcaFallback())
      })
      .finally(() => {
        if (vivo) setListo(true)
      })
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    aplicarFaviconYTitulo(marca)
    aplicarColores(marca)
  }, [marca])

  const valor = useMemo(() => ({ marca, listo }), [marca, listo])
  return <BrandingContext.Provider value={valor}>{children}</BrandingContext.Provider>
}

export function useBranding() {
  const ctx = useContext(BrandingContext)
  if (!ctx) throw new Error('useBranding debe usarse dentro de <BrandingProvider>')
  return ctx
}
