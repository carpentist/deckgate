import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const gatePath = resolve(process.cwd(), 'resources', 'hooks', 'hook-gate.cjs')

let root: string
let pipe: string
let server: Server | null = null
let sockets: Socket[] = []

async function startServer(onSocket: (socket: Socket) => void): Promise<void> {
  server = createServer((socket) => {
    sockets.push(socket)
    onSocket(socket)
  })
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(pipe, () => resolve())
  })
}

function launchGate(): {
  child: ChildProcess
  output: { stdout: string; stderr: string }
} {
  const child = spawn(process.execPath, [gatePath], {
    env: {
      ...process.env,
      LOCALAPPDATA: root,
      DECKGATE_APPROVAL_PIPE: pipe,
      DECKGATE_HEARTBEAT_TIMEOUT_MS: '400',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const output = { stdout: '', stderr: '' }
  child.stdout?.on('data', (chunk: Buffer) => {
    output.stdout += chunk.toString('utf8')
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output.stderr += chunk.toString('utf8')
  })
  child.stdin?.end(
    JSON.stringify({
      session_id: 'session-1',
      hook_event_name: 'PermissionRequest',
      cwd: 'C:\\project',
      tool_name: 'PowerShell',
      tool_input: { command: 'echo ok' },
    }),
  )
  return { child, output }
}

function waitForExit(child: ChildProcess, timeoutMs = 4000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('gate did not exit in time'))
    }, timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccw-gate-'))
  await mkdir(join(root, 'Deckgate'), { recursive: true })
  await writeFile(
    join(root, 'Deckgate', 'approval-token.txt'),
    `${'a'.repeat(64)}\n`,
    'utf8',
  )
  pipe = `\\\\.\\pipe\\ccw-gate-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
})

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets = []
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = null
  }
  await rm(root, { recursive: true, force: true })
})

describe('approval gate watchdog', () => {
  it('falls back to the terminal when the app stops heartbeating', async () => {
    let requestSeen: () => void = () => undefined
    const requestReceived = new Promise<void>((resolve) => {
      requestSeen = resolve
    })
    await startServer((socket) => {
      socket.setEncoding('utf8')
      socket.once('data', () => requestSeen())
    })

    const { child, output } = launchGate()
    await Promise.race([
      requestReceived,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('gate never contacted the app')), 2000),
      ),
    ])

    const started = Date.now()
    const code = await waitForExit(child)
    expect(code).toBe(0)
    expect(output.stdout).toBe('')
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
  })

  it('stays alive while heartbeats continue and accepts a later decision', async () => {
    await startServer((socket) => {
      socket.setEncoding('utf8')
      let buffer = ''
      let requestId = ''
      let heartbeat: NodeJS.Timeout | null = null
      let decision: NodeJS.Timeout | null = null

      socket.on('data', (chunk: string) => {
        buffer += chunk
        const newline = buffer.indexOf('\n')
        if (newline < 0 || requestId) return
        const message = JSON.parse(buffer.slice(0, newline)) as { requestId?: string }
        requestId = message.requestId ?? ''
        heartbeat = setInterval(() => {
          try {
            socket.write(`${JSON.stringify({ type: 'heartbeat', requestId })}\n`)
          } catch {
            // ignore
          }
        }, 150)
        decision = setTimeout(() => {
          if (heartbeat) clearInterval(heartbeat)
          socket.write(
            `${JSON.stringify({ type: 'decision', requestId, behavior: 'allow' })}\n`,
          )
        }, 900)
      })

      socket.on('close', () => {
        if (heartbeat) clearInterval(heartbeat)
        if (decision) clearTimeout(decision)
      })
    })

    const { child, output } = launchGate()
    const code = await waitForExit(child)
    expect(code).toBe(0)
    expect(output.stdout).toContain('"behavior":"allow"')
  })
})
