import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isPathInside, normalizeForComparison, resolveSpawnCommand } from '../src/main/domain'
import { inspectProject } from '../src/main/project-service'
import { inferLocalUrl, inferRunUrl, resolveDefaultRunConfiguration } from '../src/main/runner-service'
import { fillRect, getTile, parseTiled, serializeTiled, setTile, type TiledDocument } from '../src/renderer/src/lib/tiled'
import { convertColor, rgbaToHex } from '../src/renderer/src/lib/colors'
import { formatCommandLine, parseCommandLine } from '../src/shared/command-line'

function mapFixture(): TiledDocument {
  return {
    width: 4,
    height: 3,
    tilewidth: 16,
    tileheight: 16,
    orientation: 'orthogonal',
    customEditorField: { preserved: true },
    tilesets: [{ firstgid: 1, name: 'tiles', image: 'tiles.png', tilewidth: 16, tileheight: 16 }],
    layers: [{ id: 1, name: 'Ground', type: 'tilelayer', width: 4, height: 3, data: new Array(12).fill(0) }]
  }
}

describe('path containment', () => {
  it('accepts descendants and rejects sibling-prefix paths', () => {
    expect(isPathInside('C:\\games\\demo', 'C:\\games\\demo\\src\\main.ts')).toBe(true)
    expect(isPathInside('C:\\games\\demo', 'C:\\games\\demo-escape\\file.ts')).toBe(false)
  })

  it('normalizes Windows path casing', () => {
    if (process.platform === 'win32') expect(normalizeForComparison('C:\\Games')).toContain('c:\\games')
  })

  it('routes Windows command scripts through ComSpec without enabling a shell', () => {
    const command = resolveSpawnCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['start'])
    if (process.platform === 'win32') {
      expect(command.executable.toLocaleLowerCase()).toContain('cmd.exe')
      expect(command.args).toEqual(['/d', '/s', '/c', 'npm.cmd', 'start'])
    } else {
      expect(command).toEqual({ executable: 'npm', args: ['start'] })
    }
  })
})

describe('project detection and launch configuration', () => {
  it('recognizes a Phaser examples repository from marker files without a phaser dependency', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phaser-editor-project-'))
    try {
      await fs.mkdir(path.join(root, 'public'))
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'phaser-examples', scripts: { start: 'http-server public' } }))
      await fs.writeFile(path.join(root, 'README.md'), '# Phaser 4 Examples\n')
      const project = await inspectProject(root)
      expect(project.valid).toBe(true)
      expect(project.phaserVersion).toBe('4')
      expect(project.folders).toContain('public')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('selects the first conventional run script', () => {
    expect(resolveDefaultRunConfiguration({
      name: 'demo', path: 'C:\\demo', phaserVersion: '4', packageManager: 'pnpm', scripts: { dev: 'vite' }, dependencies: {}, folders: [], lastOpenedAt: '', valid: true
    })).toEqual({ executable: 'pnpm', args: ['run', 'dev'] })
  })

  it('derives an embedded preview URL from standard server arguments', () => {
    expect(inferLocalUrl(['public', '--host', '0.0.0.0', '--port=4173'])).toBe('http://127.0.0.1:4173/')
    expect(inferLocalUrl(['-a', 'localhost', '-p', '8080'])).toBe('http://localhost:8080/')
    expect(inferLocalUrl(['--host', 'example.com', '--port', '8080'])).toBeUndefined()
  })

  it('derives the preview URL from the package script behind yarn run', () => {
    const project = {
      name: 'examples', path: 'C:\\examples', phaserVersion: '4', packageManager: 'yarn' as const,
      scripts: { start: 'http-server public -s -a 127.0.0.1 -p 8080' }, dependencies: {}, folders: ['public'], lastOpenedAt: '', valid: true
    }
    expect(inferRunUrl(project, { executable: 'yarn', args: ['run', 'start'] })).toBe('http://127.0.0.1:8080/')
  })
})

describe('command-line arguments', () => {
  it('preserves quoted groups, empty values, escapes and Windows paths', () => {
    expect(parseCommandLine('run dev --title "My Game" --path \'C:\\Program Files\\game\' --label=hello\\ world ""')).toEqual([
      'run', 'dev', '--title', 'My Game', '--path', 'C:\\Program Files\\game', '--label=hello world', ''
    ])
    const args = ['run', 'dev', '--title', 'My Game', '--path', 'C:\\Program Files\\game', 'say "hello"', '']
    expect(parseCommandLine(formatCommandLine(args))).toEqual(args)
  })
})

describe('Tiled document model', () => {
  it('edits finite orthogonal tile layers and preserves unknown fields', () => {
    const map = mapFixture()
    expect(setTile(map, 1, 2, 1, 9)).toBe(true)
    fillRect(map, 1, 0, 0, 1, 1, 3)
    expect(getTile(map, 1, 2, 1)).toBe(9)
    expect(getTile(map, 1, 1, 1)).toBe(3)
    const parsed = JSON.parse(serializeTiled(map)) as TiledDocument
    expect(parsed.customEditorField).toEqual({ preserved: true })
    expect(parseTiled(serializeTiled(parsed)).editable).toBe(true)
  })

  it('marks unsupported map formats read-only', () => {
    const map = { ...mapFixture(), infinite: true, orientation: 'isometric' }
    const validation = parseTiled(JSON.stringify(map))
    expect(validation.document).not.toBeNull()
    expect(validation.editable).toBe(false)
    expect(validation.issues).toHaveLength(2)
  })
})

describe('color conversion', () => {
  it('converts CSS colors and keeps alpha in sampled pixels', () => {
    expect(convertColor('rgb(57, 181, 74)')?.hex).toBe('#39B54A')
    expect(rgbaToHex(255, 0, 128, 128)).toBe('#FF008080')
  })
})
