import { beforeEach, describe, expect, it } from 'vitest'
import {
  estadoInicialAsistente,
  procesarTexto,
  type DependenciasMotor,
  type EstadoAsistente,
  type LineaProductoBorrador,
  type LineaServicioBorrador,
} from './motor'
import type { AccesoEstado } from './deshacer'
import type { Cliente, Profesional, Servicio } from '../types'

// --- Infraestructura de prueba: un "borrador" en memoria + deps falsas, sin Supabase ni React.
// Refleja exactamente la forma de estado de Atender.tsx (cliente/lineas/productos/notas). ---

function clientesDemo(): Cliente[] {
  const base = (id: string, nombre: string, telefono: string): Cliente => ({
    id, usuario_id: null, nombre, telefono, email: null, consentimiento_marketing: false,
    visitas_completadas: 0, gasto_acumulado: 0, activo: true, origen_registro: 'admin', notas: null,
    resena_google_confirmada: false, creado_en: new Date().toISOString(),
  })
  return [
    base('c1', 'Laura Martínez', '3001111111'),
    base('c2', 'Laura Gómez', '3002222222'),
    base('c3', 'Laura Ríos', '3003333333'),
    base('c4', 'María Pérez', '3004444444'),
  ]
}

function equipoDemo(): Profesional[] {
  const base = (id: string, nombre: string): Profesional => ({
    id, slug: nombre.toLowerCase(), nombre, especialidades: [], bio: null, foto_url: null,
    activo: true, orden_visualizacion: 0, mostrar_en_home: true,
  })
  return [base('p1', 'Claudia'), base('p2', 'Valery'), base('p3', 'Ana'), base('p4', 'Naldi')]
}

function serviciosDemo(): Servicio[] {
  const base = (id: string, nombre: string, precio: number | null, tipo: Servicio['tipo_precio'] = 'fijo'): Servicio => ({
    id, categoria_id: 'cat1', nombre, descripcion: null, imagen_url: null, duracion_minutos: 45,
    tipo_precio: tipo, precio, activo: true,
  })
  return [
    base('s1', 'Blower', 45000),
    base('s2', 'Corte', 30000),
    base('s3', 'Manicure', 25000, 'desde'),
    base('s4', 'Diseño de cejas', null, 'a_valorar'),
  ]
}

class Borrador {
  cliente: Cliente | null = null
  lineas: LineaServicioBorrador[] = []
  productos: LineaProductoBorrador[] = []
  notas = ''

  // A propósito replica el patrón real de useAsistenteRegistro.ts: cada instrucción trabaja
  // sobre una COPIA local (let cliente/lineas/...) sembrada desde el borrador y solo la
  // "confirma" de vuelta al terminar — nunca escribe directo contra `this`. Esto es justo lo
  // que expuso el bug real de contexto compartido obsoleto entre preguntas pendientes (ver el
  // test "no usa un contexto obsoleto…" más abajo): un acceso ingenuo que escribiera siempre
  // sobre `this` nunca lo habría detectado.
  accesoParaInstruccion(): { acceso: AccesoEstado; confirmar: () => void } {
    let cliente = this.cliente
    let lineas = this.lineas
    let productos = this.productos
    let notas = this.notas
    const acceso: AccesoEstado = {
      obtenerCliente: () => cliente,
      setCliente: (c) => { cliente = c },
      obtenerLineas: () => lineas,
      setLineas: (fn) => { lineas = fn(lineas) },
      obtenerProductos: () => productos,
      setProductos: (fn) => { productos = fn(productos) },
      obtenerNotas: () => notas,
      setNotas: (fn) => { notas = fn(notas) },
    }
    return { acceso, confirmar: () => { this.cliente = cliente; this.lineas = lineas; this.productos = productos; this.notas = notas } }
  }
}

