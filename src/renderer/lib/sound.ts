import type { SoundKind } from '@shared/types/settings'

let context: AudioContext | null = null

function getContext(): AudioContext | null {
  try {
    if (!context) context = new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

function tone(
  ctx: AudioContext,
  frequency: number,
  offset: number,
  duration: number,
  gainValue: number,
  type: OscillatorType = 'sine',
): void {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  const start = ctx.currentTime + offset
  const end = start + duration
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, end)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(end + 0.02)
}

export function playSound(kind: SoundKind): void {
  const ctx = getContext()
  if (!ctx) return
  try {
    if (kind === 'attention') {
      tone(ctx, 880, 0, 0.12, 0.07)
      tone(ctx, 1174, 0.14, 0.16, 0.07)
    } else if (kind === 'success') {
      tone(ctx, 660, 0, 0.1, 0.05)
      tone(ctx, 990, 0.1, 0.16, 0.05)
    } else {
      tone(ctx, 220, 0, 0.16, 0.08, 'triangle')
      tone(ctx, 165, 0.17, 0.22, 0.08, 'triangle')
    }
  } catch {
    // sound must never break the UI
  }
}
