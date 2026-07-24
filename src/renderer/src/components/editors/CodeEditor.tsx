import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react'
import { Braces, Save, Search } from 'lucide-react'
import type { EditorDocument } from '@phaser-editor/contracts'
import type { editor } from 'monaco-editor'
import { useEditorStore } from '../../store/editor-store'
import { configurePhaserJsonSchemas, installPhaserCodeIntelligence } from '../../lib/phaser-code-intelligence'
import { schemaContributionRegistry } from '../../lib/contribution-registry'

export function CodeEditor({ document }: { document: EditorDocument }): React.JSX.Element {
  const updateDocument = useEditorStore((state) => state.updateDocument)
  const saveDocument = useEditorStore((state) => state.saveDocument)
  const theme = useEditorStore((state) => state.settings?.theme ?? 'dark')
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const schemaRevision = useSyncExternalStore(schemaContributionRegistry.subscribe.bind(schemaContributionRegistry), schemaContributionRegistry.getRevision.bind(schemaContributionRegistry))
  const [problems, setProblems] = useState(0)
  const [phaserInfo, setPhaserInfo] = useState<string | null>(null)
  const project = useEditorStore((state) => state.project)!

  const onMount: OnMount = (instance, monaco) => {
    editorRef.current = instance
    monacoRef.current = monaco
    if (document.language === 'json') configurePhaserJsonSchemas(monaco)
    if (document.language === 'typescript' || document.language === 'javascript') {
      void installPhaserCodeIntelligence(monaco, project).then((bundle) => setPhaserInfo(`Phaser ${bundle.version} · ${bundle.source}`)).catch((error) => setPhaserInfo(error instanceof Error ? error.message : 'Phaser typings unavailable'))
    }
    const updateProblems = (): void => setProblems(monaco.editor.getModelMarkers({ resource: instance.getModel()?.uri }).length)
    updateProblems()
    const disposable = monaco.editor.onDidChangeMarkers(updateProblems)
    instance.onDidDispose(() => disposable.dispose())
  }

  useEffect(() => {
    if (document.language === 'json' && monacoRef.current) configurePhaserJsonSchemas(monacoRef.current)
  }, [document.language, schemaRevision])

  useEffect(() => {
    const handler = (event: Event): void => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'undo') editorRef.current?.trigger('toolbar', 'undo', null)
      if (action === 'redo') editorRef.current?.trigger('toolbar', 'redo', null)
      if (action === 'find') editorRef.current?.getAction('actions.find')?.run()
    }
    window.addEventListener('phaser-editor:editor-action', handler)
    return () => window.removeEventListener('phaser-editor:editor-action', handler)
  }, [])

  const format = async (): Promise<void> => {
    await editorRef.current?.getAction('editor.action.formatDocument')?.run()
  }

  return <div className="document-editor">
    <div className="editor-toolbar">
      <span className="document-path">{document.path}</span>
      {document.language === 'json' && <button className="button small" onClick={() => void format()}><Braces size={14} />Format</button>}
      <button className="icon-button compact" title="Find" onClick={() => void editorRef.current?.getAction('actions.find')?.run()}><Search size={14} /></button>
      <button className="icon-button compact" title="Save" disabled={!document.dirty || document.readOnly || document.conflict} onClick={() => void saveDocument(document.path)}><Save size={14} /></button>
      {phaserInfo && <span className="phaser-intelligence-status" title={phaserInfo}>{phaserInfo}</span>}
      {problems > 0 && <span className="problem-count">{problems} problem{problems === 1 ? '' : 's'}</span>}
    </div>
    <div className="editor-surface">
      <Editor
        path={document.path}
        language={document.language}
        value={document.content}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        onMount={onMount}
        onChange={(value) => updateDocument(document.path, value ?? '')}
        options={{
          automaticLayout: true,
          fontFamily: "'JetBrains Mono', Consolas, monospace",
          fontSize: 13,
          minimap: { enabled: document.content.length > 2000 },
          folding: true,
          formatOnPaste: true,
          renderWhitespace: 'selection',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 2,
          wordWrap: document.language === 'markdown' ? 'on' : 'off',
          readOnly: document.readOnly
        }}
      />
    </div>
  </div>
}