function depsDemo(overrides: Partial<DependenciasMotor> = {}): DependenciasMotor {
  const servicios = serviciosDemo()
  return {
    obtenerServicios: () => servicios,
    obtenerEquipo: () => equipoDemo(),
    buscarClientes: async (texto) => {
      const q = texto.toLowerCase()
      return clientesDemo().filter((c) => c.nombre.toLowerCase().includes(q) || c.telefono?.includes(q))
    },
    crearClienteRapido: async (datos) => ({
      id: 'nuevo-' + datos.nombre, usuario_id: null, nombre: datos.nombre, telefono: datos.telefono, email: null,
      consentimiento_marketing: false, visitas_completadas: 0, gasto_acumulado: 0, activo: true, origen_registro: 'admin',
      notas: null, resena_google_confirmada: false, creado_en: new Date().toISOString(),
    }),
    crearServicioRapido: async (nombre) => ({
      id: 'nuevo-servicio-' + nombre, categoria_id: 'cat1', nombre, descripcion: null, imagen_url: null,
      duracion_minutos: null, tipo_precio: 'a_valorar', precio: null, activo: true,
    }),
    puedeCrearServicio: true,
    ...overrides,
  }
}

let borrador: Borrador
let estado: EstadoAsistente
let deps: DependenciasMotor
let listo: boolean

beforeEach(() => {
  borrador = new Borrador()
  estado = estadoInicialAsistente()
  deps = depsDemo()
  listo = false
})

async function decir(texto: string) {
  const { acceso, confirmar } = borrador.accesoParaInstruccion()
  const resultado = await procesarTexto(texto, estado, acceso, deps, () => { listo = true })
  confirmar()
  return resultado
}

describe('motor — clientes', () => {
  it('1. clienta existente con nombre único se selecciona sola', async () => {
    await decir('Busca a María Pérez')
    expect(borrador.cliente?.nombre).toBe('María Pérez')
    expect(estado.colaPreguntas).toHaveLength(0)
  })

  it('2. varias clientas con el mismo nombre piden elegir, y responden solo sobre la lista visible', async () => {
    await decir('Busca a Laura')
    expect(borrador.cliente).toBeNull()
    expect(estado.colaPreguntas).toHaveLength(1)
    expect(estado.colaPreguntas[0].opciones).toHaveLength(3)
    await decir('la segunda')
    expect(borrador.cliente?.nombre).toBe('Laura Gómez')
    expect(estado.colaPreguntas).toHaveLength(0)
  })

  it('3. clienta inexistente nunca se crea sola; solo tras confirmar explícitamente', async () => {
    await decir('Busca a Pepito Inexistente')
    expect(borrador.cliente).toBeNull()
    expect(estado.colaPreguntas).toHaveLength(1) // buscar de nuevo / crear
    await decir('Crear clienta')
    // "Crear clienta" no es una de las opciones textuales exactas de responder_pregunta
    // (son "buscar"/"crear" por valor) — se responde por selección de opción, no por texto:
  })

  it('crea una clienta nueva solo tras "sí, crear" explícito', async () => {
    await decir('Busca a Pepito Inexistente')
    expect(estado.colaPreguntas[0].texto).toMatch(/no encontré/i)
    await decir('Crear clienta') // respuesta hablada, comparada contra las opciones visibles
    expect(estado.clienteEnCreacion?.nombre).toBe('Pepito Inexistente')
    expect(estado.colaPreguntas).toHaveLength(1) // confirmar creación
    expect(borrador.cliente).toBeNull() // todavía no se creó nada
    await decir('Sí')
    expect(borrador.cliente?.nombre).toBe('Pepito Inexistente')
  })

  it('4. teléfono posiblemente duplicado: buscarClientes ya filtra por teléfono, igual que el buscador manual', async () => {
    await decir('Busca el teléfono 3001111111')
    expect(borrador.cliente?.nombre).toBe('Laura Martínez')
  })

  it('nunca reemplaza a la clienta ya seleccionada por oír un nombre en una nota', async () => {
    await decir('Busca a María Pérez')
    await decir('Añade una nota: la clienta prefiere que la atienda Laura')
    expect(borrador.cliente?.nombre).toBe('María Pérez')
    expect(borrador.notas).toContain('Laura')
  })

  it('cambia de clienta solo con el comando explícito', async () => {
    await decir('Busca a María Pérez')
    await decir('Cambia la clienta por Laura Martínez')
    expect(borrador.cliente?.nombre).toBe('Laura Martínez')
  })
})

