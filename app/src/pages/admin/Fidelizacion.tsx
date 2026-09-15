import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { Card, ErrorState } from '../../components/ui/Estados'
import { isDemoMode, supabase } from '../../lib/supabase'

export function AdminFidelizacion() {
  const [tasa, setTasa] = useState(0.02)
  const [vigenciaDias, setVigenciaDias] = useState<number | ''>('')
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode) return
    supabase!
      .from('regla_puntos')
      .select('tasa, vigencia_dias')
      .eq('activa', true)
      .is('vigente_hasta', null)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setTasa(Number(data.tasa))
          setVigenciaDias(data.vigencia_dias ?? '')
        }
      })
  }, [])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      if (!isDemoMode) {
        // Se cierra la regla vigente y se crea una nueva (nunca se hace UPDATE de una regla
        // vigente) para no alterar retroactivamente cómo se calcularon puntos ya otorgados.
        await supabase!.from('regla_puntos').update({ vigente_hasta: new Date().toISOString() }).is('vigente_hasta', null)
        const { error: err } = await supabase!.from('regla_puntos').insert({
          tasa,
          vigencia_dias: vigenciaDias === '' ? null : vigenciaDias,
          activa: true,
        })
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
      <h1 className="font-marca text-2xl font-semibold text-carbon">Fidelización</h1>
      <Card>
        {error && <ErrorState mensaje={error} />}
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <Input
            id="tasa"
            etiqueta="Puntos otorgados por cada peso pagado"
            type="number"
            step="0.0001"
            value={tasa}
            onChange={(e) => setTasa(Number(e.target.value))}
            ayuda="Ej: 0.02 = 2 puntos por cada $100 pagados. Solo aplica a atenciones completadas y pagadas en su totalidad."
          />
          <Input
            id="vigencia"
            etiqueta="Vigencia de los puntos (días, opcional)"
            type="number"
            value={vigenciaDias}
            onChange={(e) => setVigenciaDias(e.target.value === '' ? '' : Number(e.target.value))}
            ayuda="Déjalo vacío si los puntos no vencen."
          />
          <Button type="submit" cargando={guardando}>Guardar regla</Button>
          {guardado && <p className="text-sm font-medium text-exito">Regla actualizada.</p>}
        </form>
      </Card>
      <p className="text-xs text-carbon/50">Recompensas de canje avanzadas (catálogo con condiciones detalladas) quedan para Fase 2.</p>
    </div>
  )
}
