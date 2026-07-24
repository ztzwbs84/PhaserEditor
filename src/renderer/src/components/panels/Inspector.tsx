import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Box, File, FileWarning, Folder, Layers3, Play, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { parsePrefab, validatePrefabOverrides, type FileEntry, type PrefabDocument, type RunConfiguration, type SceneObject } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'
import { useSceneStore } from '../../store/scene-store'
import { replaceSceneDocumentCommand, updateObjectsCommand } from '../../store/scene-commands'
import { coreScenePropertyDescriptors, type ScenePropertyDescriptor, type ScenePropertyValue } from '../../lib/scene-properties'
import { formatCommandLine, parseCommandLine } from '../../../../shared/command-line'
import { descriptorPropertyPath, refreshPrefabInstance, removePrefabOverride, setPrefabOverride } from '../../lib/prefabs'
import { sceneComponentRegistry, type ComponentPropertyDescriptor } from '../../lib/scene-components'

export function Inspector(): React.JSX.Element {
  const activeScenePath = useSceneStore((state) => state.activePath)
  const activeScene = useSceneStore((state) => activeScenePath ? state.scenes[activeScenePath] : undefined)
  if (activeScenePath && activeScene?.status === 'editable' && activeScene.selection.length > 0) {
    return <SceneInspector path={activeScenePath} scene={activeScene} />
  }
  return <ProjectInspector />
}

function SceneInspector({ path, scene }: {
  path: string
  scene: Extract<ReturnType<typeof useSceneStore.getState>['scenes'][string], { status: 'editable' }>
}): React.JSX.Element {
  const execute = useSceneStore((state) => state.execute)
  const selected = scene.selection.flatMap((id) => {
    const object = scene.document.objects.find((candidate) => candidate.id === id)
    return object ? [object] : []
  })
  const descriptors = useMemo(() => coreScenePropertyDescriptors.filter((descriptor) => {
    if (selected.length > 1 && descriptor.group === 'Identity') return false
    return selected.length > 0 && selected.every(descriptor.supports)
  }), [selected])
  const groups = [...new Set(descriptors.map((descriptor) => descriptor.group))]
  const primary = selected[0]!

  const commit = (descriptor: ScenePropertyDescriptor, value: ScenePropertyValue): void => {
    const before = selected.map((object) => structuredClone(object))
    const after = selected.map((object) => descriptor.write(object, value))
    const replacements = new Map(after.map((object) => [object.id, object]))
    let nextDocument = { ...scene.document, objects: scene.document.objects.map((object) => replacements.get(object.id) ?? object) }
    const propertyPath = descriptorPropertyPath(descriptor.id)
    after.forEach((object) => {
      const storedValue = readPropertyPath(object, propertyPath)
      nextDocument = setPrefabOverride(nextDocument, object.id, null, propertyPath, storedValue)
    })
    if (nextDocument.objects.some((object, index) => object !== scene.document.objects[index])) {
      execute(path, replaceSceneDocumentCommand(scene.document, nextDocument, `Edit ${descriptor.label}`, scene.selection))
    } else {
      execute(path, updateObjectsCommand(before, after, scene.selection, `Edit ${descriptor.label}`))
    }
  }

  return <div className="panel inspector-panel scene-inspector">
    <div className="inspector-title"><Box size={18} /><div><strong>{selected.length === 1 ? primary.name : `${selected.length} Objects`}</strong><small>{selected.length === 1 ? primary.type : 'Multiple selection'}</small></div></div>
    {selected.length === 1 && <PrefabInstanceSection path={path} scene={scene} object={primary} />}
    {selected.length === 1 && <SceneComponentsSection path={path} scene={scene} object={primary} />}
    {groups.map((group) => <Section title={group} key={group}>
      {descriptors.filter((descriptor) => descriptor.group === group).map((descriptor) => <ScenePropertyControl key={descriptor.id} descriptor={descriptor} objects={selected} onCommit={commit} />)}
    </Section>)}
  </div>
}