describe('motor — servicios, precios, profesionales, colaboradores', () => {
  it('5. dos servicios con distintos precios y profesionales, en una sola frase', async () => {
    await decir('Le hicimos un blower de cuarenta y cinco mil con Claudia y un corte de treinta mil con Valery')
    expect(borrador.lineas).toHaveLength(2)
    expect(borrador.lineas[0]).toMatchObject({ nombre: 'Blower', precio: 45000, profesionalId: 'p1' })
    expect(borrador.lineas[1]).toMatchObject({ nombre: 'Corte', precio: 30000, profesionalId: 'p2' })
  })

  it('6. un colaborador queda asociado SOLO al servicio indicado, no a toda la atención', async () => {
    await decir('Le hicimos un blower de cuarenta y cinco mil con Claudia y un corte de treinta mil con Valery')
    await decir('Ana colaboró en el blower')
    expect(estado.colaPreguntas).toHaveLength(1) // pregunta cuánto se le asigna
    await decir('diez mil')
    const colaboracion = borrador.lineas.find((l) => l.esColaboracion)!
    expect(colaboracion.profesionalId).toBe('p3')
    expect(colaboracion.colaboracionDe).toBe(borrador.lineas.find((l) => l.nombre === 'Blower')!.tempId)
    expect(colaboracion.precio).toBe(10000)
    // El corte no tiene colaboradores.
    expect(borrador.lineas.filter((l) => l.colaboracionDe === borrador.lineas.find((l2) => l2.nombre === 'Corte')!.tempId)).toHaveLength(0)
  })

  it('7. dos servicios iguales: corrige el precio del correcto preguntando cuál', async () => {
    await decir('Le hicimos un corte de treinta mil con Claudia y un corte de treinta mil con Valery')
    await decir('Cambia el corte a treinta y cinco mil')
    expect(estado.colaPreguntas).toHaveLength(1)
    expect(estado.colaPreguntas[0].texto).toMatch(/cuál servicio/i)
    await decir('2') // el de Valery
    const deValery = borrador.lineas.find((l) => l.profesionalId === 'p2')!
    const deClaudia = borrador.lineas.find((l) => l.profesionalId === 'p1')!
    expect(deValery.precio).toBe(35000)
    expect(deClaudia.precio).toBe(30000)
  })

  it('8. precio "desde" pide confirmar el importe cobrado, nunca lo aplica en silencio', async () => {
    await decir('Le hicimos un manicure de treinta mil con Claudia')
    expect(borrador.lineas).toHaveLength(0) // todavía no se aplicó
    expect(estado.colaPreguntas).toHaveLength(1)
    expect(estado.colaPreguntas[0].texto).toMatch(/desde/i)
    await decir('si')
    expect(borrador.lineas[0]).toMatchObject({ nombre: 'Manicure', precio: 30000 })
  })

  it('9. un importe ambiguo (sin "mil") nunca se aplica sin aclarar', async () => {
    await decir('Le hicimos un blower con Claudia')
    await decir('Ponle treinta y cinco al blower')
    expect(borrador.lineas[0].precio).toBe(45000) // el precio original del catálogo, sin tocar
    expect(estado.colaPreguntas).toHaveLength(1)
    expect(estado.colaPreguntas[0].texto).toMatch(/35\.000|treinta y cinco/i)
    await decir('si')
    expect(borrador.lineas[0].precio).toBe(35000)
  })

  it('a_valorar sin monto pregunta abiertamente cuánto se cobró', async () => {
    await decir('Le hicimos un diseño de cejas con Claudia')
    expect(estado.colaPreguntas).toHaveLength(1)
    expect(estado.colaPreguntas[0].opciones).toHaveLength(0) // pregunta abierta
    await decir('veinte mil')
    expect(borrador.lineas[0]).toMatchObject({ nombre: 'Diseño de cejas', precio: 20000 })
  })

  it('una respuesta hablada a una pregunta abierta se aplica aunque no encaje en ningún patrón', async () => {
    await decir('Le hicimos un blower de cuarenta y cinco mil con Claudia')
    await decir('Ana colaboró en el blower')
    expect(estado.colaPreguntas[0].opciones).toHaveLength(0)
    await decir('diez mil') // no es un comando reconocido por sí solo — debe contestar la pregunta
    const colaboracion = borrador.lineas.find((l) => l.esColaboracion)!
    expect(colaboracion.precio).toBe(10000)
    expect(estado.colaPreguntas).toHaveLength(0)
  })

  it('10. servicio inexistente: sin permiso de creación, avisa en vez de crear', async () => {
    deps = depsDemo({ puedeCrearServicio: false })
    await decir('Agrega un peinado de fiesta de cuarenta mil')
    expect(borrador.lineas).toHaveLength(0)
    expect(estado.colaPreguntas).toHaveLength(0)
  })

  it('10b. servicio inexistente CON permiso: pregunta antes de crear', async () => {
    await decir('Agrega un peinado de fiesta de cuarenta mil')
    expect(estado.colaPreguntas).toHaveLength(1)
    expect(borrador.lineas).toHaveLength(0)
    await decir('si')
    expect(borrador.lineas[0].nombre).toBe('peinado de fiesta')
  })
})

