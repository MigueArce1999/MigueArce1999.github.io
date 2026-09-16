import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { Drawer, Modal } from '../../components/ui/Modal'
import { isDemoMode, supabase, supabaseRequerido } from '../../lib/supabase'
import { invitarEmpleada, listarEquipoConRendimiento } from '../../lib/api/admin'
import { listarServicios } from '../../lib/api/catalogo'
import type { Profesional, Servicio } from '../../lib/types'

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
  const [bio, setBio] = useState(profesional.bio ?? '')
  const [especialidades, setEspecialidades] = useState((profesional.especialidades ?? []).join(', '))
  const [fotoUrl, setFotoUrl] = useState(profesional.foto_url ?? '')
  const [activo, setActivo] = useState(profesional.activo)
  const [serviciosAsignados, setServiciosAsignados] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode) return
    supabase!
      .from('servicio_profesional')
      .select('servicio_id')
      .eq('profesional_id', profesional.id)
      .then(({ data }) => setServiciosAsignados(new Set((data ?? []).map((r: any) => r.servicio_id))))
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

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
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
    </form>
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
