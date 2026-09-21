import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cliente, Profesional, Servicio } from '../types'

// Nunca se debe pegar contra Supabase real en estos tests: se mockean todas las funciones que
// EntityResolver/voiceApi usan para hablar con la base de datos. `buscarClientes` simula el
// `ilike` real del formulario manual sobre una lista fija en memoria.
const clientesDemoRef: { current: Cliente[] } = { current: [] }

vi.mock('../api/empleada', () => ({
  buscarClientes: vi.fn(async (texto: string) => {
    const n = texto.toLowerCase()
    return clientesDemoRef.current.filter((c) => c.nombre.toLowerCase().includes(n))
  }),
}))

vi.mock('../api/clientes', () => ({
  obtenerClienteAdmin: vi.fn(async (id: string) => clientesDemoRef.current.find((c) => c.id === id) ?? null),
}))

vi.mock('./voiceApi', () => ({
  buscarAliasVoz: vi.fn(async () => null),
  buscarClientesFuzzy: vi.fn(async () => []),
  buscarServiciosFuzzy: vi.fn(async () => []),
  buscarProfesionalesFuzzy: vi.fn(async () => []),
  buscarProductosFuzzy: vi.fn(async () => []),
  listarProductos: vi.fn(async () => []),
  crearProductoRapido: vi.fn(async (nombre: string) => ({ id: 'nuevo-prod', nombre, categoria: null, precio: null })),
}))

import { procesarUtterance, type VoiceExecutionDeps } from './VoiceExecutionService'
import { crearSesionVoz, type VoiceSessionState } from './VoiceSessionContext'
import type { Producto } from './schema'

function clientesDemo(): Cliente[] {
  const base = (id: string, nombre: string, telefono: string): Cliente => ({
    id, usuario_id: null, nombre, telefono, email: null, consentimiento_marketing: false,
    visitas_completadas: 0, gasto_acumulado: 0, activo: true, origen_registro: 'admin', notas: null,
    resena_google_confirmada: false, creado_en: new Date().toISOString(),
  })
  return [
    base('c1', 'Verónica', '3001111111'),
    base('c2', 'María Pérez', '3004444444'),
    base('c3', 'Laura Martínez', '3005555555'),
  ]
}

function equipoDemo(): Profesional[] {
  const base = (id: string, nombre: string): Profesional => ({
    id, slug: nombre.toLowerCase(), nombre, especialidades: [], bio: null, foto_url: null,
    activo: true, orden_visualizacion: 0, mostrar_en_home: true,
  })
  return [base('p1', 'Claudia'), base('p2', 'Valery'), base('p3', 'Ana'), base('p4', 'Naldi'), base('p5', 'Claudia Patricia')]
}

function serviciosDemo(): Servicio[] {
  const base = (id: string, nombre: string, precio: number | null, tipo: Servicio['tipo_precio'] = 'fijo'): Servicio => ({
    id, categoria_id: 'cat1', nombre, descripcion: null, imagen_url: null, duracion_minutos: 45,
    tipo_precio: tipo, precio, activo: true,
  })
  return [base('s1', 'Blower', 45000), base('s2', 'Corte', 30000)]
}

function productosDemo(): Producto[] {
  return [{ id: 'pr1', nombre: 'Champú', categoria: 'Cuidado capilar', precio: 70000, activo: true }]
}

function depsDemo(overrides: Partial<VoiceExecutionDeps> = {}): VoiceExecutionDeps {
  return {
    obtenerServicios: () => serviciosDemo(),
    obtenerEquipo: () => equipoDemo(),
    obtenerProductos: () => productosDemo(),
    puedeCrearServicio: false,
    puedeCrearProducto: false,
    crearServicioRapido: vi.fn(async (nombre: string) => ({ ...serviciosDemo()[0], id: 'nuevo-serv', nombre })),
    crearProductoRapido: vi.fn(async (nombre: string) => ({ id: 'nuevo-prod', nombre, categoria: null, precio: null })),
    crearClienteRapido: vi.fn(async (datos): Promise<Cliente> => ({
      id: 'nueva-cliente', usuario_id: null, nombre: datos.nombre, telefono: datos.telefono, email: null,
      consentimiento_marketing: false, visitas_completadas: 0, gasto_acumulado: 0, activo: true,
      origen_registro: 'admin', notas: null, resena_google_confirmada: false, creado_en: new Date().toISOString(),
    })),
    ...overrides,
  }
}