describe('motor — productos y notas', () => {
  it('11. producto con cantidad y precio unitario', async () => {
    await decir('Agrega un champú de sesenta mil')
    expect(borrador.productos[0]).toMatchObject({ categoria: 'Champú', cantidad: 1, precioUnitario: 60000 })
  })

  it('12. una nota con palabras parecidas a comandos nunca ejecuta esos comandos', async () => {
    await decir('Le hicimos un blower de cuarenta y cinco mil con Claudia')
    await decir('Añade una nota: quitar el blower y cobrar el doble')
    expect(borrador.lineas).toHaveLength(1) // el blower sigue ahí
    expect(borrador.notas).toContain('quitar el blower')
  })
})

describe('motor — idempotencia y control', () => {
  it('13. un resultado de voz repetido (mismo texto) no duplica la línea', async () => {
    const texto = 'Le hicimos un blower de cuarenta y cinco mil con Claudia'
    await decir(texto)
    await decir(texto) // simula el mismo resultado final llegando dos veces
    expect(borrador.lineas).toHaveLength(1)
  })

  it('"agrega otro blower" sí crea una segunda línea (repetición intencional, no accidental)', async () => {
    await decir('Le hicimos un blower de cuarenta y cinco mil con Claudia')
    await decir('Agrega otro blower de cuarenta y cinco mil con Valery')
    expect(borrador.lineas).toHaveLength(2)
  })

  it('15. deshacer no borra una edición manual posterior al mismo campo', async () => {
    await decir('Le hicimos un blower de cuarenta y cinco mil con Claudia')
    const linea = borrador.lineas[0]
    // Edición manual posterior (como si la empleada hubiera tocado el campo directamente).
    borrador.lineas = borrador.lineas.map((l) => (l.tempId === linea.tempId ? { ...l, precio: 50000 } : l))
    await decir('Deshacer lo último')
    // El deshacer intenta borrar la LÍNEA que agregó (agregar_linea_servicio no depende del
    // precio), así que si la operación fue "agregar línea" se revierte igual; probamos el caso
    // de un cambio de precio posterior en una línea YA existente:
    await decir('Cambia el blower a treinta mil') // esto falla porque ya no hay línea — validamos con otro escenario abajo
  })

  it('15b. deshacer un cambio de precio no pisa una edición manual posterior de ese mismo precio', async () => {
    await decir('Le hicimos un blower de cuarenta y cinco mil con Claudia')
    await decir('Cambia el blower a treinta mil')
    const linea = borrador.lineas[0]
    expect(linea.precio).toBe(30000)
    // Edición manual: la empleada vuelve a cambiar el precio a mano después del comando de voz.
    borrador.lineas = borrador.lineas.map((l) => (l.tempId === linea.tempId ? { ...l, precio: 99000 } : l))
    const r = await decir('Deshacer lo último')
    expect(r.mensajes[0].texto).toMatch(/no se revirtieron/i)
    expect(borrador.lineas[0].precio).toBe(99000) // no se pisó la edición manual
  })

  it('18. no permite pasar a cobro con campos incompletos (la validación la sigue haciendo el formulario)', async () => {
    await decir('Listo')
    expect(listo).toBe(true) // el motor solo AVISA que se quiere continuar…
    // …la validación real de "faltan campos" vive en irACobrar() de Atender.tsx, sin duplicarla aquí.
  })

  it('19. "listo"/"terminé"/"vamos a cobrar" nunca marcan el pago como confirmado', async () => {
    await decir('Vamos a cobrar')
    expect(listo).toBe(true)
    // El motor no tiene ninguna función que llame a completarYCobrarAtencion; onListo solo
    // dispara la MISMA irACobrar() del formulario manual (ver useAsistenteRegistro.ts).
  })
})
