// Motor de diálogo de Glowdesk: turnos pregunta–respuesta (no un dictado único).
// Puro: no toca el micrófono, ni TTS, ni Supabase.

import { extraerDigitosTelefono } from './MoneyNormalizer'
import { normalizar, similitud } from './texto'

export type GeneroVozAsistente = 'femenina' | 'masculina'

export type FaseGlowdesk =
  | 'dormido'
  | 'menu'
  | 'alta_nombre'
  | 'alta_confirmar_nombre'
  | 'alta_tiene_telefono'
  | 'alta_telefono'
  | 'alta_confirmar'
  | 'atencion_cliente'
  | 'atencion_confirmar_cliente'
  | 'atencion_servicio'
  | 'atencion_confirmar_servicio'
  | 'atencion_profesional'
  | 'atencion_confirmar_profesional'
  | 'atencion_confirmar'
  | 'atencion_cobrar'

export interface OpcionGlowdesk {
  id: string
  nombre: string
  precio?: number | null
}

export interface EstadoGlowdesk {
  fase: FaseGlowdesk
  nombre: string | null
  telefono: string | null
  omiteTelefono: boolean
  clienteId: string | null
  clienteNombre: string | null
  servicioId: string | null
  servicioNombre: string | null
  precio: number | null
  profesionalId: string | null
  profesionalNombre: string | null
  opciones: OpcionGlowdesk[]
}

export type AccionGlowdesk =
  | { tipo: 'crear_cliente'; nombre: string; telefono: string | null }
  | { tipo: 'buscar_cliente'; query: string }
  | { tipo: 'buscar_servicio'; query: string }
  | { tipo: 'buscar_profesional'; query: string }
  | { tipo: 'registrar_atencion'; clienteId: string; servicioId: string; profesionalId: string; precio: number }
  | { tipo: 'cobrar_atencion'; precio: number }

export interface ResultadoTurnoGlowdesk {
  estado: EstadoGlowdesk
  decir: string | null
  accion: AccionGlowdesk | null
}

const DIGITO_HABLA: Record<string, string> = {
  cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5',
  seis: '6', siete: '7', ocho: '8', nueve: '9',
}

const RELLENO_NOMBRE = /\b(por favor|porfa|gracias|quiero|registrar|registra|usuario|clienta|cliente|persona)\b/gi

const VACIO: Omit<EstadoGlowdesk, 'fase'> = {
  nombre: null, telefono: null, omiteTelefono: false,
  clienteId: null, clienteNombre: null,
  servicioId: null, servicioNombre: null, precio: null,
  profesionalId: null, profesionalNombre: null,
  opciones: [],
}

export function estadoInicialGlowdesk(): EstadoGlowdesk {
  return { fase: 'dormido', ...VACIO }
}

export function estadoMenuGlowdesk(): EstadoGlowdesk {
  return { fase: 'menu', ...VACIO }
}

function inicioAtencion(): EstadoGlowdesk {
  return { fase: 'atencion_cliente', ...VACIO }
}

const GLOWDESK = /glow\s*des[ck]?|glo\s*desk|glou\s*desk|globo?\s*des[ck]?|glau\s*desk|glao\s*desk|clau[de]?\s*desk|cloud\s*desk|claude\s*desk|closes?\s*desk|glowdesk|gloudesk|cloudesk|globdesk|\bglo[wu]?\s+des/

function mencionaGlowdesk(n: string): boolean {
  GLOWDESK.lastIndex = 0
  return GLOWDESK.test(n)
}

export function contieneWakeWord(texto: string): boolean {
  const n = normalizar(texto).replace(/\s+/g, ' ')
  const saludo = /\b(hola|ola|buenos dias|buenas|buenas tardes|buenas noches)\b/.test(n)
  if (saludo && /\b(glow|glo|glou|globo|glau|glao|cloud|claude|closes|glowdesk|gloudesk|globdesk|desk|des)\b/.test(n)) return true
  if (!mencionaGlowdesk(n)) return false
  return saludo || /^\s*(glow|glo|glou|globo|cloud|claude)/.test(n)
}

