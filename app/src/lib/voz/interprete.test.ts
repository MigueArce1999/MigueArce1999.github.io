import { describe, expect, it } from 'vitest'
import { interpretarTexto } from './interprete'

function tipos(texto: string) {
  return interpretarTexto(texto).map((a) => a.tipo)
}

describe('interpretarTexto — clientes', () => {
  it('reconoce variantes de búsqueda de clienta', () => {
    expect(interpretarTexto('Busca a Laura')[0]).toMatchObject({ tipo: 'buscar_cliente', datos: { texto: 'Laura' } })
    expect(interpretarTexto('Clienta Laura Martínez')[0]).toMatchObject({ tipo: 'buscar_cliente', datos: { texto: 'Laura Martínez' } })
    expect(interpretarTexto('La clienta es Laura')[0]).toMatchObject({ tipo: 'buscar_cliente', datos: { texto: 'Laura' } })
    expect(interpretarTexto('Busca el teléfono 3001234567')[0]).toMatchObject({ tipo: 'buscar_cliente', datos: { texto: '3001234567' } })
  })

  it('reconoce crear nueva clienta y completar sus datos', () => {
    expect(tipos('Crear nueva clienta')).toEqual(['crear_cliente'])
    expect(interpretarTexto('Se llama Laura Martínez')[0]).toMatchObject({ tipo: 'completar_cliente_nuevo', datos: { campo: 'nombre', valor: 'Laura Martínez' } })
    expect(interpretarTexto('Su número es 3001234567')[0]).toMatchObject({ tipo: 'completar_cliente_nuevo', datos: { campo: 'telefono', valor: '3001234567' } })
  })

  it('reconoce el cambio explícito de clienta', () => {
    expect(interpretarTexto('Cambia la clienta por María Pérez')[0]).toMatchObject({ tipo: 'cambiar_cliente', datos: { texto: 'María Pérez' } })
  })
})

describe('interpretarTexto — servicios, precios y profesionales', () => {
  it('reconoce un servicio con precio y profesional combinados', () => {
    const acciones = interpretarTexto('Le hicimos un blower de cuarenta y cinco mil con Claudia')
    expect(acciones).toHaveLength(1)
    expect(acciones[0]).toMatchObject({
      tipo: 'agregar_servicio_o_producto',
      datos: { nombre: 'blower', profesionalTexto: 'Claudia', monto: { valor: 45000, ambiguo: false } },
    })
  })

  it('reconoce dos servicios en la misma frase, cada uno con su precio y profesional', () => {
    const acciones = interpretarTexto('Le hicimos un blower de cuarenta y cinco mil con Claudia y un corte de treinta mil con Valery')
    const servicios = acciones.filter((a) => a.tipo === 'agregar_servicio_o_producto')
    expect(servicios).toHaveLength(2)
    expect(servicios[0].datos).toMatchObject({ nombre: 'blower', profesionalTexto: 'Claudia', monto: { valor: 45000 } })
    expect(servicios[1].datos).toMatchObject({ nombre: 'corte', profesionalTexto: 'Valery', monto: { valor: 30000 } })
  })

  it('reconoce "por" como alternativa a "de" para el precio', () => {
    const acciones = interpretarTexto('Añade definición de rizos por setenta mil')
    expect(acciones[0]).toMatchObject({ tipo: 'agregar_servicio_o_producto', datos: { nombre: 'definición de rizos', monto: { valor: 70000 } } })
  })

  it('reconoce colaboradores asociados a un servicio', () => {
    expect(interpretarTexto('Ana colaboró en el blower')[0]).toMatchObject({ tipo: 'agregar_colaborador', datos: { colaboradorTexto: 'Ana' }, referencia: { texto: 'blower' } })
    const conOrdinal = interpretarTexto('Añade a Nalda como colaboradora del segundo servicio')[0]
    expect(conOrdinal).toMatchObject({ tipo: 'agregar_colaborador', datos: { colaboradorTexto: 'Nalda' }, referencia: { posicionOrdinal: 2 } })
    expect(interpretarTexto('Quita a Ana del blower')[0]).toMatchObject({ tipo: 'quitar_colaborador', datos: { colaboradorTexto: 'Ana' }, referencia: { texto: 'blower' } })
  })

  it('reconoce cambios de precio y de profesional', () => {
    expect(interpretarTexto('El blower costó cuarenta y cinco mil')[0]).toMatchObject({ tipo: 'fijar_precio_servicio', referencia: { texto: 'blower' } })
    expect(interpretarTexto('Cambia el corte a treinta y cinco mil')[0]).toMatchObject({ tipo: 'fijar_precio_servicio', referencia: { texto: 'corte' }, datos: { monto: { valor: 35000 } } })
    expect(interpretarTexto('El corte lo hizo Valery')[0]).toMatchObject({ tipo: 'asignar_profesional', datos: { profesionalTexto: 'Valery' }, referencia: { texto: 'corte' } })
    expect(interpretarTexto('Cambia la profesional del corte por Claudia')[0]).toMatchObject({ tipo: 'asignar_profesional', datos: { profesionalTexto: 'Claudia' }, referencia: { texto: 'corte' } })
  })

  it('marca como ambiguo un importe sin "mil" ("ponle treinta y cinco")', () => {
    const accion = interpretarTexto('Ponle treinta y cinco al corte')[0]
    expect(accion.tipo).toBe('fijar_precio_servicio')
    expect((accion.datos.monto as any).ambiguo).toBe(true)
    expect((accion.datos.monto as any).valorSugerido).toBe(35000)
  })

  it('reconoce quitar un servicio por posición o por nombre', () => {
    expect(interpretarTexto('Quita el segundo servicio')[0]).toMatchObject({ tipo: 'quitar_linea', referencia: { posicionOrdinal: 2 } })
    expect(interpretarTexto('Quita el corte')[0]).toMatchObject({ tipo: 'quitar_linea', referencia: { texto: 'corte' } })
  })
})

