import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react'
import type { EditorDocument, FileEntry, FileSnapshot, Result } from '@phaser-editor/contracts'
import { useEditorStore } from '../../store/editor-store'
import {
  isPluginSurfaceDefinition,
  pluginContributionRuntime,
  type PluginSurfaceContext,
  type PluginSurfaceExport,
  type PluginSurfaceHandle,
  type PluginSurfaceKind
} from '../../lib/plugin-runtime'

const shadowBaseStyles = `
:host { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; color: inherit; font: inherit; }
#plugin-root { width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
*, *::before, *::after { box-sizing: border-box; }
`

export type PluginSurfaceOperationPhase = 'load' | 'mount' | 'update' | 'dispose'

export async function runPluginSurfaceOperation<T>(
  phase: PluginSurfaceOperationPhase,
  operation: () => T | Promise<T>,
  onSuccess?: (value: T) => void | Promise<void>,
  onFailure?: (error: Error) => void | Promise<void>
): Promise<void> {
  let value: T
  try {
    value = await operation()
  } catch (error) {
    await notifyPluginSurfaceFailure(phase, onFailure, toError(error))
    return
  }

  if (!onSuccess) return
  try {
    await onSuccess(value)
  } catch (error) {
    await notifyPluginSurfaceFailure(phase, onFailure, toError(error))
  }
}

