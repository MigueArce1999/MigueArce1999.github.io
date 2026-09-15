import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

interface CampoBaseProps {
  etiqueta: string
  error?: string
  ayuda?: string
  children: ReactNode
  id: string
}

function CampoBase({ etiqueta, error, ayuda, children, id }: CampoBaseProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-carbon">
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

type InputProps = InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; error?: string; ayuda?: string; id: string }
export function Input({ etiqueta, error, ayuda, id, className = '', ...rest }: InputProps) {
  return (
    <CampoBase etiqueta={etiqueta} error={error} ayuda={ayuda} id={id}>
      <input id={id} className={`${estiloControl} ${error ? 'border-error' : ''} ${className}`} {...rest} />
    </CampoBase>
  )
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; error?: string; ayuda?: string; id: string }
export function Select({ etiqueta, error, ayuda, id, className = '', children, ...rest }: SelectProps) {
  return (
    <CampoBase etiqueta={etiqueta} error={error} ayuda={ayuda} id={id}>
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