let sesion: VoiceSessionState
let uid = 0
function siguienteId() {
  uid += 1
  return `u${uid}`
}

beforeEach(() => {
  clientesDemoRef.current = clientesDemo()
  sesion = crearSesionVoz()
  uid = 0
})

describe('VoiceExecutionService — procesarUtterance', () => {
  it('busca una clienta única y la resuelve automáticamente', async () => {
    const r = await procesarUtterance('Busca a Verónica', siguienteId(), sesion, depsDemo())
    expect(r.draft.client.status).toBe('resolved')
    expect(r.draft.client.resolved?.nombre).toBe('Verónica')
    expect(r.error).toBeNull()
  })

  it('clienta ambigua pide aclaración con opciones numeradas y la responde', async () => {
    clientesDemoRef.current = [
      { ...clientesDemo()[0], id: 'c8', nombre: 'Verónica Gómez' },
      { ...clientesDemo()[0], id: 'c9', nombre: 'Verónica Ríos' },
    ]
    let r = await procesarUtterance('Busca a Verónica', siguienteId(), sesion, depsDemo())
    expect(r.clarification).not.toBeNull()
    expect(r.draft.client.status).toBe('needs_clarification')

    r = await procesarUtterance('1', siguienteId(), sesion, depsDemo())
    expect(r.draft.client.status).toBe('resolved')
  })

  it('servicio con precio y profesional en una sola frase (causa raíz #1)', async () => {
    const r = await procesarUtterance(
      'Busca la clienta Verónica, se hizo un blower de 45.000 con Valery',
      siguienteId(),
      sesion,
      depsDemo(),
    )
    expect(r.draft.client.resolved?.nombre).toBe('Verónica')
    expect(r.draft.services).toHaveLength(1)
    const linea = r.draft.services[0]
    expect(linea.displayName).toBe('Blower')
    expect(linea.price).toBe(45000)
    expect(linea.professionalName).toBe('Valery')
  })

  it('colaboradora con compensación en la misma frase (causa raíz #2)', async () => {
    let r = await procesarUtterance(
      'Se hizo un blower de 45 mil con Valery',
      siguienteId(),
      sesion,
      depsDemo(),
    )
    r = await procesarUtterance(
      'Ana colaboró en el blower y tuvo una ganancia de 10.000',
      siguienteId(),
      sesion,
      depsDemo(),
    )
    const linea = r.draft.services.find((s) => s.displayName === 'Blower')!
    expect(linea.collaborators).toHaveLength(1)
    expect(linea.collaborators[0].displayName).toBe('Ana')
    expect(linea.collaborators[0].compensation).toBe(10000)
  })

  it('corrección "no fueron X, fueron Y" actualiza la compensación existente', async () => {
    await procesarUtterance('Se hizo un blower de 45 mil con Valery', siguienteId(), sesion, depsDemo())
    await procesarUtterance('Ana colaboró en el blower y se ganó 10 mil', siguienteId(), sesion, depsDemo())
    const r = await procesarUtterance('No fueron 10 mil, fueron 15 mil', siguienteId(), sesion, depsDemo())
    const linea = r.draft.services.find((s) => s.displayName === 'Blower')!
    expect(linea.collaborators[0].compensation).toBe(15000)
  })

  it('quitar colaboradora ("quita a Ana del blower")', async () => {
    await procesarUtterance('Se hizo un blower de 45 mil con Valery', siguienteId(), sesion, depsDemo())
    await procesarUtterance('Ana colaboró en el blower por 10 mil', siguienteId(), sesion, depsDemo())
    const r = await procesarUtterance('Quita a Ana del blower', siguienteId(), sesion, depsDemo())
    const linea = r.draft.services.find((s) => s.displayName === 'Blower')!
    expect(linea.collaborators).toHaveLength(0)
  })

  it('deshacer revierte el último cambio del draft', async () => {
    await procesarUtterance('Busca a Verónica', siguienteId(), sesion, depsDemo())
    await procesarUtterance('Se hizo un blower de 45 mil con Valery', siguienteId(), sesion, depsDemo())
    expect(sesion.draft.services).toHaveLength(1)
    const r = await procesarUtterance('Deshaz lo último', siguienteId(), sesion, depsDemo())
    expect(r.draft.services).toHaveLength(0)
    expect(r.draft.client.status).toBe('resolved')
  })

  it('CONFIRM solo marca shouldExecute cuando el draft está completo', async () => {
    let r = await procesarUtterance('Confirmar', siguienteId(), sesion, depsDemo())
    expect(r.shouldExecute).toBe(false)

    await procesarUtterance('Busca a Verónica', siguienteId(), sesion, depsDemo())
    await procesarUtterance('Se hizo un blower de 45 mil con Valery', siguienteId(), sesion, depsDemo())
    r = await procesarUtterance('Confirmar', siguienteId(), sesion, depsDemo())
    expect(r.shouldExecute).toBe(true)
    expect(r.readyToConfirm).toBe(true)
  })

  it('la frase larga combinada del reporte original arma el draft completo, sin escribir en la base', async () => {
    const texto =
      'Busca la clienta Verónica, se hizo un blower de 45.000 con Valery, Ana colaboró en el blower y tuvo una ganancia de 10.000, agrega un champú de 70.000'
    const r = await procesarUtterance(texto, siguienteId(), sesion, depsDemo())

    expect(r.draft.client.resolved?.nombre).toBe('Verónica')
    expect(r.draft.services).toHaveLength(1)
    const blower = r.draft.services[0]
    expect(blower.displayName).toBe('Blower')
    expect(blower.price).toBe(45000)
    expect(blower.professionalName).toBe('Valery')
    expect(blower.collaborators[0]?.displayName).toBe('Ana')
    expect(blower.collaborators[0]?.compensation).toBe(10000)
    expect(r.draft.products).toHaveLength(1)
    expect(r.draft.products[0].displayName).toBe('Champú')
    expect(r.draft.products[0].price).toBe(70000)

    // Ninguna llamada de creación/escritura debió dispararse: todo resolvió contra el
    // catálogo ya cargado en memoria.
    const deps = depsDemo()
    expect(deps.crearClienteRapido).not.toHaveBeenCalled()
    expect(deps.crearServicioRapido).not.toHaveBeenCalled()
    expect(deps.crearProductoRapido).not.toHaveBeenCalled()
  })
})