export function LazyPluginSurface({
  name,
  pluginId,
  contributionId,
  surfaceKind,
  document,
  load
}: {
  name: string
  pluginId: string
  contributionId: string
  surfaceKind: PluginSurfaceKind
  document?: EditorDocument
  load(retry: boolean): Promise<PluginSurfaceExport>
}): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ surface?: PluginSurfaceExport; error?: Error }>({})
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<PluginSurfaceHandle | null>(null)
  const contextRef = useRef<PluginSurfaceContext | null>(null)
  const loadRef = useRef(load)
  const project = useEditorStore((editor) => editor.project)
  const theme = useEditorStore((editor) => editor.settings?.theme ?? 'dark')
  const plugin = pluginContributionRuntime.getPlugin(pluginId)
  const surfaceKey = `${plugin?.instanceId ?? pluginId}:${plugin?.revision ?? 'legacy'}:${plugin?.uiUrl ?? ''}`
  const cssKey = `${plugin?.revision ?? 'legacy'}:${plugin?.cssUrls.join('|') ?? ''}`
  const context = useMemo(
    () => createSurfaceContext(pluginId, contributionId, surfaceKind, document, project?.path ?? null, theme),
    [contributionId, document, pluginId, project?.path, surfaceKind, theme]
  )
  contextRef.current = context
  loadRef.current = load
  const reportOperationFailure = useCallback((phase: PluginSurfaceOperationPhase, error: Error, showError: boolean) => {
    const failure = new Error(`${name} failed during ${phase}: ${error.message}`)
    if (showError) {
      setState((current) => current.error?.message === failure.message ? current : { error: failure })
    }
    pluginContributionRuntime.reportSurfaceDiagnostic(pluginId, contributionId, {
      severity: 'error',
      message: `${surfaceKind} ${contributionId} failed during ${phase}: ${error.message}`,
      file: plugin?.uiUrl
    })
  }, [contributionId, name, plugin?.uiUrl, pluginId, surfaceKind])

  useEffect(() => {
    let current = true
    setState({})
    void runPluginSurfaceOperation(
      'load',
      () => loadRef.current(attempt > 0),
      (surface) => { if (current) setState({ surface }) },
      (error) => { if (current) reportOperationFailure('load', error, true) }
    )
    return () => { current = false }
  }, [attempt, contributionId, pluginId, reportOperationFailure, surfaceKey])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !state.surface || !isPluginSurfaceDefinition(state.surface)) {
      setMountNode(null)
      return
    }
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    shadow.replaceChildren()
    const base = globalThis.document.createElement('style')
    base.textContent = shadowBaseStyles
    shadow.append(base)
    for (const url of plugin?.cssUrls ?? []) {
      const link = globalThis.document.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      shadow.append(link)
    }
    const root = globalThis.document.createElement('div')
    root.id = 'plugin-root'
    shadow.append(root)
    setMountNode(root)
    return () => {
      shadow.replaceChildren()
    }
  }, [cssKey, state.surface])

  useEffect(() => {
    const surface = state.surface
    if (!surface || !mountNode || !isPluginSurfaceDefinition(surface)) return
    let disposed = false
    let mountedHandle: PluginSurfaceHandle | null = null
    const initialContext = contextRef.current!
    const disposeHandle = (handle: PluginSurfaceHandle): void => {
      void runPluginSurfaceOperation(
        'dispose',
        () => handle.dispose?.(),
        undefined,
        (error) => reportOperationFailure('dispose', error, false)
      )
    }
    const updateHandle = (handle: PluginSurfaceHandle, nextContext: PluginSurfaceContext): void => {
      void runPluginSurfaceOperation(
        'update',
        () => handle.update?.(nextContext),
        undefined,
        (error) => reportOperationFailure('update', error, !disposed && handleRef.current === handle)
      )
    }

    void runPluginSurfaceOperation(
      'mount',
      () => surface.mount(mountNode, initialContext),
      (result) => {
        const handle = result ?? { update: surface.update?.bind(surface), dispose: surface.dispose?.bind(surface) }
        mountedHandle = handle
        if (disposed) disposeHandle(handle)
        else {
          handleRef.current = handle
          if (contextRef.current !== initialContext) updateHandle(handle, contextRef.current!)
        }
      },
      (error) => reportOperationFailure('mount', error, !disposed)
    )
    return () => {
      disposed = true
      if (handleRef.current === mountedHandle) handleRef.current = null
      if (mountedHandle) disposeHandle(mountedHandle)
    }
  }, [mountNode, reportOperationFailure, state.surface])

  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    let current = true
    void runPluginSurfaceOperation(
      'update',
      () => handle.update?.(context),
      undefined,
      (error) => reportOperationFailure('update', error, current && handleRef.current === handle)
    )
    return () => { current = false }
  }, [context, reportOperationFailure])

  if (state.error) return <div className="lazy-plugin-surface panel-error" role="alert">
    <AlertTriangle size={24} />
    <strong>{name} could not be loaded</strong>
    <span>{state.error.message}</span>
    <button className="button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={15} />Retry</button>
  </div>

  const LegacySurface = state.surface && !isPluginSurfaceDefinition(state.surface) ? state.surface : null
  return <div className="lazy-plugin-surface" data-plugin={plugin?.manifest.id ?? pluginId} data-theme={theme}>
    {!state.surface && <div className="editor-loading"><LoaderCircle className="spin" size={20} />Loading {name}...</div>}
    <div ref={hostRef} className="plugin-shadow-host" hidden={Boolean(LegacySurface)} />
    {LegacySurface && <LegacySurface pluginId={plugin?.manifest.id ?? pluginId} contributionId={contributionId} document={document} context={context} />}
  </div>
}

