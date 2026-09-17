// Datos de DEMOSTRACIÓN. Todos los IDs empiezan con "demo-" a propósito para que
// nunca se puedan confundir con datos reales de Supabase (que usan uuid v4).
// Ver docs/07-plan-implementacion.md.
import type {
  Atencion,
  CategoriaServicio,
  Cliente,
  ClienteResumen,
  ComisionResumen,
  MovimientoPuntos,
  Profesional,
  Promocion,
  Reserva,
  Servicio,
} from './types'

const hoy = new Date()
function enHoras(h: number) {
  const d = new Date(hoy)
  d.setHours(d.getHours() + h, 0, 0, 0)
  return d.toISOString()
}

export const demoCategorias: CategoriaServicio[] = [
  { id: 'demo-cat-cabello', nombre: 'Cabello', orden_visualizacion: 1, activa: true },
  { id: 'demo-cat-estetica', nombre: 'Estética', orden_visualizacion: 2, activa: true },
  { id: 'demo-cat-cejas', nombre: 'Cejas y maquillaje', orden_visualizacion: 3, activa: true },
  { id: 'demo-cat-unas', nombre: 'Manicura y pedicura', orden_visualizacion: 4, activa: true },
]

export const demoProfesionales: Profesional[] = [
  {
    id: 'demo-prof-claudia',
    slug: 'claudia',
    nombre: 'Claudia',
    especialidades: ['Color', 'Cortes'],
    bio: '[DEMO] Fundadora del salón, más de 15 años de experiencia en color y cortes.',
    foto_url: null,
    activo: true,
  },
  {
    id: 'demo-prof-naldi',
    slug: 'naldi',
    nombre: 'Naldi',
    especialidades: ['Tratamientos capilares', 'Alisados'],
    bio: '[DEMO] Especialista en tratamientos de recuperación capilar.',
    foto_url: null,
    activo: true,
  },
  {
    id: 'demo-prof-ana',
    slug: 'ana',
    nombre: 'Ana',
    especialidades: ['Cejas', 'Maquillaje'],
    bio: '[DEMO] Diseño de cejas y maquillaje social y de novias.',
    foto_url: null,
    activo: true,
  },
  {
    id: 'demo-prof-valery',
    slug: 'valery',
    nombre: 'Valery',
    especialidades: ['Manicura', 'Pedicura'],
    bio: '[DEMO] Manicura y pedicura spa.',
    foto_url: null,
    activo: true,
  },
]

export const demoServicios: Servicio[] = [
  {
    id: 'demo-serv-corte',
    categoria_id: 'demo-cat-cabello',
    categoria_nombre: 'Cabello',
    nombre: 'Corte de dama',
    descripcion: '[DEMO] Corte y asesoría de imagen.',
    imagen_url: null,
    duracion_minutos: 60,
    tipo_precio: 'fijo',
    precio: 45000,
    activo: true,
    profesionales: [demoProfesionales[0], demoProfesionales[1]],
  },
  {
    id: 'demo-serv-color',
    categoria_id: 'demo-cat-cabello',
    categoria_nombre: 'Cabello',
    nombre: 'Color y tinte',
    descripcion: '[DEMO] El valor final depende del largo y la técnica.',
    imagen_url: null,
    duracion_minutos: 120,
    tipo_precio: 'desde',
    precio: 120000,
    activo: true,
    profesionales: [demoProfesionales[0]],
  },
  {
    id: 'demo-serv-alisado',
    categoria_id: 'demo-cat-cabello',
    categoria_nombre: 'Cabello',
    nombre: 'Alisado / tratamiento capilar',
    descripcion: '[DEMO] Se valora en salón según diagnóstico capilar.',
    imagen_url: null,
    duracion_minutos: 150,
    tipo_precio: 'a_valorar',
    precio: null,
    activo: true,
    profesionales: [demoProfesionales[1]],
  },
  {
    id: 'demo-serv-cejas',
    categoria_id: 'demo-cat-cejas',
    categoria_nombre: 'Cejas y maquillaje',
    nombre: 'Diseño de cejas',
    descripcion: '[DEMO] Perfilado y diseño con henna opcional.',
    imagen_url: null,
    duracion_minutos: 30,
    tipo_precio: 'fijo',
    precio: 25000,
    activo: true,
    profesionales: [demoProfesionales[2]],
  },
  {
    id: 'demo-serv-manicura',
    categoria_id: 'demo-cat-unas',
    categoria_nombre: 'Manicura y pedicura',
    nombre: 'Manicura clásica',
    descripcion: '[DEMO] Manicura con esmaltado tradicional.',
    imagen_url: null,
    duracion_minutos: 45,
    tipo_precio: 'fijo',
    precio: 30000,
    activo: true,
    profesionales: [demoProfesionales[3]],
  },
]

