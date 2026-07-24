import type { SceneObject } from '@phaser-editor/contracts'
import { sceneComponentRegistry, type ComponentProjectionContext, type ComponentProjectionHandle } from './scene-components'

interface MountedComponent {
  type: string
  version: number
  handle: ComponentProjectionHandle
  enabled: boolean
}

export class SceneComponentProjectionManager {
  private readonly mounted = new Map<string, MountedComponent>()
  private active = true

  reconcile(objects: SceneObject[], contextFor: (object: SceneObject) => ComponentProjectionContext | null): void {
    const wanted = new Set(objects.flatMap((object) => object.components.map((component) => component.id)))
    for (const [id, mounted] of this.mounted) {
      if (!wanted.has(id)) { mounted.handle.destroy(); this.mounted.delete(id) }
    }
    objects.forEach((object) => object.components.forEach((component) => {
      const definition = sceneComponentRegistry.get(component.type)
      const context = contextFor(object)
      const current = this.mounted.get(component.id)
      if (!definition?.createProjection || !context || definition.version < component.version) {
        if (current) { current.handle.destroy(); this.mounted.delete(component.id) }
        return
      }
      if (current && (current.type !== component.type || current.version !== component.version)) {
        current.handle.destroy()
        this.mounted.delete(component.id)
      }
      let mounted = this.mounted.get(component.id)
      if (!mounted) {
        mounted = { type: component.type, version: component.version, handle: definition.createProjection(component.data, context), enabled: component.enabled }
        this.mounted.set(component.id, mounted)
      }
      mounted.enabled = component.enabled
      mounted.handle.update(component.data, context)
      mounted.handle.setActive?.(component.enabled && this.active)
    }))
  }

  setActive(active: boolean): void {
    if (this.active === active) return
    this.active = active
    for (const mounted of this.mounted.values()) mounted.handle.setActive?.(mounted.enabled && active)
  }

  destroy(): void {
    for (const mounted of this.mounted.values()) mounted.handle.destroy()
    this.mounted.clear()
  }
}
