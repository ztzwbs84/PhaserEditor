import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PhaserDeclarationBundle } from '@phaser-editor/contracts'

export async function resolvePhaserDeclarations(projectRoot: string | null, fallbackRoot: string): Promise<PhaserDeclarationBundle> {
  if (projectRoot) {
    const project = await readPhaserPackage(path.join(projectRoot, 'node_modules', 'phaser'), 'project')
    if (project) return project
  }
  const fallback = await readPhaserPackage(path.join(fallbackRoot, 'node_modules', 'phaser'), 'fallback')
  if (!fallback) throw new Error('Bundled Phaser declarations are unavailable.')
  return fallback
}

async function readPhaserPackage(packageRoot: string, source: PhaserDeclarationBundle['source']): Promise<PhaserDeclarationBundle | null> {
  try {
    const packageJsonPath = path.join(packageRoot, 'package.json')
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { version?: unknown; types?: unknown; typings?: unknown }
    const declarationEntry = typeof packageJson.types === 'string' ? packageJson.types : typeof packageJson.typings === 'string' ? packageJson.typings : 'types/phaser.d.ts'
    const declarationPath = path.resolve(packageRoot, declarationEntry)
    const stat = await fs.stat(declarationPath)
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return null
    return {
      source,
      version: typeof packageJson.version === 'string' ? packageJson.version : 'unknown',
      declarationPath,
      content: await fs.readFile(declarationPath, 'utf8')
    }
  } catch {
    return null
  }
}