function SceneComponentsSection({ path, scene, object }: {
  path: string
  scene: Extract<ReturnType<typeof useSceneStore.getState>['scenes'][string], { status: 'editable' }>
  object: SceneObject
}): React.JSX.Element {
  useSyncExternalStore(sceneComponentRegistry.subscribe.bind(sceneComponentRegistry), sceneComponentRegistry.getRevision.bind(sceneComponentRegistry))
  const execute = useSceneStore((state) => state.execute)
  const [type, setType] = useState(() => sceneComponentRegistry.list().find((definition) => definition.supports(object))?.type ?? '')
  const compatible = sceneComponentRegistry.list().filter((definition) => definition.supports(object))

  const commitObject = (nextObject: SceneObject, title: string, componentId?: string, propertyPath?: string[], value?: unknown): void => {
    let nextDocument = { ...scene.document, objects: scene.document.objects.map((candidate) => candidate.id === object.id ? nextObject : candidate) }
    if (componentId && propertyPath) nextDocument = setPrefabOverride(nextDocument, object.id, componentId, propertyPath, value)
    execute(path, replaceSceneDocumentCommand(scene.document, nextDocument, title, scene.selection))
  }

  return <Section title="Components">
    <div className="component-add-row"><select aria-label="Component type" value={type} onChange={(event) => setType(event.target.value)}>{compatible.map((definition) => <option value={definition.type} key={definition.type}>{definition.label}</option>)}</select><button className="icon-button compact" title="Add component" disabled={!type} onClick={() => {
      const component = sceneComponentRegistry.create(type)
      commitObject({ ...object, components: [...object.components, component] }, `Add ${sceneComponentRegistry.get(type)?.label ?? 'component'}`)
    }}><Plus size={13} /></button></div>
    {object.components.map((component) => {
      const definition = sceneComponentRegistry.get(component.type)
      const issues = sceneComponentRegistry.validate(component, scene.document.objects)
      return <div className={`scene-component${component.enabled ? '' : ' disabled'}`} key={component.id}>
        <div className="scene-component-header"><input aria-label={`Enable ${definition?.label ?? component.type}`} type="checkbox" checked={component.enabled} onChange={(event) => commitObject({ ...object, components: object.components.map((candidate) => candidate.id === component.id ? { ...candidate, enabled: event.target.checked } : candidate) }, `${event.target.checked ? 'Enable' : 'Disable'} ${definition?.label ?? component.type}`)} /><strong>{definition?.label ?? component.type}</strong><small>v{component.version}</small><button className="icon-button compact" title="Remove component" onClick={() => commitObject({ ...object, components: object.components.filter((candidate) => candidate.id !== component.id) }, `Remove ${definition?.label ?? component.type}`)}><Trash2 size={11} /></button></div>
        {issues.map((issue) => <div className="component-issue" key={issue}>{issue}</div>)}
        {definition?.properties.map((property) => <ComponentPropertyControl key={property.path.join('.')} descriptor={property} data={component.data} disabled={!component.enabled} onCommit={(value) => {
          const data = setNestedValue(component.data, property.path, value)
          const parsed = definition.dataSchema.safeParse(data)
          if (!parsed.success) return
          const nextObject = { ...object, components: object.components.map((candidate) => candidate.id === component.id ? { ...candidate, data: parsed.data } : candidate) }
          commitObject(nextObject, `Edit ${definition.label} ${property.label}`, component.id, property.path, value)
        }} />)}
        {component.type === 'phaser.tween' && <TweenTimeline data={component.data} />}
      </div>
    })}
    {object.components.length === 0 && <div className="authoring-empty">No components</div>}
  </Section>
}

