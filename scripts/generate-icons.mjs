import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import pngToIco from 'png-to-ico'

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    rgba.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function insideCircle(x, y, cx, cy, radius) {
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function insideRoundedRect(x, y, size, radius) {
  const left = radius
  const right = size - radius
  const top = radius
  const bottom = size - radius
  if (x >= left && x <= right && y >= 0 && y <= size) return true
  if (y >= top && y <= bottom && x >= 0 && x <= size) return true
  const corners = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ]
  return corners.some(([cx, cy]) => {
    const dx = x - cx
    const dy = y - cy
    return dx * dx + dy * dy <= radius * radius
  })
}

function renderIcon(size, withBackground) {
  const pixels = Buffer.alloc(size * size * 4)
  const samples = 4
  const center = size / 2
  const outer = size * 0.42
  const inner = size * 0.29
  const dot = size * 0.115
  const radius = size * 0.22

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples
          const py = y + (sy + 0.5) / samples
          let pixel = [0, 0, 0, 0]

          if (withBackground && insideRoundedRect(px, py, size, radius)) {
            pixel = [20, 20, 23, 255]
          }
          if (insideCircle(px, py, center, center, inner)) {
            pixel = withBackground ? [20, 20, 23, 255] : [0, 0, 0, 0]
          } else if (insideCircle(px, py, center, center, outer)) {
            pixel = [16, 185, 129, 255]
          }
          if (insideCircle(px, py, center, center, dot)) {
            pixel = [209, 250, 229, 255]
          }

          const sampleAlpha = pixel[3] / 255
          red += pixel[0] * sampleAlpha
          green += pixel[1] * sampleAlpha
          blue += pixel[2] * sampleAlpha
          alpha += sampleAlpha
        }
      }

      const index = (y * size + x) * 4
      if (alpha > 0) {
        pixels[index] = Math.round(red / alpha)
        pixels[index + 1] = Math.round(green / alpha)
        pixels[index + 2] = Math.round(blue / alpha)
      }
      pixels[index + 3] = Math.round((alpha / (samples * samples)) * 255)
    }
  }
  return encodePng(size, pixels)
}

const root = process.cwd()
mkdirSync(join(root, 'resources'), { recursive: true })
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'resources', 'tray.png'), renderIcon(32, false))
const iconPngPath = join(root, 'build', 'icon.png')
writeFileSync(iconPngPath, renderIcon(256, true))
const iconIco = await pngToIco(iconPngPath)
writeFileSync(join(root, 'build', 'icon.ico'), iconIco)
console.log('icons generated (png + ico + tray)')
