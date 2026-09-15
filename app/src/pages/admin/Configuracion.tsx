import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Campos'
import { Card, ErrorState } from '../../components/ui/Estados'
import { isDemoMode, supabase } from '../../lib/supabase'
import type { ConfiguracionNegocio } from '../../lib/types'

const configDemo: ConfiguracionNegocio = {
  moneda: 'COP',
  zona_horaria: 'America/Bogota',
  modo_confirmacion: 'automatica',
  reserva_pendiente_expira_minutos: 30,
  cancelacion_horas_limite: 2,
  tasa_puntos_por_defecto: 0.02,
}

export function AdminConfiguracion() {
  const [config, setConfig] = useState<ConfiguracionNegocio>(configDemo)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode) return
    supabase!.from('configuracion_negocio').select('*').maybeSingle().then(({ data }) => data && setConfig(data))
  }, [])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      if (!isDemoMode) {
        const { error: err } = await supabase!.from('configuracion_negocio').update(config).eq('id', true)
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
      <h1 className="font-marca text-2xl font-semibold text-carbon">Configuración</h1>
      <Card>
        {error && <ErrorState mensaje={error} />}
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <Select
            id="modo"
            etiqueta="Confirmación de reservas"
            value={config.modo_confirmacion}
            onChange={(e) => setConfig({ ...config, modo_confirmacion: e.target.value as any })}
            ayuda="Manual: una reserva queda 'pendiente' hasta que alguien del salón la confirme."
          >
            <option value="automatica">Automática</option>
            <option value="manual">Manual</option>
          </Select>
          <Input
            id="expira"
            etiqueta="Minutos para liberar una reserva pendiente sin confirmar"
            type="number"
            value={config.reserva_pendiente_expira_minutos}
            onChange={(e) => setConfig({ ...config, reserva_pendiente_expira_minutos: Number(e.target.value) })}
          />
          <Input
            id="cancelacion"
            etiqueta="Horas mínimas de anticipación para cancelar/reprogramar"
            type="number"
            value={config.cancelacion_horas_limite}
            onChange={(e) => setConfig({ ...config, cancelacion_horas_limite: Number(e.target.value) })}
          />
          <Button type="submit" cargando={guardando}>Guardar configuración</Button>
          {guardado && <p className="text-sm font-medium text-exito">Configuración guardada.</p>}
        </form>
      </Card>
      <p className="text-xs text-carbon/50">
        Moneda ({config.moneda}) y zona horaria ({config.zona_horaria}) son fijas para este negocio.
        Permisos por rol se configuran desde /admin/equipo.
      </p>
    </div>
  )
}
