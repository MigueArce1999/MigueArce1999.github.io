import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Textarea } from '../../components/ui/Campos'
import { Card, ErrorState } from '../../components/ui/Estados'
import { isDemoMode, supabase } from '../../lib/supabase'

export function AdminContenido() {
  const [cuerpo, setCuerpo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode) return
    supabase!
      .from('contenido_pagina')
      .select('cuerpo')
      .eq('clave', 'quienes_somos')
      .maybeSingle()
      .then(({ data }) => setCuerpo(data?.cuerpo ?? ''))
  }, [])

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      if (!isDemoMode) {
        const { error: err } = await supabase!
          .from('contenido_pagina')
          .upsert({ clave: 'quienes_somos', titulo: 'Quiénes somos', cuerpo, es_provisional: false })
        if (err) throw err
      }
      setGuardado(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Contenido web</h1>
      <Card>
        <p className="mb-3 font-semibold text-carbon">Quiénes somos</p>
        {error && <ErrorState mensaje={error} />}
        <Textarea id="cuerpo" etiqueta="" value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} rows={8} />
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} cargando={guardando}>Guardar</Button>
          {guardado && <p className="text-sm font-medium text-exito">Contenido publicado.</p>}
        </div>
      </Card>
      <p className="text-xs text-carbon/50">
        Edición de equipo, fotografías, ubicación y eventos: equipo se administra desde /admin/equipo;
        eventos y fotografías tienen su tabla lista (contenido_evento) y quedan pendientes de una UI de
        carga de imágenes contra Supabase Storage.
      </p>
    </div>
  )
}
