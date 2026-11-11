import type { HTMLAttributes, JSX } from 'react'
import { cn } from '@renderer/lib/utils'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
      {...props}
    />
  )
}
