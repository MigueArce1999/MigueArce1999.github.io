import { describe, expect, it } from 'vitest'
import {
  afinarCandidatosGlowdesk,
  aplicarCandidatosGlowdesk,
  confirmaLoMismo,
  contieneWakeWord,
  elegirOpcion,
  esComandoCorto,
  esEcoAsistente,
  extraerNombreHablado,
  extraerTelefonoHablado,
  estadoInicialGlowdesk,
  estadoMenuGlowdesk,
  puedeUsarGlowdesk,
  procesarTurnoGlowdesk,
} from './conversacionGlowdesk'

describe('Glowdesk — wake word', () => {
  it('detecta hola Glowdesk y transcripciones en español, no inglés', () => {
    expect(contieneWakeWord('Hola Glowdesk')).toBe(true)
    expect(contieneWakeWord('hola glowdesk')).toBe(true)
    expect(contieneWakeWord('Hola Glow Desk, quiero registrar un usuario')).toBe(true)
    expect(contieneWakeWord('hola globo desk')).toBe(true)
    expect(contieneWakeWord('hola glau desk')).toBe(true)
    expect(contieneWakeWord('hola glow')).toBe(true)
    expect(contieneWakeWord('hola desk')).toBe(true)
    expect(contieneWakeWord('Glowdesk')).toBe(true)
    expect(contieneWakeWord('hola claude desk')).toBe(true)
    expect(contieneWakeWord('hello glow desk')).toBe(false)
    expect(contieneWakeWord('buenos días')).toBe(false)
  })

  it('trata sí y no como comando corto', () => {
    expect(esComandoCorto('sí')).toBe(true)
    expect(esComandoCorto('no')).toBe(true)
    expect(esComandoCorto('lo confirmo')).toBe(true)
    expect(esComandoCorto('listo')).toBe(true)
    expect(esComandoCorto('la primera')).toBe(true)
    expect(esComandoCorto('hola glowdesk')).toBe(true)
    expect(esComandoCorto('Laura Martínez')).toBe(false)
  })

  it('no trata el eco de Glowdesk como turno del usuario', () => {
    expect(esEcoAsistente('No te entendí', 'No te entendí. Di: quiero registrar un usuario, o registrar una atención.')).toBe(true)
    expect(esEcoAsistente('quiero registrar un usuario, o registrar una atención', 'No te entendí. Di: quiero registrar un usuario, o registrar una atención.')).toBe(true)
    expect(esEcoAsistente('sí', '¿Lo confirmo?')).toBe(false)
    expect(esEcoAsistente('hola glowdesk', 'Hola, soy Glowdesk. ¿Registramos una atención o una clienta?')).toBe(false)
    expect(puedeUsarGlowdesk(false, { rol: 'admin', activo: true })).toBe(false)
    expect(puedeUsarGlowdesk(true, { rol: 'cliente', activo: true })).toBe(false)
    expect(puedeUsarGlowdesk(true, { rol: 'admin', activo: true })).toBe(true)
    expect(puedeUsarGlowdesk(true, { rol: 'empleada', activo: true })).toBe(true)
  })
})

