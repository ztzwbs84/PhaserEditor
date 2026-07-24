import { readFile } from 'node:fs/promises'
import path from 'node:path'

const mainBundle = await readFile(path.resolve('out/main/index.js'), 'utf8')
if (mainBundle.includes('@phaser-editor/contracts') || mainBundle.includes('packages/contracts/src')) {
  throw new Error('Electron main bundle still imports the TypeScript contracts workspace package at runtime.')
}

const outputRoot = path.resolve('out/renderer')
const manifestPath = path.join(outputRoot, '.vite', 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const entries = Object.entries(manifest)
const entry = entries.find(([, record]) => record.isEntry)
if (!entry) throw new Error('Renderer manifest does not contain an entry chunk.')

const initialFiles = new Set()
const visitStaticImports = (key) => {
  const record = manifest[key]
  if (!record || initialFiles.has(record.file)) return
  initialFiles.add(record.file)
  record.imports?.forEach(visitStaticImports)
}
visitStaticImports(entry[0])

const lazyBoundaries = [
  'components/editors/AtlasInspector.tsx',
  'components/editors/AnimationEditor.tsx',
  'components/editors/PrefabEditor.tsx',
  'lib/phaser-component-projections.ts'
]

const verified = lazyBoundaries.map((suffix) => {
  const normalizedSuffix = suffix.replaceAll('\\', '/')
  const match = entries.find(([key]) => key.replaceAll('\\', '/').endsWith(normalizedSuffix))
  if (!match) throw new Error(`Renderer manifest is missing lazy authoring boundary ${suffix}.`)
  const [key, record] = match
  if (initialFiles.has(record.file)) throw new Error(`${key} was included in the initial renderer chunk graph (${record.file}).`)
  return `${key} -> ${record.file}`
})

const pluginRuntimeSource = await readFile(path.resolve('src/renderer/src/lib/plugin-runtime.ts'), 'utf8')
if (!pluginRuntimeSource.includes('import(/* @vite-ignore */ url)')) {
  throw new Error('Plugin UI is no longer loaded through the runtime-only dynamic import boundary.')
}

console.log(`Authoring chunk assertions passed for ${verified.length} lazy boundaries.`)
verified.forEach((value) => console.log(`  ${value}`))