function textoTrasWake(texto: string): string {
  const cortado = texto.replace(new RegExp(`^[\\s\\S]*?(?:${GLOWDESK.source})`, 'i'), '').trim()
  return cortado || texto
}

function indiceOrdinal(n: string): number | null {
  const t1 = /\b(primera|primer)\b/.test(n) || /\b(el|la|numero)\s+(uno|1)\b/.test(n) || /^(uno|1)$/.test(n)
  const t2 = /\b(segunda|segundo)\b/.test(n) || /\b(el|la|numero)\s+(dos|2)\b/.test(n) || /^(dos|2)$/.test(n)
  const t3 = /\b(tercera|tercero)\b/.test(n) || /\b(el|la|numero)\s+(tres|3)\b/.test(n) || /^(tres|3)$/.test(n)
  if (t3 && !t1 && !t2) return 2
  if (t2 && !t1 && !t3) return 1
  if (t1 && !t2 && !t3) return 0
  return null
}

export function esComandoCorto(texto: string): boolean {
  if (contieneWakeWord(texto)) return true
  const n = normalizar(texto).replace(/\s+/g, ' ')
  if (/^(si|sip|claro|vale|ok|okay|dale|confirmo|lo confirmo|listo|ya|no|nop|se|cancelar|cancela)$/.test(n)) return true
  if (/^(atencion|clienta|cliente|usuario|usuaria)$/.test(n)) return true
  if (/^si\b/.test(n) && n.length <= 48 && !/\bno\b/.test(n)) return true
  if (indiceOrdinal(n) != null && n.split(' ').length <= 8) return true
  if (/^(la )?(primera|primer|segunda|segundo|tercera|tercero)$/.test(n)) return true
  if (/^(numero )?(uno|dos|tres|1|2|3)$/.test(n)) return true
  if (/^la [123]$/.test(n)) return true
  return false
}

export function esCancelacion(texto: string): boolean {
  const n = normalizar(texto)
  return /^(cancelar|cancela|olvidalo|olv[ií]dalo|ya no|nada|para|detener|apaga|duerme|callate)$/.test(n)
    || /\b(cancelar|olvidalo|ya no quiero)\b/.test(n)
}

export function esAfirmacion(texto: string): boolean {
  const n = normalizar(texto)
  if (!n) return false
  if (/^(no|nop|negativo)$/.test(n) || /^(no)\b/.test(n) || /\bsi no\b/.test(n)) return false
  if (/^(si|sip|s|se|aja|uju|uhum|listo|ya|dale|ok|okay|vale|claro|correcto|confirmo|lo confirmo|de acuerdo|asi es)$/.test(n)) return true
  if (/^(si|sip|listo|ya|dale|confirmo)\b/.test(n) && n.length <= 60) return true
  return /\b(lo confirmo|confirmo|afirmativo)\b/.test(n)
}

/** “sí”, “ese”, o repetir el mismo nombre (“es corte de cabello”). */
export function confirmaLoMismo(texto: string, nombre: string | null): boolean {
  if (esAfirmacion(texto)) return true
  if (!nombre) return false
  const n = normalizar(texto).replace(/^(te oi|si se lo hizo|se lo hizo|si fue|fue|el servicio es|el servicio|la clienta es|el profesional es|confirmo( el servicio| a)?|es el|es la|es)\s+/, '')
  const nom = normalizar(nombre)
  if (!n || !nom) return false
  return n === nom || n.includes(nom) || (n.length >= 4 && nom.includes(n))
}

export function esNegacion(texto: string): boolean {
  const n = normalizar(texto)
  return /^(no|nop|negativo|ninguno|ninguna)$/.test(n)
    || /^(no)\b/.test(n)
    || /\bno tiene\b/.test(n)
    || /\bsin (telefono|n[uú]mero)\b/.test(n)
}