function TweenTimeline({ data }: { data: Record<string, unknown> }): React.JSX.Element {
  const delay = typeof data.delay === 'number' ? data.delay : 0
  const duration = typeof data.duration === 'number' ? data.duration : 1
  const total = Math.max(1, delay + duration)
  return <div className="tween-timeline" aria-label="Tween timeline"><span style={{ width: `${delay / total * 100}%` }} /><strong style={{ left: `${delay / total * 100}%`, width: `${duration / total * 100}%` }}>{String(data.property ?? 'value')}</strong><small>{total} ms</small></div>
}

function ComponentPropertyControl({ descriptor, data, disabled, onCommit }: { descriptor: ComponentPropertyDescriptor; data: Record<string, unknown>; disabled: boolean; onCommit(value: unknown): void }): React.JSX.Element {
  const value = readPropertyPath(data, descriptor.path)
  const [draft, setDraft] = useState(String(value ?? ''))
  useEffect(() => setDraft(String(value ?? '')), [value])
  if (descriptor.kind === 'boolean') return <label className="component-property boolean"><span>{descriptor.label}</span><input type="checkbox" disabled={disabled} checked={Boolean(value)} onChange={(event) => onCommit(event.target.checked)} /></label>
  if (descriptor.kind === 'select') return <label className="component-property"><span>{descriptor.label}</span><select disabled={disabled} value={String(value ?? '')} onChange={(event) => onCommit(event.target.value)}>{descriptor.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
  return <label className="component-property"><span>{descriptor.label}</span><input disabled={disabled} type={descriptor.kind === 'number' ? 'number' : descriptor.kind === 'color' ? 'color' : 'text'} value={draft} min={descriptor.min} max={descriptor.max} step={descriptor.step} onChange={(event) => setDraft(event.target.value)} onBlur={() => {
    const next = descriptor.kind === 'number' ? Number(draft) : draft
    if ((descriptor.kind !== 'number' || Number.isFinite(next)) && next !== value) onCommit(next)
    else setDraft(String(value ?? ''))
  }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value ?? '')); event.currentTarget.blur() } }} /></label>
}

function PrefabInstanceSection({ path, scene, object }: {
  path: string
  scene: Extract<ReturnType<typeof useSceneStore.getState>['scenes'][string], { status: 'editable' }>
  object: SceneObject
}): React.JSX.Element | null {
  const execute = useSceneStore((state) => state.execute)
  const project = useEditorStore((state) => state.project)!
  const notify = useEditorStore((state) => state.notify)
  const root = scene.document.objects.find((candidate) => candidate.prefabInstance && Object.values(candidate.prefabInstance.objectMap).includes(object.id))
  const [prefab, setPrefab] = useState<PrefabDocument | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const metadata = root?.prefabInstance

  useEffect(() => {
    if (!metadata) { setPrefab(null); setLoadError(null); return }
    let cancelled = false
    const fullPath = `${project.path.replace(/[\\/]+$/, '')}\\${metadata.prefabPath.replaceAll('/', '\\')}`
    void window.editorApi.fileSystem.read(fullPath).then((result) => {
      if (cancelled) return
      if (!result.ok) { setPrefab(null); setLoadError(result.error.message); return }
      try { setPrefab(parsePrefab(result.value.content)); setLoadError(null) }
      catch (error) { setPrefab(null); setLoadError(error instanceof Error ? error.message : 'Prefab is invalid.') }
    })
    return () => { cancelled = true }
  }, [metadata?.prefabPath, metadata?.instanceId, project.path])

  if (!root || !metadata) return null
  const diagnostics = prefab ? validatePrefabOverrides(prefab, { prefabPath: metadata.prefabPath, instanceId: metadata.instanceId, overrides: metadata.overrides }) : []

  const refresh = (baseDocument = scene.document): void => {
    if (!prefab) { notify('warning', loadError ?? 'Prefab source is unavailable.'); return }
    try {
      const refreshed = refreshPrefabInstance(baseDocument, root.id, prefab)
      execute(path, replaceSceneDocumentCommand(scene.document, refreshed.document, 'Refresh prefab instance', scene.selection))
      if (refreshed.diagnostics.length) notify('warning', `${refreshed.diagnostics.length} prefab overrides remain unresolved.`)
    } catch (error) {
      notify('warning', error instanceof Error ? error.message : 'Could not refresh prefab.')
    }
  }

  return <Section title="Prefab Instance">
    <div className="prefab-instance-summary"><strong title={metadata.prefabPath}>{metadata.prefabPath}</strong><small>{metadata.instanceId}</small></div>
    <button className="button full" disabled={!prefab} onClick={() => refresh()}><RefreshCw size={13} />Refresh from prefab</button>
    {loadError && <div className="prefab-diagnostic"><FileWarning size={13} />{loadError}</div>}
    {Object.entries(metadata.overrides).map(([key]) => {
      const issue = diagnostics.find((candidate) => candidate.path.includes(JSON.stringify(key)))
      return <div className={`prefab-override-row${issue ? ' unresolved' : ''}`} key={key}><span title={key}>{overrideLabel(key)}</span>{issue && <FileWarning size={12} />}<button className="icon-button compact" title="Remove override" onClick={() => {
        const without = removePrefabOverride(scene.document, root.id, key)
        if (!prefab) execute(path, replaceSceneDocumentCommand(scene.document, without, 'Remove prefab override', scene.selection))
        else {
          const refreshed = refreshPrefabInstance(without, root.id, prefab)
          execute(path, replaceSceneDocumentCommand(scene.document, refreshed.document, 'Remove prefab override', scene.selection))
        }
      }}><Trash2 size={11} /></button></div>
    })}
  </Section>
}

