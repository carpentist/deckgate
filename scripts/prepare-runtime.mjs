import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const root = process.cwd()
const runtimeDir = join(root, 'build', 'runtime')
mkdirSync(runtimeDir, { recursive: true })

const source = process.execPath
const target = join(runtimeDir, 'node.exe')
copyFileSync(source, target)
console.log(`bundled runtime: ${source} -> ${target} (${statSync(target).size} bytes)`)

const nodeRoot = join(source, '..')
for (const license of ['LICENSE', 'LICENSE.md']) {
  const candidate = join(nodeRoot, license)
  if (existsSync(candidate)) {
    copyFileSync(candidate, join(runtimeDir, `LICENSE-node-${basename(candidate)}.txt`))
    console.log(`bundled license: ${candidate}`)
    break
  }
}
