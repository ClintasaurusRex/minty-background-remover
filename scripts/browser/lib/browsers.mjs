// Headless Chrome (Chrome DevTools Protocol) and Firefox (WebDriver BiDi), driven over Node's
// built-in WebSocket: no dependencies. Every browser gets a new temporary profile, deleted on
// close, so the scripts never touch the user's own browser sessions.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Polls `fn` until it returns something truthy; errors from `fn` mean "not yet". Stops at once
 * with the error `abort()` returns, if any.
 */
export async function waitFor(fn, { timeout = 20000, what = 'condition', abort = () => null } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    const failure = abort()
    if (failure) throw failure
    try {
      const value = await fn()
      if (value) return value
    } catch {
      // Not ready yet.
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await sleep(100)
  }
}

// Keys the scripts press: DOM key and code, Windows virtual key code (Chrome), WebDriver key value (Firefox).
const KEYS = {
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46, webdriver: '\uE017' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27, webdriver: '\uE00C' },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, webdriver: '\uE007' },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17, webdriver: '\uE009' },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16, webdriver: '\uE008' },
}
function keyInfo(name) {
  if (KEYS[name]) return KEYS[name]
  if (/^[a-z]$/.test(name)) return { key: name, code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), webdriver: name }
  throw new Error(`No key definition for "${name}"`)
}

/**
 * Starts a browser process; fails fast if the binary is missing or the process exits. Its stderr
 * is only piped when the caller reads it (a full pipe would block the browser).
 */
function start(command, args, name, { readStderr = false } = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', readStderr ? 'pipe' : 'ignore'] })
  let failure = null
  child.on('error', (error) => (failure = new Error(`Could not start ${name} (${command}): ${error.message}`)))
  child.on('exit', (code) => (failure ??= new Error(`${name} exited (code ${code})`)))
  return { child, failed: () => failure }
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error(`Could not connect to ${url}`))
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (message) => {
    const data = JSON.parse(message.data)
    const request = data.id !== undefined && pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error) request.reject(new Error(`${JSON.stringify(data.error)} ${data.message ?? ''}`))
    else request.resolve(data.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      pending.set(n, { resolve, reject })
      socket.send(JSON.stringify({ id: n, method, params }))
    })
  return { socket, send }
}

// Evaluated in the page: `expression` may return a value or a promise; the result comes back as JSON.
const wrap = (expression) => `(async () => JSON.stringify(await (${expression})))()`
const unwrap = (value) => (value === undefined ? undefined : JSON.parse(value))

async function closeBrowser(child, profile, socket, goodbye) {
  try {
    await Promise.race([goodbye(), sleep(2000)])
  } catch {
    // Already gone.
  }
  socket.close()
  if (child.exitCode === null) {
    child.kill()
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)])
  }
  // Chrome's helper processes can still write to the profile for a moment after the browser
  // process has exited, so remove it until it stays gone.
  for (let attempt = 0; attempt < 10; attempt++) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    await sleep(300)
    if (!fs.existsSync(profile)) return
  }
  console.warn(`Could not remove the temporary browser profile ${profile}`)
}

/**
 * Headless Chrome. `gpu` adds --enable-gpu. The returned object has `pid`, the browser process,
 * so its own child processes can be found (gpu-crash.mjs).
 */
export async function launchChrome({ dpr = 1, width = 1400, height = 900, reducedMotion = false, gpu = false } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'minty-chrome-'))
  const { child, failed } = start(
    process.env.CHROME ?? 'google-chrome',
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--force-device-scale-factor=${dpr}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(gpu ? ['--enable-gpu'] : []),
      'about:blank',
    ],
    'Chrome',
  )
  try {
    // Chrome writes the port it picked into the profile.
    const port = await waitFor(() => Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]), {
      what: 'Chrome to start',
      abort: failed,
    })
    const target = await waitFor(
      async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'),
      { what: 'a Chrome page' },
    )
    const { socket, send } = await connect(target.webSocketDebuggerUrl)
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }],
    })
    return {
      name: `Chrome DPR ${dpr}${gpu ? ' GPU' : ''}${reducedMotion ? ' reduced motion' : ''}`,
      pid: child.pid,
      async open(url, ready = 'true', timeout = 20000) {
        await send('Page.navigate', { url })
        await waitFor(async () => (await this.eval('document.readyState')) === 'complete' && (await this.eval(ready)), {
          timeout,
          what: `${url} to load`,
        })
      },
      async eval(expression) {
        const result = await send('Runtime.evaluate', { expression: wrap(expression), awaitPromise: true, returnByValue: true })
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails))
        return unwrap(result.result.value)
      },
      async setFile(selector, file) {
        const { root } = await send('DOM.getDocument', { depth: 0 })
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector })
        await send('DOM.setFileInputFiles', { nodeId, files: [path.resolve(file)] })
      },
      async click(x, y) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      },
      async resize(w, h) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false })
      },
      /**
       * Presses `name` (a key from KEYS or a lower-case letter) with modifiers, as real input to
       * the focused element. `repeat` sends the press as an auto-repeat of a held key.
       */
      async press(name, { ctrl = false, shift = false, repeat = false } = {}) {
        const info = keyInfo(name)
        const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0)
        const held = [ctrl && KEYS.Control, shift && KEYS.Shift].filter(Boolean)
        let down = 0
        for (const modifier of held) {
          down |= modifier === KEYS.Control ? 2 : 8
          await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: modifier.key, code: modifier.code, windowsVirtualKeyCode: modifier.keyCode, modifiers: down })
        }
        const key = shift && info.key.length === 1 ? info.key.toUpperCase() : info.key
        const event = { key, code: info.code, windowsVirtualKeyCode: info.keyCode, nativeVirtualKeyCode: info.keyCode, modifiers }
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', autoRepeat: repeat, ...event })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
        for (const modifier of held.reverse()) {
          down &= modifier === KEYS.Control ? ~2 : ~8
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: modifier.key, code: modifier.code, windowsVirtualKeyCode: modifier.keyCode, modifiers: down })
        }
      },
      /** Runs a Chrome DevTools Protocol command on the page. */
      cdp: (method, params = {}) => send(method, params),
      close: () => closeBrowser(child, profile, socket, () => send('Browser.close')),
    }
  } catch (error) {
    child.kill()
    fs.rmSync(profile, { recursive: true, force: true })
    throw error
  }
}

