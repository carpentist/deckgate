import type { AttentionType, SessionStatus } from '@shared/types/session'

export const STATUS_META: Record<
  SessionStatus,
  { label: string; dot: string; badge: string; text: string }
> = {
  RUNNING: {
    label: '运行中',
    dot: 'bg-emerald-400',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    text: 'text-emerald-300',
  },
  WAITING_PERMISSION: {
    label: '等待授权',
    dot: 'bg-amber-400',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    text: 'text-amber-300',
  },
  WAITING_INPUT: {
    label: '等待输入',
    dot: 'bg-sky-400',
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    text: 'text-sky-300',
  },
  COMPLETED: {
    label: '已完成',
    dot: 'bg-zinc-400',
    badge: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
    text: 'text-zinc-300',
  },
  FAILED: {
    label: '失败',
    dot: 'bg-rose-400',
    badge: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    text: 'text-rose-300',
  },
  STOPPED: {
    label: '已停止',
    dot: 'bg-zinc-500',
    badge: 'border-zinc-800 bg-zinc-900 text-zinc-400',
    text: 'text-zinc-400',
  },
  UNKNOWN: {
    label: '未知',
    dot: 'bg-violet-400',
    badge: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
    text: 'text-violet-300',
  },
  DISCONNECTED: {
    label: '已断开',
    dot: 'bg-orange-400',
    badge: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    text: 'text-orange-300',
  },
}

export const ATTENTION_META: Record<AttentionType, { label: string; className: string }> = {
  permission: {
    label: '需要授权',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  question: {
    label: '需要回答',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  failure: {
    label: '执行失败',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  },
  'abnormal-exit': {
    label: '异常退出',
    className: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  },
  idle: {
    label: '等待输入',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
}

export const STATUS_SORT_ORDER: Record<SessionStatus, number> = {
  WAITING_PERMISSION: 0,
  WAITING_INPUT: 1,
  FAILED: 2,
  RUNNING: 3,
  UNKNOWN: 4,
  DISCONNECTED: 5,
  COMPLETED: 6,
  STOPPED: 7,
}

export function isWaitingStatus(status: SessionStatus): boolean {
  return status === 'WAITING_PERMISSION' || status === 'WAITING_INPUT'
}

export function isAbnormalStatus(status: SessionStatus): boolean {
  return status === 'FAILED' || status === 'DISCONNECTED'
}
