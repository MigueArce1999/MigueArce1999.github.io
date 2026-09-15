import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Estados'
import { isDemoMode, supabaseRequerido } from '../../lib/supabase'
import { fechaBogotaISO } from '../../lib/format'

export function AdminReportes() {
  const [desde, setDesde] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return fechaBogotaISO(d)
  })
  const [hasta, setHasta] = useState(fechaBogotaISO())
  const [generando, setGenerando] = useState(false)

  async function exportarCsv() {
    setGenerando(true)
    try {
      if (isDemoMode) {
        alert('En modo demostración no hay datos reales para exportar.')
        return
      }
      const client = supabaseRequerido()
      const { data, error } = await client
        .from('vista_atencion')
        .select('*')
        .gte('creado_en', `${desde}T00:00:00`)
        .lte('creado_en', `${hasta}T23:59:59`)
      if (error) throw error
      const filas = (data ?? []).map((a: any) => [a.id, a.cliente_nombre, a.estado, a.creado_en, a.total_vendido, a.total_pagado].join(','))
      const csv = ['id,cliente,estado,fecha,total_vendido,total_pagado', ...filas].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reporte_${desde}_${hasta}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Reportes</h1>
      <Card className="flex flex-col gap-3">
        <p className="font-semibold text-carbon">Exportar operaciones por periodo</p>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-piedra px-3 py-2 text-sm" />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-piedra px-3 py-2 text-sm" />
          <Button onClick={exportarCsv} cargando={generando}>Exportar CSV</Button>
        </div>
        <p className="text-xs text-carbon/50">
          Reportes filtrables por profesional, servicio y método de pago, y exportación a PDF, quedan para Fase 2.
        </p>
      </Card>
    </div>
  )
}
