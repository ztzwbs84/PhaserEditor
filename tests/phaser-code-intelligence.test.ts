import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { resolvePhaserDeclarations } from '../src/main/code-intelligence-service'
import { generateProjectTypings, getBuiltInJsonSchemas } from '../src/renderer/src/lib/phaser-code-intelligence'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Phaser declaration resolution', () => {
  it('prefers the active project package and falls back to the supported editor package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phaser-editor-types-'))
    temporaryRoots.push(root)
    const project = path.join(root, 'project')
    const fallback = path.join(root, 'editor')
    await writeFakePhaser(project, '4.1.0', 'declare const projectPhaser: true;')
    await writeFakePhaser(fallback, '4.2.1', 'declare const fallbackPhaser: true;')

    await expect(resolvePhaserDeclarations(project, fallback)).resolves.toMatchObject({ source: 'project', version: '4.1.0', content: expect.stringContaining('projectPhaser') })
    await expect(resolvePhaserDeclarations(path.join(root, 'missing'), fallback)).resolves.toMatchObject({ source: 'fallback', version: '4.2.1', content: expect.stringContaining('fallbackPhaser') })
  })
})

describe('Phaser language fixtures', () => {
  const declarations = `
    declare namespace Phaser {
      class Scene { add: GameObjects.GameObjectFactory }
      namespace GameObjects {
        class Image { setAlpha(value: number): this }
        class GameObjectFactory { image(x: number, y: number, texture: string, frame?: string | number): Image }
      }
    }
  `

  it('provides completion, signature, hover, definition, and diagnostics for TypeScript', () => {
    const source = `const scene = {} as Phaser.Scene;\nscene.add.;\nscene.add.image(10, 20, 'hero').setAlpha(0.5);\nscene.add.missing();\n`
    const service = languageService({ '/phaser.d.ts': declarations, '/main.ts': source })
    const completionPosition = source.indexOf('scene.add.;') + 'scene.add.'.length
    expect(service.getCompletionsAtPosition('/main.ts', completionPosition, {})?.entries.map((entry) => entry.name)).toContain('image')

    const imagePosition = source.indexOf('image(10') + 1
    expect(ts.displayPartsToString(service.getQuickInfoAtPosition('/main.ts', imagePosition)?.displayParts)).toContain('image')
    expect(service.getDefinitionAtPosition('/main.ts', imagePosition)?.[0]?.fileName).toBe('/phaser.d.ts')
    expect(service.getSignatureHelpItems('/main.ts', source.indexOf("'hero'") + 1, undefined)?.items[0]?.parameters).toHaveLength(4)
    expect(service.getSemanticDiagnostics('/main.ts').map((diagnostic) => String(diagnostic.messageText))).toEqual(expect.arrayContaining([expect.stringContaining('missing')]))
  })

  it('provides Phaser completion and diagnostics for checked JavaScript', () => {
    const source = `// @ts-check\n/** @type {Phaser.Scene} */\nconst scene = {};\nscene.add.;\nscene.add.image('bad', 20, 'hero');\n`
    const service = languageService({ '/phaser.d.ts': declarations, '/main.js': source }, { allowJs: true, checkJs: true })
    const position = source.indexOf('scene.add.;') + 'scene.add.'.length
    expect(service.getCompletionsAtPosition('/main.js', position, {})?.entries.map((entry) => entry.name)).toContain('image')
    expect(service.getSemanticDiagnostics('/main.js').map((diagnostic) => String(diagnostic.messageText))).toEqual(expect.arrayContaining([expect.stringContaining('number')]))
  })
})

describe('generated project typings and schemas', () => {
  it('generates deterministic in-memory unions without stale duplicate names', () => {
    const content = generateProjectTypings({
      scenes: ['Menu', 'Game', 'Game'],
      objects: ['Player', 'Camera'],
      animations: ['run', 'idle'],
      prefabs: ['assets/Prefabs/Player.phaser-prefab.json'],
      assets: ['assets/player.png', 'assets/player.png']
    })
    expect(content).toContain('type SceneKey = "Game" | "Menu";')
    expect(content).toContain('type ObjectName = "Camera" | "Player";')
    expect(content.match(/assets\/player\.png/g)).toHaveLength(1)
  })

  it('registers versioned scene, animation, prefab, and Phaser config schema matches', () => {
    const schemas = getBuiltInJsonSchemas()
    expect(schemas.map((schema) => schema.fileMatch[0])).toEqual(['**/*.phaser-scene.json', '**/*.phaser-animations.json', '**/*.phaser-prefab.json', '**/phaser-config.json'])
    expect(schemas[0]?.schema).toMatchObject({ properties: { version: { const: 3 } } })
    expect(schemas[1]?.schema).toMatchObject({ properties: { version: { const: 1 } } })
    expect(schemas[2]?.schema).toMatchObject({ properties: { version: { const: 1 } } })
  })
})

async function writeFakePhaser(root: string, version: string, declaration: string): Promise<void> {
  const packageRoot = path.join(root, 'node_modules', 'phaser')
  await fs.mkdir(path.join(packageRoot, 'types'), { recursive: true })
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'phaser', version, types: './types/phaser.d.ts' }), 'utf8')
  await fs.writeFile(path.join(packageRoot, 'types', 'phaser.d.ts'), declaration, 'utf8')
}

function languageService(files: Record<string, string>, options: ts.CompilerOptions = {}): ts.LanguageService {
  const versions = new Map(Object.keys(files).map((file) => [file, '1']))
  const compilerOptions: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, allowNonTsExtensions: true, ...options }
  return ts.createLanguageService({
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => Object.keys(files),
    getScriptVersion: (fileName) => versions.get(fileName) ?? '0',
    getScriptSnapshot: (fileName) => files[fileName] === undefined ? undefined : ts.ScriptSnapshot.fromString(files[fileName]),
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/lib.d.ts',
    fileExists: (fileName) => files[fileName] !== undefined,
    readFile: (fileName) => files[fileName],
    readDirectory: () => [],
    useCaseSensitiveFileNames: () => true
  })
}
