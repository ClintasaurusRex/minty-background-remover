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

export const EDIT_FIXTURE_FILES = ['details.png', 'big50mp.png', 'broken.png']
const EDIT_VERSION = '1'

/**
 * The images the editing script (edit-workflow.mjs) needs besides FIXTURE_FILES, generated on
 * first use, exactly, from Node:
 *
 *   details.png   400 × 300 white with 1-pixel lines and dots, three disconnected red squares,
 *                 a strip of every alpha value, and colour hidden under alpha 0
 *   big50mp.png   8660 × 5773 (just under 50 megapixels): flat background, objects, an alpha band
 *   broken.png    a PNG cut off after its header, which the app rejects as truncated
 */
export async function ensureEditFixtures() {
  await ensureFixtures()
  const stamp = path.join(FIXTURES, 'EDIT_VERSION')
  const current = fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === EDIT_VERSION
  if (current && EDIT_FIXTURE_FILES.every((file) => fs.existsSync(path.join(FIXTURES, file)))) return FIXTURES
  const write = (file, bytes) => fs.writeFileSync(path.join(FIXTURES, file), bytes)
  const details = detailPixels()
  write('details.png', encodePng(details.width, details.height, details.data))
  const big = bigPixels()
  write('big50mp.png', encodePng(big.width, big.height, big.data))
  write('broken.png', encodePng(details.width, details.height, details.data).subarray(0, 120))
  fs.writeFileSync(stamp, EDIT_VERSION)
  return FIXTURES
}

function detailPixels() {
  const width = 400
  const height = 300
  const data = new Uint8Array(width * height * 4).fill(255)
  const set = (x, y, r, g, b, a = 255) => data.set([r, g, b, a], (y * width + x) * 4)
  for (let x = 20; x < 380; x++) set(x, 50, 0, 0, 0)
  for (let y = 70; y < 160; y++) set(200, y, 0, 0, 0)
  for (let i = 0; i < 90; i++) set(30 + i, 70 + i, 0, 0, 0)
  for (let y = 100; y < 160; y += 9) for (let x = 230; x < 380; x += 11) set(x, y, 20, 20, 20)
  for (const [left, top] of [[40, 180], [140, 200], [250, 170]]) {
    for (let y = top; y < top + 40; y++) for (let x = left; x < left + 40; x++) set(x, y, 220, 30, 30)
  }
  // Every alpha value 1-255 on one colour.
  for (let y = 262; y < 290; y++) for (let x = 20; x < 275; x++) set(x, y, 40, 200, 90, x - 19)
  // Colour hidden under alpha 0.
  for (let y = 180; y < 220; y++) for (let x = 330; x < 370; x++) set(x, y, 12, 34, 56, 0)
  return { width, height, data }
}

