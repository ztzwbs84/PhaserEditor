import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Grid3X3, Image as ImageIcon, Search } from 'lucide-react'
import type { EditorDocument, FrameSource, FrameSourceFrame } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'
import { createSpritesheetFrameSource, importPhaserAtlas, type SpritesheetGridConfig } from '../../lib/frame-sources'

interface SpritesheetDocument {
  image: string
  imageWidth: number
  imageHeight: number
  frameWidth: number
  frameHeight: number
  margin?: number
  spacing?: number
  startFrame?: number
  endFrame?: number
}

export function AtlasInspector({ document }: { document: EditorDocument }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)!
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | number | null>(null)
  const relativePath = useMemo(() => projectRelativePath(project.path, document.path), [document.path, project.path])
  const spritesheet = document.name.toLocaleLowerCase().endsWith('.phaser-spritesheet.json')
  const parsed = useMemo(() => spritesheet
    ? parseSpritesheetDocument(document.content, relativePath)
    : importPhaserAtlas(document.content, relativePath), [document.content, relativePath, spritesheet])
  const source = parsed.source
  const selected = source?.frames.find((frame) => sameFrameKey(frame.key, selectedKey)) ?? source?.frames[0] ?? null
  const visibleFrames = source?.frames.filter((frame) => String(frame.key).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? []
  const imageUrl = source ? window.editorApi.fileSystem.assetUrl(joinProjectPath(project.path, source.source.imagePath)) : ''

  useEffect(() => {
    if (source && selectedKey !== null && !source.frames.some((frame) => sameFrameKey(frame.key, selectedKey))) setSelectedKey(null)
  }, [selectedKey, source])

  const updateGrid = (field: keyof SpritesheetDocument, value: number): void => {
    try {
      const current = JSON.parse(document.content) as SpritesheetDocument
      updateDocument(document.path, `${JSON.stringify({ ...current, [field]: value }, null, 2)}\n`)
    } catch {
      // Diagnostics below keep malformed source editable as JSON.
    }
  }

  return <div className="authoring-editor atlas-inspector">
    <header className="authoring-toolbar">
      <div className="authoring-title"><ImageIcon size={15} /><strong>{spritesheet ? 'Spritesheet' : 'Texture Atlas'}</strong><span>{source ? `${source.frames.length} frames` : 'Invalid metadata'}</span></div>
      <label className="authoring-search"><Search size={13} /><input aria-label="Search frames" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search frames" /></label>
    </header>
    {spritesheet && <GridControls document={document.content} onChange={updateGrid} />}
    <div className="atlas-workspace">
      <aside className="atlas-frame-list" role="listbox" aria-label="Atlas frames">
        {visibleFrames.map((frame) => <button
          role="option"
          aria-selected={sameFrameKey(frame.key, selected?.key ?? null)}
          className={sameFrameKey(frame.key, selected?.key ?? null) ? 'selected' : ''}
          key={`${typeof frame.key}:${String(frame.key)}`}
          onClick={() => setSelectedKey(frame.key)}
        ><span>{String(frame.key)}</span><small>{frame.bounds.width} x {frame.bounds.height}</small></button>)}
        {source && visibleFrames.length === 0 && <div className="authoring-empty">No matching frames</div>}
      </aside>
      <main className="atlas-preview-pane">
        {source ? <TexturePreview source={source} imageUrl={imageUrl} selected={selected} /> : <div className="authoring-empty large"><AlertTriangle size={22} />Metadata cannot be previewed</div>}
        {selected && <div className="frame-detail-strip">
          <strong>{String(selected.key)}</strong>
          <span>X {selected.bounds.x}</span><span>Y {selected.bounds.y}</span>
          <span>W {selected.bounds.width}</span><span>H {selected.bounds.height}</span>
          <span>{selected.trimmed ? 'Trimmed' : 'Untrimmed'}</span><span>{selected.rotated ? 'Rotated' : 'Normal'}</span>
        </div>}
      </main>
      <aside className="authoring-diagnostics" aria-label="Validation diagnostics">
        <h3>Validation</h3>
        {parsed.issues.length === 0 ? <div className="diagnostic-ok">No issues</div> : parsed.issues.map((entry, index) => <div className={`diagnostic-item ${entry.severity}`} key={`${entry.path}-${index}`}><AlertTriangle size={13} /><div><strong>{entry.message}</strong><small>{entry.path}</small></div></div>)}
      </aside>
    </div>
  </div>
}

