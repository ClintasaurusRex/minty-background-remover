// Context restoration after a GPU process crash, in headless Chrome on Linux. Opt-in.
//
//   npm run build
//   node scripts/browser/gpu-crash.mjs --kill-test-gpu-process [--gpu] [--dpr 1,2]
//
// The script starts its own headless Chrome with a new temporary profile, opens an image, selects
// its background with the Magic Wand, and then kills that Chrome's GPU process (SIGKILL). The
// process is found among the descendants of the Chrome process the script started, so no other
// browser is ever touched. Chrome restarts its GPU process and restores the canvases' contexts.
//
// Checked, with reduced motion (static boundary) and with marching ants, without any user action
// after the crash: both layers lose and regain their contexts; the image layer shows the document
// exactly; the overlay comes back complete (identical to before the crash with reduced motion,
// the same coverage with marching ants) and correctly aligned; the selection, document and view are
// unchanged; with reduced motion nothing is redrawn after the restoration; a pan afterwards draws
// correctly too.
//
// --gpu adds Chrome's --enable-gpu. Firefox is not covered: headless Firefox has no separate GPU
// process to stop.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launchChrome, sleep, waitFor } from './lib/browsers.mjs'
import { createReport, dispatch, openApp, openImage, serveBuild, settle } from './lib/app.mjs'
import { ensureFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    'kill-test-gpu-process': { type: 'boolean', default: false },
    gpu: { type: 'boolean', default: false },
    dpr: { type: 'string', default: '1' },
  },
})
if (!values['kill-test-gpu-process']) {
  console.log('This test kills the GPU process of a headless Chrome it starts itself, to make Chrome restore its canvases.')
  console.log('Run it with --kill-test-gpu-process to confirm. Linux only.')
  process.exit(2)
}
if (process.platform !== 'linux') {
  console.log('This test needs Linux (it finds the GPU process through /proc).')
  process.exit(2)
}

/** The descendants of `root` whose command line says they are a Chrome GPU process. */
function gpuProcesses(root) {
  const parents = new Map()
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      // The command name (2nd field) is in parentheses and may contain spaces; the parent follows it.
      const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8')
      parents.set(Number(entry), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]))
    } catch {
      // The process has exited.
    }
  }
  const isDescendant = (pid) => {
    for (let p = parents.get(pid); p; p = parents.get(p)) if (p === root) return true
    return false
  }
  return [...parents.keys()].filter((pid) => {
    if (!isDescendant(pid)) return false
    try {
      // Chrome rewrites the command line of the processes its zygote forks: separated by spaces.
      return /(^|[\s\0])--type=gpu-process([\s\0]|$)/.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'))
    } catch {
      return false
    }
  })
}

const report = createReport()