describe('interpretarTexto — productos', () => {
  it('reconoce un producto con precio ("de")', () => {
    const acciones = interpretarTexto('Agrega un champú de sesenta mil')
    expect(acciones[0]).toMatchObject({ tipo: 'agregar_servicio_o_producto', datos: { nombre: 'champú', monto: { valor: 60000 } } })
  })

  it('reconoce cantidad sin precio', () => {
    const acciones = interpretarTexto('Agrega dos acondicionadores')
    expect(acciones[0]).toMatchObject({ tipo: 'agregar_servicio_o_producto', datos: { nombre: 'acondicionadores', cantidad: 2 } })
  })

  it('reconoce quitar producto y cambiar cantidad', () => {
    expect(interpretarTexto('Quita el champú')[0]).toMatchObject({ tipo: 'quitar_linea', referencia: { texto: 'champú' } })
    expect(interpretarTexto('Cambia la cantidad a dos')[0]).toMatchObject({ tipo: 'cambiar_cantidad_producto', datos: { cantidad: 2 } })
  })
})

describe('interpretarTexto — notas', () => {
  it('trata todo lo posterior a "añade una nota" como texto literal, no como comandos', () => {
    const acciones = interpretarTexto('Añade una nota: quitar el corte y cobrar el doble')
    expect(acciones).toHaveLength(1)
    expect(acciones[0]).toMatchObject({ tipo: 'agregar_nota', datos: { texto: 'quitar el corte y cobrar el doble' } })
  })
})

describe('interpretarTexto — control y ambigüedad', () => {
  it('reconoce confirmaciones y deshacer sin marcar el pago', () => {
    expect(tipos('Listo')).toEqual(['confirmar_listo'])
    expect(tipos('Terminé')).toEqual(['confirmar_listo'])
    expect(tipos('Vamos a cobrar')).toEqual(['confirmar_listo'])
    expect(tipos('Deshacer lo último')).toEqual(['deshacer'])
  })

  it('reconoce respuestas a una pregunta pendiente por posición', () => {
    expect(interpretarTexto('La primera')[0]).toMatchObject({ tipo: 'responder_pregunta', datos: { seleccion: 'primera' } })
    expect(interpretarTexto('2')[0]).toMatchObject({ tipo: 'responder_pregunta', datos: { seleccion: '2' } })
  })

  it('devuelve no_reconocido para una frase que no encaja en ningún patrón, en vez de forzarla', () => {
    const acciones = interpretarTexto('El clima está horrible hoy')
    expect(acciones.some((a) => a.tipo === 'no_reconocido')).toBe(true)
  })

  it('procesa la frase larga combinada del pedido en el orden correcto', () => {
    const texto =
      'Busca a la clienta Laura Martínez. Le hicimos un blower de cuarenta y cinco mil con Claudia y un corte de treinta mil con Valery. Ana colaboró en el blower. Agrega un champú de sesenta mil.'
    const acciones = interpretarTexto(texto)
    const t = acciones.map((a) => a.tipo)
    expect(t).toEqual([
      'buscar_cliente',
      'agregar_servicio_o_producto',
      'agregar_servicio_o_producto',
      'agregar_colaborador',
      'agregar_servicio_o_producto',
    ])
  })
})
