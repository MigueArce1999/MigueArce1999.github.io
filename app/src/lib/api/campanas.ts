import { isDemoMode, supabaseRequerido } from '../supabase'
import { soloDigitos } from '../telefono'
import type { Campana, CampanaDestinatario, CampanaTipo } from '../types'

// No hay ninguna API oficial de WhatsApp Business configurada en este proyecto: todo lo que
// sigue arma enlaces wa.me (mensaje pre-cargado, un chat a la vez). Abrir wa.me NUNCA confirma
// que el mensaje se envió — por eso el estado por destinatario distingue "pendiente" (nada
// hecho todavía), "whatsapp_abierto" (se abrió la conversación, no se sabe si se envió) y
// "marcado_enviado" (el personal confirma a mano que sí lo mandó). No existe un estado
// "enviado" automático porque nada en este proyecto puede confirmarlo de verdad.
export async function listarCampanas(): Promise<Campana[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client.from('campana').select('*').order('creado_en', { ascending: false })
  if (error) throw error
  return data
}

export async function crearCampana(nombre: string, mensaje: string, tipo: CampanaTipo): Promise<string> {
  const client = supabaseRequerido()
  const { data, error } = await client.from('campana').insert({ nombre, mensaje, tipo }).select('id').single()
  if (error) throw error
  return data.id
}

export async function actualizarCampana(id: string, nombre: string, mensaje: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('campana').update({ nombre, mensaje, actualizado_en: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function eliminarCampana(id: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('campana').delete().eq('id', id)
  if (error) throw error
}

export async function listarDestinatarios(campanaId: string): Promise<CampanaDestinatario[]> {
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('campana_destinatario')
    .select('*, cliente:cliente_id(nombre, telefono)')
    .eq('campana_id', campanaId)
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id,
    campana_id: r.campana_id,
    cliente_id: r.cliente_id,
    cliente_nombre: r.cliente?.nombre,
    cliente_telefono: r.cliente?.telefono,
    estado: r.estado,
    motivo_exclusion: r.motivo_exclusion,
  }))
}

// Revalida la autorización y el teléfono AL MOMENTO de preparar los envíos (no confía en un
// checkbox marcado hace rato en la pantalla de Clientes): trae de nuevo cada cliente desde la
// base y decide ahí si entra o queda excluido, dejando registro del motivo.
export async function prepararDestinatarios(
  campanaId: string,
  clienteIds: string[],
  tipo: CampanaTipo,
): Promise<{ incluidos: number; excluidos: number }> {
  const client = supabaseRequerido()
  const { data: clientes, error: errClientes } = await client
    .from('cliente')
    .select('id, telefono, consentimiento_marketing, activo')
    .in('id', clienteIds)
  if (errClientes) throw errClientes

  const filas = (clientes ?? []).map((c: any) => {
    if (!c.activo) return { campana_id: campanaId, cliente_id: c.id, estado: 'excluido', motivo_exclusion: 'Cliente archivado' }
    if (!c.telefono || soloDigitos(c.telefono).length < 7) {
      return { campana_id: campanaId, cliente_id: c.id, estado: 'excluido', motivo_exclusion: 'Sin teléfono válido' }
    }
    if (tipo === 'promocional' && !c.consentimiento_marketing) {
      return { campana_id: campanaId, cliente_id: c.id, estado: 'excluido', motivo_exclusion: 'Sin autorización de promociones' }
    }
    return { campana_id: campanaId, cliente_id: c.id, estado: 'pendiente', motivo_exclusion: null }
  })

  const { error: errDel } = await client.from('campana_destinatario').delete().eq('campana_id', campanaId)
  if (errDel) throw errDel
  if (filas.length > 0) {
    const { error: errIns } = await client.from('campana_destinatario').insert(filas)
    if (errIns) throw errIns
  }
  await client.from('campana').update({ estado: 'lista' }).eq('id', campanaId)

  const incluidos = filas.filter((f) => f.estado === 'pendiente').length
  return { incluidos, excluidos: filas.length - incluidos }
}

export async function marcarDestinatario(id: string, estado: 'whatsapp_abierto' | 'marcado_enviado'): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('campana_destinatario').update({ estado, actualizado_en: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// Heurística simple (no es una librería completa de números internacionales): un teléfono de
// 10 dígitos se asume celular colombiano y se le antepone el indicativo 57; si ya trae más
// dígitos (con indicativo), se usa tal cual. Suficiente para el caso real de este salón; queda
// documentado como limitación conocida.
export function enlaceWhatsApp(telefono: string, mensaje: string): string {
  const digitos = soloDigitos(telefono)
  const conIndicativo = digitos.length === 10 ? `57${digitos}` : digitos
  return `https://wa.me/${conIndicativo}?text=${encodeURIComponent(mensaje)}`
}