function bigPixels() {
  const width = 8660
  const height = 5773
  const data = new Uint8Array(width * height * 4)
  const background = new Uint32Array(data.buffer)
  background.fill(new Uint32Array(new Uint8Array([230, 235, 240, 255]).buffer)[0])
  const rect = (left, top, w, h, rgba) => {
    const value = new Uint32Array(new Uint8Array(rgba).buffer)[0]
    for (let y = top; y < top + h; y++) background.fill(value, y * width + left, y * width + left + w)
  }
  rect(1000, 800, 3000, 2000, [40, 90, 200, 255])
  rect(5200, 1200, 2400, 3600, [200, 60, 40, 255])
  rect(600, 3400, 3800, 1600, [30, 30, 30, 255])
  for (let y = 5300; y < 5500; y++) for (let x = 200; x < 8455; x++) data[(y * width + x) * 4 + 3] = 1 + ((x * 254) / 8455) | 0
  return { width, height, data }
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

export const EDGE_FIXTURE_FILES = [
  'edge-hmi.png',
  'edge-hmi.jpg',
  'edge-lines.png',
  'edge-logo.png',
  'edge-corners.png',
  'edge-gradient.png',
  'edge-alpha.png',
  'edge-border.png',
  'edge-photo.jpg',
  'edge-svg.svg',
  'edge-hmi-4k.png',
  'edge-hmi-50mp.png',
]
const EDGE_VERSION = '1'

/**
 * The images the edge cleanup and feathering script (edge-cleanup.mjs) opens, drawn with
 * Chrome's canvas (anti-aliased shapes and text), generated on first use:
 *
 *   edge-hmi.png        480 × 320 HMI pump graphic on grey: shaded pipes and pump, 2 px outlines,
 *                       1 px wiring (straight and anti-aliased), a glowing status light, text
 *   edge-hmi.jpg        the same at JPEG quality 0.8
 *   edge-lines.png      300 × 200 white: aliased and anti-aliased 1 px lines, a hairline, a 2 px
 *                       line, a 1 px box, coloured wires, single pixels and a sub-pixel dot
 *   edge-logo.png       320 × 200 anti-aliased logo shapes and text on solid blue
 *   edge-corners.png    360 × 240 white: bold, medium and 9 px text, sharp corners and spikes
 *   edge-gradient.png   320 × 240 an arrow and a gauge ring on a vertical gradient
 *   edge-alpha.png      320 × 200 partially transparent: a half-transparent panel carrying
 *                       opaque shapes, on full transparency
 *   edge-border.png     240 × 160 white: shapes and text cut by every image border
 *   edge-photo.jpg      400 × 300 soft (blurred) objects on an uneven, noisy background, JPEG 0.85
 *   edge-svg.svg        320 × 200 SVG: shapes, strokes and a 1 px line on white
 *   edge-hmi-4k.png     edge-hmi.png repeated to 3840 × 2160
 *   edge-hmi-50mp.png   edge-hmi.png repeated to 8660 × 5773 (just under 50 megapixels)
 */
export async function ensureEdgeFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true })
  const stamp = path.join(FIXTURES, 'EDGE_VERSION')
  const current = fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === EDGE_VERSION
  if (current && EDGE_FIXTURE_FILES.every((file) => fs.existsSync(path.join(FIXTURES, file)))) return FIXTURES
  const write = (file, bytes) => fs.writeFileSync(path.join(FIXTURES, file), bytes)
  write(
    'edge-svg.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#ffffff"/>' +
      '<circle cx="90" cy="100" r="60" fill="#7f8c99" stroke="#1d2733" stroke-width="3"/>' +
      '<rect x="170" y="40" width="110" height="70" rx="10" fill="#e8a33d" stroke="#5a3a10" stroke-width="2"/>' +
      '<path d="M170 150 L290 130" stroke="#000000" stroke-width="1"/>' +
      '<path d="M30 185 Q160 120 300 185" fill="none" stroke="#c0392b" stroke-width="1.5"/></svg>',
  )
  const browser = await launchChrome()
  try {
    await browser.open('about:blank')
    // Draws with `draw` on a 2D context `x` of a w × h canvas; returns its pixels (exact, straight RGBA).
    const pixels = async (w, h, draw) => {
      const base64 = await browser.eval(`(async () => {
        const c = new OffscreenCanvas(${w}, ${h}), x = c.getContext('2d')
        ${draw}
        const bytes = new Uint8Array(x.getImageData(0, 0, ${w}, ${h}).data.buffer)
        let out = ''
        for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        return btoa(out)
      })()`)
      return { width: w, height: h, data: new Uint8Array(Buffer.from(base64, 'base64')) }
    }
    const jpeg = async (file, w, h, draw, quality) => {
      const base64 = await browser.eval(`(async () => {
        const c = new OffscreenCanvas(${w}, ${h}), x = c.getContext('2d')
        ${draw}
        const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: ${quality} })).arrayBuffer())
        let out = ''
        for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        return btoa(out)
      })()`)
      write(file, Buffer.from(base64, 'base64'))
    }
    const png = (file, image) => write(file, encodePng(image.width, image.height, image.data))
    const hmi = await pixels(480, 320, HMI)
    png('edge-hmi.png', hmi)
    await jpeg('edge-hmi.jpg', 480, 320, HMI, 0.8)
    png('edge-lines.png', await pixels(300, 200, LINES))
    png('edge-logo.png', await pixels(320, 200, LOGO))
    png('edge-corners.png', await pixels(360, 240, CORNERS))
    png('edge-gradient.png', await pixels(320, 240, GRADIENT))
    png('edge-alpha.png', await pixels(320, 200, ALPHA))
    png('edge-border.png', await pixels(240, 160, BORDER))
    await jpeg('edge-photo.jpg', 400, 300, PHOTO, 0.85)
    png('edge-hmi-4k.png', tile(hmi, 3840, 2160))
    png('edge-hmi-50mp.png', tile(hmi, 8660, 5773))
  } finally {
    await browser.close()
  }
  fs.writeFileSync(stamp, EDGE_VERSION)
  return FIXTURES
}

