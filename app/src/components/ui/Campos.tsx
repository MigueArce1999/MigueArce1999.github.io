import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { formatoEnteroCOP } from '../../lib/format'

interface CampoBaseProps {
  etiqueta: string
  error?: string
  ayuda?: string
  children: ReactNode
  id: string
  // Reserva una altura fija para la etiqueta (2 líneas de texto) para que, en una fila con
  // varios campos, una etiqueta más larga que se parte en dos líneas no empuje su control
  // hacia abajo respecto a los campos vecinos con etiquetas de una sola línea.
  alinearAltura?: boolean
}

export function CampoBase({ etiqueta, error, ayuda, children, id, alinearAltura }: CampoBaseProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={`text-sm font-semibold text-carbon ${alinearAltura ? 'flex min-h-[2.5rem] items-end' : ''}`}>
        {etiqueta}
      </label>
      {children}
      {ayuda && !error && <p className="text-xs text-carbon/60">{ayuda}</p>}
      {error && <p className="text-xs font-medium text-error">{error}</p>}
    </div>
  )
}

const estiloControl =
  'w-full rounded-lg border border-piedra bg-blanco px-3 py-2.5 text-sm text-carbon outline-none transition-colors focus:border-oliva disabled:opacity-60'

type InputProps = InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; error?: string; ayuda?: string; id: string; alinearAltura?: boolean }
export function Input({ etiqueta, error, ayuda, id, alinearAltura, className = '', ...rest }: InputProps) {
  return (
    <CampoBase etiqueta={etiqueta} error={error} ayuda={ayuda} id={id} alinearAltura={alinearAltura}>
      <input id={id} className={`${estiloControl} ${error ? 'border-error' : ''} ${className}`} {...rest} />
    </CampoBase>
  )
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; error?: string; ayuda?: string; id: string; alinearAltura?: boolean }
export function Select({ etiqueta, error, ayuda, id, alinearAltura, className = '', children, ...rest }: SelectProps) {
  return (
    <CampoBase etiqueta={etiqueta} error={error} ayuda={ayuda} id={id} alinearAltura={alinearAltura}>
      <select id={id} className={`${estiloControl} ${error ? 'border-error' : ''} ${className}`} {...rest}>
        {children}
      </select>
    </CampoBase>
  )
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { etiqueta: string; error?: string; ayuda?: string; id: string }
export function Textarea({ etiqueta, error, ayuda, id, className = '', ...rest }: TextareaProps) {
  return (
    <CampoBase etiqueta={etiqueta} error={error} ayuda={ayuda} id={id}>
      <textarea id={id} className={`${estiloControl} ${error ? 'border-error' : ''} ${className}`} rows={3} {...rest} />
    </CampoBase>
  )
}

// --- Campo de dinero (COP) --------------------------------------------------------------
// type="text" + inputMode="numeric" en vez de type="number": sin flechas, con formato de
// miles "45.000" mientras se escribe, prefijo "$" y sufijo "COP" fijos (no editables, fuera
// del valor). Separa el texto mostrado (con puntos) del valor numérico real que maneja el
// formulario — nunca se guarda ni se envía el texto formateado.
function soloDigitos(s: string): string {
  return s.replace(/\D/g, '')
}

function contarDigitos(s: string): number {
  let n = 0
  for (const ch of s) if (ch >= '0' && ch <= '9') n++
  return n
}

// Ubica el cursor tras reformatear: cuenta dígitos (no separadores) para que insertar,
// borrar o reemplazar en medio del número no lo mande al final inesperadamente.
function posicionCursorTrasFormatear(formateado: string, digitosAntes: number): number {
  if (digitosAntes <= 0) return 0
  let contados = 0
  for (let i = 0; i < formateado.length; i++) {
    if (formateado[i] >= '0' && formateado[i] <= '9') {
      contados++
      if (contados === digitosAntes) return i + 1
    }
  }
  return formateado.length
}

interface CampoMonedaProps {
  id: string
  etiqueta: string
  value: number | null
  onChange: (valor: number | null) => void
  placeholder?: string
  error?: string
  ayuda?: string
  disabled?: boolean
  alinearAltura?: boolean
}

export function CampoMoneda({ id, etiqueta, value, onChange, placeholder = 'Ingresa el valor', error, ayuda, disabled, alinearAltura }: CampoMonedaProps) {
  const [texto, setTexto] = useState(value == null ? '' : formatoEnteroCOP(value))
  const ref = useRef<HTMLInputElement>(null)

  // Sincroniza el texto mostrado cuando el valor cambia desde afuera (p. ej. al precargar el
  // precio del servicio elegido), pero nunca mientras la persona está escribiendo en este
  // campo — así un rerender del formulario no le pisa lo que ya editó.
  useEffect(() => {
    if (document.activeElement !== ref.current) {
      setTexto(value == null ? '' : formatoEnteroCOP(value))
    }
  }, [value])

  function manejarCambio(e: ChangeEvent<HTMLInputElement>) {
    const crudo = e.target.value
    const posicionCursor = e.target.selectionStart ?? crudo.length
    const digitosAntes = contarDigitos(crudo.slice(0, posicionCursor))
    // Cualquier carácter que no sea 0-9 (incluido "-") se descarta: nunca se puede escribir
    // un importe negativo aquí, no se "convierte" un negativo en positivo, simplemente no es
    // un carácter válido para este campo (igual que una letra no lo sería).
    const digitos = soloDigitos(crudo)
    const numero = digitos === '' ? null : parseInt(digitos, 10)
    const formateado = digitos === '' ? '' : formatoEnteroCOP(numero as number)
    setTexto(formateado)
    onChange(numero)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const pos = posicionCursorTrasFormatear(formateado, digitosAntes)
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <CampoBase etiqueta={etiqueta} error={error} ayuda={ayuda} id={id} alinearAltura={alinearAltura}>
      <div
        className={`flex items-center gap-1 rounded-lg border bg-blanco px-2.5 transition-colors focus-within:border-oliva ${
          error ? 'border-error' : 'border-piedra'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <span className="select-none text-sm text-carbon/50" aria-hidden>$</span>
        <input
          ref={ref}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={texto}
          onChange={manejarCambio}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!error}
          // El placeholder se alinea a la izquierda (más espacio disponible antes de "COP" en
          // columnas angostas) y se ve un poco más pequeño para que quepa en un campo angosto
          // sin achicar el tamaño de un importe ya escrito; en cuanto hay un valor, se alinea
          // a la derecha como cualquier importe, para comparar cifras fácilmente en una lista.
          className={`w-full min-w-0 bg-transparent py-2.5 text-sm text-carbon outline-none placeholder:text-xs disabled:cursor-not-allowed ${texto ? 'text-right' : 'text-left'}`}
        />
        <span className="select-none whitespace-nowrap text-sm text-carbon/50" aria-hidden>COP</span>
      </div>
    </CampoBase>
  )
}