function ScenePropertyControl({ descriptor, objects, onCommit }: {
  descriptor: ScenePropertyDescriptor
  objects: SceneObject[]
  onCommit(descriptor: ScenePropertyDescriptor, value: ScenePropertyValue): void
}): React.JSX.Element {
  const values = objects.map(descriptor.read)
  const mixed = values.some((value) => value !== values[0])
  const modelValue = mixed ? '' : values[0]!
  const [draft, setDraft] = useState(String(modelValue))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(String(modelValue))
    setError(null)
  }, [descriptor.id, modelValue, objects])

  const commit = (raw: string): void => {
    let value: ScenePropertyValue = raw
    if (descriptor.kind === 'number') {
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) { setError('Enter a valid number.'); return }
      if (descriptor.min !== undefined && parsed < descriptor.min) { setError(`Minimum is ${descriptor.min}.`); return }
      if (descriptor.max !== undefined && parsed > descriptor.max) { setError(`Maximum is ${descriptor.max}.`); return }
      value = parsed
    }
    const validation = descriptor.validate?.(value) ?? null
    if (validation) { setError(validation); return }
    setError(null)
    onCommit(descriptor, value)
  }

  if (descriptor.kind === 'boolean') {
    return <label className="scene-property-row boolean"><span>{descriptor.label}</span><input type="checkbox" checked={!mixed && Boolean(modelValue)} ref={(input) => { if (input) input.indeterminate = mixed }} onChange={(event) => onCommit(descriptor, event.target.checked)} /></label>
  }
  if (descriptor.kind === 'multiline') {
    return <label className={`scene-property-row multiline${error ? ' invalid' : ''}`}><span>{descriptor.label}</span><textarea value={draft} placeholder={mixed ? 'Mixed' : ''} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft)} />{error && <small>{error}</small>}</label>
  }
  return <label className={`scene-property-row${error ? ' invalid' : ''}`}>
    <span>{descriptor.label}</span>
    <input
      type={descriptor.kind === 'number' ? 'number' : 'text'}
      value={draft}
      placeholder={mixed ? 'Mixed' : ''}
      min={descriptor.min}
      max={descriptor.max}
      step={descriptor.step}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur() } if (event.key === 'Escape') { setDraft(String(modelValue)); setError(null); event.currentTarget.blur() } }}
    />
    {error && <small>{error}</small>}
  </label>
}