export const TRIM_FIXTURE_FILES = [
  'trim-pump.png',
  'trim-valve.png',
  'trim-empty.png',
  'trim-edges.png',
  'trim-4k.png',
  'trim-photo-4k.png',
  'trim-photo-50mp.png',
  'trim-empty-50mp.png',
]
const TRIM_VERSION = '1'

/**
 * The images the Auto Trim script (auto-trim.mjs, Phase 3 Step 11) opens, generated on first use.
 * Drawn with Chrome's canvas (anti-aliased shapes, text and shadows) or exactly in Node:
 *
 *   trim-pump.png         640 × 480 flat grey background around an HMI pump and valve with pipes,
 *                         2 px outlines, 1 px wiring reaching out to x = 579, a status light's glow
 *                         and text: delete the background (Magic Wand at 2, 2, tolerance 10), trim
 *   trim-valve.png        360 × 240 transparent PNG: a valve symbol with a stem and handwheel, a
 *                         soft shadow fading to alpha 1, an anti-aliased 1 px line and a faint dot;
 *                         nothing to delete, so its own transparency is trimmed
 *   trim-empty.png        300 × 200 fully transparent
 *   trim-edges.png        160 × 100 transparent with a 1 px opaque frame along every edge
 *   trim-4k.png           3840 × 2160 of the pump's flat grey with trim-pump.png in the middle
 *   trim-photo-4k.png     3840 × 2160 photographic noise (a 61 × 37 tile, so the PNG stays small)
 *                         around a flat grey box with the pump at its centre: deleting the noise
 *                         leaves a different hidden colour in every removed pixel
 *   trim-photo-50mp.png   the same at 8660 × 5773, the box a quarter of the image (Step 10's
 *                         worst-case history entry, about 150 MB)
 *   trim-empty-50mp.png   8660 × 5773 fully transparent: the longest bounds scan
 */
export async function ensureTrimFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true })
  const stamp = path.join(FIXTURES, 'TRIM_VERSION')
  const current = fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === TRIM_VERSION
  if (current && TRIM_FIXTURE_FILES.every((file) => fs.existsSync(path.join(FIXTURES, file)))) return FIXTURES
  const png = (file, image) => fs.writeFileSync(path.join(FIXTURES, file), encodePng(image.width, image.height, image.data))
  const browser = await launchChrome()
  let pump
  let valve
  try {
    await browser.open('about:blank')
    const pixels = async (w, h, draw) => {
      const base64 = await browser.eval(`(async () => {
        const c = new OffscreenCanvas(${w}, ${h}), x = c.getContext('2d')
        ${draw}
        const bytes = new Uint8Array(x.getImageData(0, 0, ${w}, ${h}).data.buffer)
        let out = ''
        for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        return btoa(out)
      })()`)
      return { width: w, height: h, data: new Uint8Array(Buffer.from(base64, 'base64')) }
    }
    pump = await pixels(640, 480, TRIM_PUMP)
    valve = await pixels(360, 240, TRIM_VALVE)
  } finally {
    await browser.close()
  }
  png('trim-pump.png', pump)
  png('trim-valve.png', valve)
  png('trim-empty.png', { width: 300, height: 200, data: new Uint8Array(300 * 200 * 4) })
  const edges = { width: 160, height: 100, data: new Uint8Array(160 * 100 * 4) }
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 160; x++) if (x === 0 || y === 0 || x === 159 || y === 99) edges.data.set([20, 60, 140, 255], (y * 160 + x) * 4)
  }
  png('trim-edges.png', edges)
  const grey = [0xd0, 0xd4, 0xd8, 255]
  png('trim-4k.png', place(pump, filled(3840, 2160, () => grey), 1600, 840))
  const noise = noiseTile()
  const photo = (width, height, boxWidth, boxHeight) => {
    const image = filled(width, height, (x, y) => noise[(y % 37) * 61 + (x % 61)])
    const left = Math.floor((width - boxWidth) / 2)
    const top = Math.floor((height - boxHeight) / 2)
    const box = new Uint32Array(image.data.buffer)
    const value = new Uint32Array(new Uint8Array(grey).buffer)[0]
    for (let y = top; y < top + boxHeight; y++) box.fill(value, y * width + left, y * width + left + boxWidth)
    return place(pump, image, left + Math.floor((boxWidth - pump.width) / 2), top + Math.floor((boxHeight - pump.height) / 2))
  }
  png('trim-photo-4k.png', photo(3840, 2160, 960, 640))
  png('trim-photo-50mp.png', photo(8660, 5773, 4330, 2886))
  png('trim-empty-50mp.png', { width: 8660, height: 5773, data: new Uint8Array(8660 * 5773 * 4) })
  fs.writeFileSync(stamp, TRIM_VERSION)
  return FIXTURES
}

