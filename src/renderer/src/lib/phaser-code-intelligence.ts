import type { Monaco } from '@monaco-editor/react'
import {
  ANIMATION_ASSET_FORMAT,
  CURRENT_ANIMATION_ASSET_VERSION,
  CURRENT_PREFAB_VERSION,
  CURRENT_SCENE_VERSION,
  PREFAB_FORMAT,
  SCENE_FORMAT,
  parseAnimationAsset,
  parsePrefab,
  parseSceneDocument,
  type FileEntry,
  type PhaserDeclarationBundle,
  type ProjectDescriptor
} from '@phaser-editor/contracts'
import { schemaContributionRegistry } from './contribution-registry'

interface MonacoDisposable { dispose(): void }

interface ActiveInstallation {
  projectPath: string
  bundle: PhaserDeclarationBundle
  disposables: MonacoDisposable[]
  disposeFileListener: () => void
  refreshTimer: number | null
}

export interface GeneratedProjectNames {
  scenes: string[]
  objects: string[]
  animations: string[]
  prefabs: string[]
  assets: string[]
}

let active: ActiveInstallation | null = null
let installing: Promise<PhaserDeclarationBundle> | null = null

export async function installPhaserCodeIntelligence(monaco: Monaco, project: ProjectDescriptor): Promise<PhaserDeclarationBundle> {
  if (active?.projectPath === project.path) return active.bundle
  if (installing) return installing
  installing = install(monaco, project).finally(() => { installing = null })
  return installing
}

export function configurePhaserJsonSchemas(monaco: Monaco): void {
  const json = (monaco.languages as typeof monaco.languages & {
    json?: { jsonDefaults: { setDiagnosticsOptions(options: Record<string, unknown>): void } }
  }).json
  json?.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    trailingCommas: 'error',
    enableSchemaRequest: false,
    schemas: [
      ...getBuiltInJsonSchemas(),
      ...schemaContributionRegistry.list().map((entry) => ({ uri: entry.value.uri, fileMatch: entry.value.fileMatch, schema: entry.value.schema }))
    ]
  })
}