export function extraerTelefonoHablado(texto: string): string | null {
  const directos = extraerDigitosTelefono(texto)
  if (directos.length >= 7 && directos.length <= 12) return directos
  const tokens = normalizar(texto).split(' ').filter(Boolean)
  let digitos = ''
  for (const t of tokens) {
    if (/^\d$/.test(t)) digitos += t
    else if (DIGITO_HABLA[t]) digitos += DIGITO_HABLA[t]
  }
  if (digitos.length >= 7 && digitos.length <= 12) return digitos
  return null
}

export function extraerNombreHablado(texto: string): string | null {
  const n = texto.trim()
  if (!n) return null
  const m = n.match(/(?:se llama|el nombre es|nombre(?:\s+es)?|es)\s+(.+)/i)
  const crudo = (m?.[1] ?? n).replace(RELLENO_NOMBRE, ' ').replace(/\s+/g, ' ').trim()
  if (crudo.length < 2) return null
  if (esCancelacion(crudo) || esAfirmacion(crudo) || esNegacion(crudo)) return null
  return capitalizarNombre(crudo.replace(/[.,;]+$/g, '').trim())
}

function capitalizarNombre(texto: string): string {
  return texto
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
}

export function esPedidoClienta(texto: string): boolean {
  const n = normalizar(texto)
  if (/\b(atencion|venta)\b/.test(n)) return false
  return /\b(clienta|cliente|usuario|usuaria|persona)\b/.test(n)
    || /^(la )?(segunda|segundo|dos|2)$/.test(n)
    || similitud(n, 'clienta') >= 0.78
    || similitud(n, 'cliente') >= 0.78
}

export function esPedidoAtencion(texto: string): boolean {
  const n = normalizar(texto)
  if (esPedidoClienta(texto)) return false
  return /\b(atencion|venta|servicio|cancion|tencion|atension)\b/.test(n)
    || /^(la )?(primera|primer|uno|1)$/.test(n)
    || similitud(n, 'atencion') >= 0.72
    || similitud(n, 'una atencion') >= 0.75
}

export function esIntentoRegistrarUsuario(texto: string): boolean {
  const n = normalizar(texto)
  if (/\b(atencion|venta)\b/.test(n)) return false
  if (/^(clienta|cliente|usuario|usuaria|una clienta|un cliente|un usuario)$/.test(n)) return true
  if (/\balta de (un |una )?(cliente|clienta|usuario|usuaria)\b/.test(n)) return true
  if (/\bnuev[oa] (clienta|cliente|usuario|usuaria)\b/.test(n)) return true
  const verbo = /\b(registrar|registra|crear|crea|agregar|agrega|anadir|anade|anotar|anota|apuntar|apunta)\b/.test(n)
  const quien = /\b(usuario|usuaria|clienta|cliente|persona)\b/.test(n)
  return (verbo && quien) || esPedidoClienta(texto)
}

export function esRegistrarSuelto(texto: string): boolean {
  return /^(registrar|registra|quiero registrar|quiero registrar una|registrar una)$/.test(normalizar(texto))
}

export function esIntentoRegistrarAtencion(texto: string): boolean {
  const n = normalizar(texto)
  if (esPedidoClienta(texto)) return false
  return (
    /\b(registrar|registra|crear)\b/.test(n)
    && /\b(atencion|venta|servicio|cancion)\b/.test(n)
  ) || /\bcobrar\b/.test(n) || esPedidoAtencion(texto)
}

const PREGUNTA_MENU = '¿Registramos una atención o una clienta?'

function irAlMenu(decir = PREGUNTA_MENU): ResultadoTurnoGlowdesk {
  return { estado: estadoMenuGlowdesk(), decir, accion: null }
}

function resetAlta(fase: FaseGlowdesk): EstadoGlowdesk {
  return { ...VACIO, fase }
}

function resumenCliente(estado: EstadoGlowdesk): string {
  const tel = estado.omiteTelefono || !estado.telefono
    ? 'sin número de teléfono'
    : `con el teléfono ${estado.telefono.split('').join(' ')}`
  return `${estado.nombre}, ${tel}`
}