/** A width × height image whose pixel (x, y) is `colour(x, y)` (RGBA). */
function filled(width, height, colour) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4)
  return { width, height, data }
}

/** `image` with `source` copied over it, its top-left corner at (left, top). */
function place(source, image, left, top) {
  for (let y = 0; y < source.height; y++) {
    const from = y * source.width * 4
    image.data.set(source.data.subarray(from, from + source.width * 4), ((top + y) * image.width + left) * 4)
  }
  return image
}

/** 61 × 37 opaque pixels of a mid grey with up to ±10 levels of noise per channel. */
function noiseTile() {
  let seed = 11
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
  return Array.from({ length: 61 * 37 }, () => [150, 156, 162].map((v) => v + Math.round(random() * 20 - 10)).concat(255))
}

function tile(image, width, height) {
  const source = new Uint32Array(image.data.buffer, image.data.byteOffset, image.width * image.height)
  const data = new Uint8Array(width * height * 4)
  const out = new Uint32Array(data.buffer)
  for (let y = 0; y < height; y++) {
    const row = (y % image.height) * image.width
    for (let x = 0; x < width; x++) out[y * width + x] = source[row + (x % image.width)]
  }
  return { width, height, data }
}

const HMI = `
  x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 480, 320)
  const pipe = (y0, h) => { const g = x.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, '#80858e'); g.addColorStop(0.45, '#f1f3f6'); g.addColorStop(1, '#5f646d'); return g }
  x.fillStyle = pipe(150, 30); x.fillRect(0, 150, 160, 30)
  x.fillStyle = pipe(90, 26); x.fillRect(250, 90, 180, 26)
  x.fillStyle = '#4a4d55'; x.fillRect(430, 80, 12, 46)
  x.fillStyle = '#6e737c'; x.fillRect(236, 70, 10, 30)
  const body = x.createRadialGradient(200, 140, 8, 220, 165, 84); body.addColorStop(0, '#f4f5f7'); body.addColorStop(1, '#70757e')
  x.fillStyle = body; x.beginPath(); x.arc(220, 165, 80, 0, Math.PI * 2); x.fill()
  x.lineWidth = 2; x.strokeStyle = '#2b2d33'; x.stroke()
  x.fillStyle = '#26282d'; x.beginPath(); x.moveTo(195, 125); x.lineTo(265, 165); x.lineTo(195, 205); x.closePath(); x.fill()
  x.fillStyle = '#2a5aa0'; x.beginPath(); x.roundRect(150, 20, 72, 50, 6); x.fill(); x.lineWidth = 2; x.strokeStyle = '#1b2433'; x.stroke()
  x.lineWidth = 1
  x.strokeStyle = '#000000'; x.beginPath(); x.moveTo(224, 40.5); x.lineTo(440.5, 40.5); x.lineTo(440.5, 72); x.stroke()
  x.strokeStyle = '#c00000'; x.beginPath(); x.moveTo(224, 60.5); x.lineTo(400, 60.5); x.stroke()
  x.strokeStyle = '#109040'; x.beginPath(); x.moveTo(20, 20); x.lineTo(148, 40); x.stroke()
  const led = x.createRadialGradient(380, 230, 3, 380, 230, 16); led.addColorStop(0, '#30f070'); led.addColorStop(0.45, '#20c050'); led.addColorStop(1, 'rgba(32, 192, 80, 0)')
  x.fillStyle = led; x.fillRect(360, 210, 40, 40)
  x.fillStyle = '#ffffff'; x.fillRect(300, 270, 150, 34); x.strokeStyle = '#555555'; x.strokeRect(300.5, 270.5, 149, 33)
  x.fillStyle = '#111111'; x.font = 'bold 13px sans-serif'; x.fillText('P-101  RUN', 314, 292)
  x.fillStyle = '#333333'; x.font = '9px sans-serif'; x.fillText('TAG-0042 FLOW 12.5', 20, 300)`

