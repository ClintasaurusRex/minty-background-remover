// Display-image correctness and creation timing (src/canvas/displayImage.ts) in headless browsers.
//
//   node scripts/browser/display-image-bench.mjs [--browser chrome|firefox|all] [--gpu]
//        [--sizes 1920x1080,3840x2160,8660x5773] [--content opaque,deleted] [--reps 5]
//
// Serves the source with Vite's dev server (no build needed) and runs display-image-bench/ in
// each browser. Correctness: the transfer path and both forced fallbacks show the same bytes as
// the import path's createImageBitmap, opaque pixels exactly and alpha 0 as nothing; the source is
// not changed; a released image is never drawn; the renderer draws once per content or view
// change and not for an identical frame; the largest accepted images can be created.
// Timing: creation (synchronous, the main thread is blocked for it) and time to the first frame,
// for the transfer path, the canvas-element fallback and the import path's createImageBitmap.
// Times vary from machine to machine: compare strategies and browsers within one run.
import { parseArgs } from 'node:util'
import { launch } from './lib/browsers.mjs'
import { createReport, serveSource } from './lib/app.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    gpu: { type: 'boolean', default: false },
    sizes: { type: 'string', default: '1920x1080,3840x2160,8660x5773' },
    content: { type: 'string', default: 'deleted' },
    reps: { type: 'string', default: '5' },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const sizes = values.sizes.split(',').map((size) => size.split('x').map(Number))
const contents = values.content.split(',')
const report = createReport()

const server = await serveSource()
try {
  for (const name of browsers) {
    const browser = await launch(name, { width: 1700, height: 1000, gpu: values.gpu })
    report.note(`\n=== ${browser.name}`)
    try {
      await browser.open(new URL('scripts/browser/display-image-bench/index.html', server.url).href, '!!window.__ready', 60000)
      const result = await browser.eval('window.__bench.correctness()')
      report.check('created with transferToImageBitmap', result.transfer.kind === 'ImageBitmap', result.transfer.kind)
      for (const key of ['fallbackWithoutOffscreenCanvas', 'fallbackWithoutTransfer']) {
        report.check(`${key}: a canvas element`, result[key].kind === 'HTMLCanvasElement', result[key].kind)
      }
      for (const key of ['transfer', 'fallbackWithoutOffscreenCanvas', 'fallbackWithoutTransfer']) {
        const r = result[key]
        report.check(
          `${key}: same bytes as createImageBitmap; opaque exact, alpha 0 shows nothing, partial within one premultiplied level`,
          r.differentFromImportPath === 0 && r.opaqueWrong === 0 && r.transparentWrong === 0 && r.alphaWrong === 0 && r.maxPremultipliedError <= 1,
          JSON.stringify(r),
        )
      }
      report.check('the source pixels are unchanged', result.sourceUnchanged)
      report.check('a released image reports itself released and is not drawn', result.released.isReleased && result.renderReleased === 'no error', JSON.stringify(result.released) + ' ' + result.renderReleased)
      const expected = { 'first frame': 1, 'identical frame': 0, 'new revision, same image': 1, 'new image, same key': 1, 'invalidate alone': 0, 'identical frame after invalidate': 1, 'contextrestored event': 1 }
      report.check('renderer draws once per change, never for an identical frame', JSON.stringify(result.rendererDraws) === JSON.stringify(expected), JSON.stringify(result.rendererDraws))
      for (const [size, image] of Object.entries(result.largest)) {
        report.check(`largest accepted image ${size} created`, `${image.size[0]}×${image.size[1]}` === size, image.kind)
      }

      const rows = await browser.eval(`window.__bench.timing(${JSON.stringify(sizes)}, ${JSON.stringify(contents)}, ${Number(values.reps)})`)
      report.note(`\nMedian of ${values.reps} runs (ms):`)
      console.table(rows)
    } catch (error) {
      report.check(`${browser.name}: run`, false, error.stack)
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
}
report.finish()
