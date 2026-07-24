import { AlertCircle, GitBranch, Info, TriangleAlert } from 'lucide-react'
import { useEditorStore } from '../../store/editor-store'

export function StatusBar(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const logs = useEditorStore((state) => state.logs)
  const errors = logs.filter((entry) => entry.level === 'error').length
  const warnings = logs.filter((entry) => entry.level === 'warning').length
  return (
    <footer className="status-bar">
      <span><GitBranch size={13} />{project?.packageManager ?? 'npm'}</span>
      <span><Info size={13} />Phaser {project?.phaserVersion}</span>
      <span className="status-spacer" />
      <span><TriangleAlert size={13} />{warnings}</span>
      <span><AlertCircle size={13} />{errors}</span>
      <span>UTF-8</span>
      <span>Windows</span>
    </footer>
  )
}
