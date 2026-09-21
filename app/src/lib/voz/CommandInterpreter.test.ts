import { describe, expect, it } from 'vitest'
import { interpretarUtterance } from './CommandInterpreter'

function u(texto: string) {
  return interpretarUtterance(texto, 'test-' + Math.random())
}

describe('CommandInterpreter — cliente (fix de la causa raíz)', () => {
  it('"Busca a Verónica" — nombre limpio, sin arrastrar nada más', () => {
    const r = u('Busca a Verónica')
    expect(r.intent).toBe('FIND_CLIENT')
    expect(r.client?.query).toBe('Verónica')
  })

  it('"Busca la clienta Verónica" — nombre limpio', () => {
    const r = u('Busca la clienta Verónica')
    expect(r.client?.query).toBe('Verónica')
  })

  it('"Atiende a Verónica" — nombre limpio', () => {
    const r = u('Atiende a Verónica')
    expect(r.client?.query).toBe('Verónica')
  })

  it('BUG ORIGINAL: "clienta Verónica, se hizo un blower" NUNCA debe capturar "Verónica se hizo"', () => {
    const r = u('Busca la clienta Verónica, se hizo un blower')
    expect(r.client?.query).toBe('Verónica')
    expect(r.client?.query).not.toMatch(/hizo/i)
    expect(r.services).toHaveLength(1)
    expect(r.services[0].query).toBe('blower')
  })
})

describe('CommandInterpreter — servicios y profesional', () => {
  it('"Verónica se hizo un blower" — un servicio sin precio ni profesional', () => {
    const r = u('Verónica se hizo un blower')
    expect(r.client?.query).toBe('Verónica')
    expect(r.services).toHaveLength(1)
    expect(r.services[0].query).toBe('blower')
    expect(r.services[0].price).toBeUndefined()
  })

  it('"Verónica se hizo blower de 45 mil"', () => {
    const r = u('Verónica se hizo blower de 45 mil')
    expect(r.services[0].query).toBe('blower')
    expect(r.services[0].price).toBe(45000)
  })

  it('"Verónica se hizo blower de 45 mil con Valery"', () => {
    const r = u('Verónica se hizo blower de 45 mil con Valery')
    expect(r.services[0]).toMatchObject({ query: 'blower', price: 45000 })
    expect(r.services[0].professional?.query).toBe('Valery')
  })

  it('"Agrega definición de rizos con Valery"', () => {
    const r = u('Agrega definición de rizos con Valery')
    expect(r.services[0].query).toBe('definición de rizos')
    expect(r.services[0].professional?.query).toBe('Valery')
  })
})

describe('CommandInterpreter — colaborador y compensación (fix de la causa raíz)', () => {
  it('"Verónica se hizo blower de 45 mil con Valery y Ana colaboró" — UNA atención, no comandos sueltos', () => {
    const r = u('Verónica se hizo blower de 45 mil con Valery y Ana colaboró')
    expect(r.intent).toBe('REGISTER_ATTENTION')
    expect(r.client?.query).toBe('Verónica')
    expect(r.services).toHaveLength(1)
    expect(r.services[0].collaborators).toHaveLength(1)
    expect(r.services[0].collaborators[0].query).toBe('Ana')
  })

  it('BUG ORIGINAL: "...y Ana colaboró por 10 mil" — la compensación queda DENTRO de la misma operación, no huérfana', () => {
    const r = u('Verónica se hizo blower de 45 mil con Valery y Ana colaboró por 10 mil')
    const colab = r.services[0].collaborators[0]
    expect(colab.query).toBe('Ana')
    expect(colab.compensation).toBe(10000)
    expect(r.ambiguities).toHaveLength(0)
  })

  it('frase larga completa: cliente + 1 servicio + profesional + colaborador + compensación + producto, todo en UNA sola atención', () => {
    const r = u('Verónica se hizo blower de 45 mil con Valery, Ana colaboró por 10 mil y agrega un champú de 70 mil')
    expect(r.intent).toBe('REGISTER_ATTENTION')
    expect(r.client?.query).toBe('Verónica')
    expect(r.services).toHaveLength(1)
    expect(r.services[0]).toMatchObject({ query: 'blower', price: 45000 })
    expect(r.services[0].professional?.query).toBe('Valery')
    expect(r.services[0].collaborators[0]).toMatchObject({ query: 'Ana', compensation: 10000 })
    expect(r.products).toHaveLength(1)
    expect(r.products[0].query).toBe('champú')
    expect(r.products[0].price).toBe(70000)
  })

  it('"Ana colaboró en el blower" sola, sin servicio nuevo en la frase', () => {
    const r = u('Ana colaboró en el blower')
    expect(r.services).toHaveLength(1)
    expect(r.services[0].collaborators[0].query).toBe('Ana')
    // El nombre del servicio en sí puede quedar vacío aquí (se resuelve contra el contexto de
    // sesión más adelante en el pipeline) — lo importante es que la colaboradora no se pierde.
  })
})