function ProjectInspector(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)!
  const selectedPath = useEditorStore((state) => state.selectedPath)
  const document = useEditorStore((state) => selectedPath ? state.documents[selectedPath] : undefined)
  const settings = useEditorStore((state) => state.settings)
  const updateSettings = useEditorStore((state) => state.updateSettings)
  const notify = useEditorStore((state) => state.notify)
  const [entry, setEntry] = useState<FileEntry | null>(null)
  const stored = settings?.runConfigurations[project.path]
  const defaultScript = ['start', 'dev', 'serve', 'preview'].find((candidate) => project.scripts[candidate]) ?? 'start'
  const [executable, setExecutable] = useState(stored?.executable ?? project.packageManager)
  const [args, setArgs] = useState(formatCommandLine(stored?.args ?? ['run', defaultScript]))
  const [cwd, setCwd] = useState(stored?.cwd ?? '')

  useEffect(() => {
    if (!selectedPath) { setEntry(null); return }
    void window.editorApi.fileSystem.stat(selectedPath).then((result) => { if (result.ok) setEntry(result.value) })
  }, [selectedPath])

  if (entry) {
    return <div className="panel inspector-panel">
      <div className="inspector-title">{entry.kind === 'directory' ? <Folder size={18} /> : <File size={18} />}<div><strong>{entry.name}</strong><small>{entry.relativePath}</small></div></div>
      <Section title="Asset"><Field label="Type" value={entry.kind === 'directory' ? 'Folder' : entry.extension.toLocaleUpperCase() || 'File'} /><Field label="Size" value={formatBytes(entry.size)} /><Field label="Modified" value={new Date(entry.modifiedAt).toLocaleString()} /><Field label="Path" value={entry.path} multiline /></Section>
      {document && <Section title="Document"><Field label="Language" value={document.language} /><Field label="State" value={document.dirty ? 'Modified' : 'Saved'} /></Section>}
    </div>
  }

  return <div className="panel inspector-panel">
    <div className="inspector-title"><Play size={18} /><div><strong>{project.name}</strong><small>Project settings</small></div></div>
    <Section title="Project"><Field label="Root" value={project.path} multiline /><Field label="Phaser" value={project.phaserVersion ?? 'Unknown'} /><Field label="Manager" value={project.packageManager} /></Section>
    <Section title="Run configuration">
      <label className="inspector-input"><span>Executable</span><input value={executable} onChange={(event) => setExecutable(event.target.value)} /></label>
      <label className="inspector-input"><span>Arguments</span><input value={args} onChange={(event) => setArgs(event.target.value)} /></label>
      <label className="inspector-input"><span>Working directory</span><input value={cwd} placeholder="Project root" onChange={(event) => setCwd(event.target.value)} /></label>
      <button className="button full" onClick={() => {
        const configuration: RunConfiguration = { executable, args: parseCommandLine(args), cwd: cwd.trim() || undefined }
        void updateSettings({ runConfigurations: { ...(settings?.runConfigurations ?? {}), [project.path]: configuration } })
        notify('success', 'Run configuration saved')
      }}><Save size={14} />Save configuration</button>
    </Section>
  </div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element { return <section className="inspector-section"><h3>{title}</h3>{children}</section> }
function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }): React.JSX.Element { return <div className={`property-row${multiline ? ' multiline' : ''}`}><span>{label}</span><strong title={value}>{value}</strong></div> }
function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB` }

function readPropertyPath(root: unknown, path: Array<string | number>): unknown {
  let value = root
  for (const segment of path) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined
    value = (value as Record<string | number, unknown>)[segment]
  }
  return structuredClone(value)
}

function overrideLabel(key: string): string {
  try {
    const value = JSON.parse(key) as unknown[]
    return value.slice(2).join('.') || 'Override'
  } catch { return key }
}

function setNestedValue(data: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const clone = structuredClone(data)
  let current: Record<string, unknown> = clone
  path.slice(0, -1).forEach((segment) => {
    const next = current[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  })
  current[path.at(-1)!] = value
  return clone
}