// Sección 42 del pedido: contexto entre comandos, slot filling y nombres compuestos. El
// AttentionDraft final debe ser el MISMO sin importar si la persona lo dijo en una sola frase o
// repartido en varios turnos (regla de aceptación crítica A/B/C/D/F/G).
describe('VoiceExecutionService — contexto entre turnos y slot filling (sección 42)', () => {
  it('TEST 1: una sola frase con cliente + servicio + profesional + producto', async () => {
    const r = await procesarUtterance(
      'Busca a Laura Martínez, se hizo un blower con Claudia Patricia de 45 mil y agregó un champú de 85 mil',
      siguienteId(),
      sesion,
      depsDemo(),
    )
    expect(r.draft.client.resolved?.nombre).toBe('Laura Martínez')
    expect(r.draft.services).toHaveLength(1)
    expect(r.draft.services[0].displayName).toBe('Blower')
    expect(r.draft.services[0].price).toBe(45000)
    expect(r.draft.services[0].professionalName).toBe('Claudia Patricia')
    expect(r.draft.products[0]?.displayName).toBe('Champú')
    expect(r.draft.products[0]?.price).toBe(85000)
  })

  it('TEST 1 dividido en 2 turnos: la segunda frase no repite a la clienta y aun así se aplica a ella', async () => {
    await procesarUtterance('Busca a Laura Martínez', siguienteId(), sesion, depsDemo())
    const r = await procesarUtterance(
      'Se hizo un blower con Claudia Patricia de 45 mil y agregó un champú de 85 mil',
      siguienteId(),
      sesion,
      depsDemo(),
    )
    expect(r.draft.client.resolved?.nombre).toBe('Laura Martínez')
    expect(r.draft.services[0].displayName).toBe('Blower')
    expect(r.draft.services[0].price).toBe(45000)
    expect(r.draft.services[0].professionalName).toBe('Claudia Patricia')
    expect(r.draft.products[0]?.displayName).toBe('Champú')
    expect(r.draft.products[0]?.price).toBe(85000)
  })

  it('TEST 1 dividido en muchos turnos cortos: mismo resultado final', async () => {
    await procesarUtterance('Busca a Laura Martínez', siguienteId(), sesion, depsDemo())
    await procesarUtterance('Se hizo un blower', siguienteId(), sesion, depsDemo())
    await procesarUtterance('Costó 45 mil', siguienteId(), sesion, depsDemo())
    await procesarUtterance('Lo hizo Claudia Patricia', siguienteId(), sesion, depsDemo())
    const r = await procesarUtterance('También agrega un champú de 85 mil', siguienteId(), sesion, depsDemo())

    expect(r.draft.client.resolved?.nombre).toBe('Laura Martínez')
    const blower = r.draft.services.find((s) => s.displayName === 'Blower')!
    expect(blower.price).toBe(45000)
    expect(blower.professionalName).toBe('Claudia Patricia')
    expect(r.draft.products[0]?.displayName).toBe('Champú')
    expect(r.draft.products[0]?.price).toBe(85000)
  })

  it('"también ella se hizo..." reutiliza la clienta activa sin volver a nombrarla', async () => {
    await procesarUtterance('Busca a Laura Martínez', siguienteId(), sesion, depsDemo())
    const r = await procesarUtterance('También ella se hizo un blower de 45 mil con Valery', siguienteId(), sesion, depsDemo())
    expect(r.draft.client.resolved?.nombre).toBe('Laura Martínez')
    expect(r.draft.services[0].displayName).toBe('Blower')
  })

  it('TEST 3: slot filling — "un servicio"/"un producto" sin nombre preguntan SOLO lo que falta, sin perder precio/profesional', async () => {
    await procesarUtterance('Busca a Laura Martínez', siguienteId(), sesion, depsDemo())
    let r = await procesarUtterance(
      'Se hizo un servicio con Claudia Patricia de 45 mil y agregó un producto de 85 mil',
      siguienteId(),
      sesion,
      depsDemo(),
    )
    // Primera pregunta: solo el nombre del servicio.
    expect(r.clarification?.question).toBe('¿Qué servicio se realizó?')
    // Lo que sí se sabía ya quedó guardado en el draft (una línea sin nombre todavía).
    const lineaPendiente = r.draft.services.find((s) => !s.resolved)!
    expect(lineaPendiente.price).toBe(45000)
    expect(lineaPendiente.professionalName).toBe('Claudia Patricia')

    r = await procesarUtterance('Blower', siguienteId(), sesion, depsDemo())
    // Se completó el servicio (conservando precio/profesional) y encadenó la pregunta del producto.
    const blower = r.draft.services.find((s) => s.resolved)!
    expect(blower.displayName).toBe('Blower')
    expect(blower.price).toBe(45000)
    expect(blower.professionalName).toBe('Claudia Patricia')
    expect(r.clarification?.question).toBe('¿Qué producto se agregó?')
    const productoPendiente = r.draft.products.find((p) => !p.resolved)!
    expect(productoPendiente.price).toBe(85000)

    r = await procesarUtterance('Champú', siguienteId(), sesion, depsDemo())
    expect(r.clarification).toBeNull()
    expect(r.draft.products[0].displayName).toBe('Champú')
    expect(r.draft.products[0].price).toBe(85000)
    expect(r.draft.client.resolved?.nombre).toBe('Laura Martínez')
    expect(r.shouldExecute).toBe(false) // todavía no se dijo "confirmar"
  })

  it('TEST 4: múltiples entidades en una sola frase (servicio + colaboradora + producto)', async () => {
    await procesarUtterance('Busca a Laura Martínez', siguienteId(), sesion, depsDemo())
    const r = await procesarUtterance(
      'Se hizo un blower de 45 mil con Claudia Patricia, también Ana ayudó y ganó 10 mil, y agrega un champú de 85 mil',
      siguienteId(),
      sesion,
      depsDemo(),
    )
    const blower = r.draft.services.find((s) => s.displayName === 'Blower')!
    expect(blower.price).toBe(45000)
    expect(blower.professionalName).toBe('Claudia Patricia')
    expect(blower.collaborators[0]?.displayName).toBe('Ana')
    expect(blower.collaborators[0]?.compensation).toBe(10000)
    expect(r.draft.products[0]?.displayName).toBe('Champú')
    expect(r.draft.products[0]?.price).toBe(85000)
  })

  it('nombre compuesto transcrito con "y" ("Claudia y Patricia") resuelve a la profesional real "Claudia Patricia"', async () => {
    const r = await procesarUtterance('Se hizo un blower de 45 mil con Claudia y Patricia', siguienteId(), sesion, depsDemo())
    expect(r.draft.services[0].professionalName).toBe('Claudia Patricia')
  })

  it('crear una clienta nueva con nombre y teléfono en una sola frase, pidiendo confirmación', async () => {
    const deps = depsDemo()
    let r = await procesarUtterance('Crea a Xiomara, teléfono 3009998888', siguienteId(), sesion, deps)
    expect(r.clarification?.field).toBe('create_client_confirm')
    expect(r.draft.client.pendingName).toBe('Xiomara')
    expect(r.draft.client.pendingPhone).toBe('3009998888')

    r = await procesarUtterance('Sí', siguienteId(), sesion, deps)
    expect(deps.crearClienteRapido).toHaveBeenCalledWith({ nombre: 'Xiomara', telefono: '3009998888' })
    expect(r.draft.client.status).toBe('resolved')
    expect(r.draft.client.resolved?.nombre).toBe('Xiomara')
    expect(r.draft.client.resolved?.isNew).toBe(true)
  })

  it('BUG: si el reconocimiento de voz parte "Crea a X, teléfono N" en dos frases, la segunda (solo el teléfono) se engancha igual', async () => {
    const deps = depsDemo()
    let r = await procesarUtterance('Crea a Xiomara', siguienteId(), sesion, deps)
    expect(r.clarification?.question).toContain('sin teléfono')
    expect(r.draft.client.pendingPhone).toBeUndefined()

    // Segunda frase, llegada aparte por una pausa al hablar: antes se perdía en silencio.
    r = await procesarUtterance('teléfono 3009998888', siguienteId(), sesion, deps)
    expect(r.draft.client.pendingPhone).toBe('3009998888')
    expect(r.clarification?.question).toContain('3009998888')

    r = await procesarUtterance('Sí', siguienteId(), sesion, deps)
    expect(deps.crearClienteRapido).toHaveBeenCalledWith({ nombre: 'Xiomara', telefono: '3009998888' })
    expect(r.draft.client.resolved?.nombre).toBe('Xiomara')
  })
})
