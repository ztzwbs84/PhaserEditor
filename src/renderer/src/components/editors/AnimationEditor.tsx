import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  AuthoringDocumentError,
  createAnimationClip,
  parseAnimationAsset,
  serializeAnimationAsset,
  validateAnimationFrameReferences,
  type AnimationAsset,
  type AnimationClip,
  type EditorDocument,
  type FrameSource
} from '@phaser-editor/contracts'
import { importPhaserAtlas } from '../../lib/frame-sources'
import { useAuthoringHistoryStore } from '../../store/authoring-history-store'
import { useEditorStore } from '../../store/editor-store'

export function AnimationEditor({ document }: { document: EditorDocument }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)!
  const loadHistory = useAuthoringHistoryStore((state) => state.load)
  const commitHistory = useAuthoringHistoryStore((state) => state.commit)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [frameIndex, setFrameIndex] = useState(0)
  const [sources, setSources] = useState<Record<string, FrameSource>>({})

  useEffect(() => { loadHistory(document.path, document.content) }, [document.content, document.path, loadHistory])

  const parsed = useMemo(() => {
    try { return { asset: parseAnimationAsset(document.content), issues: [] } }
    catch (error) { return { asset: null, issues: error instanceof AuthoringDocumentError ? error.issues : [] } }
  }, [document.content])
  const asset = parsed.asset
  const clip = asset?.clips.find((candidate) => candidate.id === selectedId) ?? asset?.clips[0] ?? null
  const sourceList = Object.values(sources)
  const diagnostics = asset ? validateAnimationFrameReferences(asset, sourceList) : []

  useEffect(() => {
    let cancelled = false
    const paths = [...new Set((asset?.clips ?? []).flatMap((candidate) => candidate.frames.map((frame) => frame.source)))]
    void Promise.all(paths.map(async (relativePath) => {
      const result = await window.editorApi.fileSystem.read(joinProjectPath(project.path, relativePath))
      if (!result.ok) return null
      const imported = importPhaserAtlas(result.value.content, relativePath)
      return imported.source ? [relativePath, imported.source] as const : null
    })).then((entries) => {
      if (!cancelled) setSources(Object.fromEntries(entries.filter((entry): entry is readonly [string, FrameSource] => Boolean(entry))))
    })
    return () => { cancelled = true }
  }, [asset, project.path])

  const commit = useCallback((next: AnimationAsset): void => {
    try { commitHistory(document.path, serializeAnimationAsset(next)) } catch (error) {
      useEditorStore.getState().notify('warning', error instanceof Error ? error.message : 'Animation change is invalid.')
    }
  }, [commitHistory, document.path])

  const updateClip = (nextClip: AnimationClip): void => {
    if (!asset) return
    commit({ ...asset, clips: asset.clips.map((candidate) => candidate.id === nextClip.id ? nextClip : candidate) })
  }

  useEffect(() => {
    if (!playing || !clip || clip.frames.length < 2) return
    const frameDuration = clip.duration ? clip.duration / clip.frames.length : 1000 / (clip.frameRate ?? 24)
    const timer = window.setInterval(() => setFrameIndex((index) => (index + 1) % clip.frames.length), Math.max(16, frameDuration))
    return () => window.clearInterval(timer)
  }, [clip?.duration, clip?.frameRate, clip?.frames.length, playing])

  useEffect(() => { setFrameIndex(0); setPlaying(false) }, [clip?.id])
  useEffect(() => { if (clip && frameIndex >= clip.frames.length) setFrameIndex(0) }, [clip, frameIndex])

  const activeFrame = clip?.frames[frameIndex]
  const activeSource = activeFrame ? sources[activeFrame.source] : undefined
  const activeFrameModel = activeSource?.frames.find((candidate) => typeof candidate.key === typeof activeFrame?.frame && candidate.key === activeFrame?.frame)

  if (!asset) return <div className="authoring-editor invalid-authoring"><strong>Invalid animation asset</strong>{parsed.issues.map((entry) => <span key={`${entry.path}-${entry.message}`}>{entry.path}: {entry.message}</span>)}</div>

  return <div className="authoring-editor animation-editor">
    <header className="authoring-toolbar">
      <div className="authoring-title"><strong>Animations</strong><span>{asset.clips.length} clips</span></div>
      <button className="icon-button compact" title="Create animation" onClick={() => {
        const next = createAnimationClip(uniqueClipKey(asset, 'animation'))
        commit({ ...asset, clips: [...asset.clips, next] })
        setSelectedId(next.id)
      }}><Plus size={14} /></button>
      <button className="icon-button compact" title="Delete animation" disabled={!clip} onClick={() => {
        if (!clip) return
        commit({ ...asset, clips: asset.clips.filter((candidate) => candidate.id !== clip.id) })
        setSelectedId(null)
      }}><Trash2 size={14} /></button>
    </header>
    <div className="animation-workspace">
      <aside className="animation-clip-list" role="listbox" aria-label="Animation clips">
        {asset.clips.map((candidate) => <button key={candidate.id} className={candidate.id === clip?.id ? 'selected' : ''} aria-selected={candidate.id === clip?.id} role="option" onClick={() => setSelectedId(candidate.id)}><strong>{candidate.key}</strong><small>{candidate.frames.length} frames</small></button>)}
        {asset.clips.length === 0 && <div className="authoring-empty">No animation clips</div>}
      </aside>
      <main className="animation-main">
        {clip ? <>
          <section className="animation-preview">
            {activeSource && activeFrameModel ? <FramePreview source={activeSource} frame={activeFrameModel} projectRoot={project.path} /> : <div className="preview-missing">Missing frame</div>}
            <div className="playback-controls">
              <button className="icon-button" title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
              <button className="icon-button" title="Restart" onClick={() => { setFrameIndex(0); setPlaying(true) }}><RotateCcw size={15} /></button>
              <input aria-label="Animation frame" type="range" min={0} max={Math.max(0, clip.frames.length - 1)} value={frameIndex} onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)) }} />
              <span>{clip.frames.length ? frameIndex + 1 : 0} / {clip.frames.length}</span>
            </div>
          </section>
          <section className="animation-properties">
            <h3>Playback</h3>
            <div className="authoring-field-grid">
              <CommitInput label="Key" value={clip.key} onCommit={(value) => updateClip({ ...clip, key: value })} />
              <SelectInput label="Timing" value={clip.duration === null ? 'frameRate' : 'duration'} options={[['frameRate', 'Frame rate'], ['duration', 'Duration']]} onChange={(value) => updateClip(value === 'duration' ? { ...clip, duration: 1000, frameRate: null } : { ...clip, duration: null, frameRate: 24 })} />
              {clip.duration === null
                ? <NumberInput label="FPS" value={clip.frameRate ?? 24} min={0.1} onCommit={(value) => updateClip({ ...clip, frameRate: value })} />
                : <NumberInput label="Duration ms" value={clip.duration} min={1} onCommit={(value) => updateClip({ ...clip, duration: Math.round(value) })} />}
              <NumberInput label="Delay ms" value={clip.delay} min={0} onCommit={(value) => updateClip({ ...clip, delay: Math.round(value) })} />
              <NumberInput label="Repeat" value={clip.repeat} min={-1} onCommit={(value) => updateClip({ ...clip, repeat: Math.round(value) })} />
              <NumberInput label="Repeat delay" value={clip.repeatDelay} min={0} onCommit={(value) => updateClip({ ...clip, repeatDelay: Math.round(value) })} />
              <label className="authoring-check"><span>Yoyo</span><input type="checkbox" checked={clip.yoyo} onChange={(event) => updateClip({ ...clip, yoyo: event.target.checked })} /></label>
              <label className="authoring-check"><span>Skip missed</span><input type="checkbox" checked={clip.skipMissedFrames} onChange={(event) => updateClip({ ...clip, skipMissedFrames: event.target.checked })} /></label>
            </div>
          </section>
          <section className="animation-frames">
            <div className="authoring-section-title"><h3>Frames</h3><button className="icon-button compact" title="Add frame" onClick={() => updateClip({ ...clip, frames: [...clip.frames, clip.frames.at(-1) ?? { source: 'assets/atlas.json', frame: 0 }] })}><Plus size={13} /></button></div>
            <div className="animation-frame-table">
              {clip.frames.map((frame, index) => <div className={index === frameIndex ? 'active' : ''} key={`${index}-${frame.source}-${String(frame.frame)}`} onClick={() => { setPlaying(false); setFrameIndex(index) }}>
                <span>{index + 1}</span>
                <CommitInput label="Source" compact value={frame.source} onCommit={(value) => updateClip({ ...clip, frames: replaceAt(clip.frames, index, { ...frame, source: value }) })} />
                <CommitInput label="Frame" compact value={String(frame.frame)} onCommit={(value) => updateClip({ ...clip, frames: replaceAt(clip.frames, index, { ...frame, frame: parseFrameKey(value) }) })} />
                <button className="icon-button compact" title="Move frame up" disabled={index === 0} onClick={(event) => { event.stopPropagation(); updateClip({ ...clip, frames: moveItem(clip.frames, index, index - 1) }) }}><ChevronUp size={12} /></button>
                <button className="icon-button compact" title="Move frame down" disabled={index === clip.frames.length - 1} onClick={(event) => { event.stopPropagation(); updateClip({ ...clip, frames: moveItem(clip.frames, index, index + 1) }) }}><ChevronDown size={12} /></button>
                <button className="icon-button compact" title="Remove frame" disabled={clip.frames.length === 1} onClick={(event) => { event.stopPropagation(); updateClip({ ...clip, frames: clip.frames.filter((_item, candidate) => candidate !== index) }) }}><Trash2 size={12} /></button>
              </div>)}
            </div>
          </section>
        </> : <div className="authoring-empty large">Create an animation clip to begin</div>}
      </main>
      <aside className="authoring-diagnostics"><h3>Diagnostics</h3>{diagnostics.length === 0 ? <div className="diagnostic-ok">No missing frames</div> : diagnostics.map((entry) => <div className={`diagnostic-item ${entry.severity}`} key={`${entry.path}-${entry.message}`}><div><strong>{entry.message}</strong><small>{entry.path}</small></div></div>)}</aside>
    </div>
  </div>
}