export const demoPromociones: Promocion[] = [
  {
    id: 'demo-promo-cejas',
    nombre: 'Martes de cejas [DEMO]',
    descripcion: 'Diseño de cejas con 20% de descuento todos los martes.',
    condiciones: 'Válido solo los martes, no acumulable.',
    vigente_desde: enHoras(-24 * 10),
    vigente_hasta: enHoras(24 * 30),
    tipo_descuento: 'porcentaje',
    valor: 20,
    servicios: ['demo-serv-cejas'],
  },
]

export const demoClienteActual: Cliente = {
  id: 'demo-cliente-1',
  usuario_id: 'demo-usuario-cliente',
  nombre: 'Cliente Demo',
  telefono: '3000000000',
  email: 'demo@example.com',
  consentimiento_marketing: false,
  visitas_completadas: 3,
  gasto_acumulado: 245000,
  activo: true,
  origen_registro: 'admin',
  notas: null,
  resena_google_confirmada: false,
  creado_en: enHoras(-720),
}

export const demoReservasCliente: Reserva[] = [
  {
    id: 'demo-reserva-1',
    cliente_id: 'demo-cliente-1',
    servicio_id: 'demo-serv-corte',
    servicio_nombre: 'Corte de dama',
    profesional_id: 'demo-prof-claudia',
    profesional_nombre: 'Claudia',
    rango_inicio: enHoras(26),
    rango_fin: enHoras(27),
    precio_estimado: 45000,
    estado: 'confirmada',
    origen: 'cliente',
    notas: null,
  },
  {
    id: 'demo-reserva-2',
    cliente_id: 'demo-cliente-1',
    servicio_id: 'demo-serv-manicura',
    servicio_nombre: 'Manicura clásica',
    profesional_id: 'demo-prof-valery',
    profesional_nombre: 'Valery',
    rango_inicio: enHoras(-48),
    rango_fin: enHoras(-47),
    precio_estimado: 30000,
    estado: 'completada',
    origen: 'cliente',
    notas: null,
  },
  {
    id: 'demo-reserva-3',
    cliente_id: 'demo-cliente-1',
    servicio_id: 'demo-serv-cejas',
    servicio_nombre: 'Diseño de cejas',
    profesional_id: 'demo-prof-ana',
    profesional_nombre: 'Ana',
    rango_inicio: enHoras(-100),
    rango_fin: enHoras(-99.5),
    precio_estimado: 25000,
    estado: 'cancelada',
    origen: 'cliente',
    notas: null,
  },
]

export const demoHistorialAtenciones: Atencion[] = [
  {
    id: 'demo-atencion-1',
    reserva_id: 'demo-reserva-2',
    cliente_id: 'demo-cliente-1',
    estado: 'completada',
    notas: null,
    creado_en: enHoras(-47),
    completado_en: enHoras(-47),
    lineas: [
      {
        id: 'demo-linea-1',
        servicio_id: 'demo-serv-manicura',
        nombre_snapshot: 'Manicura clásica',
        precio_snapshot: 30000,
        descuento: 0,
        cantidad: 1,
        profesional_id: 'demo-prof-valery',
        profesional_nombre: 'Valery',
      },
    ],
    total_pagado: 30000,
    total_vendido: 30000,
  },
]

// Producto de ejemplo para que el panel admin de Ventas (modo demostración) también muestre
// cómo se ve la tabla de productos vendidos.
export const demoProductosVenta = [
  {
    id: 'demo-prod-1',
    fecha: enHoras(-47),
    clienteNombre: 'Cliente Demo',
    categoria: 'Tratamiento',
    nombre: 'Aceite de cutícula',
    cantidad: 1,
    precioUnitario: 12000,
    subtotal: 12000,
  },
]

export const demoMovimientosPuntos: MovimientoPuntos[] = [
  {
    id: 'demo-mov-1',
    cliente_id: 'demo-cliente-1',
    tipo: 'abono',
    puntos: 600,
    referencia_tipo: 'atencion',
    referencia_id: 'demo-atencion-1',
    motivo: null,
    creado_en: enHoras(-47),
  },
]

// --- Portal de empleadas (demo: sesión como Naldi) ---

export const demoReservasAgendaEmpleada: Reserva[] = [
  {
    id: 'demo-reserva-e1',
    cliente_id: 'demo-cliente-2',
    cliente_nombre: 'Valentina Gómez',
    servicio_id: 'demo-serv-alisado',
    servicio_nombre: 'Tratamiento capilar',
    profesional_id: 'demo-prof-naldi',
    profesional_nombre: 'Naldi',
    rango_inicio: enHoras(1),
    rango_fin: enHoras(3.5),
    precio_estimado: null,
    estado: 'confirmada',
    origen: 'cliente',
    notas: null,
  },
  {
    id: 'demo-reserva-e2',
    cliente_id: 'demo-cliente-3',
    cliente_nombre: 'Daniela Restrepo',
    servicio_id: 'demo-serv-corte',
    servicio_nombre: 'Corte de dama',
    profesional_id: 'demo-prof-naldi',
    profesional_nombre: 'Naldi',
    rango_inicio: enHoras(-2),
    rango_fin: enHoras(-1),
    precio_estimado: 45000,
    estado: 'completada',
    origen: 'cliente',
    notas: null,
  },
]