export function getBuiltInJsonSchemas(): Array<{ uri: string; fileMatch: string[]; schema: Record<string, unknown> }> {
  const transform = {
    type: 'object', additionalProperties: false,
    required: ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'originX', 'originY'],
    properties: {
      x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'number' }, scaleX: { type: 'number' }, scaleY: { type: 'number' },
      originX: { type: 'number', minimum: 0, maximum: 1 }, originY: { type: 'number', minimum: 0, maximum: 1 }
    }
  }
  const component = {
    type: 'object', additionalProperties: false, required: ['id', 'type', 'version', 'enabled', 'data'],
    properties: { id: { type: 'string', format: 'uuid' }, type: { type: 'string' }, version: { type: 'integer', minimum: 1 }, enabled: { type: 'boolean' }, data: { type: 'object' } }
  }
  const baseObjectProperties = {
    id: { type: 'string', format: 'uuid' }, type: { enum: ['image', 'sprite', 'text', 'container'] }, name: { type: 'string', minLength: 1 }, parentId: { type: ['string', 'null'] }, order: { type: 'integer', minimum: 0 }, transform, visible: { type: 'boolean' }, alpha: { type: 'number', minimum: 0, maximum: 1 }, components: { type: 'array', items: component }
  }
  return [
    {
      uri: 'phaser-editor://schemas/scene-v3.json', fileMatch: ['**/*.phaser-scene.json'],
      schema: {
        type: 'object', additionalProperties: false, required: ['format', 'version', 'settings', 'objects'],
        properties: {
          format: { const: SCENE_FORMAT }, version: { const: CURRENT_SCENE_VERSION },
          settings: { type: 'object', required: ['key', 'width', 'height', 'backgroundColor', 'pixelArt'], properties: { key: { type: 'string' }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 }, backgroundColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, pixelArt: { type: 'boolean' } } },
          objects: { type: 'array', items: { type: 'object', required: ['id', 'type', 'name', 'parentId', 'order', 'transform', 'visible', 'alpha', 'components'], properties: baseObjectProperties } }
        }
      }
    },
    {
      uri: 'phaser-editor://schemas/animations-v1.json', fileMatch: ['**/*.phaser-animations.json'],
      schema: { type: 'object', additionalProperties: false, required: ['format', 'version', 'clips'], properties: { format: { const: ANIMATION_ASSET_FORMAT }, version: { const: CURRENT_ANIMATION_ASSET_VERSION }, clips: { type: 'array', items: { type: 'object', required: ['id', 'key', 'frames', 'frameRate', 'duration', 'delay', 'repeat', 'repeatDelay', 'yoyo', 'skipMissedFrames'], properties: { id: { type: 'string', format: 'uuid' }, key: { type: 'string', minLength: 1 }, frames: { type: 'array', minItems: 1, items: { type: 'object', required: ['source', 'frame'], properties: { source: { type: 'string' }, frame: { type: ['string', 'integer'] } } } }, frameRate: { type: ['number', 'null'], exclusiveMinimum: 0 }, duration: { type: ['integer', 'null'], minimum: 1 }, delay: { type: 'integer', minimum: 0 }, repeat: { type: 'integer', minimum: -1 }, repeatDelay: { type: 'integer', minimum: 0 }, yoyo: { type: 'boolean' }, skipMissedFrames: { type: 'boolean' } } } } } }
    },
    {
      uri: 'phaser-editor://schemas/prefab-v1.json', fileMatch: ['**/*.phaser-prefab.json'],
      schema: { type: 'object', additionalProperties: false, required: ['format', 'version', 'rootObjectId', 'objects', 'exposedProperties'], properties: { format: { const: PREFAB_FORMAT }, version: { const: CURRENT_PREFAB_VERSION }, rootObjectId: { type: 'string', format: 'uuid' }, objects: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'type', 'name', 'parentId', 'order', 'transform', 'visible', 'alpha', 'components'], properties: baseObjectProperties } }, exposedProperties: { type: 'array', items: { type: 'object', required: ['id', 'name', 'objectId', 'componentId', 'propertyPath'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, objectId: { type: 'string', format: 'uuid' }, componentId: { type: ['string', 'null'] }, propertyPath: { type: 'array', minItems: 1, items: { type: ['string', 'integer'] } } } } } } }
    },
    {
      uri: 'phaser-editor://schemas/game-config-v1.json', fileMatch: ['**/phaser-config.json', '**/*.phaser-config.json'],
      schema: { type: 'object', properties: { type: { enum: ['AUTO', 'CANVAS', 'WEBGL', 'HEADLESS'] }, width: { type: ['number', 'string'] }, height: { type: ['number', 'string'] }, parent: { type: 'string' }, backgroundColor: { type: ['string', 'number'] }, pixelArt: { type: 'boolean' }, transparent: { type: 'boolean' }, physics: { type: 'object', properties: { default: { enum: ['arcade', 'matter'] }, arcade: { type: 'object' }, matter: { type: 'object' } } }, scale: { type: 'object' } } }
    }
  ]
}

export function generateProjectTypings(names: GeneratedProjectNames): string {
  const union = (values: string[]): string => values.length ? [...new Set(values)].sort().map((value) => JSON.stringify(value)).join(' | ') : 'never'
  return [
    'declare namespace PhaserEditorProject {',
    `  type SceneKey = ${union(names.scenes)};`,
    `  type ObjectName = ${union(names.objects)};`,
    `  type AnimationKey = ${union(names.animations)};`,
    `  type PrefabPath = ${union(names.prefabs)};`,
    `  type AssetKey = ${union(names.assets)};`,
    '  interface NamedObjectMap { [name: string]: Phaser.GameObjects.GameObject }',
    '}',
    ''
  ].join('\n')
}

