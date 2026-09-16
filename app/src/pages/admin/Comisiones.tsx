import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { listarEquipoConRendimiento } from '../../lib/api/admin'
import { crearLiquidacion } from '../../lib/api/empleada'
import { isDemoMode, supabaseRequerido } from '../../lib/supabase'
import { fechaBogotaISO, formatoMoneda } from '../../lib/format'

export function AdminComisiones() {
  const [equipo, setEquipo] = useState<any[]>([])
  const [pendientes, setPendientes] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [liquidando, setLiquidando] = useState<string | null>(null)
  const [inicio, setInicio] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return fechaBogotaISO(d)
  })
  const [fin, setFin] = useState(fechaBogotaISO())

  useEffect(() => {
    listarEquipoConRendimiento().then(setEquipo)
  }, [])

  useEffect(() => {
    if (isDemoMode || equipo.length === 0) return
    const client = supabaseRequerido()
    client
      .from('comision')
      .select('profesional_id, valor, estado')
      .eq('estado', 'generada')
      .then(({ data }) => {
        const acc: Record<string, number> = {}
        for (const c of data ?? []) acc[c.profesional_id] = (acc[c.profesional_id] ?? 0) + Number(c.valor)
        setPendientes(acc)
      })
  }, [equipo])

  async function liquidar(profesionalId: string) {
    setError(null)
    if (new Date(fin) < new Date(inicio)) {
      setError('El fin del periodo debe ser igual o posterior al inicio.')
      return
    }
    setLiquidando(profesionalId)
    try {
      await crearLiquidacion(profesionalId, inicio, fin)
      setPendientes((p) => ({ ...p, [profesionalId]: 0 }))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLiquidando(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Comisiones y liquidaciones</h1>
      <p className="text-sm text-carbon/60">
        La regla aplicada queda guardada dentro de cada comisión (snapshot): cambiar una regla hoy nunca
        modifica comisiones que ya se generaron. Una comisión liquidada no puede volver a pagarse.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-carbon/60">Periodo a liquidar:</label>
        <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="rounded-lg border border-piedra px-3 py-1.5 text-sm" />
        <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} className="rounded-lg border border-piedra px-3 py-1.5 text-sm" />
      </div>

      {error && <ErrorState mensaje={error} />}
      {!equipo.length ? (
        <Cargando />
      ) : (
        <div className="flex flex-col gap-2">
          {equipo.map((p) => (
            <Card key={p.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-carbon">{p.nombre}</p>
                <p className="text-xs text-carbon/60">Comisión pendiente de liquidar</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-oliva">{formatoMoneda(pendientes[p.id] ?? p.comisionPendiente ?? 0)}</span>
                <Button tamano="sm" onClick={() => liquidar(p.id)} cargando={liquidando === p.id}>
                  Liquidar periodo
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
