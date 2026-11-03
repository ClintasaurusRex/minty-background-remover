// Rendering smoke test of the production build in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/smoke.mjs [--browser chrome|firefox|all] [--dpr 1,2] [--gpu]
//
// For each image format: the document opens at revision 0 with a live display image of its size,
// the replaced image's display image is released, and the image layer shows the document's pixels
// exactly (opaque), the checkerboard exactly (alpha 0) and composites partial alpha, at several
// zoom levels and pans, and at Fit. The selection overlay shows the mint tint exactly over selected
// pixels, nothing elsewhere, and a black-and-white boundary along the edges. Frames that do not
// change the view are not redrawn; view changes are, once.
//
// Device pixel ratios with fractional device scales (such as 1.5 at 100%) are only checked at
// zoom levels where every device pixel shows exactly one image pixel.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch } from './lib/browsers.mjs'
import { createReport, dispatch, openApp, openImage, serveBuild, settle } from './lib/app.mjs'
import { FIXTURE_FILES, ensureFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    dpr: { type: 'string', default: '1,2' },
    gpu: { type: 'boolean', default: false },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const ratios = values.dpr.split(',').map(Number)
const report = createReport()

async function run(browser, dpr, url, fixtures) {
  report.note(`\n=== ${browser.name} — ${url}`)
  await openApp(browser, url)
  // Zoom levels whose device scale (zoom × DPR) is a whole number.
  const zooms = [1, 2, 4].filter((zoom) => Number.isInteger(zoom * dpr)).slice(0, dpr >= 2 ? 2 : 3)
  if (!zooms.length) zooms.push(2 / dpr)

  for (const file of FIXTURE_FILES) {
    await browser.eval('(window.__previous = window.__minty.state().documentBitmap, true)')
    const drawsBefore = await browser.eval('window.__minty.draws.image')
    await openImage(browser, path.join(fixtures, file))
    await settle(browser)
    const opened = await browser.eval(`(() => {
      const s = window.__minty.state(), d = s.document, image = s.documentBitmap, previous = window.__previous
      return { revision: d.revision, size: [d.width, d.height], image: [image.width, image.height],
        previousReleased: previous ? previous.width === 0 && previous.height === 0 : null }
    })()`)
    report.check(
      `${file}: opened at revision 0 with a live display image of its size`,
      opened.revision === 0 && opened.image[0] === opened.size[0] && opened.image[1] === opened.size[1],
      JSON.stringify(opened),
    )
    if (opened.previousReleased !== null) report.check(`${file}: the replaced display image was released`, opened.previousReleased)
    report.check(`${file}: drawn`, (await browser.eval('window.__minty.draws.image')) > drawsBefore)

    for (const zoom of zooms) {
      await dispatch(browser, { type: 'zoom-actual-size' })
      if (zoom !== 1) await dispatch(browser, { type: 'zoom-scaled', anchor: { x: 300, y: 200 }, factor: zoom })
      for (const pan of [null, { x: -53, y: 31 }]) {
        if (pan) await dispatch(browser, { type: 'wheel-panned', delta: pan })
        await settle(browser)
        const result = await browser.eval('window.__minty.compareImage()')
        const label = `${file}: image at ${zoom * 100}%${pan ? ', panned' : ''} (device scale ${zoom * dpr})`
        if (result.skipped) report.check(label, false, result.skipped)
        else
          report.check(
            `${label}: opaque exact, transparent exactly the checkerboard, partial within 2 levels`,
            result.failures === 0,
            `${JSON.stringify(result.n)}, partial max error ${result.maxPartial}${result.failures ? `, wrong ${JSON.stringify(result.wrong)}, first ${JSON.stringify(result.first)}` : ''}`,
          )
      }
    }
    await dispatch(browser, { type: 'zoom-fitted' })
    await settle(browser)
    const fit = await browser.eval('window.__minty.drawnAtFit()')
    report.check(`${file}: drawn at Fit (${(fit.zoom * 100).toFixed(1)}%)`, fit.notOpaque === 0 && fit.notChecker > 0, JSON.stringify(fit))
  }

  // The selection overlay: a Magic Wand click on graphic.png's transparent background.
  await openImage(browser, path.join(fixtures, 'graphic.png'))
  await dispatch(browser, { type: 'zoom-actual-size' })
  await settle(browser)
  const point = await browser.eval('window.__minty.clientPoint(5, 5)')
  const imageDraws = () => browser.eval('window.__minty.draws.image')
  let before = await imageDraws()
  await browser.click(point.x, point.y)
  await settle(browser)
  report.check('Magic Wand click: selects, without redrawing the image', (await browser.eval('window.__minty.state().selection?.count ?? 0')) > 0 && (await imageDraws()) === before)
  for (const zoom of zooms) {
    await dispatch(browser, { type: 'zoom-actual-size' })
    // Around the left edge of the circle: selected background and unselected circle in view.
    const anchor = await browser.eval('window.__minty.workspacePoint(255, 260)')
    if (zoom !== 1) await dispatch(browser, { type: 'zoom-scaled', anchor, factor: zoom })
    for (const pan of [null, { x: -37, y: 23 }]) {
      if (pan) await dispatch(browser, { type: 'wheel-panned', delta: pan })
      await settle(browser)
      const overlay = await browser.eval('window.__minty.checkOverlay()')
      report.check(
        `overlay at ${zoom * 100}%${pan ? ', panned' : ''}: tint exact over the selection, nothing elsewhere, boundary along the edges`,
        !overlay.skipped && overlay.wrongTint === 0 && overlay.wrongClear === 0 && overlay.strange === 0 && overlay.tint > 0 && overlay.clear > 0 && overlay.boundary > 0,
        JSON.stringify(overlay),
      )
    }
  }

  // Frames that do not change the view are skipped; view changes draw once.
  await dispatch(browser, { type: 'zoom-actual-size' })
  await settle(browser)
  const redraws = async (label, action, expected) => {
    before = await imageDraws()
    await action()
    await settle(browser)
    const count = (await imageDraws()) - before
    report.check(`image redraws: ${label}`, count === expected, `${count}, expected ${expected}`)
  }
  await redraws('20 tolerance changes', async () => {
    for (let tolerance = 21; tolerance <= 40; tolerance++) await dispatch(browser, { type: 'magic-wand-tolerance-changed', tolerance })
  }, 0)
  await redraws('selection cleared', () => dispatch(browser, { type: 'selection-cleared' }), 0)
  const cleared = await browser.eval('(() => { const c = document.querySelector("canvas.workspace__overlay"); return [c.width, c.height] })()')
  report.check('overlay keeps no backing store without a selection', cleared[0] === 0 && cleared[1] === 0, JSON.stringify(cleared))
  await redraws('zoom step', () => dispatch(browser, { type: 'zoom-stepped', direction: 1 }), 1)
  await redraws('pan', () => dispatch(browser, { type: 'wheel-panned', delta: { x: 7, y: -5 } }), 1)
  await redraws('workspace resize', () => browser.resize(1300, 860), 1)

  const current = await browser.eval('(() => { const image = window.__minty.state().documentBitmap; return [image.width, image.height] })()')
  report.check('the current display image is still live', current[0] > 0 && current[1] > 0, JSON.stringify(current))
  const errors = await browser.eval('window.__minty.errors')
  report.check('no page errors', errors.length === 0, errors.join('; '))
}

const fixtures = await ensureFixtures()
const server = await serveBuild()
try {
  for (const name of browsers) {
    for (const dpr of ratios) {
      const browser = await launch(name, { dpr, width: 1400, height: 900, gpu: values.gpu })
      try {
        await run(browser, dpr, server.url, fixtures)
      } catch (error) {
        report.check(`${browser.name}: run`, false, error.stack)
      } finally {
        await browser.close()
      }
    }
  }
} finally {
  await server.close()
}
report.finish()
