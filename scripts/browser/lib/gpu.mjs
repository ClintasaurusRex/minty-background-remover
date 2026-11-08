// Finding the GPU process of a headless Chrome the scripts started (gpu-crash.mjs, auto-trim.mjs),
// so that it alone can be killed to make Chrome restore its canvases. Linux only (/proc).
import fs from 'node:fs'

/** The descendants of `root` whose command line says they are a Chrome GPU process. */
export function gpuProcesses(root) {
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