// The pump scene of edge-hmi.png, moved into a larger flat background with room on every side.
const TRIM_PUMP = `
  x.fillStyle = '#d0d4d8'; x.fillRect(0, 0, 640, 480)
  x.translate(80, 90)
  const pipe = (y0, h) => { const g = x.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, '#80858e'); g.addColorStop(0.45, '#f1f3f6'); g.addColorStop(1, '#5f646d'); return g }
  x.fillStyle = pipe(150, 30); x.fillRect(40, 150, 120, 30)
  x.fillStyle = pipe(90, 26); x.fillRect(250, 90, 180, 26)
  const body = x.createRadialGradient(200, 140, 8, 220, 165, 84); body.addColorStop(0, '#f4f5f7'); body.addColorStop(1, '#70757e')
  x.fillStyle = body; x.beginPath(); x.arc(220, 165, 80, 0, Math.PI * 2); x.fill()
  x.lineWidth = 2; x.strokeStyle = '#2b2d33'; x.stroke()
  x.fillStyle = '#26282d'; x.beginPath(); x.moveTo(195, 125); x.lineTo(265, 165); x.lineTo(195, 205); x.closePath(); x.fill()
  // A valve on the outlet pipe: two triangles meeting at the stem.
  x.fillStyle = '#3d7a3d'; x.beginPath(); x.moveTo(330, 80); x.lineTo(360, 103); x.lineTo(330, 126); x.closePath(); x.moveTo(390, 80); x.lineTo(360, 103); x.lineTo(390, 126); x.closePath(); x.fill()
  x.strokeStyle = '#1e3d1e'; x.lineWidth = 2; x.stroke()
  x.fillStyle = '#1e3d1e'; x.fillRect(359, 62, 2, 41); x.fillRect(346, 58, 28, 5)
  x.lineWidth = 1
  x.strokeStyle = '#000000'; x.beginPath(); x.moveTo(224, 40.5); x.lineTo(499.5, 40.5); x.lineTo(499.5, 72); x.stroke()
  x.strokeStyle = '#c00000'; x.beginPath(); x.moveTo(224, 60.5); x.lineTo(400, 60.5); x.stroke()
  x.strokeStyle = '#109040'; x.beginPath(); x.moveTo(60, 20); x.lineTo(148, 40); x.stroke()
  const led = x.createRadialGradient(380, 230, 3, 380, 230, 16); led.addColorStop(0, '#30f070'); led.addColorStop(0.45, '#20c050'); led.addColorStop(1, 'rgba(32, 192, 80, 0)')
  x.fillStyle = led; x.fillRect(360, 210, 40, 40)
  x.fillStyle = '#ffffff'; x.fillRect(300, 270, 150, 34); x.strokeStyle = '#555555'; x.strokeRect(300.5, 270.5, 149, 33)
  x.fillStyle = '#111111'; x.font = 'bold 13px sans-serif'; x.fillText('P-101  RUN', 314, 292)
  x.fillStyle = '#333333'; x.font = '9px sans-serif'; x.fillText('TAG-0042 FLOW 12.5', 40, 290)`

// A valve symbol on transparency, with a soft shadow and faint anti-aliased details.
const TRIM_VALVE = `
  x.clearRect(0, 0, 360, 240)
  x.save(); x.shadowColor = 'rgba(0, 0, 0, 0.6)'; x.shadowBlur = 10; x.shadowOffsetX = 4; x.shadowOffsetY = 6
  x.fillStyle = '#c62828'; x.beginPath(); x.moveTo(110, 90); x.lineTo(180, 130); x.lineTo(110, 170); x.closePath(); x.moveTo(250, 90); x.lineTo(180, 130); x.lineTo(250, 170); x.closePath(); x.fill()
  x.restore()
  x.strokeStyle = '#4a0d0d'; x.lineWidth = 2; x.stroke()
  x.fillStyle = '#333333'; x.fillRect(179, 72, 2, 58)
  x.strokeStyle = '#333333'; x.lineWidth = 3; x.beginPath(); x.ellipse(180, 66, 30, 8, 0, 0, Math.PI * 2); x.stroke()
  x.strokeStyle = '#000000'; x.lineWidth = 1; x.beginPath(); x.moveTo(60, 200); x.lineTo(300, 182); x.stroke()
  x.fillStyle = '#000000'; x.beginPath(); x.arc(320.5, 40.5, 0.35, 0, Math.PI * 2); x.fill()`

