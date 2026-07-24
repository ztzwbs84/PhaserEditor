import { Box, Link2 } from 'lucide-react'
import { AuthoringDocumentError, parsePrefab, type EditorDocument } from '@phaser-editor/contracts'

export function PrefabEditor({ document }: { document: EditorDocument }): React.JSX.Element {
  try {
    const prefab = parsePrefab(document.content)
    return <div className="authoring-editor prefab-editor">
      <header className="authoring-toolbar"><div className="authoring-title"><Box size={15} /><strong>Prefab</strong><span>{prefab.objects.length} objects</span></div></header>
      <div className="prefab-summary">
        <section><h3>Object subtree</h3>{prefab.objects.map((object) => <div className="prefab-object-row" key={object.id}><Box size={13} /><strong>{object.name}</strong><span>{object.type}</span><small>{object.components.length} components</small></div>)}</section>
        <section><h3>Exposed properties</h3>{prefab.exposedProperties.map((property) => <div className="prefab-property-row" key={property.id}><Link2 size={13} /><strong>{property.name}</strong><span>{property.propertyPath.join('.')}</span></div>)}{prefab.exposedProperties.length === 0 && <div className="authoring-empty">No exposed properties</div>}</section>
      </div>
    </div>
  } catch (error) {
    const issues = error instanceof AuthoringDocumentError ? error.issues : []
    return <div className="authoring-editor invalid-authoring"><strong>Invalid prefab</strong>{issues.map((entry) => <span key={`${entry.path}-${entry.message}`}>{entry.path}: {entry.message}</span>)}</div>
  }
}