function createSurfaceContext(
  instanceId: string,
  contributionId: string,
  surfaceKind: PluginSurfaceKind,
  document: EditorDocument | undefined,
  projectRoot: string | null,
  theme: 'dark' | 'light'
): PluginSurfaceContext {
  const pluginId = pluginContributionRuntime.getPlugin(instanceId)?.manifest.id ?? instanceId
  const documentPath = document?.path
  const resolvePath = (candidate = ''): string => resolveProjectPath(projectRoot, candidate)
  return {
    pluginId,
    instanceId,
    contributionId,
    surfaceKind,
    document: document ? {
      snapshot: document,
      update: (content) => useEditorStore.getState().updateDocument(document.path, content),
      save: () => useEditorStore.getState().saveDocument(document.path),
      subscribe: (listener) => useEditorStore.subscribe((state, previous) => {
        const nextDocument = state.documents[document.path]
        if (nextDocument && nextDocument !== previous.documents[document.path]) listener(nextDocument)
      }),
      onDidSave: (listener) => useEditorStore.subscribe((state, previous) => {
        const nextDocument = state.documents[document.path]
        const previousDocument = previous.documents[document.path]
        if (nextDocument && previousDocument && !nextDocument.dirty && nextDocument.savedContent !== previousDocument.savedContent) listener(nextDocument)
      })
    } : undefined,
    project: {
      root: projectRoot,
      read: async (relativePath): Promise<FileSnapshot> => unwrapResult(await window.editorApi.fileSystem.read(resolvePath(relativePath))),
      write: async (relativePath, content, expectedModifiedAt): Promise<FileSnapshot> => unwrapResult(await window.editorApi.fileSystem.write(resolvePath(relativePath), content, expectedModifiedAt)),
      list: async (relativePath): Promise<FileEntry[]> => unwrapResult(await window.editorApi.fileSystem.list(resolvePath(relativePath))),
      assetUrl: (relativePath) => window.editorApi.fileSystem.assetUrl(resolvePath(relativePath))
    },
    workspace: {
      openFile: async (path) => {
        window.dispatchEvent(new CustomEvent('phaser-editor:open-document-tab', { detail: resolvePath(path) }))
      },
      openPanel: (id) => window.dispatchEvent(new CustomEvent('phaser-editor:show-contributed-panel', { detail: id }))
    },
    theme: {
      current: theme,
      subscribe: (listener) => useEditorStore.subscribe((state, previous) => {
        const nextTheme = state.settings?.theme ?? 'dark'
        if (nextTheme !== (previous.settings?.theme ?? 'dark')) listener(nextTheme)
      })
    },
    diagnostics: {
      report: (diagnostic) => pluginContributionRuntime.reportSurfaceDiagnostic(instanceId, contributionId, diagnostic)
    },
    history: {
      registerActiveUndoRedo: (handlers) => pluginContributionRuntime.registerActiveUndoRedo(
        () => surfaceKind === 'fileEditor' && Boolean(documentPath) && useEditorStore.getState().selectedPath === documentPath,
        handlers
      )
    }
  }
}

function unwrapResult<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function resolveProjectPath(root: string | null, candidate: string): string {
  if (!root) throw new Error('No project is open.')
  const normalizedRoot = normalizePath(root).replace(/\/$/, '')
  const normalizedCandidate = normalizePath(candidate.trim())
  const absolute = isAbsolutePath(normalizedCandidate)
    ? normalizedCandidate
    : `${normalizedRoot}/${normalizedCandidate.replace(/^\.\//, '').replace(/^\//, '')}`
  const resolved = resolveSegments(absolute)
  const comparisonRoot = normalizedRoot.toLocaleLowerCase()
  const comparisonResolved = resolved.toLocaleLowerCase()
  if (comparisonResolved !== comparisonRoot && !comparisonResolved.startsWith(`${comparisonRoot}/`)) throw new Error('Plugin project path is outside the active project.')
  return root.includes('\\') ? resolved.replaceAll('/', '\\') : resolved
}

function resolveSegments(value: string): string {
  const prefix = value.match(/^[a-z]:\//i)?.[0] ?? (value.startsWith('/') ? '/' : '')
  const segments = value.slice(prefix.length).split('/')
  const resolved: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') resolved.pop()
    else resolved.push(segment)
  }
  return `${prefix}${resolved.join('/')}`.replace(/\/$/, '')
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function isAbsolutePath(value: string): boolean {
  return /^[a-z]:\//i.test(value) || value.startsWith('/')
}

async function notifyPluginSurfaceFailure(
  phase: PluginSurfaceOperationPhase,
  onFailure: ((error: Error) => void | Promise<void>) | undefined,
  error: Error
): Promise<void> {
  if (!onFailure) return
  try {
    await onFailure(error)
  } catch (reportingError) {
    try {
      console.error(`Plugin surface ${phase} failure could not be reported.`, reportingError)
    } catch {
      // Cleanup must never create a second unhandled failure.
    }
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  try {
    return new Error(String(error))
  } catch {
    return new Error('Unknown plugin surface failure.')
  }
}
