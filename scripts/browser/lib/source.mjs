// Imports the application's own TypeScript modules into these Node scripts, so a script can
// compute what the app should produce with the very code the app runs (for example the expected
// result of Delete with edge cleanup, compared byte for byte with what the browser produced).
//
// Node 24 runs TypeScript by stripping types (the project uses erasable syntax only). The app's
// imports have no file extension, as Vite resolves them; the hook below adds `.ts` where such a
// file exists. Nothing is installed or compiled.
import fs from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT } from './app.mjs'

let registered = false

function register() {
  if (registered) return
  registered = true
  registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.startsWith('file:') && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        const url = new URL(`${specifier}.ts`, context.parentURL)
        if (fs.existsSync(fileURLToPath(url))) return next(url.href, context)
      }
      return next(specifier, context)
    },
  })
}

/** Imports `src/<file>` (a .ts module path relative to src/). */
export async function importSource(file) {
  register()
  return import(pathToFileURL(path.join(ROOT, 'src', file)).href)
}
