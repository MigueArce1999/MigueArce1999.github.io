import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Select, Input } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { listarEquipoConRendimiento } from '../../lib/api/admin'
import { crearLiquidacion } from '../../lib/api/empleada'
import { isDemoMode, supabase, supabaseRequerido } from '../../lib/supabase'
import { fechaBogotaISO, formatoMoneda } from '../../lib/format'

export function AdminComisiones() {
  const [equipo, setEquipo] = useState<any[]>([])
  const [pendientes, setPendientes] = useState<Record<string, number>>({})
  const [reglas, setReglas] = useState<Record<string, { tipo: string; valor: number }>>({})
  const [error, setError] = useState<string | null>(null)
  const [liquidando, setLiquidando] = useState<string | null>(null)
  const [editandoRegla, setEditandoRegla] = useState<string | null>(null)
  const [inicio, setInicio] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return fechaBogotaISO(d)
  })
  const [fin, setFin] = useState(fechaBogotaISO())

  function recargarReglas() {
    if (isDemoMode) return
    supabase!
      .from('regla_comision')
      .select('profesional_id, tipo, valor')
      .is('servicio_id', null)
      .is('vigente_hasta', null)
      .then(({ data }) => {
        const acc: Record<string, { tipo: string; valor: number }> = {}
        for (const r of data ?? []) acc[r.profesional_id] = { tipo: r.tipo, valor: Number(r.valor) }
        setReglas(acc)
      })
  }

  useEffect(() => {
    listarEquipoConRendimiento().then(setEquipo)
    recargarReglas()
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
            <Card key={p.id} className="flex flex-col gap-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-carbon">{p.nombre}</p>
                  <p className="text-xs text-carbon/60">
                    Regla general:{' '}
                    {reglas[p.id]
                      ? reglas[p.id].tipo === 'porcentaje'
                        ? `${reglas[p.id].valor}% por servicio`
                        : `${formatoMoneda(reglas[p.id].valor)} fijo por servicio`
                      : 'sin configurar (no se generará comisión hasta que definas una)'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-oliva">{formatoMoneda(pendientes[p.id] ?? p.comisionPendiente ?? 0)}</span>
                  <Button variante="secondary" tamano="sm" onClick={() => setEditandoRegla(p.id)}>
                    {reglas[p.id] ? 'Editar regla' : 'Definir regla'}
                  </Button>
                  <Button tamano="sm" onClick={() => liquidar(p.id)} cargando={liquidando === p.id}>
                    Liquidar periodo
                  </Button>
                </div>
              </div>
              {editandoRegla === p.id && (
                <FormularioRegla
                  profesionalId={p.id}
                  reglaActual={reglas[p.id]}
                  onGuardado={() => {
                    setEditandoRegla(null)
                    recargarReglas()
                  }}
                  onCancelar={() => setEditandoRegla(null)}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function FormularioRegla({
  profesionalId,
  reglaActual,
  onGuardado,
  onCancelar,
}: {
  profesionalId: string
  reglaActual?: { tipo: string; valor: number }
  onGuardado: () => void
  onCancelar: () => void
}) {
  const [tipo, setTipo] = useState(reglaActual?.tipo ?? 'porcentaje')
  const [valor, setValor] = useState(reglaActual?.valor ?? 40)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    if (isDemoMode) { onGuardado(); return }
    setGuardando(true)
    setError(null)
    try {
      const client = supabaseRequerido()
      // Nunca se hace UPDATE de una regla vigente: se cierra y se crea una nueva, para que
      // comisiones ya generadas conserven el snapshot de la regla con la que se calcularon.
      const { error: errCerrar } = await client
        .from('regla_comision')
        .update({ vigente_hasta: new Date().toISOString() })
        .eq('profesional_id', profesionalId)
        .is('servicio_id', null)
        .is('vigente_hasta', null)
      if (errCerrar) throw errCerrar

      const { error: errCrear } = await client.from('regla_comision').insert({
        profesional_id: profesionalId,
        servicio_id: null,
        tipo,
        valor,
      })
      if (errCrear) throw errCrear
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-piedra p-3">
      {error && <ErrorState mensaje={error} />}
      <p className="text-xs text-carbon/50">
        Regla general (aplica a cualquier servicio que realice, salvo que definas una específica por servicio).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Select id="tipoRegla" etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="porcentaje">Porcentaje del valor cobrado</option>
          <option value="fijo">Valor fijo por servicio</option>
        </Select>
        <Input id="valorRegla" etiqueta={tipo === 'porcentaje' ? 'Porcentaje (%)' : 'Valor (COP)'} type="number" value={valor} onChange={(e) => setValor(Number(e.target.value))} />
        <Button tamano="sm" onClick={guardar} cargando={guardando}>Guardar regla</Button>
        <Button tamano="sm" variante="ghost" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  )
}