/** Headless Firefox over WebDriver BiDi. */
export async function launchFirefox({ dpr = 1, width = 1400, height = 900, reducedMotion = false } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'minty-firefox-'))
  fs.writeFileSync(
    path.join(profile, 'user.js'),
    [
      `user_pref("layout.css.devPixelsPerPx", "${dpr}");`,
      `user_pref("ui.prefersReducedMotion", ${reducedMotion ? 1 : 0});`,
      'user_pref("dom.max_script_run_time", 0);',
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("app.normandy.enabled", false);',
    ].join('\n'),
  )
  const { child, failed } = start(
    process.env.FIREFOX ?? 'firefox',
    ['--headless', '--remote-debugging-port', '0', '--profile', profile, '--no-remote', '--width', String(width), '--height', String(height)],
    'Firefox',
    { readStderr: true },
  )
  try {
    // Firefox reports the port it picked on stderr. Later output is drained and dropped.
    let output = ''
    child.stderr.on('data', (chunk) => {
      if (!output.includes('WebDriver BiDi listening')) output += chunk
    })
    const url = await waitFor(() => output.match(/WebDriver BiDi listening on (ws:\/\/\S+)/)?.[1], {
      timeout: 30000,
      what: 'Firefox to start',
      abort: failed,
    })
    const { socket, send } = await connect(`${url}/session`)
    await send('session.new', { capabilities: {} })
    // The window is sized by --width and --height: setViewport is refused on the start page.
    const context = (await send('browsingContext.getTree', {})).contexts[0].context
    const pointer = (actions) => send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }] })
    return {
      name: `Firefox DPR ${dpr}${reducedMotion ? ' reduced motion' : ''}`,
      pid: child.pid,
      async open(address, ready = 'true', timeout = 20000) {
        await send('browsingContext.navigate', { context, url: address, wait: 'complete' })
        await waitFor(() => this.eval(ready), { timeout, what: `${address} to load` })
      },
      async eval(expression) {
        const result = await send('script.evaluate', { expression: wrap(expression), target: { context }, awaitPromise: true })
        if (result.type === 'exception') throw new Error(result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails))
        return unwrap(result.result.value)
      },
      async setFile(selector, file) {
        const found = await send('script.evaluate', {
          expression: `document.querySelector(${JSON.stringify(selector)})`,
          target: { context },
          awaitPromise: false,
          resultOwnership: 'root',
        })
        await send('input.setFiles', { context, element: { sharedId: found.result.sharedId }, files: [path.resolve(file)] })
      },
      async click(x, y) {
        await pointer([
          { type: 'pointerMove', x: Math.round(x), y: Math.round(y), origin: 'viewport' },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ])
      },
      async resize(w, h) {
        await send('browsingContext.setViewport', { context, viewport: { width: w, height: h } })
      },
      /**
       * Presses `name` with modifiers, as real input. `repeat`: the key is pressed twice without
       * being released, so the second press is an auto-repeat (WebDriver sets repeat), and it is
       * left held until the next press or release().
       */
      async press(name, { ctrl = false, shift = false, repeat = false } = {}) {
        const info = keyInfo(name)
        const held = [ctrl && KEYS.Control, shift && KEYS.Shift].filter(Boolean)
        const actions = [
          ...held.map((modifier) => ({ type: 'keyDown', value: modifier.webdriver })),
          { type: 'keyDown', value: info.webdriver },
          ...(repeat ? [] : [{ type: 'keyUp', value: info.webdriver }]),
          ...held.reverse().map((modifier) => ({ type: 'keyUp', value: modifier.webdriver })),
        ]
        await send('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions }] })
      },
      /** Releases every key and button still held. */
      release: () => send('input.releaseActions', { context }),
      close: () => closeBrowser(child, profile, socket, () => send('session.end', {})),
    }
  } catch (error) {
    child.kill()
    fs.rmSync(profile, { recursive: true, force: true })
    throw error
  }
}

export function launch(browser, options) {
  if (browser === 'chrome') return launchChrome(options)
  if (browser === 'firefox') return launchFirefox(options)
  throw new Error(`Unknown browser "${browser}" (use chrome or firefox)`)
}
