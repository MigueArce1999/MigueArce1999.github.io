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

