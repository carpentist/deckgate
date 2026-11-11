#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')

const MAX_INPUT_BYTES = 512 * 1024
const CONNECT_TIMEOUT_MS = 500
const DECISION_TIMEOUT_MS = 660_000
const HEARTBEAT_TIMEOUT_MS = Number(process.env.DECKGATE_HEARTBEAT_TIMEOUT_MS) || 6000
const MAX_RESPONSE_BYTES = 64 * 1024

function getAppDataDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(localAppData, 'Deckgate')
}

function getPipeName() {
  if (process.env.DECKGATE_APPROVAL_PIPE) return process.env.DECKGATE_APPROVAL_PIPE
  const username = (process.env.USERNAME || process.env.USER || 'user').replace(
    /[^A-Za-z0-9_.-]/g,
    '_',
  )
  return `\\\\.\\pipe\\deckgate-approval-${username}`
}

function readToken() {
  try {
    return fs.readFileSync(path.join(getAppDataDir(), 'approval-token.txt'), 'utf8').trim()
  } catch {
    return ''
  }
}

function outputDecision(decision) {
  const text =
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision,
      },
    }) + '\n'
  try {
    process.stdout.write(text, () => process.exit(0))
    setTimeout(() => process.exit(0), 200).unref()
  } catch {
    process.exit(0)
  }
}

let raw = ''
let truncated = false

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  if (raw.length >= MAX_INPUT_BYTES) {
    truncated = true
    return
  }
  raw += chunk
})

process.stdin.on('end', () => {
  try {
    if (!raw || truncated) return process.exit(0)
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    const payload = JSON.parse(raw)
    if (!payload || typeof payload !== 'object') return process.exit(0)
    if (payload.hook_event_name !== 'PermissionRequest') return process.exit(0)
    if (payload.tool_name === 'AskUserQuestion') return process.exit(0)
    if (typeof payload.session_id !== 'string' || typeof payload.tool_name !== 'string') {
      return process.exit(0)
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'tool_input')) return process.exit(0)

    const token = readToken()
    if (!token) return process.exit(0)

    const requestId = crypto.randomUUID()
    const socket = net.connect(getPipeName())
    let buffer = ''
    let settled = false
    let heartbeatTimer = null

    const overallTimer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      process.exit(0)
    }, DECISION_TIMEOUT_MS)

    const connectTimer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      process.exit(0)
    }, CONNECT_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(overallTimer)
      clearTimeout(connectTimer)
      if (heartbeatTimer) clearTimeout(heartbeatTimer)
      heartbeatTimer = null
      socket.removeAllListeners()
      if (!socket.destroyed) socket.destroy()
    }

    const armHeartbeatWatchdog = () => {
      if (settled) return
      if (heartbeatTimer) clearTimeout(heartbeatTimer)
      heartbeatTimer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        process.exit(0)
      }, HEARTBEAT_TIMEOUT_MS)
    }

    socket.setEncoding('utf8')
    socket.on('connect', () => {
      clearTimeout(connectTimer)
      const message = {
        type: 'permission_request',
        token,
        requestId,
        sessionId: payload.session_id,
        cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        receivedAt: Date.now(),
      }
      socket.write(JSON.stringify(message) + '\n')
      armHeartbeatWatchdog()
    })

    socket.on('data', (chunk) => {
      if (settled) return
      buffer += chunk
      if (buffer.length > MAX_RESPONSE_BYTES) {
        settled = true
        cleanup()
        process.exit(0)
      }

      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (!line.trim()) continue

        let message
        try {
          message = JSON.parse(line)
        } catch {
          settled = true
          cleanup()
          process.exit(0)
        }

        if (!message || message.requestId !== requestId) continue
        if (message.type === 'heartbeat') {
          armHeartbeatWatchdog()
          continue
        }
        if (message.type === 'fallback') {
          settled = true
          cleanup()
          process.exit(0)
        }
        if (message.type === 'decision' && message.behavior === 'allow') {
          settled = true
          cleanup()
          outputDecision({ behavior: 'allow', updatedInput: payload.tool_input })
        }
        if (message.type === 'decision' && message.behavior === 'deny') {
          settled = true
          cleanup()
          outputDecision({
            behavior: 'deny',
            message:
              typeof message.message === 'string'
                ? message.message
                : '已由 Deckgate 拒绝',
          })
        }
        settled = true
        cleanup()
        process.exit(0)
      }
    })

    socket.on('error', () => {
      if (settled) return
      settled = true
      cleanup()
      process.exit(0)
    })

    socket.on('close', () => {
      if (settled) return
      settled = true
      cleanup()
      process.exit(0)
    })
  } catch {
    process.exit(0)
  }
})

setTimeout(() => process.exit(0), 700_000).unref()
