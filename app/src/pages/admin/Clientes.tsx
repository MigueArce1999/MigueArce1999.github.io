import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Drawer } from '../../components/ui/Modal'
import { isDemoMode, supabase } from '../../lib/supabase'
import { listarClientes } from '../../lib/api/admin'
import { formatoMoneda } from '../../lib/format'
import type { Cliente } from '../../lib/types'

export function AdminClientes() {
  const [busqueda, setBusqueda] = useState('')
  const [clientes, setClientes] = useState<Cliente[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panelAbierto, setPanelAbierto] = useState<'nuevo' | Cliente | null>(null)

  function recargar() {
    listarClientes(busqueda || undefined).then(setClientes).catch((e) => setError(e.message))
  }

  useEffect(() => {
    const t = setTimeout(recargar, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Clientes</h1>
        <Button tamano="sm" onClick={() => setPanelAbierto('nuevo')}>+ Nuevo cliente</Button>
      </div>
      <input
        placeholder="Buscar por nombre, teléfono o correo…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="rounded-lg border border-piedra px-3 py-2 text-sm sm:max-w-sm"
      />

      {error && <ErrorState mensaje={error} />}
      {!clientes ? (
        <Cargando />
      ) : clientes.length === 0 ? (
        <EmptyState titulo="No hay clientes con ese criterio" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-piedra bg-blanco">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-piedra bg-piedra/20 text-xs uppercase tracking-wide text-carbon/50">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Contacto</th>
                <th className="px-4 py-3">Visitas</th>
                <th className="px-4 py-3">Gasto acumulado</th>
                <th className="px-4 py-3">Cuenta</th>
                <th className="px-4 py-3">Marketing</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className="border-b border-piedra/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-carbon">{c.nombre}</td>
                  <td className="px-4 py-3 text-carbon/70">{c.telefono || c.email || '—'}</td>
                  <td className="px-4 py-3">{c.visitas_completadas}</td>
                  <td className="px-4 py-3">{formatoMoneda(c.gasto_acumulado)}</td>
                  <td className="px-4 py-3">{c.usuario_id ? 'Con cuenta' : 'Sin cuenta (recepción)'}</td>
                  <td className="px-4 py-3">{c.consentimiento_marketing ? 'Sí' : 'No'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setPanelAbierto(c)} className="text-xs font-semibold text-oliva underline underline-offset-2">
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Card className="text-xs text-carbon/50">
        Fase 2: detección y fusión asistida de posibles duplicados (mismo teléfono/correo con nombres distintos).
      </Card>

      <Drawer
        abierto={panelAbierto !== null}
        onCerrar={() => setPanelAbierto(null)}
        titulo={panelAbierto === 'nuevo' ? 'Nuevo cliente' : 'Editar cliente'}
      >
        <FormularioCliente
          cliente={panelAbierto !== 'nuevo' ? panelAbierto : null}
          onGuardado={() => {
            setPanelAbierto(null)
            recargar()
          }}
        />
      </Drawer>
    </div>
  )
}

function FormularioCliente({ cliente, onGuardado }: { cliente: Cliente | null; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(cliente?.nombre ?? '')
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '')
  const [email, setEmail] = useState(cliente?.email ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (isDemoMode) { onGuardado(); return }
    setGuardando(true)
    setError(null)
    try {
      const datos = { nombre, telefono: telefono || null, email: email || null }
      const { error: err } = cliente
        ? await supabase!.from('cliente').update(datos).eq('id', cliente.id)
        // Un cliente creado aquí (recepción/admin) no tiene cuenta ni consentimiento de
        // marketing automático — se puede vincular a una cuenta real más adelante.
        : await supabase!.from('cliente').insert({ ...datos, consentimiento_marketing: false })
      if (err) throw err
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
      {cliente?.usuario_id && (
        <p className="rounded-lg bg-piedra/30 p-3 text-xs text-carbon/60">
          Esta persona tiene cuenta propia. Puede actualizar su nombre/teléfono/correo desde su perfil también.
        </p>
      )}
      <Input id="nombreCliente" etiqueta="Nombre completo" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Input id="telefonoCliente" etiqueta="Teléfono" value={telefono ?? ''} onChange={(e) => setTelefono(e.target.value)} />
      <Input id="emailCliente" etiqueta="Correo (opcional)" type="email" value={email ?? ''} onChange={(e) => setEmail(e.target.value)} />
      <Button type="submit" cargando={guardando}>{cliente ? 'Guardar cambios' : 'Crear cliente'}</Button>
    </form>
  )
}