function resumenAtencion(estado: EstadoGlowdesk): string {
  const pesos = estado.precio != null ? `${Math.round(estado.precio)} pesos` : 'sin precio de catálogo'
  return `${estado.clienteNombre}, ${estado.servicioNombre}, ${estado.profesionalNombre}, ${pesos}`
}

function listarOpciones(opciones: OpcionGlowdesk[]): string {
  const nums = ['Uno', 'Dos', 'Tres']
  return opciones.map((o, i) => `${nums[i] ?? i + 1}, ${o.nombre}`).join('. ') + '. ¿Cuál?'
}

export function elegirOpcion(opciones: OpcionGlowdesk[], texto: string): OpcionGlowdesk | null {
  if (opciones.length === 0) return null
  const n = normalizar(texto).replace(/\s+/g, ' ')
  if (/^(si|sip|no|nop|claro|vale)$/.test(n)) return null

  const ordinal = indiceOrdinal(n)
  if (ordinal != null) return opciones[ordinal] ?? null

  const exacto = opciones.filter((o) => normalizar(o.nombre) === n)
  if (exacto.length === 1) return exacto[0]

  const tokens = new Set(n.split(' ').filter((t) => t.length >= 3 && !/^(uno|dos|tres|el|la|los|las|del|de|se|lo|hizo|numero)$/.test(t)))
  const hits = opciones.filter((o) => {
    const nom = normalizar(o.nombre)
    const partes = nom.split(' ').filter(Boolean)
    const primero = partes[0] ?? ''
    const apellido = partes.length > 1 ? partes[partes.length - 1] : ''
    if (n.length >= 3 && nom.startsWith(n) && opciones.filter((x) => normalizar(x.nombre).startsWith(n)).length === 1) return true
    if ((n === primero || tokens.has(primero)) && opciones.filter((x) => normalizar(x.nombre).split(' ')[0] === primero).length === 1) return true
    if (apellido && (n === apellido || tokens.has(apellido)) && opciones.filter((x) => {
      const ps = normalizar(x.nombre).split(' ')
      return ps.length > 1 && ps[ps.length - 1] === apellido
    }).length === 1) return true
    return false
  })
  return hits.length === 1 ? hits[0] : null
}

export function esEcoAsistente(texto: string, ultimaFrase: string | null): boolean {
  if (contieneWakeWord(texto)) return false
  const n = normalizar(texto)
  if (!n) return true
  if (/\bno te entendi\b/.test(n)) return true
  if (/\bhola soy glowdesk\b/.test(n)) return true
  if (/\bte escucho\b/.test(n)) return true
  if (/\bdi quiero registrar\b/.test(n)) return true
  if (!ultimaFrase) return false
  const u = normalizar(ultimaFrase)
  if (!u) return false
  if (n.length >= 10 && (u.includes(n) || n.includes(u))) return true
  const cabeza = u.slice(0, Math.min(48, u.length))
  return cabeza.length >= 12 && n.includes(cabeza)
}

export function puedeUsarGlowdesk(haySesion: boolean, perfil: { rol: string; activo: boolean; local_id?: string } | null): boolean {
  if (!haySesion || !perfil?.activo) return false
  return perfil.rol === 'admin' || perfil.rol === 'empleada'
}

export function esRespuestaRapida(estado: EstadoGlowdesk, texto: string): boolean {
  if (esEcoAsistente(texto, null)) return false
  if (esComandoCorto(texto) || esAfirmacion(texto) || esNegacion(texto)) return true
  if (elegirOpcion(estado.opciones, texto) != null) return true
  return confirmaLoMismo(texto, estado.profesionalNombre)
    || confirmaLoMismo(texto, estado.servicioNombre)
    || confirmaLoMismo(texto, estado.clienteNombre)
    || confirmaLoMismo(texto, estado.nombre)
}

function arrancarAtencion(): ResultadoTurnoGlowdesk {
  return {
    estado: inicioAtencion(),
    decir: 'Vamos a registrar la atención. ¿Quién fue la clienta?',
    accion: null,
  }
}

