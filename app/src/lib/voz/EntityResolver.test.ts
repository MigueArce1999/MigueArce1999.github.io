import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cliente, Servicio } from '../types'

const clientesServidor: { current: Cliente[] } = { current: [] }
const aliasMock = vi.fn(async (_tipo: string, _texto: string): Promise<string | null> => null)
const clientesFuzzyMock = vi.fn(async (_texto: string): Promise<Array<{ id: string; nombre: string; telefono: string | null; score: number }>> => [])
const serviciosFuzzyMock = vi.fn(async (_texto: string): Promise<Array<{ id: string; nombre: string; score: number }>> => [])

vi.mock('../api/empleada', () => ({
  buscarClientes: vi.fn(async (texto: string) => clientesServidor.current.filter((c) => c.nombre.toLowerCase().includes(texto.toLowerCase()))),
}))
vi.mock('../api/clientes', () => ({
  obtenerClienteAdmin: vi.fn(async (id: string) => clientesServidor.current.find((c) => c.id === id) ?? null),
}))
vi.mock('./voiceApi', () => ({
  buscarAliasVoz: (tipo: string, texto: string) => aliasMock(tipo, texto),
  buscarClientesFuzzy: (texto: string) => clientesFuzzyMock(texto),
  buscarServiciosFuzzy: (texto: string) => serviciosFuzzyMock(texto),
  buscarProfesionalesFuzzy: vi.fn(async () => []),
  buscarProductosFuzzy: vi.fn(async () => []),
}))

import { resolverCliente, resolverServicio, UMBRALES_FUZZY } from './EntityResolver'

function cliente(id: string, nombre: string): Cliente {
  return {
    id, usuario_id: null, nombre, telefono: '3000000000', email: null, consentimiento_marketing: false,
    visitas_completadas: 0, gasto_acumulado: 0, activo: true, origen_registro: 'admin', notas: null,
    resena_google_confirmada: false, creado_en: new Date().toISOString(),
  }
}

function servicio(id: string, nombre: string): Servicio {
  return { id, categoria_id: 'cat1', nombre, descripcion: null, imagen_url: null, duracion_minutos: 45, tipo_precio: 'fijo', precio: 45000, activo: true }
}

beforeEach(() => {
  clientesServidor.current = []
  aliasMock.mockReset().mockResolvedValue(null)
  clientesFuzzyMock.mockReset().mockResolvedValue([])
  serviciosFuzzyMock.mockReset().mockResolvedValue([])
})

describe('EntityResolver — resolverCliente', () => {
  it('coincidencia exacta única se resuelve sola', async () => {
    clientesServidor.current = [cliente('c1', 'Verónica')]
    const r = await resolverCliente('Verónica')
    expect(r.tipo).toBe('unica')
    if (r.tipo === 'unica') expect(r.item.id).toBe('c1')
  })

  it('coincidencia exacta normalizada (mayúsculas distintas) igual se resuelve sola', async () => {
    clientesServidor.current = [cliente('c1', 'Verónica')]
    const r = await resolverCliente('VERÓNICA')
    expect(r.tipo).toBe('unica')
  })

  it('varias parecidas → multiple, nunca se elige sola', async () => {
    clientesServidor.current = [cliente('c1', 'Laura Martínez'), cliente('c2', 'Laura Gómez')]
    const r = await resolverCliente('Laura')
    expect(r.tipo).toBe('multiple')
  })

  it('sin ningún resultado ni por ilike ni por fuzzy → ninguna', async () => {
    clientesServidor.current = []
    clientesFuzzyMock.mockResolvedValue([])
    const r = await resolverCliente('Xilena')
    expect(r.tipo).toBe('ninguna')
  })

  it('typo de transcripción se recupera por fuzzy remoto aunque el ilike no la traiga', async () => {
    clientesServidor.current = [cliente('c1', 'Verónica')]
    clientesFuzzyMock.mockResolvedValue([{ id: 'c1', nombre: 'Verónica', telefono: '3000000000', score: 0.9 }])
    const r = await resolverCliente('Beronica')
    expect(r.tipo).toBe('unica')
    if (r.tipo === 'unica') expect(r.item.nombre).toBe('Verónica')
  })

  it('alias resuelve directo sin pasar por fuzzy', async () => {
    clientesServidor.current = [cliente('c1', 'Verónica')]
    aliasMock.mockResolvedValue('c1')
    const r = await resolverCliente('vero')
    expect(r.tipo).toBe('unica')
    if (r.tipo === 'unica') expect(r.item.id).toBe('c1')
  })
})

describe('EntityResolver — resolverServicio (lista local + fuzzy remoto)', () => {
  it('coincidencia exacta en el catálogo cargado', async () => {
    const r = await resolverServicio('Blower', [servicio('s1', 'Blower')])
    expect(r.tipo).toBe('unica')
  })

  it('typo local ("blowr") se resuelve por similitud local sin llamar al fuzzy remoto', async () => {
    const r = await resolverServicio('blowr', [servicio('s1', 'Blower')])
    expect(r.tipo === 'unica' || r.tipo === 'aproximada').toBe(true)
    expect(serviciosFuzzyMock).not.toHaveBeenCalled()
  })

  it('nombre sin ninguna relación local → ninguna (nunca inventa un servicio)', async () => {
    const r = await resolverServicio('xilofonoterapia', [servicio('s1', 'Blower'), servicio('s2', 'Corte')])
    expect(r.tipo).toBe('ninguna')
  })

  it('los umbrales están centralizados y son los documentados', () => {
    expect(UMBRALES_FUZZY.alto).toBe(0.85)
    expect(UMBRALES_FUZZY.medio).toBe(0.65)
  })
})
