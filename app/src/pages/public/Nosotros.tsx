import { useEffect, useState } from 'react'
import { isDemoMode, supabase } from '../../lib/supabase'
import { Cargando } from '../../components/ui/Estados'

interface ContenidoPagina {
  titulo: string
  cuerpo: string
  es_provisional: boolean
}

const contenidoDemo: ContenidoPagina = {
  titulo: 'Quiénes somos',
  cuerpo:
    '[CONTENIDO PROVISIONAL — pendiente de redacción final por administración] Claudia Patricia es un salón familiar en Cartagena dedicado al cuidado real de personas reales.',
  es_provisional: true,
}

export function Nosotros() {
  const [contenido, setContenido] = useState<ContenidoPagina | null>(null)

  useEffect(() => {
    if (isDemoMode) {
      setContenido(contenidoDemo)
      return
    }
    supabase!
      .from('contenido_pagina')
      .select('titulo, cuerpo, es_provisional')
      .eq('clave', 'quienes_somos')
      .maybeSingle()
      .then(({ data }) => setContenido(data ?? contenidoDemo))
  }, [])

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="mb-6 font-marca text-3xl font-semibold text-carbon sm:text-4xl">Quiénes somos</h1>
      {!contenido ? (
        <Cargando filas={2} />
      ) : (
        <>
          {contenido.es_provisional && (
            <p className="mb-4 inline-block rounded-full bg-advertencia/15 px-3 py-1 text-xs font-semibold text-advertencia">
              Contenido provisional — pendiente de redacción final
            </p>
          )}
          <p className="whitespace-pre-line text-lg leading-relaxed text-carbon/80">{contenido.cuerpo}</p>
        </>
      )}

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { titulo: 'Cabello saludable', texto: 'Tratamientos y técnicas que cuidan la fibra capilar.' },
          { titulo: 'Personas reales', texto: 'Resultados reales, sin promesas imposibles.' },
          { titulo: 'Atención con calma', texto: 'Un espacio donde la belleza se vive sin prisa.' },
        ].map((v) => (
          <div key={v.titulo} className="rounded-2xl border border-piedra bg-blanco p-5">
            <p className="font-semibold text-carbon">{v.titulo}</p>
            <p className="mt-1 text-sm text-carbon/60">{v.texto}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
