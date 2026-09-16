import { isDemoMode, supabase } from '../supabase'

export interface EstimacionComision {
  encontrada: boolean
  tipo?: 'porcentaje' | 'fijo'
  valor?: number
  origen?: 'base' | 'excepcion'
  comisionEstimada?: number
}

// Refleja la MISMA prioridad que fn_completar_y_cobrar_atencion usa al cobrar de verdad
// (supabase/migrations/0023_comisiones_por_servicio_origen.sql): una regla con servicio_id
// específico gana sobre la regla general (servicio_id null); "select ... order by servicio_id
// nulls last limit 1" allá, "preferir la fila con match exacto" acá. Es solo una ESTIMACIÓN
// para mostrar en pantalla mientras se arma la atención — el servidor vuelve a resolver y
// guardar la comisión real al confirmar el cobro, nunca se confía en este cálculo del
// navegador para el dinero real (ver docs del flujo de cobro).
//
// La RLS de regla_comision (admin o la propia profesional, ver 0014_rls.sql) decide si esta
// consulta devuelve algo: si quien la ejecuta no tiene permiso para ver la regla de esa
// profesional, simplemente no llegan filas y no se muestra ninguna estimación — así se
// "respetan los permisos de acceso" sin necesitar una función aparte para eso.
export async function estimarComision(profesionalId: string, servicioId: string, montoBase: number): Promise<EstimacionComision> {
  if (isDemoMode || !profesionalId || !servicioId || montoBase <= 0) return { encontrada: false }
  const { data, error } = await supabase!
    .from('regla_comision')
    .select('servicio_id, tipo, valor')
    .eq('profesional_id', profesionalId)
    .or(`servicio_id.eq.${servicioId},servicio_id.is.null`)
    .is('vigente_hasta', null)
  if (error || !data || data.length === 0) return { encontrada: false }

  const regla = data.find((r) => r.servicio_id === servicioId) ?? data.find((r) => r.servicio_id === null)
  if (!regla) return { encontrada: false }

  const valor = Number(regla.valor)
  const comisionEstimada = regla.tipo === 'porcentaje' ? Math.round(((montoBase * valor) / 100) * 100) / 100 : valor
  return {
    encontrada: true,
    tipo: regla.tipo,
    valor,
    origen: regla.servicio_id ? 'excepcion' : 'base',
    comisionEstimada,
  }
}
