import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const cli = join(root, 'node_modules', 'electron-builder', 'cli.js')
if (!existsSync(cli)) {
  console.error('electron-builder is not installed')
  process.exit(1)
}

const args = process.argv.slice(2)
const env = {
  ...process.env,
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??
    'https://npmmirror.com/mirrors/electron-builder-binaries/',
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false',
}

const result = spawnSync(process.execPath, [cli, '--win', 'nsis', ...args], {
  cwd: root,
  env,
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
