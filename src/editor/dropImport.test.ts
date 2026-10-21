import { describe, expect, it } from 'vitest'
import type { DroppedFileChoice } from '../image/import/droppedFiles'
import type { ImportRequest } from '../image/import/importImage'
import { createDropImporter } from './dropImport'
import type { EditorAction } from './editorState'
import type { ImportOptions } from './importRunner'

function setUp() {
  const started: { request: ImportRequest; options?: ImportOptions }[] = []
  const actions: EditorAction[] = []
  const choices: { files: readonly File[]; resolve: (choice: DroppedFileChoice | null) => void }[] = []
  const importer = createDropImporter({
    chooseFile: (files) => new Promise((resolve) => choices.push({ files, resolve })),
    startImport: async (request, options) => {
      started.push({ request, options })
    },
    dispatch: (action) => actions.push(action),
  })
  return { importer, started, actions, choices }
}

const file = (name: string) => new File(['x'], name)

describe('createDropImporter', () => {
  it('imports the chosen file as a drop, reporting ignored files and folders', async () => {
    const { importer, started, choices } = setUp()
    const chosen = file('b.png')
    const done = importer.drop([file('a.txt'), chosen], 2)
    choices[0].resolve({ file: chosen, ignoredCount: 1 })
    await done
    expect(started).toEqual([{ request: { blob: chosen, name: 'b.png', source: 'drop' }, options: { ignoredFileCount: 3 } }])
  })

  it('lets the newest drop win when an older one finishes choosing later', async () => {
    const { importer, started, choices } = setUp()
    const older = importer.drop([file('old.png')], 0)
    const newer = importer.drop([file('new.png')], 0)
    choices[1].resolve({ file: file('new.png'), ignoredCount: 0 })
    await newer
    choices[0].resolve({ file: file('old.png'), ignoredCount: 0 })
    await older
    expect(started.map(({ request }) => request.name)).toEqual(['new.png'])
  })

  it('abandons a drop when a file-picker import starts meanwhile', async () => {
    const { importer, started, choices } = setUp()
    const drop = importer.drop([file('dropped.png')], 0)
    importer.supersede()
    choices[0].resolve({ file: file('dropped.png'), ignoredCount: 0 })
    await drop
    expect(started).toEqual([])
  })

  it('reports a drop with nothing to open as unsupported', async () => {
    const { importer, started, actions, choices } = setUp()
    const done = importer.drop([], 1)
    choices[0].resolve(null)
    await done
    expect(started).toEqual([])
    expect(actions).toEqual([
      { type: 'import-rejected', error: expect.objectContaining({ code: 'unsupported-format', detail: 'Only folders were dropped' }) },
    ])
  })
})
