import type { InputHTMLAttributes, JSX } from 'react'
import { cn } from '@renderer/lib/utils'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-emerald-500/20',
        className,
      )}
      {...props}
    />
  )
}