function FramePreview({ source, frame, projectRoot }: { source: FrameSource; frame: FrameSource['frames'][number]; projectRoot: string }): React.JSX.Element {
  const imageUrl = window.editorApi.fileSystem.assetUrl(joinProjectPath(projectRoot, source.source.imagePath))
  const scale = Math.min(6, Math.max(1, Math.floor(260 / Math.max(frame.bounds.width, frame.bounds.height))))
  return <div className="animation-frame-preview checkerboard"><div style={{
    width: frame.bounds.width * scale,
    height: frame.bounds.height * scale,
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${source.imageSize.width * scale}px ${source.imageSize.height * scale}px`,
    backgroundPosition: `${-frame.bounds.x * scale}px ${-frame.bounds.y * scale}px`,
    imageRendering: 'pixelated'
  }} /></div>
}

function CommitInput({ label, value, onCommit, compact }: { label: string; value: string; onCommit(value: string): void; compact?: boolean }): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <label className={compact ? 'compact-input' : 'authoring-field'}><span>{label}</span><input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { const next = draft.trim(); if (next && next !== value) onCommit(next); else setDraft(value) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur() } }} /></label>
}

function NumberInput({ label, value, min, onCommit }: { label: string; value: number; min: number; onCommit(value: number): void }): React.JSX.Element {
  return <label className="authoring-field"><span>{label}</span><input type="number" value={value} min={min} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next) && next >= min) onCommit(next) }} /></label>
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange(value: string): void }): React.JSX.Element {
  return <label className="authoring-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>
}

function replaceAt<T>(items: T[], index: number, value: T): T[] { return items.map((item, candidate) => candidate === index ? value : item) }
function moveItem<T>(items: T[], from: number, to: number): T[] { const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item!); return next }
function parseFrameKey(value: string): string | number { return /^\d+$/.test(value) ? Number(value) : value }
function uniqueClipKey(asset: AnimationAsset, base: string): string { let key = base; let index = 1; while (asset.clips.some((clip) => clip.key === key)) key = `${base}-${++index}`; return key }
function joinProjectPath(root: string, relativePath: string): string { return `${root.replace(/[\\/]+$/, '')}\\${relativePath.replaceAll('/', '\\')}` }