export function afinarCandidatosGlowdesk(query: string, candidatos: OpcionGlowdesk[]): OpcionGlowdesk[] {
  const q = normalizar(query)
  if (!q || candidatos.length === 0) return candidatos
  const ranked = candidatos.map((c) => {
    const nom = normalizar(c.nombre)
    const primero = nom.split(' ')[0] ?? ''
    const tokenExacto = primero === q || nom === q || nom.startsWith(`${q} `)
    const puntaje = Math.max(
      similitud(q, nom),
      similitud(q, primero),
      tokenExacto ? 1 : 0,
    )
    return { c, puntaje, tokenExacto }
  }).filter((x) => x.tokenExacto || x.puntaje >= 0.72)
    .sort((a, b) => b.puntaje - a.puntaje)

  const exactos = ranked.filter((x) => x.tokenExacto)
  if (exactos.length === 1) return [exactos[0].c]
  if (exactos.length > 1) return exactos.map((x) => x.c)
  if (ranked.length === 0) return []
  if (ranked.length === 1 || ranked[0].puntaje - (ranked[1]?.puntaje ?? 0) >= 0.12) return [ranked[0].c]
  return ranked.slice(0, 3).map((x) => x.c)
}

export function aplicarCandidatosGlowdesk(
  estado: EstadoGlowdesk,
  tipo: 'cliente' | 'servicio' | 'profesional',
  candidatos: OpcionGlowdesk[],
  query?: string,
): ResultadoTurnoGlowdesk {
  const afinados = query ? afinarCandidatosGlowdesk(query, candidatos) : candidatos
  if (afinados.length === 0) {
    const pregunta = tipo === 'cliente' ? 'Dime el nombre otra vez.' : tipo === 'servicio' ? '¿Qué se hizo?' : '¿Quién se lo hizo?'
    return { estado: { ...estado, opciones: [] }, decir: `No encontré eso. ${pregunta}`, accion: null }
  }
  if (afinados.length === 1) {
    return aplicarOpcionUnica(estado, tipo, afinados[0])
  }
  const recorte = afinados.slice(0, 3)
  return {
    estado: { ...estado, opciones: recorte },
    decir: `Encontré varias. ${listarOpciones(recorte)}`,
    accion: null,
  }
}

function aplicarOpcionUnica(estado: EstadoGlowdesk, tipo: 'cliente' | 'servicio' | 'profesional', op: OpcionGlowdesk, yaElegida = false): ResultadoTurnoGlowdesk {
  if (tipo === 'cliente') {
    if (yaElegida) {
      return { estado: { ...estado, fase: 'atencion_servicio', clienteId: op.id, clienteNombre: op.nombre, opciones: [] }, decir: `Clienta ${op.nombre}. ¿Qué se hizo?`, accion: null }
    }
    return {
      estado: { ...estado, fase: 'atencion_confirmar_cliente', clienteId: op.id, clienteNombre: op.nombre, opciones: [] },
      decir: `¿La clienta es ${op.nombre}?`,
      accion: null,
    }
  }
  if (tipo === 'servicio') {
    if (yaElegida) {
      return { estado: { ...estado, fase: 'atencion_profesional', servicioId: op.id, servicioNombre: op.nombre, precio: op.precio ?? null, opciones: [] }, decir: `Servicio ${op.nombre}. ¿Quién se lo hizo?`, accion: null }
    }
    return {
      estado: { ...estado, fase: 'atencion_confirmar_servicio', servicioId: op.id, servicioNombre: op.nombre, precio: op.precio ?? null, opciones: [] },
      decir: `¿El servicio es ${op.nombre}?`,
      accion: null,
    }
  }
  if (yaElegida) {
    const siguiente: EstadoGlowdesk = { ...estado, fase: 'atencion_confirmar', profesionalId: op.id, profesionalNombre: op.nombre, opciones: [] }
    return { estado: siguiente, decir: `Quedaría ${resumenAtencion(siguiente)}. ¿Lo confirmo?`, accion: null }
  }
  return {
    estado: { ...estado, fase: 'atencion_confirmar_profesional', profesionalId: op.id, profesionalNombre: op.nombre, opciones: [] },
    decir: `¿Se lo hizo ${op.nombre}?`,
    accion: null,
  }
}