describe('Glowdesk — alta conversacional de clienta', () => {
  it('con el micrófono ya despierto (menú), registrar usuario pide el nombre', () => {
    const r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'quiero registrar un usuario')
    expect(r.estado.fase).toBe('alta_nombre')
    expect(r.decir).toMatch(/cómo se llama/i)
  })

  it('en el menú, «atención» o «clienta» bastan para empezar', () => {
    expect(procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'atención').estado.fase).toBe('atencion_cliente')
    expect(procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'clienta').estado.fase).toBe('alta_nombre')
    expect(procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'cliente').estado.fase).toBe('alta_nombre')
    const incompleto = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'quiero registrar una')
    expect(incompleto.estado.fase).toBe('menu')
    expect(incompleto.decir).toMatch(/atención o una clienta/i)
  })

  it('hola Glowdesk vuelve a abrir el menú aunque ya estaba despierto', () => {
    const enMenu = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'hola glowdesk')
    expect(enMenu.estado.fase).toBe('menu')
    expect(enMenu.decir).toMatch(/atención o una clienta/i)
    const dormido = procesarTurnoGlowdesk(estadoInicialGlowdesk(), 'hola glowdesk')
    expect(dormido.estado.fase).toBe('menu')
    expect(dormido.decir).toMatch(/atención o una clienta/i)
  })

  it('acepta frases de alta de clienta en el menú', () => {
    expect(procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'nueva clienta').estado.fase).toBe('alta_nombre')
    expect(procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'anota una clienta').estado.fase).toBe('alta_nombre')
  })

  it('«registrar» suelto pregunta si es clienta o atención', () => {
    const r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'registrar')
    expect(r.estado.fase).toBe('menu')
    expect(r.decir).toMatch(/clienta/i)
  })

  it('si no entiende en el menú, vuelve a preguntar atención o clienta', () => {
    const r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'qué hora es')
    expect(r.decir).toMatch(/atención o clienta/i)
    expect(r.estado.fase).toBe('menu')
  })

  it('en dormido, registrar sin wake word no dispara', () => {
    const r = procesarTurnoGlowdesk(estadoInicialGlowdesk(), 'quiero registrar un usuario')
    expect(r.decir).toBeNull()
    expect(r.estado.fase).toBe('dormido')
  })

  it('pide el nombre, el teléfono y confirma antes de crear', () => {
    let r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'quiero registrar un usuario')
    expect(r.estado.fase).toBe('alta_nombre')

    r = procesarTurnoGlowdesk(r.estado, 'Laura Martínez')
    expect(r.estado.fase).toBe('alta_confirmar_nombre')
    expect(r.estado.nombre).toBe('Laura Martínez')

    r = procesarTurnoGlowdesk(r.estado, 'sí')
    expect(r.estado.fase).toBe('alta_tiene_telefono')

    r = procesarTurnoGlowdesk(r.estado, 'sí')
    expect(r.estado.fase).toBe('alta_telefono')

    r = procesarTurnoGlowdesk(r.estado, '300 123 4567')
    expect(r.estado.fase).toBe('alta_confirmar')
    expect(r.estado.telefono).toBe('3001234567')

    r = procesarTurnoGlowdesk(r.estado, 'confirmo')
    expect(r.accion).toEqual({ tipo: 'crear_cliente', nombre: 'Laura Martínez', telefono: '3001234567' })
    expect(r.estado.fase).toBe('menu')
  })

  it('permite omitir el teléfono', () => {
    let r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'quiero registrar un usuario')
    r = procesarTurnoGlowdesk(r.estado, 'Ana')
    r = procesarTurnoGlowdesk(r.estado, 'sí')
    r = procesarTurnoGlowdesk(r.estado, 'no')
    expect(r.estado.omiteTelefono).toBe(true)
    r = procesarTurnoGlowdesk(r.estado, 'sí')
    expect(r.accion).toEqual({ tipo: 'crear_cliente', nombre: 'Ana', telefono: null })
  })

  it('cancelar en el menú no apaga el micrófono', () => {
    const r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'cancelar')
    expect(r.accion).toBeNull()
    expect(r.estado.fase).toBe('menu')
  })

  it('cancelar en medio vuelve al menú sin crear', () => {
    let r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'quiero registrar un usuario')
    r = procesarTurnoGlowdesk(r.estado, 'Pedro')
    r = procesarTurnoGlowdesk(r.estado, 'cancelar')
    expect(r.accion).toBeNull()
    expect(r.estado.fase).toBe('menu')
    expect(r.estado.nombre).toBeNull()
  })
})

describe('Glowdesk — extractores', () => {
  it('extrae nombre y dígitos hablados', () => {
    expect(extraerNombreHablado('se llama maría josé')).toBe('María José')
    expect(extraerTelefonoHablado('tres cero cero uno dos tres cuatro cinco seis siete')).toBe('3001234567')
  })
})