async function install(monaco: Monaco, project: ProjectDescriptor): Promise<PhaserDeclarationBundle> {
  const prior = active
  prior?.disposables.forEach((disposable) => disposable.dispose())
  prior?.disposeFileListener()
  if (prior?.refreshTimer !== null && prior?.refreshTimer !== undefined) window.clearTimeout(prior.refreshTimer)
  active = null

  const result = await window.editorApi.codeIntelligence.resolvePhaserDeclarations()
  if (!result.ok) throw new Error(result.error.message)
  const bundle = result.value
  const typescript = monaco.languages.typescript
  const declarationUri = 'file:///node_modules/phaser/types/phaser.d.ts'
  const disposables: MonacoDisposable[] = [
    typescript.typescriptDefaults.addExtraLib(bundle.content, declarationUri),
    typescript.javascriptDefaults.addExtraLib(bundle.content, declarationUri)
  ]
  const compilerOptions = {
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: true,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    typeRoots: ['file:///node_modules/@types'],
    baseUrl: 'file:///'
  }
  typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  typescript.javascriptDefaults.setCompilerOptions(compilerOptions)

  const installation: ActiveInstallation = { projectPath: project.path, bundle, disposables, disposeFileListener: () => undefined, refreshTimer: null }
  active = installation
  await refreshGeneratedLibrary(monaco, installation)
  installation.disposeFileListener = window.editorApi.fileSystem.onChange(() => {
    if (installation.refreshTimer !== null) window.clearTimeout(installation.refreshTimer)
    installation.refreshTimer = window.setTimeout(() => { void refreshGeneratedLibrary(monaco, installation) }, 180)
  })
  return bundle
}

async function refreshGeneratedLibrary(monaco: Monaco, installation: ActiveInstallation): Promise<void> {
  const [authoringResult, assetsResult] = await Promise.all([window.editorApi.fileSystem.search('phaser-'), window.editorApi.fileSystem.search('.')])
  const authoring = authoringResult.ok ? authoringResult.value.filter((entry) => entry.kind === 'file' && /\.phaser-(scene|animations|prefab)\.json$/i.test(entry.name)) : []
  const assets = assetsResult.ok ? assetsResult.value.filter((entry) => entry.kind === 'file') : []
  const names: GeneratedProjectNames = { scenes: [], objects: [], animations: [], prefabs: [], assets: assets.map(assetKey) }
  await Promise.all(authoring.map(async (entry) => {
    const result = await window.editorApi.fileSystem.read(entry.path)
    if (!result.ok) return
    try {
      if (entry.name.toLocaleLowerCase().endsWith('.phaser-scene.json')) {
        const parsed = parseSceneDocument(result.value.content)
        if (parsed.status === 'editable') { names.scenes.push(parsed.document.settings.key); names.objects.push(...parsed.document.objects.map((object) => object.name)) }
      } else if (entry.name.toLocaleLowerCase().endsWith('.phaser-animations.json')) names.animations.push(...parseAnimationAsset(result.value.content).clips.map((clip) => clip.key))
      else { parsePrefab(result.value.content); names.prefabs.push(assetKey(entry)) }
    } catch {
      // Invalid authoring files remain diagnosed by their JSON schemas.
    }
  }))
  const content = generateProjectTypings(names)
  const uri = 'file:///__phaser_editor__/project.generated.d.ts'
  const next = [monaco.languages.typescript.typescriptDefaults.addExtraLib(content, uri), monaco.languages.typescript.javascriptDefaults.addExtraLib(content, uri)]
  installation.disposables.splice(2).forEach((disposable) => disposable.dispose())
  installation.disposables.push(...next)
}

function assetKey(entry: Pick<FileEntry, 'relativePath' | 'name'>): string {
  return (entry.relativePath || entry.name).replaceAll('\\', '/')
}