export function procesarTurnoGlowdesk(estado: EstadoGlowdesk, textoCrudo: string): ResultadoTurnoGlowdesk {
  const texto = textoCrudo.trim()
  if (!texto) return { estado, decir: null, accion: null }

  if (contieneWakeWord(texto)) {
    const despues = textoTrasWake(texto)
    const pedido = despues && normalizar(despues) !== normalizar(texto) ? despues : texto
    if (esIntentoRegistrarUsuario(pedido) && !contieneWakeWord(pedido)) {
      return { estado: resetAlta('alta_nombre'), decir: 'Clienta. ¿Cómo se llama?', accion: null }
    }
    if (esIntentoRegistrarAtencion(pedido) && !contieneWakeWord(pedido)) {
      return arrancarAtencion()
    }
    return irAlMenu(PREGUNTA_MENU)
  }

  if (estado.fase === 'dormido') return { estado, decir: null, accion: null }

  if (esCancelacion(texto)) return irAlMenu(estado.fase === 'menu' ? PREGUNTA_MENU : 'Cancelé. ¿Atención o clienta?')

  if (estado.fase === 'menu') {
    if (esEcoAsistente(texto, null)) return { estado, decir: null, accion: null }
    if (esIntentoRegistrarAtencion(texto) || esPedidoAtencion(texto)) return arrancarAtencion()
    if (esIntentoRegistrarUsuario(texto) || esPedidoClienta(texto)) {
      return { estado: resetAlta('alta_nombre'), decir: 'Clienta. ¿Cómo se llama?', accion: null }
    }
    if (esRegistrarSuelto(texto)) return irAlMenu(PREGUNTA_MENU)
    return irAlMenu('¿Atención o clienta?')
  }

  const atencion = procesarAtencion(estado, texto)
  if (atencion) return atencion

  if (estado.fase === 'alta_nombre') {
    const telEmbebido = extraerTelefonoHablado(texto)
    const sinTel = esNegacion(texto) && /\b(telefono|numero)\b/.test(normalizar(texto))
    const nombre = extraerNombreHablado(
      texto.replace(/\b(no tiene (telefono|numero)|sin telefono).*$/i, '').replace(/\b(telefono|n[uú]mero).*$/i, ''),
    )
    if (!nombre) {
      return { estado, decir: 'No alcancé el nombre. Dime solo cómo se llama, por favor.', accion: null }
    }
    if (sinTel) {
      const siguiente: EstadoGlowdesk = { ...estado, fase: 'alta_confirmar', nombre, telefono: null, omiteTelefono: true }
      return { estado: siguiente, decir: `Registraré a ${nombre} sin teléfono. ¿Lo confirmo?`, accion: null }
    }
    if (telEmbebido) {
      const siguiente: EstadoGlowdesk = { ...estado, fase: 'alta_confirmar', nombre, telefono: telEmbebido, omiteTelefono: false }
      return { estado: siguiente, decir: `Quedaría ${nombre}, teléfono ${telEmbebido.split('').join(' ')}. ¿Lo confirmo?`, accion: null }
    }
    return { estado: { ...estado, fase: 'alta_confirmar_nombre', nombre }, decir: `¿El nombre es ${nombre}?`, accion: null }
  }

  if (estado.fase === 'alta_confirmar_nombre') {
    if (esNegacion(texto)) {
      return { estado: { ...estado, fase: 'alta_nombre', nombre: null }, decir: 'De acuerdo. Dime el nombre otra vez.', accion: null }
    }
    if (esAfirmacion(texto) || extraerNombreHablado(texto) === estado.nombre) {
      return { estado: { ...estado, fase: 'alta_tiene_telefono' }, decir: '¿Tiene número de teléfono?', accion: null }
    }
    const otro = extraerNombreHablado(texto)
    if (otro && !esAfirmacion(texto)) {
      return { estado: { ...estado, fase: 'alta_confirmar_nombre', nombre: otro }, decir: `¿Entonces es ${otro}?`, accion: null }
    }
    return { estado, decir: `¿Confirmo el nombre ${estado.nombre}? Di sí o no.`, accion: null }
  }

  if (estado.fase === 'alta_tiene_telefono') {
    if (esNegacion(texto)) {
      const siguiente: EstadoGlowdesk = { ...estado, fase: 'alta_confirmar', omiteTelefono: true, telefono: null }
      return { estado: siguiente, decir: `Registraré a ${resumenCliente(siguiente)}. ¿Lo confirmo?`, accion: null }
    }
    const yaNumero = extraerTelefonoHablado(texto)
    if (yaNumero) {
      const siguiente: EstadoGlowdesk = { ...estado, fase: 'alta_confirmar', telefono: yaNumero, omiteTelefono: false }
      return { estado: siguiente, decir: `Quedaría ${resumenCliente(siguiente)}. ¿Lo confirmo?`, accion: null }
    }
    if (esAfirmacion(texto)) {
      return { estado: { ...estado, fase: 'alta_telefono' }, decir: 'Dime el número, dígito por dígito si quieres.', accion: null }
    }
    return { estado, decir: '¿Sí tiene teléfono, o no tiene?', accion: null }
  }

  if (estado.fase === 'alta_telefono') {
    if (esNegacion(texto)) {
      const siguiente: EstadoGlowdesk = { ...estado, fase: 'alta_confirmar', omiteTelefono: true, telefono: null }
      return { estado: siguiente, decir: `Sin teléfono, entonces. Registraré a ${resumenCliente(siguiente)}. ¿Lo confirmo?`, accion: null }
    }
    const tel = extraerTelefonoHablado(texto)
    if (!tel) return { estado, decir: 'No entendí el número. Repítelo, por favor.', accion: null }
    const siguiente: EstadoGlowdesk = { ...estado, fase: 'alta_confirmar', telefono: tel, omiteTelefono: false }
    return { estado: siguiente, decir: `El teléfono es ${tel.split('').join(' ')}. Registraré a ${resumenCliente(siguiente)}. ¿Lo confirmo?`, accion: null }
  }

  if (estado.fase === 'alta_confirmar') {
    if (esNegacion(texto)) {
      return { estado: resetAlta('alta_nombre'), decir: 'Está bien, empecemos de nuevo. ¿Cómo se llama?', accion: null }
    }
    if (!esAfirmacion(texto)) return { estado, decir: 'Di sí para guardar, o no para empezar de nuevo.', accion: null }
    if (!estado.nombre) return { estado: resetAlta('alta_nombre'), decir: 'Me falta el nombre. ¿Cómo se llama?', accion: null }
    return {
      estado: estadoMenuGlowdesk(),
      decir: `Listo. ${estado.nombre} ya quedó registrada. ¿Algo más?`,
      accion: { tipo: 'crear_cliente', nombre: estado.nombre, telefono: estado.omiteTelefono ? null : estado.telefono },
    }
  }

  return { estado, decir: null, accion: null }
}