const LINES = `
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 300, 200)
  const line = (colour, width, x0, y0, x1, y1) => { x.strokeStyle = colour; x.lineWidth = width; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke() }
  line('#000000', 1, 10, 10.5, 290, 10.5)
  line('#000000', 1, 10.5, 20, 10.5, 190)
  line('#000000', 1, 20, 30, 280, 125)
  line('#000000', 1, 20, 140, 280, 163)
  line('#000000', 0.6, 30, 175, 280, 192)
  line('#000000', 2, 150, 40, 150, 120)
  x.lineWidth = 1; x.strokeStyle = '#000000'; x.strokeRect(200.5, 40.5, 60, 40)
  line('#d00000', 1, 30, 60.5, 140, 60.5)
  line('#0040d0', 1, 30, 70, 140, 90)
  x.fillStyle = '#000000'; for (const [px, py] of [[40, 110], [60, 112], [80, 114], [270, 20]]) x.fillRect(px, py, 1, 1)
  x.beginPath(); x.arc(100.5, 110.5, 0.4, 0, Math.PI * 2); x.fill()`

const LOGO = `
  x.fillStyle = '#2a6fdb'; x.fillRect(0, 0, 320, 200)
  x.strokeStyle = '#ffffff'; x.lineWidth = 6; x.beginPath(); x.arc(70, 100, 44, 0, Math.PI * 2); x.stroke()
  x.fillStyle = '#ff9a1f'; x.beginPath(); x.moveTo(70, 66); x.lineTo(98, 120); x.lineTo(42, 120); x.closePath(); x.fill()
  x.fillStyle = '#ffffff'; x.font = 'bold 40px sans-serif'; x.fillText('MINTY', 128, 112)
  x.font = '12px sans-serif'; x.fillText('background remover', 132, 136)`

const CORNERS = `
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 360, 240)
  x.fillStyle = '#000000'; x.font = 'bold 28px sans-serif'; x.fillText('PUMP P-101 STATUS', 14, 40)
  x.fillStyle = '#1f4fa0'; x.font = '16px sans-serif'; x.fillText('Flow 12.5 m³/h   Δp 0.8 bar', 14, 68)
  x.fillStyle = '#333333'; x.font = '9px sans-serif'; x.fillText('TAG-0042 (9 px label)', 14, 86)
  x.fillStyle = '#000000'
  const poly = (points) => { x.beginPath(); points.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill() }
  poly([[60, 110], [100, 150], [60, 190], [20, 150]])
  x.fillStyle = '#c0141e'; poly([[150, 110], [158, 200], [142, 200]])
  x.fillStyle = '#000000'
  const star = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 16 : 42, t = -Math.PI / 2 + (i * Math.PI) / 5; star.push([240 + r * Math.cos(t), 155 + r * Math.sin(t)]) }
  poly(star)
  x.fillRect(300, 120, 40, 60)`

const GRADIENT = `
  const g = x.createLinearGradient(0, 0, 0, 240); g.addColorStop(0, '#e6eef8'); g.addColorStop(1, '#bccbe0')
  x.fillStyle = g; x.fillRect(0, 0, 320, 240)
  x.fillStyle = '#f2c230'; x.strokeStyle = '#3a2f0a'; x.lineWidth = 2
  x.beginPath(); x.moveTo(30, 100); x.lineTo(150, 100); x.lineTo(150, 70); x.lineTo(200, 120); x.lineTo(150, 170); x.lineTo(150, 140); x.lineTo(30, 140); x.closePath(); x.fill(); x.stroke()
  x.strokeStyle = '#c62828'; x.lineWidth = 8; x.beginPath(); x.arc(258, 120, 40, 0, Math.PI * 2); x.stroke()`

const ALPHA = `
  x.clearRect(0, 0, 320, 200)
  x.fillStyle = 'rgba(40, 40, 48, 0.5)'; x.beginPath(); x.roundRect(20, 20, 280, 160, 14); x.fill()
  x.fillStyle = '#ff8c1a'; x.beginPath(); x.arc(100, 100, 46, 0, Math.PI * 2); x.fill()
  x.fillStyle = '#ffffff'; x.font = 'bold 30px sans-serif'; x.fillText('ALARM', 160, 112)
  x.strokeStyle = '#ffffff'; x.lineWidth = 1; x.beginPath(); x.moveTo(160, 130.5); x.lineTo(280, 130.5); x.stroke()`

