// Display-image ownership of edit actions with real React, in headless Chrome and Firefox.
//
//   node scripts/browser/edit-ownership.mjs [--browser chrome|firefox|all] [--mode dev|prod|both]
//
// Runs edit-ownership/ with the project's own reducer, edit commands, dispatchEditAction and
// ImageCanvas: in development React under Strict Mode (Vite's dev server) and in a production
// build. It checks that an accepted action's image is committed, drawn and kept before
// dispatchEditAction returns, and that a stale action's image is released at once. With an update
// of lower priority queued just before (a resize, or another image arriving, at default,
// continuous-input and transition priority), React either processes it first, in order, or skips
// it and processes the edit actions again on top of it later: either way no released image is ever
// held or drawn, the one held is live, and every replaced one is released (by the dispatcher, or by
// the canvas once replaced). Also: no React warnings.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import react from '@vitejs/plugin-react'
import { build, createServer, preview } from 'vite'
import { launch } from './lib/browsers.mjs'
import { ROOT, createReport } from './lib/app.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    mode: { type: 'string', default: 'both' },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const modes = values.mode === 'both' ? ['dev', 'prod'] : [values.mode]
const PAGE = 'scripts/browser/edit-ownership/index.html'
const report = createReport()

async function serve(mode) {
  const common = { root: ROOT, configFile: false, logLevel: 'warn', plugins: [react()] }
  if (mode === 'dev') {
    const server = await createServer({
      ...common,
      server: { host: '127.0.0.1', port: 5181, strictPort: false },
      optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client'] },
    })
    await server.listen()
    return { url: new URL(`${PAGE}?strict`, server.resolvedUrls.local[0]).href, close: () => server.close() }
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minty-ownership-'))
  await build({ ...common, mode: 'production', build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(ROOT, PAGE) } } })
  const server = await preview({ ...common, build: { outDir }, preview: { host: '127.0.0.1', port: 4181, strictPort: false, open: false } })
  return {
    url: new URL(PAGE, server.resolvedUrls.local[0]).href,
    close: async () => {
      await server.close()
      fs.rmSync(outDir, { recursive: true, force: true })
    },
  }
}

function checks(r) {
  const flags = (object) => Object.entries(object).filter(([, value]) => typeof value === 'boolean')
  const all = (object) => flags(object).every(([, value]) => value)
  const detail = (object) => JSON.stringify(object)
  report.check('accepted Delete: committed, drawn and held before dispatch returns; the replaced image released; drawn exactly', r.accepted.type === 'edit-applied' && all(r.accepted), detail(r.accepted))
  report.check('stale Undo (computed from the same state as the first): released at once; the accepted one held and drawn', all(r.stale), detail(r.stale))
  for (const kind of ['default', 'continuous', 'transition']) {
    const q = r[`queued-${kind}`]
    report.check(`${kind}-priority update queued first, then an action and its stale twin: first held and live, twin released and never held (${q.path})`, all(q), detail(q))
    const i = r[`import-${kind}`]
    report.check(`another image arriving at ${kind} priority before a Delete: the import held, the Delete's image released by the ${i.releasedBy} (${i.path})`, all(i), detail(i))
  }
  report.check('React processed the transition after the edit actions (the rebase path was exercised)', r['queued-transition'].path.startsWith('resize skipped') && r['import-transition'].path.startsWith('import skipped'))
  report.check('every image but the current one released; the current one live', r.final.everyOtherReleased && r.final.currentLive, detail(r.final))
  report.check('no React warnings or console errors', r.consoleMessages.length === 0, r.consoleMessages.join('; '))
  // Not something the app does; reported so a change in React's behaviour shows up.
  report.note(`  (not used by the app) selection change at transition priority before a Delete and a stale Undo: ${JSON.stringify(r.transitionHazard)}`)
  report.check('a released stale action stays rejected when React processes it again', r.transitionHazard.finallyHeld !== 'the stale Undo', JSON.stringify(r.transitionHazard))
}

for (const mode of modes) {
  const server = await serve(mode)
  try {
    for (const name of browsers) {
      const browser = await launch(name, { width: 900, height: 700 })
      report.note(`\n=== ${browser.name}, ${mode === 'dev' ? 'development React, Strict Mode' : 'production build'}`)
      try {
        await browser.open(server.url, '!!window.__ready', 60000)
        const result = await browser.eval('window.__ownership.run()')
        report.check('Strict Mode as intended', result.strict === (mode === 'dev'))
        checks(result)
      } catch (error) {
        report.check(`${browser.name}: run`, false, error.stack)
      } finally {
        await browser.close()
      }
    }
  } finally {
    await server.close()
  }
}
report.finish()
