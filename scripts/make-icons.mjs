// Draws R.R.'s mark (a vessel with its waterline) into PNGs for the window and the tray.
// No image dependencies: shapes are signed-distance functions, supersampled, then PNG-encoded.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const out = path.resolve('resources')
fs.mkdirSync(out, { recursive: true })

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function draw(size, { background }) {
  const S = 4
  const px = new Float32Array(size * size * 4)
  const u = size / 24 // design grid of 24 units, like the SVG mark
  const layers = []
  if (background) layers.push((x, y) => (sdRoundRect(x, y, 12, 12, 11.5, 11.5, 5.2) < 0 ? [11, 12, 14, 1] : null))
  // Liquid (inside the vessel, below the waterline)
  layers.push((x, y) => (sdRoundRect(x, y, 12, 12, 4.6, 9.6, 4.6) < 0 && y > 11.2 ? [22, 70, 78, background ? 1 : 0.85] : null))
  // Vessel outline
  layers.push((x, y) => (Math.abs(sdRoundRect(x, y, 12, 12, 5.5, 10.5, 5.5)) < (background ? 0.62 : 0.9) ? [243, 244, 246, 1] : null))
  // Waterline
  layers.push((x, y) => (Math.abs(y - 11.2) < (background ? 0.55 : 0.8) && Math.abs(x - 12) < 4.7 ? [220, 250, 255, 1] : null))

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (i + (sx + 0.5) / S) / u
          const y = (j + (sy + 0.5) / S) / u
          let cr = 0, cg = 0, cb = 0, ca = 0
          for (const layer of layers) {
            const c = layer(x, y)
            if (!c) continue
            const al = c[3]
            cr = c[0] * al + cr * (1 - al)
            cg = c[1] * al + cg * (1 - al)
            cb = c[2] * al + cb * (1 - al)
            ca = al + ca * (1 - al)
          }
          r += cr; g += cg; b += cb; a += ca
        }
      }
      const n = S * S
      const k = (j * size + i) * 4
      const alpha = a / n
      px[k] = alpha ? r / n / alpha : 0
      px[k + 1] = alpha ? g / n / alpha : 0
      px[k + 2] = alpha ? b / n / alpha : 0
      px[k + 3] = alpha * 255
    }
  }
  return png(size, size, px)
}

function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(px[y * w * 4 + x])))
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

fs.writeFileSync(path.join(out, 'icon.png'), draw(256, { background: true }))
fs.writeFileSync(path.join(out, 'tray.png'), draw(32, { background: false }))
console.log('wrote resources/icon.png and resources/tray.png')
