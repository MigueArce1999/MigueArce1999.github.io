import { useEffect, useState } from 'react'
import { useAuth } from '../../state/AuthContext'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { isDemoMode, supabaseRequerido } from '../../lib/supabase'
import { listarServicios, listarServiciosDeProfesional } from '../../lib/api/catalogo'
import { guardarServiciosPropios } from '../../lib/api/empleada'
import type { Servicio } from '../../lib/types'

export function EmpleadaPerfil() {
  const { profesional, perfil } = useAuth()

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Mi perfil</h1>
      <Card className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-piedra font-marca text-2xl text-oliva">
          {perfil?.nombre?.charAt(0)}
        </div>
        <div>
          <p className="font-marca text-xl font-semibold text-carbon">{perfil?.nombre}</p>
          <p className="text-sm text-carbon/60">{profesional?.especialidades?.join(' · ') || 'Especialidades por definir'}</p>
        </div>
      </Card>
      <Card>
        <p className="mb-2 font-semibold text-carbon">Presentación</p>
        <p className="text-sm text-carbon/70">{profesional?.bio ?? 'Aún no tienes una presentación configurada. Pídele a administración que la complete desde el panel de Equipo.'}</p>
      </Card>
      <MisServicios />
      <CambiarContrasena />
      <p className="text-xs text-carbon/50">
        La edición de especialidades, foto y horarios está sujeta a los permisos que defina
        administración desde /admin/equipo.
      </p>
    </div>
  )
}

// Antes solo admin podía marcar qué servicios realiza cada profesional (0014_rls.sql). 0022
// agrega una policy que permite a cada quien gestionar sus PROPIAS filas de
// servicio_profesional, así que esto ya no depende de pedírselo a administración.
function MisServicios() {
  const { profesional } = useAuth()
  const [servicios, setServicios] = useState<Servicio[] | null>(null)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)

  useEffect(() => {
    if (!profesional) return
    Promise.all([listarServicios(), listarServiciosDeProfesional(profesional.id)])
      .then(([todos, propios]) => {
        setServicios(todos)
        setSeleccionados(new Set(propios.map((s) => s.id)))
      })
      .catch((e) => setError(e.message))
  }, [profesional])

  function alternar(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setExito(false)
  }

  async function guardar() {
    if (!profesional) return
    setGuardando(true)
    setError(null)
    setExito(false)
    try {
      await guardarServiciosPropios(profesional.id, Array.from(seleccionados))
      setExito(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card>
      <p className="mb-2 font-semibold text-carbon">Mis servicios</p>
      <p className="mb-3 text-sm text-carbon/60">
        Marca los servicios que realizas. Puedes registrar cualquier servicio desde Atender sin
        importar esta lista; esto solo controla cuáles apareces ofreciendo en el sitio público.
      </p>
      {error && <div className="mb-3"><ErrorState mensaje={error} /></div>}
      {exito && <p className="mb-3 rounded-lg bg-exito/10 px-3 py-2 text-sm font-medium text-exito">Servicios actualizados.</p>}
      {!servicios ? (
        <Cargando filas={3} />
      ) : (
        <div className="flex flex-col gap-1.5 rounded-lg border border-piedra p-3">
          {servicios.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-carbon">
              <input type="checkbox" checked={seleccionados.has(s.id)} onChange={() => alternar(s.id)} />
              {s.nombre}
            </label>
          ))}
        </div>
      )}
      <Button className="mt-3" onClick={guardar} cargando={guardando} disabled={!servicios}>Guardar cambios</Button>
    </Card>
  )
}

// Quien entra por primera vez con el enlace de invitación (ver lib/api/admin.ts →
// invitarEmpleada) queda con sesión iniciada pero SIN contraseña propia — supabase.auth.
// updateUser funciona sobre la sesión activa sin importar si antes tenía una o no, así que
// esto le sirve tanto para definirla la primera vez como para cambiarla después.
function CambiarContrasena() {
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setExito(false)
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    if (password !== confirmar) { setError('Las contraseñas no coinciden.'); return }
    if (isDemoMode) { setExito(true); return }
    setGuardando(true)
    const { error: err } = await supabaseRequerido().auth.updateUser({ password })
    setGuardando(false)
    if (err) { setError(err.message); return }
    setPassword(''); setConfirmar('')
    setExito(true)
  }

  return (
    <Card>
      <p className="mb-2 font-semibold text-carbon">Crear o cambiar tu contraseña</p>
      <p className="mb-3 text-sm text-carbon/60">
        Si entraste con el enlace que te llegó por correo, todavía no tienes una contraseña propia.
        Defínela aquí para poder ingresar la próxima vez con tu correo y contraseña desde la pantalla
        de inicio de sesión, sin depender de un nuevo enlace.
      </p>
      {error && <div className="mb-3"><ErrorState mensaje={error} /></div>}
      {exito && <p className="mb-3 rounded-lg bg-exito/10 px-3 py-2 text-sm font-medium text-exito">Contraseña guardada.</p>}
      <form onSubmit={guardar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1"><Input id="nuevaPassword" etiqueta="Nueva contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="flex-1"><Input id="confirmarPassword" etiqueta="Confirmar contraseña" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} /></div>
        <Button type="submit" cargando={guardando}>Guardar</Button>
      </form>
    </Card>
  )
}
