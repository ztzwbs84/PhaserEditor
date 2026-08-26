import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UnityAssetIndex } from './asset-index.js'
import { bakeUnityUIDocument } from './bake.js'
import { convertUnityPrefab, type ConvertPrefabOptions } from './converter.js'

export interface BatchBakeEntry {
  prefabPath: string
  relativePath: string
  outputPath: string
  previewPath: string | null
  phaserPath: string | null
  status: 'passed' | 'failed'
  durationMs: number
  nodes: number
  resources: number
  components: Record<string, number>
  nestedPrefabs: number
  warnings: number
  errors: number
  diagnosticCodes: Record<string, number>
  failure?: string
}

export interface BatchBakeReport {
  generatedAt: string
  prefabRoot: string
  outputRoot: string
  total: number
  passed: number
  failed: number
  totalNodes: number
  totalResources: number
  totalWarnings: number
  totalErrors: number
  componentCoverage: Record<string, number>
  entries: BatchBakeEntry[]
}

export interface BatchBakeOptions {
  prefabRoot: string
  prefabPaths: string[]
  outputRoot: string
  assetIndex: UnityAssetIndex
  convert?: ConvertPrefabOptions
}

export async function bakeUnityUIBatch(options: BatchBakeOptions): Promise<BatchBakeReport> {
  const prefabRoot = path.resolve(options.prefabRoot)
  const outputRoot = path.resolve(options.outputRoot)
  await mkdir(outputRoot, { recursive: true })
  const entries: BatchBakeEntry[] = []

  for (const configuredPath of options.prefabPaths) {
    const prefabPath = path.isAbsolute(configuredPath) ? path.resolve(configuredPath) : path.resolve(prefabRoot, configuredPath)
    const relativePath = normalizeRelative(path.relative(prefabRoot, prefabPath))
    const relativeWithoutExtension = relativePath.replace(/\.prefab$/i, '')
    const outputPath = path.join(outputRoot, 'batch', ...relativeWithoutExtension.split('/'))
    const startedAt = performance.now()
    try {
      const document = await convertUnityPrefab(prefabPath, options.assetIndex, options.convert)
      const result = await bakeUnityUIDocument(document, { outputDirectory: outputPath })
      entries.push({
        prefabPath,
        relativePath,
        outputPath,
        previewPath: result.previewHtml,
        phaserPath: result.phaserHtml,
        status: document.statistics.errorCount > 0 ? 'failed' : 'passed',
        durationMs: Math.round(performance.now() - startedAt),
        nodes: document.statistics.nodeCount,
        resources: document.statistics.resourceCount,
        components: document.statistics.componentCounts,
        nestedPrefabs: document.nestedPrefabs.length,
        warnings: document.statistics.warningCount,
        errors: document.statistics.errorCount,
        diagnosticCodes: countCodes(document.diagnostics.map((diagnostic) => diagnostic.code))
      })
    } catch (error) {
      entries.push({
        prefabPath,
        relativePath,
        outputPath,
        previewPath: null,
        phaserPath: null,
        status: 'failed',
        durationMs: Math.round(performance.now() - startedAt),
        nodes: 0,
        resources: 0,
        components: {},
        nestedPrefabs: 0,
        warnings: 0,
        errors: 1,
        diagnosticCodes: { BATCH_BAKE_FAILED: 1 },
        failure: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const componentCoverage: Record<string, number> = {}
  for (const entry of entries) {
    for (const [component, count] of Object.entries(entry.components)) componentCoverage[component] = (componentCoverage[component] ?? 0) + count
  }
  const report: BatchBakeReport = {
    generatedAt: new Date().toISOString(),
    prefabRoot,
    outputRoot,
    total: entries.length,
    passed: entries.filter((entry) => entry.status === 'passed').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
    totalNodes: entries.reduce((total, entry) => total + entry.nodes, 0),
    totalResources: entries.reduce((total, entry) => total + entry.resources, 0),
    totalWarnings: entries.reduce((total, entry) => total + entry.warnings, 0),
    totalErrors: entries.reduce((total, entry) => total + entry.errors, 0),
    componentCoverage,
    entries
  }
  await Promise.all([
    writeFile(path.join(outputRoot, 'batch-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputRoot, 'index.html'), renderBatchIndex(report), 'utf8')
  ])
  return report
}

function renderBatchIndex(report: BatchBakeReport): string {
  const rows = report.entries.map((entry) => {
    const relativeOutput = normalizeRelative(path.relative(report.outputRoot, entry.outputPath))
    const links = entry.status === 'passed'
      ? `<a href="${encodeURI(`${relativeOutput}/preview.html`)}">HTML</a><a href="${encodeURI(`${relativeOutput}/phaser.html`)}">Phaser</a>`
      : ''
    return `<tr class="${entry.status}"><td>${escapeHtml(entry.relativePath)}</td><td>${entry.status}</td><td>${entry.nodes}</td><td>${entry.resources}</td><td>${entry.nestedPrefabs}</td><td>${entry.warnings}</td><td>${entry.errors}</td><td>${entry.durationMs}</td><td class="links">${links}</td></tr>`
  }).join('\n')
  const components = Object.entries(report.componentCoverage).sort((a, b) => b[1] - a[1]).map(([name, count]) => `<span>${escapeHtml(name)} <b>${count}</b></span>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Unity UI Batch</title>
<style>*{box-sizing:border-box}body{margin:0;background:#17191b;color:#e6e2da;font:13px/1.45 Segoe UI,Arial,sans-serif}header{padding:16px 20px;border-bottom:1px solid #414548;background:#222527}h1{margin:0 0 8px;font-size:19px;letter-spacing:0}.summary,.components{display:flex;flex-wrap:wrap;gap:8px 18px;color:#bcb8af}.components{padding:10px 20px;border-bottom:1px solid #35393b}.components span{white-space:nowrap}.components b{color:#71d4c3}main{padding:14px 20px;overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:7px 9px;border-bottom:1px solid #34383a;text-align:right}th{position:sticky;top:0;background:#292c2e;color:#bbb7ae}th:first-child,td:first-child{text-align:left}.failed{color:#ef8177}.links{display:flex;justify-content:flex-end;gap:10px}.links a{color:#6bd2c1;text-decoration:none}@media(max-width:700px){header,main{padding-inline:10px}.components{padding-inline:10px}}</style></head>
<body><header><h1>Unity UI Batch</h1><div class="summary"><span>Total <b>${report.total}</b></span><span>Passed <b>${report.passed}</b></span><span>Failed <b>${report.failed}</b></span><span>Nodes <b>${report.totalNodes}</b></span><span>Resources <b>${report.totalResources}</b></span><span>Warnings <b>${report.totalWarnings}</b></span><span>Errors <b>${report.totalErrors}</b></span></div></header><div class="components">${components}</div><main><table><thead><tr><th>Prefab</th><th>Status</th><th>Nodes</th><th>Resources</th><th>Nested</th><th>Warnings</th><th>Errors</th><th>ms</th><th>Preview</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>\n`
}

function countCodes(codes: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1
  return counts
}

function normalizeRelative(value: string): string { return value.replaceAll('\\', '/') }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!) }
