import { describe, expect, it } from 'vitest'
import type { Cliente } from '../types'
import { crearDraftVacio } from './VoiceSessionContext'
import {
  agregarColaborador,
  agregarProducto,
  agregarServicio,
  draftEstaCompleto,
  quitarServicio,
  setClienteResuelto,
  totalDraft,
} from './draftReducer'

function cliente(id: string, nombre: string, telefono: string | null = null): Cliente {
  return {
    id, usuario_id: null, nombre, telefono, email: null, consentimiento_marketing: false,
    visitas_completadas: 0, gasto_acumulado: 0, activo: true, origen_registro: 'admin', notas: null,
    resena_google_confirmada: false, meta_recompensa_id: null, creado_en: new Date().toISOString(),
  }
}

describe('draftReducer', () => {
  it('agregarServicio reutiliza la única línea vacía en vez de duplicar', () => {
    let draft = crearDraftVacio()
    draft = { ...draft, services: [{ tempId: 'vacia', query: '', displayName: '', collaborators: [], priceStatus: 'missing', resolved: false }] }
    const { draft: d2 } = agregarServicio(draft, { servicioId: 's1', displayName: 'Blower', price: 45000, priceStatus: 'confirmed' })
    expect(d2.services).toHaveLength(1)
    expect(d2.services[0].tempId).toBe('vacia')
    expect(d2.services[0].displayName).toBe('Blower')
  })

  it('nunca muta el draft original (inmutable)', () => {
    const draft = crearDraftVacio()
    const { draft: d2 } = agregarServicio(draft, { displayName: 'Corte', priceStatus: 'missing' })
    expect(draft.services).toHaveLength(0)
    expect(d2.services).toHaveLength(1)
  })

  it('agregarColaborador queda anidado SOLO bajo su servicio', () => {
    let draft = crearDraftVacio()
    const r1 = agregarServicio(draft, { servicioId: 's1', displayName: 'Blower', price: 45000, priceStatus: 'confirmed' })
    draft = r1.draft
    const r2 = agregarServicio(draft, { servicioId: 's2', displayName: 'Corte', price: 30000, priceStatus: 'confirmed' })
    draft = r2.draft
    const r3 = agregarColaborador(draft, r1.tempId, { employeeId: 'p3', displayName: 'Ana', compensation: 10000 })
    draft = r3.draft
    expect(draft.services.find((s) => s.tempId === r1.tempId)!.collaborators).toHaveLength(1)
    expect(draft.services.find((s) => s.tempId === r2.tempId)!.collaborators).toHaveLength(0)
  })

  it('totalDraft suma servicios + colaboradores + productos', () => {
    let draft = crearDraftVacio()
    const r1 = agregarServicio(draft, { servicioId: 's1', displayName: 'Blower', price: 45000, priceStatus: 'confirmed' })
    draft = r1.draft
    draft = agregarColaborador(draft, r1.tempId, { employeeId: 'p3', displayName: 'Ana', compensation: 10000 }).draft
    draft = agregarProducto(draft, { productId: 'pr1', displayName: 'Champú', quantity: 1, price: 70000 }).draft
    expect(totalDraft(draft)).toBe(45000 + 10000 + 70000)
  })

  it('draftEstaCompleto exige clienta resuelta y todos los servicios con precio+profesional', () => {
    let draft = crearDraftVacio()
    expect(draftEstaCompleto(draft)).toBe(false)
    draft = setClienteResuelto(draft, cliente('c1', 'Verónica'))
    const r1 = agregarServicio(draft, { servicioId: 's1', displayName: 'Blower', price: 45000, priceStatus: 'confirmed', professionalId: 'p1' })
    draft = r1.draft
    expect(draftEstaCompleto(draft)).toBe(true)
    draft = quitarServicio(draft, r1.tempId)
    expect(draftEstaCompleto(draft)).toBe(false)
  })
})
