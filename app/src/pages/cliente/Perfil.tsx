import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { Card } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { actualizarPerfilCliente } from '../../lib/api/cliente'
import { isDemoMode } from '../../lib/supabase'

export function ClientePerfil() {
  const { cliente } = useAuth()
  const [nombre, setNombre] = useState(cliente?.nombre ?? '')
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '')
  const [marketing, setMarketing] = useState(cliente?.consentimiento_marketing ?? false)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!cliente || isDemoMode) {
      setGuardado(true)
      return
    }
    setGuardando(true)
    try {
      await actualizarPerfilCliente(cliente.id, { nombre, telefono, consentimiento_marketing: marketing })
      setGuardado(true)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Mi perfil</h1>
      <Card>
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <Input id="nombre" etiqueta="Nombre completo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Input id="telefono" etiqueta="Teléfono" value={telefono ?? ''} onChange={(e) => setTelefono(e.target.value)} />

          <div className="rounded-xl bg-piedra/30 p-4">
            <p className="mb-2 text-sm font-semibold text-carbon">Preferencias de comunicación</p>
            <p className="mb-3 text-xs text-carbon/60">
              Las notificaciones sobre tus citas (confirmaciones, recordatorios) son operativas y siempre se envían.
              Esto solo controla si quieres recibir promociones y novedades del salón.
            </p>
            <label className="flex items-center gap-2 text-sm text-carbon">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
              Quiero recibir promociones y novedades por WhatsApp/correo
            </label>
          </div>

          <Button type="submit" cargando={guardando}>Guardar cambios</Button>
          {guardado && <p className="text-sm font-medium text-exito">Cambios guardados.</p>}
        </form>
      </Card>
    </div>
  )
}
