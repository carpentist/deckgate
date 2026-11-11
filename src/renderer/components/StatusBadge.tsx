import type { JSX } from 'react'
import type { SessionStatus } from '@shared/types/session'
import { Badge } from './ui/badge'
import { STATUS_META } from '@renderer/lib/status'

export function StatusBadge({ status }: { status: SessionStatus }): JSX.Element {
  const meta = STATUS_META[status]
  return (
    <Badge className={meta.badge}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </Badge>
  )
}
