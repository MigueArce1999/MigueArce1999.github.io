import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { Drawer, Modal } from '../../components/ui/Modal'
import { isDemoMode, supabase, supabaseRequerido } from '../../lib/supabase'
import {
  actualizarNombreProfesional,
  eliminarEmpleada,
  eliminarExcepcionComision,
  eliminarProfesionalDefinitivo,
  guardarComisionBase,
  guardarExcepcionComision,
  invitarEmpleada,
  listarEquipoConRendimiento,
  listarReglasComision,
} from '../../lib/api/admin'
import { fijarPermisoHorarioPropio, tienePermisoHorarioPropio } from '../../lib/api/agenda'
import { listarServicios } from '../../lib/api/catalogo'
import { formatoMoneda } from '../../lib/format'
import type { Profesional, ReglaComision, Servicio } from '../../lib/types'

// Acepta 0-100, hasta dos decimales ("50", "50.5", "50.55"); rechaza vacío, negativos, >100,
// más de dos decimales o cualquier otro texto que no sea un número.
function validarPorcentaje(texto: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(texto.trim())) return null
  const n = Number(texto)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100) / 100
}

export function AdminEquipo() {
  const [equipo, setEquipo] = useState<Profesional[] | null>(null)
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [error, setError] = useState<string | null>(null)
  const [panelAbierto, setPanelAbierto] = useState<Profesional | null>(null)
  const [modalNueva, setModalNueva] = useState(false)

  function recargar() {
    listarEquipoConRendimiento().then(setEquipo as any).catch((e) => setError(e.message))
    listarServicios().then(setServicios)
  }

  useEffect(recargar, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Equipo</h1>
        <Button tamano="sm" onClick={() => setModalNueva(true)}>+ Invitar empleada</Button>
      </div>
      <p className="text-sm text-carbon/60">
        Horarios y reglas de comisión se configuran por separado (comisiones en /admin/comisiones). Ninguno
        de estos datos se asume: Claudia, Naldi, Ana y Valery aparecen aquí solo cuando su cuenta y perfil existan.
      </p>

      {error && <ErrorState mensaje={error} />}
      {!equipo ? (
        <Cargando />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {equipo.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-piedra font-marca text-oliva">{p.nombre?.charAt(0)}</div>
                <div>
                  <p className="font-semibold text-carbon">{p.nombre}</p>
                  <p className="text-xs text-carbon/60">{(p.especialidades ?? []).join(', ') || 'Sin especialidades configuradas'}</p>
                </div>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${p.activo ? 'bg-exito/15 text-exito' : 'bg-carbon/10 text-carbon/60'}`}>
                  {p.activo ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <button onClick={() => setPanelAbierto(p)} className="mt-1 self-start text-xs font-semibold text-oliva underline underline-offset-2">
                Editar perfil y servicios
              </button>
            </Card>
          ))}
        </div>
      )}

      <Drawer abierto={panelAbierto !== null} onCerrar={() => setPanelAbierto(null)} titulo="Editar profesional">
        {panelAbierto && (
          <FormularioProfesional
            profesional={panelAbierto}
            servicios={servicios}
            onGuardado={() => {
              setPanelAbierto(null)
              recargar()
            }}
          />
        )}
      </Drawer>

      <Modal abierto={modalNueva} onCerrar={() => setModalNueva(false)} titulo="Invitar empleada">
        <InvitarEmpleada
          onCreada={() => {
            recargar()
          }}
        />
      </Modal>
    </div>
  )
}

function FormularioProfesional({
  profesional,
  servicios,
  onGuardado,
}: {
  profesional: Profesional
  servicios: Servicio[]
  onGuardado: () => void
}) {
  const [nombre, setNombre] = useState(profesional.nombre ?? '')
  const [bio, setBio] = useState(profesional.bio ?? '')
  const [especialidades, setEspecialidades] = useState((profesional.especialidades ?? []).join(', '))
  const [fotoUrl, setFotoUrl] = useState(profesional.foto_url ?? '')
  const [activo, setActivo] = useState(profesional.activo)
  const [puedeHorario, setPuedeHorario] = useState(false)
  const [serviciosAsignados, setServiciosAsignados] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null)
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode) return
    supabase!
      .from('servicio_profesional')
      .select('servicio_id')
      .eq('profesional_id', profesional.id)
      .then(({ data }) => setServiciosAsignados(new Set((data ?? []).map((r: any) => r.servicio_id))))
    tienePermisoHorarioPropio(profesional.id).then(setPuedeHorario)
  }, [profesional.id])

  function alternarServicio(id: string) {
    setServiciosAsignados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (isDemoMode) { onGuardado(); return }
    setGuardando(true)
    setError(null)
    try {
      const client = supabaseRequerido()
      if (nombre.trim() && nombre.trim() !== profesional.nombre) {
        await actualizarNombreProfesional(profesional.id, nombre.trim())
      }
      await fijarPermisoHorarioPropio(profesional.id, puedeHorario)
      const { error: err1 } = await client
        .from('profesional')
        .update({
          bio: bio || null,
          foto_url: fotoUrl || null,
          activo,
          especialidades: especialidades.split(',').map((s) => s.trim()).filter(Boolean),
        })
        .eq('id', profesional.id)
      if (err1) throw err1

      // Reemplaza el conjunto de servicios asignados: borra y vuelve a insertar la selección actual.
      const { error: errDel } = await client.from('servicio_profesional').delete().eq('profesional_id', profesional.id)
      if (errDel) throw errDel
      if (serviciosAsignados.size > 0) {
        const filas = Array.from(serviciosAsignados).map((servicio_id) => ({ servicio_id, profesional_id: profesional.id }))
        const { error: errIns } = await client.from('servicio_profesional').insert(filas)
        if (errIns) throw errIns
      }
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    setEliminando(true)
    setErrorEliminar(null)
    try {
      await eliminarEmpleada(profesional.id)
      onGuardado()
    } catch (e: any) {
      setErrorEliminar(e.message)
      setEliminando(false)
    }
  }

  async function borrar() {
    setBorrando(true)
    setErrorBorrar(null)
    try {
      await eliminarProfesionalDefinitivo(profesional.id)
      onGuardado()
    } catch (e: any) {
      setErrorBorrar(e.message)
      setBorrando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      <Input id="nombre" etiqueta="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Textarea id="bio" etiqueta="Presentación" value={bio} onChange={(e) => setBio(e.target.value)} />
      <Input
        id="especialidades"
        etiqueta="Especialidades (separadas por coma)"
        value={especialidades}
        onChange={(e) => setEspecialidades(e.target.value)}
        placeholder="Color, Cortes"
      />
      <Input id="fotoUrl" etiqueta="URL de foto (opcional)" value={fotoUrl} onChange={(e) => setFotoUrl(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-carbon">
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        Visible en el sitio público y disponible para nuevas reservas
      </label>
      <label className="flex items-center gap-2 text-sm text-carbon">
        <input type="checkbox" checked={puedeHorario} onChange={(e) => setPuedeHorario(e.target.checked)} />
        Puede editar su propio horario y ausencias sin aprobación (si no, sus cambios quedan como solicitud pendiente)
      </label>

      <div>
        <p className="mb-2 text-sm font-semibold text-carbon">Servicios que realiza</p>
        <div className="flex flex-col gap-1.5 rounded-lg border border-piedra p-3">
          {servicios.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-carbon">
              <input type="checkbox" checked={serviciosAsignados.has(s.id)} onChange={() => alternarServicio(s.id)} />
              {s.nombre}
            </label>
          ))}
        </div>
      </div>

      <Button type="submit" cargando={guardando}>Guardar cambios</Button>

      <SeccionComisiones profesionalId={profesional.id} servicios={servicios} />

      <div className="mt-2 rounded-lg border border-error/30 bg-error/5 p-3">
        <p className="mb-1 text-sm font-semibold text-error">Eliminar empleada</p>
        <p className="mb-3 text-xs text-carbon/60">
          Le quita el acceso a su portal de empleada (vuelve a ser una cuenta de clienta normal) y la
          oculta del sitio público. No borra sus ventas, comisiones ni atenciones ya registradas: esa
          información sigue intacta en los reportes.
        </p>
        {errorEliminar && <div className="mb-2"><ErrorState mensaje={errorEliminar} /></div>}
        {!confirmandoEliminar ? (
          <Button type="button" variante="danger" tamano="sm" onClick={() => setConfirmandoEliminar(true)}>
            Eliminar empleada
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-carbon">¿Eliminar a {profesional.nombre}?</span>
            <Button type="button" variante="danger" tamano="sm" cargando={eliminando} onClick={eliminar}>
              Sí, eliminar
            </Button>
            <Button type="button" variante="secondary" tamano="sm" onClick={() => setConfirmandoEliminar(false)} disabled={eliminando}>
              Cancelar
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-error/30 bg-error/5 p-3">
        <p className="mb-1 text-sm font-semibold text-error">Borrar definitivamente</p>
        <p className="mb-3 text-xs text-carbon/60">
          Borra por completo la fila de esta empleada (a diferencia de "Eliminar empleada", que solo la
          desactiva). Solo funciona si nunca tuvo ventas, comisiones ni liquidaciones registradas — úsalo
          para cuentas de prueba o duplicadas, no para empleadas reales.
        </p>
        {errorBorrar && <div className="mb-2"><ErrorState mensaje={errorBorrar} /></div>}
        {!confirmandoBorrar ? (
          <Button type="button" variante="danger" tamano="sm" onClick={() => setConfirmandoBorrar(true)}>
            Borrar definitivamente
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-carbon">¿Borrar a {profesional.nombre} para siempre?</span>
            <Button type="button" variante="danger" tamano="sm" cargando={borrando} onClick={borrar}>
              Sí, borrar
            </Button>
            <Button type="button" variante="secondary" tamano="sm" onClick={() => setConfirmandoBorrar(false)} disabled={borrando}>
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </form>
  )
}

// Equipo → Editar perfil y servicios → Comisiones: comisión base de la profesional más sus
// excepciones por servicio (regla_comision.servicio_id null vs. específico — ver
// supabase/migrations/0006_comisiones_liquidaciones.sql y 0023). La misma prioridad
// (excepción > base) ya la resuelve fn_completar_y_cobrar_atencion al cobrar; esta sección
// solo administra esas filas.
function SeccionComisiones({ profesionalId, servicios }: { profesionalId: string; servicios: Servicio[] }) {
  const [reglas, setReglas] = useState<ReglaComision[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function recargar() {
    if (isDemoMode) { setReglas([]); return }
    listarReglasComision(profesionalId).then(setReglas).catch((e) => setError(e.message))
  }

  useEffect(recargar, [profesionalId])

  const base = reglas?.find((r) => r.servicioId === null) ?? null
  const excepciones = reglas?.filter((r) => r.servicioId !== null) ?? []

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-piedra p-3">
      <p className="text-sm font-semibold text-carbon">Comisiones</p>
      {error && <ErrorState mensaje={error} />}
      {!reglas ? (
        <Cargando filas={2} />
      ) : (
        <>
          <ComisionBase profesionalId={profesionalId} regla={base} onGuardado={recargar} />
          <div className="border-t border-piedra/60 pt-3">
            <ComisionesEspeciales profesionalId={profesionalId} servicios={servicios} excepciones={excepciones} onCambio={recargar} />
          </div>
        </>
      )}
    </div>
  )
}

function ComisionBase({
  profesionalId,
  regla,
  onGuardado,
}: {
  profesionalId: string
  regla: ReglaComision | null
  onGuardado: () => void
}) {
  const [valor, setValor] = useState(regla ? String(regla.valor) : '')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(false)

  useEffect(() => {
    setValor(regla ? String(regla.valor) : '')
  }, [regla?.id])

  async function guardar() {
    setError(null)
    setExito(false)
    const n = validarPorcentaje(valor)
    if (n === null) { setError('Ingresa un porcentaje entre 0 y 100, con hasta dos decimales.'); return }
    setGuardando(true)
    try {
      await guardarComisionBase(profesionalId, n)
      setExito(true)
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-semibold text-carbon">Comisión base</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className={`flex items-center rounded-lg border bg-blanco px-2.5 ${error ? 'border-error' : 'border-piedra'}`}>
          <input
            value={valor}
            onChange={(e) => { setValor(e.target.value); setExito(false) }}
            placeholder="50"
            inputMode="decimal"
            aria-label="Comisión base"
            className="w-16 bg-transparent py-2 text-right text-sm text-carbon outline-none"
          />
          <span className="select-none pl-1 text-sm text-carbon/50" aria-hidden>%</span>
        </div>
        <Button type="button" tamano="sm" onClick={guardar} cargando={guardando}>Guardar</Button>
      </div>
      {error && <p className="text-xs font-medium text-error">{error}</p>}
      {exito && <p className="text-xs font-medium text-exito">Comisión base actualizada.</p>}
      <p className="text-xs text-carbon/50">Se aplica a los servicios que no tienen una comisión especial.</p>
      {!regla && (
        <p className="text-xs text-advertencia">
          Sin comisión base configurada todavía: no se generará comisión en los servicios sin excepción hasta que definas una.
        </p>
      )}
      {regla?.tipo === 'fijo' && (
        <p className="text-xs text-carbon/50">
          Actualmente tiene un valor fijo configurado ({formatoMoneda(regla.valor)} por servicio); guardar aquí lo reemplaza por un porcentaje.
        </p>
      )}
    </div>
  )
}

function ComisionesEspeciales({
  profesionalId,
  servicios,
  excepciones,
  onCambio,
}: {
  profesionalId: string
  servicios: Servicio[]
  excepciones: ReglaComision[]
  onCambio: () => void
}) {
  const [formAbierto, setFormAbierto] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const serviciosDisponibles = servicios.filter((s) => !excepciones.some((e) => e.servicioId === s.id))

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-carbon">Comisiones especiales</p>
      <p className="text-xs text-carbon/50">Las comisiones especiales reemplazan la comisión base únicamente para el servicio seleccionado.</p>
      {mensaje && <p className="rounded-lg bg-piedra/30 px-3 py-2 text-xs text-carbon/70">{mensaje}</p>}
      {excepciones.length === 0 ? (
        <p className="text-sm text-carbon/60">Esta profesional recibe su comisión base en todos los servicios.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-piedra">
          <table className="w-full text-sm">
            <thead className="bg-piedra/30 text-left text-xs uppercase tracking-wide text-carbon/50">
              <tr>
                <th className="px-3 py-2">Servicio</th>
                <th className="px-3 py-2 text-right">Comisión</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {excepciones.map((r) => (
                <FilaExcepcion
                  key={r.id}
                  regla={r}
                  profesionalId={profesionalId}
                  onCambio={onCambio}
                  onEliminada={(nombre) => setMensaje(`Las nuevas atenciones de "${nombre}" usarán la comisión base.`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {formAbierto ? (
        <FormularioExcepcion
          profesionalId={profesionalId}
          servicios={serviciosDisponibles}
          onGuardado={() => { setFormAbierto(false); setMensaje(null); onCambio() }}
          onCancelar={() => setFormAbierto(false)}
        />
      ) : serviciosDisponibles.length === 0 ? (
        <p className="text-xs text-carbon/50">Ya hay una excepción configurada para todos los servicios.</p>
      ) : (
        <button type="button" onClick={() => setFormAbierto(true)} className="self-start text-sm font-semibold text-oliva hover:underline">
          + Añadir excepción por servicio
        </button>
      )}
    </div>
  )
}

function FilaExcepcion({
  regla,
  profesionalId,
  onCambio,
  onEliminada,
}: {
  regla: ReglaComision
  profesionalId: string
  onCambio: () => void
  onEliminada: (nombreServicio: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(String(regla.valor))
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false)
  const [eliminando, setEliminando] = useState(false)

  async function guardar() {
    setError(null)
    const n = validarPorcentaje(valor)
    if (n === null) { setError('Ingresa un porcentaje entre 0 y 100, con hasta dos decimales.'); return }
    setGuardando(true)
    try {
      await guardarExcepcionComision(profesionalId, regla.servicioId!, n)
      setEditando(false)
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    setEliminando(true)
    try {
      await eliminarExcepcionComision(profesionalId, regla.servicioId!)
      onEliminada(regla.servicioNombre ?? 'este servicio')
      onCambio()
    } catch (e: any) {
      setError(e.message)
      setEliminando(false)
    }
  }

  if (editando) {
    return (
      <tr className="border-t border-piedra/60">
        <td className="px-3 py-2 text-carbon">{regla.servicioNombre}</td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              aria-label={`Comisión especial para ${regla.servicioNombre}`}
              className={`w-16 rounded border px-2 py-1 text-right text-sm ${error ? 'border-error' : 'border-piedra'}`}
            />
            <span className="text-sm text-carbon/60" aria-hidden>%</span>
          </div>
          {error && <p className="text-right text-xs font-medium text-error">{error}</p>}
        </td>
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-3">
            <button type="button" onClick={guardar} disabled={guardando} className="text-xs font-semibold text-oliva hover:underline">Guardar</button>
            <button
              type="button"
              onClick={() => { setEditando(false); setValor(String(regla.valor)); setError(null) }}
              className="text-xs text-carbon/50 hover:underline"
            >
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t border-piedra/60">
      <td className="px-3 py-2 text-carbon">{regla.servicioNombre}</td>
      <td className="px-3 py-2 text-right font-semibold text-carbon">{regla.valor}%</td>
      <td className="px-3 py-2 text-right">
        {confirmandoEliminar ? (
          <div className="flex justify-end gap-3">
            <button type="button" onClick={eliminar} disabled={eliminando} className="text-xs font-semibold text-error hover:underline">Sí, eliminar</button>
            <button type="button" onClick={() => setConfirmandoEliminar(false)} disabled={eliminando} className="text-xs text-carbon/50 hover:underline">Cancelar</button>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditando(true)} className="text-xs font-semibold text-oliva hover:underline">Editar</button>
            <button type="button" onClick={() => setConfirmandoEliminar(true)} className="text-xs font-semibold text-error hover:underline">Eliminar</button>
          </div>
        )}
      </td>
    </tr>
  )
}

function FormularioExcepcion({
  profesionalId,
  servicios,
  onGuardado,
  onCancelar,
}: {
  profesionalId: string
  servicios: Servicio[]
  onGuardado: () => void
  onCancelar: () => void
}) {
  const [servicioId, setServicioId] = useState('')
  const [valor, setValor] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setError(null)
    if (!servicioId) { setError('Elige un servicio.'); return }
    const n = validarPorcentaje(valor)
    if (n === null) { setError('Ingresa un porcentaje entre 0 y 100, con hasta dos decimales.'); return }
    setGuardando(true)
    try {
      await guardarExcepcionComision(profesionalId, servicioId, n)
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-piedra bg-marfil p-3">
      {error && <p className="text-xs font-medium text-error">{error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
        <Select id="servicioExcepcion" etiqueta="Servicio" value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
          <option value="">Elegir…</option>
          {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
        <Input id="valorExcepcion" etiqueta="Comisión (%)" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="60" inputMode="decimal" />
      </div>
      <div className="flex gap-2">
        <Button type="button" tamano="sm" onClick={guardar} cargando={guardando}>Guardar excepción</Button>
        <Button type="button" tamano="sm" variante="ghost" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  )
}

function generarSlug(nombre: string) {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function InvitarEmpleada({ onCreada }: { onCreada: () => void }) {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [slug, setSlug] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  function alCambiarNombre(v: string) {
    setNombre(v)
    setSlug(generarSlug(v))
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    setExito(null)
    try {
      const resultado = await invitarEmpleada({ nombre, email, slug })
      setExito(
        resultado === 'ya_era_empleada'
          ? `${nombre} ya forma parte del equipo.`
          : resultado === 'creada_sin_correo'
            ? `La cuenta de ${nombre} ya quedó creada y activa como empleada, pero el correo con el enlace de acceso no se pudo enviar por el límite diario de correos del sistema. Vuelve a enviar la invitación con el mismo correo más tarde (no hace falta borrar nada) y esta vez el enlace sí le llegará.`
            : `Invitación enviada a ${email}. En cuanto abra el enlace del correo, su cuenta quedará activa como empleada.`,
      )
      setNombre('')
      setEmail('')
      setSlug('')
      onCreada()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      {exito && <p className="rounded-lg bg-exito/10 px-3 py-2 text-sm font-medium text-exito">{exito}</p>}
      <p className="text-sm text-carbon/60">
        Se le envía un correo con un enlace de acceso (sin necesidad de que cree una contraseña). Si el
        correo ya pertenece a una cuenta de clienta, se usa esa misma cuenta; si no existe, se crea
        automáticamente al abrir el enlace.
      </p>
      <Input id="nombreInvitar" etiqueta="Nombre completo" required value={nombre} onChange={(e) => alCambiarNombre(e.target.value)} />
      <Input id="emailInvitar" etiqueta="Correo electrónico" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input id="slugInvitar" etiqueta="Identificador para su perfil público (slug)" required value={slug} onChange={(e) => setSlug(e.target.value)} />
      <Button type="submit" cargando={enviando}>Enviar invitación</Button>
    </form>
  )
}