describe('CommandInterpreter — correcciones', () => {
  it('"No fueron 10 mil, fueron 15 mil" → corrección de compensación', () => {
    const r = u('No fueron 10 mil, fueron 15 mil')
    expect(r.corrections).toHaveLength(1)
    expect(r.corrections[0]).toMatchObject({ field: 'collaborator_compensation', value: 15000 })
  })

  it('"No fue Valery, fue Claudia" → corrección de profesional', () => {
    const r = u('No fue Valery, fue Claudia')
    expect(r.corrections[0]).toMatchObject({ field: 'service_professional', value: 'Claudia' })
  })
})

describe('CommandInterpreter — quitar y control', () => {
  it('"Quita el champú"', () => {
    const r = u('Quita el champú')
    expect(r.intent).toBe('REMOVE_SERVICE')
    expect(r.products[0].query).toBe('champú')
  })

  it('"Deshaz lo último"', () => {
    expect(u('Deshaz lo último').intent).toBe('UNDO')
  })

  it('"Confirmar"', () => {
    expect(u('Confirmar').intent).toBe('CONFIRM')
  })
})

describe('CommandInterpreter — crear clienta nueva', () => {
  it('BUG: "Crea a Verónica, teléfono 3001234567" separaba mal el nombre del teléfono', () => {
    const r = u('Crea a Verónica, teléfono 3001234567')
    expect(r.intent).toBe('CREATE_CLIENT')
    expect(r.client?.createName).toBe('Verónica')
    expect(r.client?.createPhone).toBe('3001234567')
  })

  it('"Crea a Verónica" sin teléfono', () => {
    const r = u('Crea a Verónica')
    expect(r.client?.createName).toBe('Verónica')
    expect(r.client?.createPhone).toBeUndefined()
  })
})

describe('CommandInterpreter — contexto entre turnos y slot filling (sección 42)', () => {
  it('BUG: "con NOMBRE de MONTO" (profesional ANTES del precio) no debe tragarse el resto de la frase', () => {
    const r = u('Se hizo un blower con Claudia Patricia de 45 mil y agregó un champú de 85 mil')
    expect(r.services[0]).toMatchObject({ query: 'blower', price: 45000 })
    expect(r.services[0].professional?.query).toBe('Claudia Patricia')
    expect(r.products[0]).toMatchObject({ query: 'champú', price: 85000 })
  })

  it('"también Ana ayudó" — "también" nunca se cuela en el nombre de la colaboradora', () => {
    const r = u('también Ana ayudó y ganó 10 mil')
    expect(r.services[0].collaborators[0]).toMatchObject({ query: 'Ana', compensation: 10000 })
  })

  it('"también ella se hizo un blower" — relleno puro, no se inventa un nombre de clienta', () => {
    const r = u('también ella se hizo un blower de 45 mil')
    expect(r.client).toBeUndefined()
    expect(r.services[0]).toMatchObject({ query: 'blower', price: 45000 })
  })

  it('slot filling: "un servicio" genérico se marca queryUnknown, sin inventar un nombre', () => {
    const r = u('Laura se hizo un servicio con Claudia Patricia de 45 mil y agregó un producto de 85 mil')
    expect(r.client?.query).toBe('Laura')
    expect(r.services[0].query).toBeUndefined()
    expect(r.services[0].queryUnknown).toBe(true)
    expect(r.services[0].price).toBe(45000)
    expect(r.services[0].professional?.query).toBe('Claudia Patricia')
    expect(r.products[0].query).toBeUndefined()
    expect(r.products[0].queryUnknown).toBe(true)
    expect(r.products[0].price).toBe(85000)
  })

  it('nombre compuesto mal transcrito: "con Claudia y Patricia" ofrece "Claudia Patricia" como lectura principal y "Claudia" como alternativa', () => {
    const r = u('Se hizo un blower de 45 mil con Claudia y Patricia')
    expect(r.services[0].professional?.query).toBe('Claudia Patricia')
    expect(r.services[0].professional?.queryAlternativo).toBe('Claudia')
  })

  it('TEST 4 del pedido: servicio + colaboradora + producto en una sola frase, con "también" de relleno', () => {
    const r = u('Se hizo un blower de 45 mil con Claudia Patricia, también Ana ayudó y ganó 10 mil, y agrega un champú de 85 mil')
    expect(r.services).toHaveLength(1)
    expect(r.services[0]).toMatchObject({ query: 'blower', price: 45000 })
    expect(r.services[0].professional?.query).toBe('Claudia Patricia')
    expect(r.services[0].collaborators[0]).toMatchObject({ query: 'Ana', compensation: 10000 })
    expect(r.products[0]).toMatchObject({ query: 'champú', price: 85000 })
  })
})