describe('Glowdesk — atención por diálogo', () => {
  it('registrar un servicio pregunta por la clienta, no navega', () => {
    const r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'quiero registrar un servicio')
    expect(r.estado.fase).toBe('atencion_cliente')
    expect(r.accion).toBeNull()
    expect(r.decir).toMatch(/quién fue la clienta/i)
  })

  it('resuelve un único candidato y pide confirmación', () => {
    let r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'quiero registrar una atención')
    r = procesarTurnoGlowdesk(r.estado, 'Laura')
    expect(r.accion).toEqual({ tipo: 'buscar_cliente', query: 'Laura' })
    r = aplicarCandidatosGlowdesk(r.estado, 'cliente', [{ id: 'c1', nombre: 'Laura Martínez' }])
    expect(r.estado.fase).toBe('atencion_confirmar_cliente')
    expect(r.decir).toMatch(/Laura Martínez/)
  })

  it('con varios candidatos pregunta cuál', () => {
    const base = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'registrar una atención').estado
    const conQuery = procesarTurnoGlowdesk(base, 'Laura').estado
    const r = aplicarCandidatosGlowdesk(conQuery, 'cliente', [
      { id: '1', nombre: 'Laura' },
      { id: '2', nombre: 'Laura Pérez' },
    ])
    expect(r.decir).toMatch(/uno/i)
    expect(r.estado.opciones).toHaveLength(2)
  })

  it('elige por ordinal o por nombre único', () => {
    const ops = [
      { id: '1', nombre: 'Laura' },
      { id: '2', nombre: 'Laura Pérez' },
    ]
    expect(elegirOpcion(ops, 'la primera')?.id).toBe('1')
    expect(elegirOpcion(ops, 'la segunda')?.id).toBe('2')
    expect(elegirOpcion(ops, 'Laura Pérez')?.id).toBe('2')
    expect(elegirOpcion(ops, 'Laura')?.id).toBe('1')
    expect(elegirOpcion(ops, 'sí')).toBeNull()
    expect(elegirOpcion([
      { id: '1', nombre: 'Miguel' },
      { id: '2', nombre: 'Maris Marin' },
      { id: '3', nombre: 'Claudia Mercado' },
    ], 'Miguel el uno')?.id).toBe('1')
    expect(elegirOpcion([
      { id: '1', nombre: 'Miguel' },
      { id: '2', nombre: 'Maris Marin' },
      { id: '3', nombre: 'Claudia Mercado' },
    ], 'el uno')?.id).toBe('1')
    expect(elegirOpcion([
      { id: '1', nombre: 'Miguel' },
      { id: '2', nombre: 'Maris Marin' },
      { id: '3', nombre: 'Claudia Mercado' },
    ], 'Claudia')?.id).toBe('3')
    expect(esComandoCorto('Miguel el uno')).toBe(true)
    expect(esComandoCorto('si se lo hizo Miguel')).toBe(true)
  })

  it('con Miguel no mezcla a Maris ni Claudia', () => {
    const equipo = [
      { id: '1', nombre: 'Miguel' },
      { id: '2', nombre: 'Maris Marin' },
      { id: '3', nombre: 'Claudia Mercado' },
    ]
    expect(afinarCandidatosGlowdesk('Miguel', equipo)).toEqual([{ id: '1', nombre: 'Miguel' }])
    const r = aplicarCandidatosGlowdesk(
      { ...procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'atención').estado, fase: 'atencion_profesional', clienteId: 'c1', clienteNombre: 'Laura', servicioId: 's1', servicioNombre: 'Corte', precio: 40000 },
      'profesional',
      equipo,
      'Miguel',
    )
    expect(r.estado.profesionalNombre).toBe('Miguel')
    expect(r.estado.opciones).toHaveLength(0)
    expect(r.decir).not.toMatch(/varias/i)
  })

  it('recorre clienta, servicio, profesional, confirma y pregunta cobro', () => {
    let r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'quiero registrar una atención')
    r = procesarTurnoGlowdesk(r.estado, 'Laura')
    r = aplicarCandidatosGlowdesk(r.estado, 'cliente', [{ id: 'c1', nombre: 'Laura' }])
    r = procesarTurnoGlowdesk(r.estado, 'sí')
    expect(r.estado.fase).toBe('atencion_servicio')
    r = procesarTurnoGlowdesk(r.estado, 'corte')
    r = aplicarCandidatosGlowdesk(r.estado, 'servicio', [{ id: 's1', nombre: 'Corte', precio: 40000 }])
    r = procesarTurnoGlowdesk(r.estado, 'es corte de cabello')
    expect(r.estado.fase).toBe('atencion_profesional')
    r = procesarTurnoGlowdesk(r.estado, 'Miguel')
    r = aplicarCandidatosGlowdesk(r.estado, 'profesional', [{ id: 'p1', nombre: 'Miguel' }])
    r = procesarTurnoGlowdesk(r.estado, 'sí')
    expect(r.estado.fase).toBe('atencion_confirmar')
    r = procesarTurnoGlowdesk(r.estado, 'sí')
    expect(r.accion?.tipo).toBe('registrar_atencion')
    expect(r.estado.fase).toBe('atencion_cobrar')
    r = procesarTurnoGlowdesk(r.estado, 'sí')
    expect(r.accion).toEqual({ tipo: 'cobrar_atencion', precio: 40000 })
    expect(r.estado.fase).toBe('menu')
  })

  it('acepta sí y el mismo nombre al confirmar el servicio', () => {
    const base = aplicarCandidatosGlowdesk(
      { ...procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'registrar una atención').estado, fase: 'atencion_confirmar_servicio', servicioId: 's1', servicioNombre: 'Corte de cabello', precio: 35000, opciones: [] },
      'servicio',
      [{ id: 's1', nombre: 'Corte de cabello', precio: 35000 }],
    )
    expect(confirmaLoMismo('sí', 'Corte de cabello')).toBe(true)
    expect(confirmaLoMismo('si si', 'Corte de cabello')).toBe(true)
    expect(confirmaLoMismo('es corte de cabello', 'Corte de cabello')).toBe(true)
    expect(confirmaLoMismo('corte de cabello', 'Corte de cabello')).toBe(true)
    expect(confirmaLoMismo('tinte', 'Corte de cabello')).toBe(false)
    const r = procesarTurnoGlowdesk(
      { ...base.estado, fase: 'atencion_confirmar_servicio', servicioId: 's1', servicioNombre: 'Corte de cabello', precio: 35000 },
      'sí',
    )
    expect(r.estado.fase).toBe('atencion_profesional')
  })

  it('al elegir uno de la lista pasa al resumen, y confirma “sí se lo hizo Miguel”', () => {
    let r = procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'registrar una atención')
    r = aplicarCandidatosGlowdesk(
      { ...r.estado, fase: 'atencion_profesional', clienteId: 'c1', clienteNombre: 'Laura', servicioId: 's1', servicioNombre: 'Corte', precio: 40000 },
      'profesional',
      [
        { id: '1', nombre: 'Miguel' },
        { id: '2', nombre: 'Maris Marin' },
        { id: '3', nombre: 'Claudia Mercado' },
      ],
    )
    expect(r.estado.opciones).toHaveLength(3)
    r = procesarTurnoGlowdesk(r.estado, 'Miguel el uno')
    expect(r.estado.fase).toBe('atencion_confirmar')
    expect(r.estado.profesionalNombre).toBe('Miguel')

    const porConfirmar = aplicarCandidatosGlowdesk(
      { ...procesarTurnoGlowdesk(estadoMenuGlowdesk(), 'registrar una atención').estado, fase: 'atencion_profesional', clienteId: 'c1', clienteNombre: 'Laura', servicioId: 's1', servicioNombre: 'Corte', precio: 40000 },
      'profesional',
      [{ id: '1', nombre: 'Miguel' }],
    )
    expect(porConfirmar.estado.fase).toBe('atencion_confirmar_profesional')
    expect(confirmaLoMismo('si se lo hizo Miguel', 'Miguel')).toBe(true)
    const si = procesarTurnoGlowdesk(porConfirmar.estado, 'si se lo hizo Miguel')
    expect(si.estado.fase).toBe('atencion_confirmar')
    const guardado = procesarTurnoGlowdesk(si.estado, 'sí')
    expect(guardado.accion?.tipo).toBe('registrar_atencion')
  })
})
