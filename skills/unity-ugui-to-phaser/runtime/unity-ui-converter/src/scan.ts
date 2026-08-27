import { opendir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AssetIndexSummary } from './asset-index.js'

export interface UnityProjectScanReport {
  generatedAt: string
  unityVersion: string | null
  paths: { projectRoot: string; prefabRoot: string; uiRawRoot: string | null }
  prefabs: {
    count: number
    totalBytes: number
    sliced: number
    text: number
    buttons: number
    nestedPrefabInstances: number
    componentMarkers: Record<string, number>
    largest: Array<{ path: string; bytes: number }>
  }
  uiRaw: { fileCount: number; totalBytes: number; byExtension: Record<string, number> }
  assetIndex: AssetIndexSummary
}

export async function scanUnityProject(projectRoot: string, prefabRoot: string, uiRawRoot: string | null, assetIndex: AssetIndexSummary): Promise<UnityProjectScanReport> {
  const prefabFiles: Array<{ path: string; bytes: number }> = []
  const rawFiles: Array<{ path: string; bytes: number }> = []
  for await (const file of walkFiles(prefabRoot)) if (file.path.toLocaleLowerCase().endsWith('.prefab')) prefabFiles.push(file)
  if (uiRawRoot) for await (const file of walkFiles(uiRawRoot)) rawFiles.push(file)
  const componentPatterns: Record<string, RegExp> = {
    Image: /^  m_Sprite:/m, RawImage: /^  m_Texture:/m, Text: /^  m_Text:/m, TextMeshProUGUI: /^  m_text:/m,
    Button: /^  m_OnClick:$/m, Toggle: /^  m_IsOn:/m, Slider: /^  m_MaxValue:/m, ScrollRect: /^  m_Viewport:/m,
    LayoutGroup: /^  m_ChildAlignment:/m, ContentSizeFitter: /^  m_HorizontalFit:/m, AspectRatioFitter: /^  m_AspectMode:/m,
    CanvasGroup: /^  m_BlocksRaycasts:/m, Mask: /^  m_ShowMaskGraphic:/m
  }
  const componentMarkers = Object.fromEntries(Object.keys(componentPatterns).map((key) => [key, 0]))
  let sliced = 0
  let text = 0
  let buttons = 0
  let nestedPrefabInstances = 0
  await mapConcurrent(prefabFiles, 32, async (file) => {
    const source = await readFile(file.path, 'utf8')
    if (/^  m_Type: 1$/m.test(source)) sliced++
    if (/^  m_Text:/m.test(source) || /^  m_text:/m.test(source)) text++
    if (/^  m_OnClick:$/m.test(source)) buttons++
    if (/^--- !u!1001 /m.test(source)) nestedPrefabInstances++
    for (const [name, pattern] of Object.entries(componentPatterns)) if (pattern.test(source)) componentMarkers[name] = (componentMarkers[name] ?? 0) + 1
  })
  const byExtension: Record<string, number> = {}
  for (const file of rawFiles) {
    const extension = path.extname(file.path).toLocaleLowerCase() || '<none>'
    byExtension[extension] = (byExtension[extension] ?? 0) + 1
  }
  return {
    generatedAt: new Date().toISOString(),
    unityVersion: await readUnityVersion(projectRoot),
    paths: {
      projectRoot: path.resolve(projectRoot),
      prefabRoot: path.resolve(prefabRoot),
      uiRawRoot: uiRawRoot ? path.resolve(uiRawRoot) : null
    },
    prefabs: {
      count: prefabFiles.length,
      totalBytes: prefabFiles.reduce((total, file) => total + file.bytes, 0),
      sliced, text, buttons, nestedPrefabInstances, componentMarkers,
      largest: prefabFiles.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 25)
    },
    uiRaw: {
      fileCount: rawFiles.length,
      totalBytes: rawFiles.reduce((total, file) => total + file.bytes, 0),
      byExtension: Object.fromEntries(Object.entries(byExtension).sort((a, b) => b[1] - a[1]))
    },
    assetIndex
  }
}

async function readUnityVersion(projectRoot: string): Promise<string | null> {
  try {
    const source = await readFile(path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    return source.match(/^m_EditorVersion:\s*(.+)$/m)?.[1]?.trim() ?? null
  } catch { return null }
}

async function* walkFiles(directory: string): AsyncGenerator<{ path: string; bytes: number }> {
  const entries = await opendir(directory)
  for await (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(filePath)
    else if (entry.isFile()) yield { path: filePath, bytes: (await stat(filePath)).size }
  }
}

async function mapConcurrent<T>(items: T[], concurrency: number, visit: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) await visit(items[cursor++]!)
  }))
}