function GridControls({ document, onChange }: { document: string; onChange(field: keyof SpritesheetDocument, value: number): void }): React.JSX.Element | null {
  let value: Partial<SpritesheetDocument>
  try { value = JSON.parse(document) as Partial<SpritesheetDocument> } catch { return null }
  const controls: Array<{ field: keyof SpritesheetDocument; label: string; min: number }> = [
    { field: 'frameWidth', label: 'Frame W', min: 1 },
    { field: 'frameHeight', label: 'Frame H', min: 1 },
    { field: 'margin', label: 'Margin', min: 0 },
    { field: 'spacing', label: 'Spacing', min: 0 },
    { field: 'startFrame', label: 'Start', min: 0 },
    { field: 'endFrame', label: 'End', min: -1 }
  ]
  return <div className="spritesheet-controls"><Grid3X3 size={14} />{controls.map(({ field, label, min }) => <label key={field}><span>{label}</span><input type="number" min={min} value={typeof value[field] === 'number' ? String(value[field]) : field === 'endFrame' ? '-1' : '0'} onChange={(event) => onChange(field, Number(event.target.value))} /></label>)}</div>
}

function TexturePreview({ source, imageUrl, selected }: { source: FrameSource; imageUrl: string; selected: FrameSourceFrame | null }): React.JSX.Element {
  return <div className="texture-preview-scroll"><div className="texture-preview" style={{ aspectRatio: `${source.imageSize.width} / ${source.imageSize.height}` }}>
    <img src={imageUrl} alt={source.source.imagePath} draggable={false} />
    {source.frames.map((frame) => <span
      key={`${typeof frame.key}:${String(frame.key)}`}
      className={`frame-bounds${sameFrameKey(frame.key, selected?.key ?? null) ? ' selected' : ''}`}
      title={String(frame.key)}
      style={{ left: `${frame.bounds.x / source.imageSize.width * 100}%`, top: `${frame.bounds.y / source.imageSize.height * 100}%`, width: `${frame.bounds.width / source.imageSize.width * 100}%`, height: `${frame.bounds.height / source.imageSize.height * 100}%` }}
    />)}
  </div></div>
}

function parseSpritesheetDocument(content: string, metadataPath: string) {
  try {
    const value = JSON.parse(content) as SpritesheetDocument
    const config: SpritesheetGridConfig = {
      imagePath: resolveSibling(metadataPath, value.image),
      imageWidth: value.imageWidth,
      imageHeight: value.imageHeight,
      frameWidth: value.frameWidth,
      frameHeight: value.frameHeight,
      margin: value.margin ?? 0,
      spacing: value.spacing ?? 0,
      startFrame: value.startFrame,
      endFrame: value.endFrame === undefined || value.endFrame < 0 ? undefined : value.endFrame
    }
    return createSpritesheetFrameSource(config)
  } catch (error) {
    return { source: null, issues: [{ path: '$', code: 'invalid-json', message: error instanceof Error ? error.message : 'Invalid spritesheet JSON.', severity: 'error' as const }] }
  }
}

function projectRelativePath(projectRoot: string, fullPath: string): string {
  const root = projectRoot.replaceAll('\\', '/').replace(/\/$/, '')
  const path = fullPath.replaceAll('\\', '/')
  return path.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`) ? path.slice(root.length + 1) : path
}

function joinProjectPath(projectRoot: string, relativePath: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}\\${relativePath.replaceAll('/', '\\')}`
}

function resolveSibling(metadataPath: string, sibling: string): string {
  const segments = metadataPath.split('/').slice(0, -1)
  for (const segment of String(sibling ?? '').replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

function sameFrameKey(left: string | number | null, right: string | number | null): boolean {
  return typeof left === typeof right && left === right
}
