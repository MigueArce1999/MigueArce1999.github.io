import { isDemoMode, LOCAL_ID, supabase, supabaseRequerido } from '../supabase'
import { demoClienteActual, demoHistorialAtenciones, demoMovimientosPuntos } from '../demoData'
import type { Atencion, Cliente, MovimientoPuntos } from '../types'

export async function obtenerClientePorUsuario(usuarioId: string): Promise<Cliente | null> {
  if (isDemoMode) return demoClienteActual
  const q = supabase!.from('cliente').select('*').eq('usuario_id', usuarioId)
  const { data, error } = LOCAL_ID ? await q.eq('local_id', LOCAL_ID).maybeSingle() : await q.maybeSingle()
  if (error) throw error
  return data
}

export async function actualizarPerfilCliente(
  clienteId: string,
  cambios: Partial<Pick<Cliente, 'nombre' | 'telefono' | 'email' | 'consentimiento_marketing'>>,
) {
  const client = supabaseRequerido()
  const { error } = await client.from('cliente').update(cambios).eq('id', clienteId)
  if (error) throw error
}

// La clienta marca "ya la dejé" desde su propio portal — igual que el toggle que ya existe en
// Admin → Clientes, sigue siendo un registro manual (no se verifica contra Google), solo que
// ahora también lo puede marcar ella misma, no solo el personal del salón.
export async function marcarMiResenaGoogle(clienteId: string): Promise<void> {
  if (isDemoMode) return
  const client = supabaseRequerido()
  const { error } = await client.from('cliente').update({ resena_google_confirmada: true }).eq('id', clienteId)
  if (error) throw error
}

export async function listarHistorialAtenciones(clienteId: string): Promise<Atencion[]> {
  if (isDemoMode) return demoHistorialAtenciones
  const { data, error } = await supabase!
    .from('vista_atencion')
    .select('*, lineas:atencion_servicio(id, servicio_id, nombre_snapshot, precio_snapshot, descuento, cantidad, profesional_id)')
    .eq('cliente_id', clienteId)
    .eq('estado', 'completada')
    .order('completado_en', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Atencion[]
}

export async function listarMovimientosPuntos(clienteId: string): Promise<MovimientoPuntos[]> {
  if (isDemoMode) return demoMovimientosPuntos
  const { data, error } = await supabase!
    .from('movimiento_puntos')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return data
}

export function saldoPuntos(movimientos: MovimientoPuntos[]): number {
  return movimientos.reduce((acc, m) => acc + Number(m.puntos), 0)
}
