import { useAuth } from '../../state/AuthContext'
import { Card } from '../../components/ui/Estados'

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
      <p className="text-xs text-carbon/50">
        La edición de especialidades, servicios autorizados y horarios está sujeta a los permisos que
        defina administración desde /admin/equipo.
      </p>
    </div>
  )
}
