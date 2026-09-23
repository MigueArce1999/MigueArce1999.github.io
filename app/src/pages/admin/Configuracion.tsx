import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Campos'
import { Card, ErrorState } from '../../components/ui/Estados'
import { isDemoMode, LOCAL_ID, supabase } from '../../lib/supabase'
import type { ConfiguracionNegocio } from '../../lib/types'

const configDemo: ConfiguracionNegocio = {
  moneda: 'COP',
  zona_horaria: 'America/Bogota',
  modo_confirmacion: 'automatica',
  reserva_pendiente_expira_minutos: 30,
  cancelacion_horas_limite: 2,
  tasa_puntos_por_defecto: 0.02,
  anticipacion_minima_reserva_minutos: 0,
  horizonte_reservas_dias: 60,
  margen_entre_citas_minutos: 0,
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
        const { error: err } = await supabase!.from('configuracion_negocio').update(config).eq('local_id', LOCAL_ID)
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
          {config.modo_confirmacion === 'manual' && (
            <Input
              id="expira"
              etiqueta="Minutos para liberar una reserva pendiente sin confirmar"
              type="number"
              value={config.reserva_pendiente_expira_minutos}
              onChange={(e) => setConfig({ ...config, reserva_pendiente_expira_minutos: Number(e.target.value) })}
              ayuda="Solo aplica en modo manual: una vez pasado este tiempo, la cita deja de retener el horario aunque nadie la revise."
            />
          )}
          <Input
            id="cancelacion"
            etiqueta="Horas mínimas de anticipación para cancelar/reprogramar"
            type="number"
            value={config.cancelacion_horas_limite}
            onChange={(e) => setConfig({ ...config, cancelacion_horas_limite: Number(e.target.value) })}
          />
          <Input
            id="anticipacion"
            etiqueta="Anticipación mínima para reservar en línea (minutos)"
            type="number"
            value={config.anticipacion_minima_reserva_minutos}
            onChange={(e) => setConfig({ ...config, anticipacion_minima_reserva_minutos: Number(e.target.value) })}
            ayuda="Una clienta no puede reservar un horario que empiece en menos de este tiempo. No aplica a citas creadas desde recepción/admin."
          />
          <Input
            id="horizonte"
            etiqueta="Horizonte de reservas (días hacia adelante)"
            type="number"
            value={config.horizonte_reservas_dias}
            onChange={(e) => setConfig({ ...config, horizonte_reservas_dias: Number(e.target.value) })}
            ayuda="Qué tan lejos en el futuro se puede reservar en línea."
          />
          <Input
            id="margen"
            etiqueta="Margen entre citas (minutos)"
            type="number"
            value={config.margen_entre_citas_minutos}
            onChange={(e) => setConfig({ ...config, margen_entre_citas_minutos: Number(e.target.value) })}
            ayuda="Tiempo libre que se reserva automáticamente antes y después de cada cita, para que dos citas seguidas nunca queden pegadas."
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
