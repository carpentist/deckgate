import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { NormalizedHookEvent } from '@shared/types/hooks'

const envelopeSchema = z.object({
  receivedAt: z.number().finite().positive(),
  relayVersion: z.string().max(50).optional(),
  eventId: z.string().min(1).max(120).optional(),
  payload: z.record(z.string(), z.unknown()),
})

export type ParseResult =
  | { ok: true; event: NormalizedHookEvent }
  | { ok: false; error: string }

function stripControlChars(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13) {
      out += char
      continue
    }
    if (code < 32 || code === 127) continue
    out += char
  }
  return out
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = stripControlChars(value).trim()
  if (!cleaned) return null
  return cleaned.slice(0, maxLength)
}

function fallbackEventId(payload: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 20)
}

export function parseHookEnvelope(input: unknown): ParseResult {
  const parsedEnvelope = envelopeSchema.safeParse(input)
  if (!parsedEnvelope.success) {
    return { ok: false, error: 'envelope-invalid' }
  }

  const { receivedAt, eventId, payload } = parsedEnvelope.data
  const sessionId = cleanString(payload['session_id'], 200)
  const name = cleanString(payload['hook_event_name'], 100)

  if (!sessionId) return { ok: false, error: 'missing-session-id' }
  if (!name) return { ok: false, error: 'missing-event-name' }

  let rawSize = 0
  try {
    rawSize = JSON.stringify(payload).length
  } catch {
    return { ok: false, error: 'payload-not-serializable' }
  }

  return {
    ok: true,
    event: {
      eventId: eventId ?? fallbackEventId(payload),
      name,
      sessionId,
      cwd: cleanString(payload['cwd'], 1024),
      transcriptPath: cleanString(payload['transcript_path'], 2048),
      receivedAt,
      permissionMode: cleanString(payload['permission_mode'], 50),
      source: cleanString(payload['source'], 50),
      reason: cleanString(payload['reason'], 100),
      toolName: cleanString(payload['tool_name'], 100),
      toolUseId: cleanString(payload['tool_use_id'], 200),
      error: cleanString(payload['error'], 500),
      notificationType: cleanString(payload['notification_type'], 100),
      message: cleanString(payload['message'], 300),
      lastAssistantMessage: cleanString(payload['last_assistant_message'], 800),
      rawSize,
    },
  }
}