async function run(url, fixtures, { dpr, reducedMotion }) {
  const browser = await launchChrome({ dpr, width: 1400, height: 900, reducedMotion, gpu: values.gpu })
  const label = browser.name
  report.note(`\n=== ${label} — ${url}`)
  try {
    await openApp(browser, url)
    await openImage(browser, path.join(fixtures, 'graphic.png'))
    // At 200% the image is larger than the view, so it can be panned. The view is centred on the
    // left edge of the circle: selected background and the unselected circle are both in view.
    await dispatch(browser, { type: 'zoom-actual-size' })
    await settle(browser)
    const anchor = await browser.eval('window.__minty.workspacePoint(255, 260)')
    await dispatch(browser, { type: 'zoom-scaled', anchor, factor: 2 })
    await settle(browser)
    const point = await browser.eval('window.__minty.clientPoint(200, 150)')
    await browser.click(point.x, point.y)
    await settle(browser)
    await sleep(400)
    const before = await browser.eval('window.__minty.checkOverlay()')
    report.check(`${label}: overlay correct before the crash`, before.selection && before.wrongTint === 0 && before.wrongClear === 0 && before.boundary > 0, JSON.stringify(before))
    await browser.eval(`(() => {
      const s = window.__minty.state()
      window.__before = { selection: s.selection, document: s.document, viewport: s.viewport, draws: { ...window.__minty.draws } }
      window.__offset = { ...s.viewport.offset }
      return window.__minty.snapshotOverlay()
    })()`)

    const gpu = gpuProcesses(browser.pid)
    if (gpu.length !== 1) throw new Error(`Expected one GPU process under Chrome ${browser.pid}, found ${gpu.length}`)
    process.kill(gpu[0], 'SIGKILL')
    const events = await waitFor(
      async () => {
        const list = await browser.eval('window.__minty.contextEvents')
        return list.includes('image restored') && list.includes('overlay restored') && list
      },
      { timeout: 15000, what: 'both canvases to be restored' },
    ).catch(async () => browser.eval('window.__minty.contextEvents'))
    const restarted = gpuProcesses(browser.pid)
    report.check(
      `${label}: the crash was real: both layers lost and regained their contexts, Chrome started a new GPU process`,
      ['image lost', 'overlay lost', 'image restored', 'overlay restored'].every((e) => events.includes(e)) && restarted.length === 1 && restarted[0] !== gpu[0],
      `${JSON.stringify(events)}, GPU process ${gpu[0]} → ${restarted.join(', ') || 'none'}`,
    )
    await settle(browser)

    // No user action since the crash.
    const image = await browser.eval('window.__minty.compareImage()')
    report.check(`${label}: image layer shows the document exactly`, !image.skipped && image.failures === 0, JSON.stringify(image.skipped ?? { pixels: image.n, wrong: image.wrong }))
    const overlay = await browser.eval('window.__minty.checkOverlay()')
    report.check(
      `${label}: overlay complete: tint exact, nothing elsewhere, boundary drawn`,
      overlay.selection && overlay.wrongTint === 0 && overlay.wrongClear === 0 && overlay.strange === 0 && overlay.boundary > 0,
      JSON.stringify(overlay),
    )
    const changed = await browser.eval('window.__minty.compareOverlayWithSnapshot()')
    if (reducedMotion) report.check(`${label}: overlay identical to before the crash`, changed.pixels === 0, JSON.stringify(changed))
    else report.check(`${label}: overlay covers the same pixels as before the crash (the ants have moved on)`, changed.coverage === 0, JSON.stringify(changed))
    const kept = await browser.eval(`(() => {
      const s = window.__minty.state(), b = window.__before
      return { selection: s.selection === b.selection, document: s.document === b.document, viewport: s.viewport === b.viewport }
    })()`)
    report.check(`${label}: selection, document and view unchanged`, kept.selection && kept.document && kept.viewport, JSON.stringify(kept))
    const draws = await browser.eval('(() => { const b = window.__before.draws, d = window.__minty.draws; return { image: d.image - b.image, overlay: d.overlay - b.overlay } })()')
    report.check(`${label}: the image was drawn again once`, draws.image === 1, JSON.stringify(draws))
    if (reducedMotion) {
      const idle = await browser.eval('window.__minty.draws.overlay')
      await sleep(1000)
      const after = await browser.eval('window.__minty.draws.overlay')
      report.check(`${label}: nothing redrawn while idle after the restoration`, after === idle, `${after - idle} overlay draws in 1 s`)
    }

    // A pan reuses the overlay's tiles: they must not be the blank ones from before the restoration.
    await dispatch(browser, { type: 'wheel-panned', delta: { x: 40, y: 25 } })
    await settle(browser)
    const moved = await browser.eval('window.__minty.state().viewport.offset')
    const offset = await browser.eval('window.__offset')
    report.check(`${label}: the pan moved the view`, moved.x !== offset.x || moved.y !== offset.y, `${JSON.stringify(offset)} → ${JSON.stringify(moved)}`)
    const panned = await browser.eval('window.__minty.checkOverlay()')
    report.check(
      `${label}: after a pan, overlay still complete`,
      panned.selection && panned.wrongTint === 0 && panned.wrongClear === 0 && panned.strange === 0 && panned.boundary > 0,
      JSON.stringify(panned),
    )
    const pannedImage = await browser.eval('window.__minty.compareImage()')
    report.check(`${label}: after a pan, image exact`, !pannedImage.skipped && pannedImage.failures === 0, JSON.stringify(pannedImage.skipped ?? { pixels: pannedImage.n, wrong: pannedImage.wrong }))
    const errors = await browser.eval('window.__minty.errors')
    report.check(`${label}: no page errors`, errors.length === 0, errors.join('; '))
  } catch (error) {
    report.check(`${label}: run`, false, error.stack)
  } finally {
    await browser.close()
  }
}

const fixtures = await ensureFixtures()
const server = await serveBuild()
try {
  for (const dpr of values.dpr.split(',').map(Number)) {
    for (const reducedMotion of [true, false]) await run(server.url, fixtures, { dpr, reducedMotion })
  }
} finally {
  await server.close()
}
report.finish()
