import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UIDiagnostic, UnityUIDocument } from './schema.js'

export interface BakeUnityUIOptions {
  outputDirectory: string
  copyPhaserRuntime?: boolean
}

export interface BakeUnityUIResult {
  outputDirectory: string
  previewHtml: string
  phaserHtml: string
  documentJson: string
  copiedResources: number
  diagnostics: UIDiagnostic[]
}

const templateNames = ['preview.html', 'preview.css', 'preview-runtime.js', 'phaser.html', 'phaser-runtime.js'] as const

export async function bakeUnityUIDocument(document: UnityUIDocument, options: BakeUnityUIOptions): Promise<BakeUnityUIResult> {
  const outputDirectory = path.resolve(options.outputDirectory)
  const assetDirectory = path.join(outputDirectory, 'assets')
  const vendorDirectory = path.join(outputDirectory, 'vendor')
  await Promise.all([mkdir(assetDirectory, { recursive: true }), mkdir(vendorDirectory, { recursive: true })])
  let copiedResources = 0

  for (const resource of Object.values(document.resources)) {
    if (!resource.sourcePath) continue
    const extension = path.extname(resource.sourcePath).toLocaleLowerCase()
    const outputName = `${safeSegment(resource.guid || 'local')}_${safeSegment(resource.fileId)}${extension}`
    const relativePath = `assets/${outputName}`
    try {
      await copyFile(resource.sourcePath, path.join(outputDirectory, ...relativePath.split('/')))
      resource.webPath = relativePath
      copiedResources++
      if ((resource.kind === 'sprite' || resource.kind === 'texture') && !isBrowserImage(extension)) {
        document.diagnostics.push({
          severity: 'warning',
          code: 'BROWSER_IMAGE_FORMAT_UNSUPPORTED',
          message: `${extension || 'Unknown image format'} cannot be displayed directly by the browser or Phaser preview.`,
          sourcePath: resource.sourcePath,
          details: { resourceId: resource.id, copiedPath: relativePath }
        })
      }
    } catch (error) {
      document.diagnostics.push({
        severity: 'error',
        code: 'RESOURCE_COPY_FAILED',
        message: error instanceof Error ? error.message : 'Resource could not be copied.',
        sourcePath: resource.sourcePath,
        details: { resourceId: resource.id }
      })
    }
  }

  refreshStatistics(document)
  const templateRoot = fileURLToPath(new URL('../templates/', import.meta.url))
  await Promise.all(templateNames.map((name) => copyFile(path.join(templateRoot, name), path.join(outputDirectory, name))))
  for (const runtimeFile of ['phaser-renderer.js', 'phaser-renderer.js.map', 'layout.js', 'layout.js.map', 'text-layout.js', 'text-layout.js.map']) {
    await copyFile(fileURLToPath(new URL(`./${runtimeFile}`, import.meta.url)), path.join(outputDirectory, runtimeFile))
  }
  if (options.copyPhaserRuntime !== false) {
    const require = createRequire(import.meta.url)
    await copyFile(require.resolve('phaser'), path.join(vendorDirectory, 'phaser.js'))
  }

  const documentJson = path.join(outputDirectory, 'ui.json')
  const dataSource = `window.__UNITY_UI_PREVIEW__ = ${serializeForScript({ documents: [document] })};\n`
  await Promise.all([
    writeFile(documentJson, `${JSON.stringify(document, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDirectory, 'preview-data.js'), dataSource, 'utf8'),
    writeFile(path.join(outputDirectory, 'conversion-report.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: document.source,
      statistics: document.statistics,
      nestedPrefabs: document.nestedPrefabs,
      diagnostics: document.diagnostics
    }, null, 2)}\n`, 'utf8')
  ])

  return {
    outputDirectory,
    previewHtml: path.join(outputDirectory, 'preview.html'),
    phaserHtml: path.join(outputDirectory, 'phaser.html'),
    documentJson,
    copiedResources,
    diagnostics: document.diagnostics
  }
}

function refreshStatistics(document: UnityUIDocument): void {
  document.statistics.resourceCount = Object.keys(document.resources).length
  document.statistics.errorCount = document.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  document.statistics.warningCount = document.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('</script', '<\\/script').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function isBrowserImage(extension: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(extension)
}