export const demoComisionesEmpleada: ComisionResumen[] = [
  {
    id: 'demo-com-1',
    atencion_servicio_id: 'demo-linea-e2',
    base_calculo: 45000,
    valor: 18000,
    estado: 'generada',
    creado_en: enHoras(-1),
    servicio_nombre: 'Corte de dama',
    cliente_nombre: 'Daniela Restrepo',
  },
]

// --- Dashboard admin ---

export const demoResumenNegocio = {
  ventasNetas: 3250000,
  cobros: 3100000,
  citasCompletadas: 42,
  clientesNuevos: 7,
  clientesRecurrentes: 28,
  ticketPromedio: 77380,
  cancelaciones: 3,
  inasistencias: 1,
  comisionesGeneradas: 1200000,
  comisionesPendientes: 450000,
}

// Desglose de ventas para las gráficas de pastel del Dashboard (modo demostración): el único
// historial real (demoHistorialAtenciones) trae una sola línea, muy poco para mostrar cómo se
// ven las gráficas, así que aquí se arma un desglose de ejemplo aparte, coherente con
// demoResumenNegocio.ventasNetas pero sin pretender ser la misma atención.
export const demoMetricasVentas = {
  ventasPorProfesional: [
    { etiqueta: 'Claudia', valor: 1180000 },
    { etiqueta: 'Naldi', valor: 850000 },
    { etiqueta: 'Ana', valor: 640000 },
    { etiqueta: 'Valery', valor: 580000 },
  ],
  ventasPorServicio: [
    { etiqueta: 'Color', valor: 900000 },
    { etiqueta: 'Corte de dama', valor: 620000 },
    { etiqueta: 'Tratamiento capilar', valor: 540000 },
    { etiqueta: 'Diseño de cejas', valor: 420000 },
    { etiqueta: 'Manicura clásica', valor: 380000 },
    { etiqueta: 'Otros', valor: 390000 },
  ],
  ventasPorMetodoPago: [
    { etiqueta: 'Transferencia', valor: 1450000 },
    { etiqueta: 'Efectivo', valor: 980000 },
    { etiqueta: 'Tarjeta', valor: 670000 },
  ],
}

export const demoClientesAdmin: ClienteResumen[] = [
  { ...demoClienteActual, ultima_visita: '2026-09-10T15:00:00Z', ultimo_servicio_nombre: 'Corte de dama', ultimo_profesional_nombre: 'Naldi' },
  {
    id: 'demo-cliente-2',
    usuario_id: null,
    nombre: 'Valentina Gómez',
    telefono: '3001112233',
    email: null,
    consentimiento_marketing: false,
    visitas_completadas: 5,
    gasto_acumulado: 380000,
    activo: true,
    origen_registro: 'admin',
    notas: null,
    resena_google_confirmada: true,
    creado_en: enHoras(-2000),
    ultima_visita: '2026-08-20T18:00:00Z',
    ultimo_servicio_nombre: 'Color y tinte',
    ultimo_profesional_nombre: 'Claudia',
  },
  {
    id: 'demo-cliente-3',
    usuario_id: null,
    nombre: 'Daniela Restrepo',
    telefono: '3004445566',
    email: null,
    consentimiento_marketing: true,
    visitas_completadas: 2,
    gasto_acumulado: 95000,
    activo: true,
    origen_registro: 'publico',
    notas: null,
    resena_google_confirmada: false,
    creado_en: enHoras(-900),
    ultima_visita: null,
    ultimo_servicio_nombre: null,
    ultimo_profesional_nombre: null,
  },
  {
    id: 'demo-cliente-4',
    usuario_id: null,
    nombre: 'Penny Ríos',
    telefono: '3009998877',
    email: null,
    consentimiento_marketing: false,
    visitas_completadas: 0,
    gasto_acumulado: 0,
    activo: true,
    origen_registro: 'admin',
    notas: null,
    resena_google_confirmada: false,
    creado_en: enHoras(-1),
    ultima_visita: null,
    ultimo_servicio_nombre: null,
    ultimo_profesional_nombre: null,
  },
]

export const demoEquipoResumen = demoProfesionales.map((p, i) => ({
  ...p,
  ventasDelMes: [1450000, 980000, 620000, 540000][i],
  comisionPendiente: [180000, 120000, 90000, 60000][i],
}))