const BORDER = `
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 240, 160)
  x.fillStyle = '#1b3a6b'; x.beginPath(); x.arc(0, 80, 40, 0, Math.PI * 2); x.fill()
  x.fillStyle = '#000000'; x.fillRect(60, 150, 120, 10)
  x.fillStyle = '#b02020'; x.beginPath(); x.moveTo(200, 0); x.lineTo(240, 0); x.lineTo(240, 50); x.closePath(); x.fill()
  x.fillStyle = '#000000'; x.font = 'bold 20px sans-serif'; x.fillText('EDGE', 90, 12)`

const PHOTO = `
  const g = x.createRadialGradient(140, 90, 20, 200, 150, 320); g.addColorStop(0, '#d9dde3'); g.addColorStop(1, '#8e959f')
  x.fillStyle = g; x.fillRect(0, 0, 400, 300)
  const noise = x.getImageData(0, 0, 400, 300); let seed = 7
  for (let i = 0; i < noise.data.length; i += 4) { seed = (seed * 1103515245 + 12345) >>> 0; const n = ((seed >>> 24) % 13) - 6; for (let k = 0; k < 3; k++) noise.data[i + k] += n }
  x.putImageData(noise, 0, 0)
  x.filter = 'blur(1.5px)'
  x.fillStyle = '#3b5f8a'; x.fillRect(170, 150, 70, 120)
  x.strokeStyle = '#c0392b'; x.lineWidth = 9; x.beginPath(); x.arc(205, 105, 48, 0, Math.PI * 2); x.stroke()
  x.fillStyle = '#2d3a46'; x.fillRect(60, 200, 90, 50)
  x.filter = 'none'`

/**
 * Phase 4 (crop.mjs, colour.mjs):
 *
 *   crop-columns.png   120 × 80, opaque; red = 2 × column, green = 3 × row, blue varies, so the
 *                      canvas shows which column and row each device pixel draws
 *   colour-stripes.png 60 × 40, sharp alternating colours: columns alternate red and blue, rows
 *                      alternate alpha 255 and 128, and every third diagonal is fully transparent
 *                      (hidden colour yellow), so every pixel looks different from all eight
 *                      neighbours on screen
 */
export const CROP_FIXTURE_FILES = ['crop-columns.png', 'colour-stripes.png']

/** colour-stripes.png's pixel (x, y). */
export function stripePixel(x, y) {
  if ((x + y) % 3 === 0) return [200, 200, 0, 0]
  return [...(x % 2 ? [230, 30, 40] : [20, 40, 220]), y % 2 ? 128 : 255]
}

export function ensureCropFixtures({ force = false } = {}) {
  const stripes = path.join(FIXTURES, 'colour-stripes.png')
  if (!fs.existsSync(stripes) || force) {
    const rgba = new Uint8Array(60 * 40 * 4)
    for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) rgba.set(stripePixel(x, y), (y * 60 + x) * 4)
    fs.mkdirSync(FIXTURES, { recursive: true })
    fs.writeFileSync(stripes, encodePng(60, 40, rgba))
  }
  const file = path.join(FIXTURES, 'crop-columns.png')
  if (fs.existsSync(file) && !force) return FIXTURES
  const width = 120
  const height = 80
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set([x * 2, y * 3, (x * 7 + y * 11) % 256, 255], (y * width + x) * 4)
  }
  fs.mkdirSync(FIXTURES, { recursive: true })
  fs.writeFileSync(file, encodePng(width, height, rgba))
  return FIXTURES
}

if (import.meta.main) {
  const dir = await ensureFixtures({ force: true })
  for (const file of FIXTURE_FILES) console.log(`${file}  ${fs.statSync(path.join(dir, file)).size} bytes`)
  fs.rmSync(path.join(dir, 'EDGE_VERSION'), { force: true })
  await ensureEdgeFixtures()
  for (const file of EDGE_FIXTURE_FILES) console.log(`${file}  ${fs.statSync(path.join(dir, file)).size} bytes`)
  fs.rmSync(path.join(dir, 'TRIM_VERSION'), { force: true })
  await ensureTrimFixtures()
  for (const file of TRIM_FIXTURE_FILES) console.log(`${file}  ${fs.statSync(path.join(dir, file)).size} bytes`)
  ensureCropFixtures({ force: true })
  for (const file of CROP_FIXTURE_FILES) console.log(`${file}  ${fs.statSync(path.join(dir, file)).size} bytes`)
}
