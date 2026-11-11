#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const MAX_STDIN_BYTES = 512 * 1024
const MAX_SPOOL_FILES = 3000
const KEEP_SPOOL_FILES = 2000
const RELAY_VERSION = '0.1.0'

function getSpoolDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(localAppData, 'Deckgate', 'spool')
}

function trimSpool(dir) {
  try {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    if (files.length <= MAX_SPOOL_FILES) return
    for (const name of files.slice(0, files.length - KEEP_SPOOL_FILES)) {
      try {
        fs.unlinkSync(path.join(dir, name))
      } catch {
        // best effort
      }
    }
  } catch {
    // never affect Claude Code
  }
}

let raw = ''
let truncated = false

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  if (raw.length >= MAX_STDIN_BYTES) {
    truncated = true
    return
  }
  raw += chunk
})

process.stdin.on('end', () => {
  try {
    if (!raw || truncated) return
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    const payload = JSON.parse(raw)
    if (!payload || typeof payload !== 'object' || typeof payload.session_id !== 'string') return

    const dir = getSpoolDir()
    fs.mkdirSync(dir, { recursive: true })

    const envelope = {
      receivedAt: Date.now(),
      relayVersion: RELAY_VERSION,
      eventId: crypto.randomUUID(),
      payload,
    }

    const filename = `${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`
    const target = path.join(dir, filename)
    const temp = `${target}.tmp`
    fs.writeFileSync(temp, JSON.stringify(envelope), 'utf8')
    fs.renameSync(temp, target)
    trimSpool(dir)
  } catch {
    // monitoring must never block or break the session
  } finally {
    process.exit(0)
  }
})

setTimeout(() => process.exit(0), 2500).unref()
