// Generates the images the browser scripts open, into scripts/browser/fixtures/ (not committed).
// Run directly to regenerate them: node scripts/browser/fixtures.mjs
//
//   graphic.png / .webp   800 × 600 flat graphic on a transparent background
//   graphic.jpg           the same graphic on white
//   logo.svg              opaque SVG; logo-alpha.svg: no background, partial opacity
//   alpha.png             every alpha value, and colour hidden under alpha 0 (exact, from Node)
//   alpha.webp            the same pixels through Chrome's WebP encoder
//   shot4k.png            3840 × 2160 screenshot-like image
import fs from 'node:fs'
import path from 'node:path'
import { launchChrome } from './lib/browsers.mjs'
import { encodePng } from './lib/png.mjs'

export const FIXTURES = path.join(import.meta.dirname, 'fixtures')
export const FIXTURE_FILES = ['graphic.png', 'graphic.jpg', 'graphic.webp', 'logo.svg', 'logo-alpha.svg', 'alpha.png', 'alpha.webp', 'shot4k.png']
// Bump when a fixture changes, so existing copies are regenerated.
const VERSION = '1'

/** Generates the fixtures unless they are already there; returns their directory. */
export async function ensureFixtures({ force = false } = {}) {
  const stamp = path.join(FIXTURES, 'VERSION')
  const current = fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === VERSION
  if (!force && current && FIXTURE_FILES.every((file) => fs.existsSync(path.join(FIXTURES, file)))) return FIXTURES
  fs.rmSync(FIXTURES, { recursive: true, force: true })
  fs.mkdirSync(FIXTURES, { recursive: true })
  const write = (file, bytes) => fs.writeFileSync(path.join(FIXTURES, file), bytes)

  const alpha = alphaPixels()
  write('alpha.png', encodePng(alpha.width, alpha.height, alpha.data))
  write('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#ffffff"/><circle cx="100" cy="100" r="70" fill="#2a7de1"/><rect x="190" y="40" width="100" height="120" rx="12" fill="#e14a2a"/></svg>')
  write('logo-alpha.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><circle cx="100" cy="100" r="70" fill="#2a7de1"/><rect x="190" y="40" width="100" height="120" rx="12" fill="#e14a2a" fill-opacity="0.5"/><path d="M20 180 L300 20" stroke="#10d070" stroke-width="3"/></svg>')

  // JPEG and WebP need an encoder: the browser's.
  const browser = await launchChrome()
  try {
    await browser.open('about:blank')
    const encode = async (file, type, quality, draw) => {
      const base64 = await browser.eval(`(async () => {
        const c = new OffscreenCanvas(1, 1)
        ${draw}
        const bytes = new Uint8Array(await (await c.convertToBlob({ type: '${type}', quality: ${quality} })).arrayBuffer())
        let out = ''
        for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        return btoa(out)
      })()`)
      write(file, Buffer.from(base64, 'base64'))
    }
    await encode('graphic.png', 'image/png', 1, graphic(null))
    await encode('graphic.webp', 'image/webp', 1, graphic(null))
    await encode('graphic.jpg', 'image/jpeg', 0.92, graphic('#ffffff'))
    await encode('shot4k.png', 'image/png', 1, screenshot)
    await encode(
      'alpha.webp',
      'image/webp',
      1,
      `c.width = ${alpha.width}; c.height = ${alpha.height}
       const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,${fs.readFileSync(path.join(FIXTURES, 'alpha.png')).toString('base64')}')).blob(), { premultiplyAlpha: 'none' })
       c.getContext('2d').drawImage(bitmap, 0, 0)`,
    )
  } finally {
    await browser.close()
  }
  fs.writeFileSync(stamp, VERSION)
  return FIXTURES
}

/** Opaque noise, every alpha value, colour under alpha 0, and a pattern of opaque, half and alpha 1. */
function alphaPixels() {
  const width = 640
  const height = 400
  const data = new Uint8Array(width * height * 4)
  let seed = 9
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = (x * 3 + y) & 255
      data[i + 1] = (y * 5 + 40) & 255
      data[i + 2] = Math.floor(random() * 256)
      data[i + 3] = y < 100 ? 255 : y < 200 ? x & 255 : y < 300 ? 0 : ((x >> 3) + (y >> 3)) % 2 ? 255 : x % 7 === 0 ? 1 : 128
    }
  }
  return { width, height, data }
}

const graphic = (background) => `
  c.width = 800; c.height = 600
  const x = c.getContext('2d')
  ${background ? `x.fillStyle = '${background}'; x.fillRect(0, 0, 800, 600)` : ''}
  x.fillStyle = '#9aa3ad'; x.fillRect(100, 380, 600, 60)
  x.fillStyle = '#2a7de1'; x.beginPath(); x.arc(400, 260, 150, 0, 7); x.fill()
  x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(340, 180); x.lineTo(500, 260); x.lineTo(340, 340); x.closePath(); x.fill()
  x.strokeStyle = '#1b1b1b'; x.lineWidth = 6; x.strokeRect(80, 360, 640, 100)
  x.font = 'bold 40px sans-serif'; x.fillStyle = '#1b1b1b'; x.fillText('P-101', 340, 540)`

// Flat panels, text and thin lines, like a 4K screenshot of a desktop application.
const screenshot = `
  c.width = 3840; c.height = 2160
  const x = c.getContext('2d')
  x.fillStyle = '#f3f4f6'; x.fillRect(0, 0, 3840, 2160)
  x.fillStyle = '#1f2937'; x.fillRect(0, 0, 3840, 96)
  x.fillStyle = '#e5e7eb'; x.fillRect(0, 96, 520, 2064)
  x.font = '28px sans-serif'
  for (let i = 0; i < 40; i++) { x.fillStyle = i % 5 ? '#374151' : '#2563eb'; x.fillText('Navigation item ' + (i + 1), 40, 160 + i * 48) }
  for (let row = 0; row < 6; row++) for (let col = 0; col < 4; col++) {
    const left = 600 + col * 800, top = 160 + row * 330
    x.fillStyle = '#ffffff'; x.fillRect(left, top, 760, 300)
    x.strokeStyle = '#d1d5db'; x.lineWidth = 2; x.strokeRect(left + 1, top + 1, 758, 298)
    x.fillStyle = ['#10b981', '#f59e0b', '#ef4444', '#6366f1'][(row + col) % 4]; x.fillRect(left + 24, top + 24, 120, 120)
    x.fillStyle = '#111827'; x.fillText('Card ' + (row * 4 + col + 1), left + 170, top + 70)
    x.fillStyle = '#6b7280'; for (let l = 0; l < 4; l++) x.fillText('Some secondary text, line ' + (l + 1), left + 24, top + 190 + l * 30)
  }`

if (import.meta.main) {
  const dir = await ensureFixtures({ force: true })
  for (const file of FIXTURE_FILES) console.log(`${file}  ${fs.statSync(path.join(dir, file)).size} bytes`)
}