function procesarAtencion(estado: EstadoGlowdesk, texto: string): ResultadoTurnoGlowdesk | null {
  if (estado.fase === 'atencion_cliente') {
    const elegida = elegirOpcion(estado.opciones, texto)
    if (elegida) return aplicarOpcionUnica(estado, 'cliente', elegida, true)
    const query = extraerNombreHablado(texto)
    if (!query) return { estado, decir: '¿Quién fue la clienta? Dime el nombre.', accion: null }
    return { estado, decir: null, accion: { tipo: 'buscar_cliente', query } }
  }

  if (estado.fase === 'atencion_confirmar_cliente') {
    if (esNegacion(texto)) {
      return { estado: { ...estado, fase: 'atencion_cliente', clienteId: null, clienteNombre: null }, decir: 'De acuerdo. ¿Quién fue la clienta?', accion: null }
    }
    if (confirmaLoMismo(texto, estado.clienteNombre)) {
      return { estado: { ...estado, fase: 'atencion_servicio' }, decir: '¿Qué se hizo?', accion: null }
    }
    return { estado, decir: `¿Confirmo a ${estado.clienteNombre}? Di sí o no.`, accion: null }
  }

  if (estado.fase === 'atencion_servicio') {
    const elegida = elegirOpcion(estado.opciones, texto)
    if (elegida) return aplicarOpcionUnica(estado, 'servicio', elegida, true)
    const query = extraerNombreHablado(texto)
    if (!query) return { estado, decir: '¿Qué se hizo? Dime el servicio.', accion: null }
    return { estado, decir: null, accion: { tipo: 'buscar_servicio', query } }
  }

  if (estado.fase === 'atencion_confirmar_servicio') {
    if (esNegacion(texto)) {
      return { estado: { ...estado, fase: 'atencion_servicio', servicioId: null, servicioNombre: null, precio: null }, decir: '¿Qué se hizo?', accion: null }
    }
    if (confirmaLoMismo(texto, estado.servicioNombre)) {
      return { estado: { ...estado, fase: 'atencion_profesional' }, decir: '¿Quién se lo hizo?', accion: null }
    }
    return { estado, decir: `¿Confirmo el servicio ${estado.servicioNombre}? Di sí o no.`, accion: null }
  }

  if (estado.fase === 'atencion_profesional') {
    const elegida = elegirOpcion(estado.opciones, texto)
    if (elegida) return aplicarOpcionUnica(estado, 'profesional', elegida, true)
    const query = extraerNombreHablado(texto)
    if (!query) return { estado, decir: '¿Quién se lo hizo? Dime el nombre.', accion: null }
    return { estado, decir: null, accion: { tipo: 'buscar_profesional', query } }
  }

  if (estado.fase === 'atencion_confirmar_profesional') {
    if (esNegacion(texto)) {
      return { estado: { ...estado, fase: 'atencion_profesional', profesionalId: null, profesionalNombre: null }, decir: '¿Quién se lo hizo?', accion: null }
    }
    if (confirmaLoMismo(texto, estado.profesionalNombre)) {
      return {
        estado: { ...estado, fase: 'atencion_confirmar' },
        decir: `Quedaría ${resumenAtencion(estado)}. ¿Lo confirmo?`,
        accion: null,
      }
    }
    return { estado, decir: `¿Confirmo a ${estado.profesionalNombre}? Di sí o no.`, accion: null }
  }

  if (estado.fase === 'atencion_confirmar') {
    if (esNegacion(texto)) return arrancarAtencion()
    if (!esAfirmacion(texto) && !confirmaLoMismo(texto, estado.profesionalNombre) && !confirmaLoMismo(texto, estado.servicioNombre)) {
      return { estado, decir: 'Di sí para guardar la atención, o no para empezar de nuevo.', accion: null }
    }
    if (!estado.clienteId || !estado.servicioId || !estado.profesionalId) {
      return arrancarAtencion()
    }
    const precio = estado.precio ?? 0
    return {
      estado: { ...estado, fase: 'atencion_cobrar', precio },
      decir: `Atención registrada. El total es ${Math.round(precio)} pesos. ¿Lo cobramos ahora en efectivo?`,
      accion: {
        tipo: 'registrar_atencion',
        clienteId: estado.clienteId,
        servicioId: estado.servicioId,
        profesionalId: estado.profesionalId,
        precio,
      },
    }
  }

  if (estado.fase === 'atencion_cobrar') {
    if (esNegacion(texto)) {
      return { estado: estadoMenuGlowdesk(), decir: 'Quedó registrada sin cobrar. ¿Algo más?', accion: null }
    }
    if (!esAfirmacion(texto)) return { estado, decir: '¿Lo cobramos ahora en efectivo? Di sí o no.', accion: null }
    return {
      estado: estadoMenuGlowdesk(),
      decir: 'Listo, cobrada en efectivo. ¿Algo más?',
      accion: { tipo: 'cobrar_atencion', precio: estado.precio ?? 0 },
    }
  }

  return null
}
