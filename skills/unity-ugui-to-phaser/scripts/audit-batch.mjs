#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
if (args.help || args.h) {
  printHelp()
  process.exit(0)
}

const batchReportPath = requiredPath(args['batch-report'], '--batch-report')
const outputPath = args.output ? path.resolve(String(args.output)) : path.join(path.dirname(batchReportPath), 'commercial-audit.json')
const allowedWarningCodes = new Set(csvValues(args['allow-warning-code']))
const allowedVisualComponentGuids = new Set(csvValues(args['allow-visual-component-guid']))
const batch = JSON.parse(await readFile(batchReportPath, 'utf8'))
const issues = []
const diagnosticCounts = {}
const unsupportedOverridePaths = {}
const unknownVisualComponents = {}
const requiredArtifacts = [
  'ui.json',
  'conversion-report.json',
  'preview.html',
  'phaser.html',
  'preview-data.js',
  'preview-runtime.js',
  'phaser-runtime.js',
  'layout.js',
  'text-layout.js',
  'phaser-renderer.js'
]

for (const entry of batch.entries ?? []) {
  const prefab = entry.relativePath ?? entry.prefabPath ?? '<unknown>'
  if (entry.status !== 'passed') addIssue('error', 'BATCH_ENTRY_FAILED', prefab, entry.failure ?? 'Batch entry did not pass fatal conversion.')
  for (const artifact of requiredArtifacts) {
    const filePath = path.join(entry.outputPath, artifact)
    if (!(await exists(filePath))) addIssue('error', 'REQUIRED_ARTIFACT_MISSING', prefab, artifact, { filePath })
  }
  const documentPath = path.join(entry.outputPath, 'ui.json')
  if (!(await exists(documentPath))) continue
  let document
  try {
    document = JSON.parse(await readFile(documentPath, 'utf8'))
  } catch (error) {
    addIssue('error', 'DOCUMENT_INVALID', prefab, error instanceof Error ? error.message : String(error))
    continue
  }

  for (const diagnostic of document.diagnostics ?? []) {
    const key = `${diagnostic.severity}:${diagnostic.code}`
    diagnosticCounts[key] = (diagnosticCounts[key] ?? 0) + 1
    if (diagnostic.severity === 'error') {
      addIssue('error', diagnostic.code, prefab, diagnostic.message, diagnostic)
      continue
    }
    if (diagnostic.code === 'PREFAB_OVERRIDE_UNSUPPORTED') {
      const propertyPath = diagnostic.propertyPath || '<unknown>'
      unsupportedOverridePaths[propertyPath] = (unsupportedOverridePaths[propertyPath] ?? 0) + 1
      if (looksVisualProperty(propertyPath)) addIssue('error', 'VISUAL_OVERRIDE_UNSUPPORTED', prefab, diagnostic.message, diagnostic)
    }
    if (diagnostic.code === 'COMPONENT_UNSUPPORTED' && looksVisualFields(diagnostic.details?.fields)) {
      const guid = componentGuid(diagnostic.message)
      const signature = `${guid}|${(diagnostic.details?.fields ?? []).join(',')}`
      unknownVisualComponents[signature] = (unknownVisualComponents[signature] ?? 0) + 1
      if (!allowedVisualComponentGuids.has(guid)) addIssue('error', 'VISUAL_COMPONENT_UNSUPPORTED', prefab, diagnostic.message, diagnostic)
    }
    if (diagnostic.severity === 'warning' && !allowedWarningCodes.has(diagnostic.code)) {
      addIssue('warning', 'UNWAIVED_WARNING', prefab, diagnostic.message, diagnostic)
    }
  }

  const resources = document.resources ?? {}
  for (const node of document.nodes ?? []) {
    for (const component of node.components ?? []) {
      if (!component.resourceId) continue
      const resource = resources[component.resourceId]
      if (!resource || !resource.sourcePath) {
        addIssue('error', 'PRESENTATION_RESOURCE_UNRESOLVED', prefab, `Resource ${component.resourceId} used by ${node.name} is unresolved.`, {
          nodeId: node.id,
          componentId: component.id,
          componentType: component.type,
          resourceId: component.resourceId
        })
      } else if (!resource.webPath && ['image', 'raw-image', 'text', 'text-mesh-pro'].includes(component.type)) {
        addIssue('error', 'PRESENTATION_RESOURCE_NOT_BAKED', prefab, `Resource ${component.resourceId} used by ${node.name} has no baked web path.`, {
          nodeId: node.id,
          componentId: component.id,
          componentType: component.type,
          resourceId: component.resourceId
        })
      }
    }
  }
}

const blockers = issues.filter((issue) => issue.severity === 'error' || issue.severity === 'warning')
const report = {
  generatedAt: new Date().toISOString(),
  batchReport: batchReportPath,
  status: blockers.length === 0 ? 'passed' : 'failed',
  entries: batch.entries?.length ?? 0,
  issueCount: issues.length,
  blockerCount: blockers.length,
  diagnosticCounts: sortRecord(diagnosticCounts),
  unsupportedOverridePaths: sortRecord(unsupportedOverridePaths),
  unknownVisualComponents: sortRecord(unknownVisualComponents),
  waivers: {
    warningCodes: [...allowedWarningCodes].sort(),
    visualComponentGuids: [...allowedVisualComponentGuids].sort()
  },
  issues
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  output: outputPath,
  status: report.status,
  entries: report.entries,
  blockers: report.blockerCount,
  topDiagnostics: Object.entries(report.diagnosticCounts).slice(0, 12),
  topUnsupportedOverrides: Object.entries(report.unsupportedOverridePaths).slice(0, 12),
  topUnknownVisualComponents: Object.entries(report.unknownVisualComponents).slice(0, 12)
}, null, 2))
if (blockers.length > 0) process.exitCode = 1

function looksVisualProperty(value) {
  return /(?:color|material|sprite|texture|font|text|gradient|outline|shadow|effect|spacing|padding|cellsize|constraint|aspect|fit|alpha|softness|fill|preserveaspect|pixelsperunit|type$|anchoredposition|sizedelta|anchormin|anchormax|pivot|localscale|localrotation|localeuler|renderqueue|gray|circle|mesh|uvrect)/i.test(String(value))
}

function looksVisualFields(fields) {
  return Array.isArray(fields) && fields.some((field) => looksVisualProperty(field))
}

function componentGuid(message) {
  return String(message).match(/MonoBehaviour\s+([^:]+):/)?.[1] ?? '<unknown>'
}

function addIssue(severity, code, prefab, message, details) {
  issues.push({ severity, code, prefab, message, ...(details ? { details } : {}) })
}

async function exists(filePath) {
  try { await access(filePath); return true } catch { return false }
}

function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function csvValues(value) {
  if (value == null || value === true) return []
  return String(value).split(/[;,]/).map((entry) => entry.trim()).filter(Boolean)
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) result[key] = true
    else { result[key] = next; index++ }
  }
  return result
}

function requiredPath(value, name) {
  if (!value || value === true) throw new Error(`${name} is required.`)
  return path.resolve(String(value))
}

function printHelp() {
  console.log('Audit baked Unity UGUI output with strict commercial gates.\n\nRequired:\n  --batch-report <json-file>\n\nOptional:\n  --output <json-file>\n  --allow-warning-code <code-list>\n  --allow-visual-component-guid <guid-list>')
}
