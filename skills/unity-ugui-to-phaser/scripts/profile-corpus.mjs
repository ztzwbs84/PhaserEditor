#!/usr/bin/env node
import { mkdir, opendir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
if (args.help || args.h) {
  printHelp()
  process.exit(0)
}

const prefabRoot = requiredPath(args['prefab-root'], '--prefab-root')
const outputPath = args.output ? path.resolve(String(args.output)) : null
const sampleSize = positiveInteger(args['sample-size'], 24)
const files = []
for await (const filePath of walkFiles(prefabRoot)) {
  if (filePath.toLocaleLowerCase().endsWith('.prefab')) files.push(filePath)
}
files.sort(comparePaths)

const featureDefinitions = {
  image: [/^  m_Sprite:/m, 2],
  rawImage: [/^  m_Texture:/m, 3],
  legacyText: [/^  m_Text:/m, 3],
  textMeshPro: [/^  m_text:/m, 4],
  slicedImage: [/^  m_Type: 1$/m, 4],
  tiledImage: [/^  m_Type: 2$/m, 5],
  filledImage: [/^  m_Type: 3$/m, 5],
  mask: [/^  m_ShowMaskGraphic:/m, 5],
  rectMask2D: [/^  m_Softness:/m, 5],
  scrollRect: [/^  m_Viewport:/m, 5],
  layoutGroup: [/^  m_ChildAlignment:/m, 4],
  contentSizeFitter: [/^  m_HorizontalFit:/m, 4],
  aspectRatioFitter: [/^  m_AspectMode:/m, 5],
  canvasGroup: [/^  m_BlocksRaycasts:/m, 3],
  nestedPrefab: [/^--- !u!1001\b/m, 6],
  material: [/^  m_Material:/m, 5],
  animation: [/^--- !u!95\b/m, 5]
}

const prefabs = []
const componentSignatures = new Map()
for (const filePath of files) {
  const source = await readFile(filePath, 'utf8')
  const fileStat = await stat(filePath)
  const features = {}
  let risk = Math.log2(fileStat.size + 1)
  for (const [name, [pattern, weight]] of Object.entries(featureDefinitions)) {
    const count = countMatches(source, pattern)
    features[name] = count
    risk += Math.min(count, 20) * weight
  }
  const monoBehaviours = readMonoBehaviours(source)
  risk += Math.min(monoBehaviours.length, 40) * 0.5
  for (const component of monoBehaviours) {
    const key = `${component.guid}:${component.fileId}|${component.fields.join(',')}`
    const entry = componentSignatures.get(key) ?? { ...component, count: 0, prefabs: new Set() }
    entry.count++
    entry.prefabs.add(normalizeRelative(path.relative(prefabRoot, filePath)))
    componentSignatures.set(key, entry)
  }
  prefabs.push({
    relativePath: normalizeRelative(path.relative(prefabRoot, filePath)),
    bytes: fileStat.size,
    riskScore: Number(risk.toFixed(2)),
    features,
    monoBehaviourCount: monoBehaviours.length
  })
}

const corpus = selectCorpus(prefabs, sampleSize, Object.keys(featureDefinitions))
const featureTotals = {}
for (const name of Object.keys(featureDefinitions)) {
  featureTotals[name] = prefabs.reduce((total, prefab) => total + prefab.features[name], 0)
}

const report = {
  generatedAt: new Date().toISOString(),
  prefabRoot,
  prefabCount: prefabs.length,
  totalBytes: prefabs.reduce((total, prefab) => total + prefab.bytes, 0),
  featureTotals,
  corpus,
  largest: prefabs.slice().sort((a, b) => b.bytes - a.bytes || comparePaths(a.relativePath, b.relativePath)).slice(0, Math.min(25, prefabs.length)),
  componentSignatures: [...componentSignatures.values()]
    .map((entry) => ({ guid: entry.guid, fileId: entry.fileId, fields: entry.fields, count: entry.count, prefabCount: entry.prefabs.size }))
    .sort((a, b) => b.count - a.count || comparePaths(`${a.guid}:${a.fileId}`, `${b.guid}:${b.fileId}`))
}

if (outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify({
  output: outputPath,
  prefabs: report.prefabCount,
  bytes: report.totalBytes,
  selected: corpus.length,
  featureTotals,
  corpus: corpus.map((entry) => entry.relativePath)
}, null, 2))

function selectCorpus(prefabs, limit, featureNames) {
  const selected = new Map()
  const ranked = prefabs.slice().sort((a, b) => b.riskScore - a.riskScore || b.bytes - a.bytes || comparePaths(a.relativePath, b.relativePath))
  const largest = prefabs.slice().sort((a, b) => b.bytes - a.bytes || comparePaths(a.relativePath, b.relativePath))
  for (const prefab of largest.slice(0, Math.min(5, limit))) selected.set(prefab.relativePath, { ...prefab, reasons: ['largest'] })
  for (const feature of featureNames) {
    const candidate = ranked.find((prefab) => prefab.features[feature] > 0)
    if (!candidate) continue
    const existing = selected.get(candidate.relativePath)
    if (existing) existing.reasons.push(`feature:${feature}`)
    else if (selected.size < limit) selected.set(candidate.relativePath, { ...candidate, reasons: [`feature:${feature}`] })
  }
  for (const prefab of ranked) {
    if (selected.size >= limit) break
    if (!selected.has(prefab.relativePath)) selected.set(prefab.relativePath, { ...prefab, reasons: ['risk-score'] })
  }
  return [...selected.values()].map((entry) => ({ ...entry, reasons: [...new Set(entry.reasons)] }))
}

function readMonoBehaviours(source) {
  const result = []
  for (const block of source.split(/(?=^--- !u!)/m)) {
    if (!/^--- !u!114\b/m.test(block)) continue
    const script = block.match(/^  m_Script:\s*\{fileID:\s*([^,}]+)(?:,\s*guid:\s*([0-9a-f]{32}))?/m)
    const fields = [...block.matchAll(/^  ([A-Za-z_][\w]*):/gm)]
      .map((match) => match[1])
      .filter((name) => !['m_ObjectHideFlags', 'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset', 'm_GameObject', 'm_Enabled', 'm_EditorHideFlags', 'm_Script', 'm_Name', 'm_EditorClassIdentifier'].includes(name))
      .slice(0, 40)
    result.push({ guid: script?.[2] ?? '', fileId: script?.[1]?.trim() ?? '0', fields })
  }
  return result
}

function countMatches(source, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...source.matchAll(new RegExp(pattern.source, flags))].length
}

async function* walkFiles(directory) {
  const entries = await opendir(directory)
  for await (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(filePath)
    else if (entry.isFile()) yield filePath
  }
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

function positiveInteger(value, fallback) {
  const number = value == null ? fallback : Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error('--sample-size must be a positive integer.')
  return number
}

function normalizeRelative(value) { return value.replaceAll('\\', '/') }
function comparePaths(a, b) { return a.localeCompare(b, 'en', { sensitivity: 'base' }) }
function printHelp() {
  console.log('Profile Unity UGUI Prefabs and select a deterministic risk corpus.\n\nRequired:\n  --prefab-root <directory>\n\nOptional:\n  --output <json-file>\n  --sample-size <count>')
}
