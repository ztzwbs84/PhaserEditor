import { lazy, Suspense, useCallback, useEffect, useSyncExternalStore } from 'react'
import { AlertTriangle, LoaderCircle, RefreshCw, Save } from 'lucide-react'
import { useEditorStore } from '../../store/editor-store'
import { CodeEditor } from './CodeEditor'
import { MarkdownEditor } from './MarkdownEditor'
import { ImageViewer } from './ImageViewer'
import { AudioViewer } from './AudioViewer'
import { pluginContributionRuntime } from '../../lib/plugin-runtime'
import { fileHandlerContributionRegistry } from '../../lib/contribution-registry'
import { LazyPluginSurface } from '../common/LazyPluginSurface'

const TilemapEditor = lazy(async () => ({ default: (await import('./TilemapEditor')).TilemapEditor }))
const SceneEditor = lazy(async () => ({ default: (await import('./SceneEditor')).SceneEditor }))
const AtlasInspector = lazy(async () => ({ default: (await import('./AtlasInspector')).AtlasInspector }))
const AnimationEditor = lazy(async () => ({ default: (await import('./AnimationEditor')).AnimationEditor }))
const PrefabEditor = lazy(async () => ({ default: (await import('./PrefabEditor')).PrefabEditor }))
const SpineViewer = lazy(async () => ({ default: (await import('./SpineViewer')).SpineViewer }))

export function DocumentHost({ path }: { path: string }): React.JSX.Element {
  useSyncExternalStore(fileHandlerContributionRegistry.subscribe.bind(fileHandlerContributionRegistry), fileHandlerContributionRegistry.getRevision.bind(fileHandlerContributionRegistry))
  const document = useEditorStore((state) => state.documents[path])
  const openDocument = useEditorStore((state) => state.openDocument)
  const selectPath = useEditorStore((state) => state.selectPath)
  const reloadDocument = useEditorStore((state) => state.reloadDocument)
  const overwriteDocument = useEditorStore((state) => state.overwriteDocument)
  const fileHandler = pluginContributionRuntime.getFileHandlerResolution(path).winner
  const loadPluginEditor = useCallback((retry: boolean) => pluginContributionRuntime.loadFileEditor(path, retry), [path, fileHandler?.owner, fileHandler?.id])
  useEffect(() => {
    selectPath(path)
    if (!document) void openDocument(path)
  }, [document, openDocument, path, selectPath])

  if (!document) return <div className="editor-loading"><LoaderCircle className="spin" size={20} />Loading {path}</div>
  const editor = fileHandler
    ? <LazyPluginSurface name={fileHandler.value.id} pluginId={fileHandler.owner} contributionId={fileHandler.id} document={document} load={loadPluginEditor} />
    : document.kind === 'markdown' ? <MarkdownEditor document={document} />
    : document.kind === 'image' ? <ImageViewer document={document} />
      : document.kind === 'audio' ? <AudioViewer document={document} />
        : document.kind === 'spine' ? <SpineViewer document={document} />
          : document.kind === 'tilemap' ? <TilemapEditor document={document} />
            : document.kind === 'scene' ? <SceneEditor document={document} />
              : document.kind === 'atlas' ? <AtlasInspector document={document} />
                : document.kind === 'animation' ? <AnimationEditor document={document} />
                  : document.kind === 'prefab' ? <PrefabEditor document={document} />
          : <CodeEditor document={document} />
  return <div className="document-host">
    {document.conflict && <div className="document-alert" role="alert">
      <AlertTriangle size={15} />
      <span>This file changed on disk. Keep your edits by overwriting it, or reload the disk version.</span>
      <button className="button small" onClick={() => void reloadDocument(document.path)}><RefreshCw size={13} />Reload</button>
      <button className="button small primary" onClick={() => void overwriteDocument(document.path)}><Save size={13} />Overwrite</button>
    </div>}
    {document.missing && <div className="document-alert" role="alert">
      <AlertTriangle size={15} />
      <span>This file was deleted. The unsaved buffer is read-only so you can copy it before closing.</span>
    </div>}
    <Suspense fallback={<div className="editor-loading"><LoaderCircle className="spin" size={20} />Loading editor...</div>}>{editor}</Suspense>
  </div>
}
