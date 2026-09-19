import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { isDemoMode, supabase } from '../../lib/supabase'
import { listarPromocionesVigentes } from '../../lib/api/catalogo'
import { formatoFecha } from '../../lib/format'
import type { Promocion } from '../../lib/types'

export function AdminPromociones() {
  const [promos, setPromos] = useState<Promocion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [tipo, setTipo] = useState<'porcentaje' | 'fijo' | 'precio_especial'>('porcentaje')
  const [valor, setValor] = useState(10)
  const [guardando, setGuardando] = useState(false)

  function recargar() {
    listarPromocionesVigentes().then(setPromos).catch((e) => setError(e.message))
  }
  useEffect(recargar, [])

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (isDemoMode) return
    setError(null)
    if (new Date(hasta) <= new Date(desde)) {
      setError('La fecha "Vigente hasta" debe ser posterior a "Vigente desde".')
      return
    }
    setGuardando(true)
    try {
      const { error: err } = await supabase!.from('promocion').insert({
        nombre,
        descripcion,
        vigente_desde: desde,
        vigente_hasta: hasta,
        tipo_descuento: tipo,
        valor,
      })
      if (err) throw err
      setNombre(''); setDescripcion(''); setDesde(''); setHasta('')
      recargar()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Promociones</h1>

      <Card>
        <p className="mb-3 font-semibold text-carbon">Nueva promoción</p>
        {error && <ErrorState mensaje={error} />}
        <form onSubmit={crear} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input id="nombre" etiqueta="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Select id="tipo" etiqueta="Tipo de descuento" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
            <option value="porcentaje">Porcentaje</option>
            <option value="fijo">Valor fijo</option>
            <option value="precio_especial">Precio especial</option>
          </Select>
          <Input id="desde" etiqueta="Vigente desde" type="datetime-local" required value={desde} onChange={(e) => setDesde(e.target.value)} />
          <Input id="hasta" etiqueta="Vigente hasta" type="datetime-local" required value={hasta} onChange={(e) => setHasta(e.target.value)} />
          <Input id="valor" etiqueta="Valor" type="number" required value={valor} onChange={(e) => setValor(Number(e.target.value))} />
          <Input id="descripcion" etiqueta="Descripción" required value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          <div className="sm:col-span-2">
            <Button type="submit" cargando={guardando}>Crear promoción</Button>
          </div>
        </form>
      </Card>

      <p className="font-semibold text-carbon">Vigentes actualmente</p>
      {!promos ? <Cargando /> : (
        <div className="flex flex-col gap-2">
          {promos.map((p) => (
            <Card key={p.id} className="py-3">
              <p className="font-medium text-carbon">{p.nombre}</p>
              <p className="text-xs text-carbon/60">{p.vigente_hasta ? `Hasta ${formatoFecha(p.vigente_hasta)}` : 'Sin fecha de fin'}</p>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-carbon/50">
        Campañas con segmentación de clientes y envío: sin integración de mensajería conectada, esta sección
        se limita a preparar el mensaje y los enlaces de contacto — no simula envíos automáticos (Fase 2).
      </p>
    </div>
  )
}
