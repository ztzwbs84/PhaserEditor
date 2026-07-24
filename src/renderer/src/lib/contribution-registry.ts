import type {
  CommandContribution,
  ComponentProviderContribution,
  FileHandlerContribution,
  PanelContribution,
  SchemaContribution
} from '@phaser-editor/contracts'

export interface ContributionRegistration<T> {
  owner: string
  id: string
  priority?: number
  value: T
}

export interface ContributionEntry<T> {
  owner: string
  id: string
  priority: number
  value: T
}

export interface ContributionConflict<T> {
  id: string
  winner: ContributionEntry<T>
  shadowed: ContributionEntry<T>[]
}

export class ContributionRegistry<T> {
  private readonly entries = new Map<string, Map<string, ContributionEntry<T>>>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  register(registration: ContributionRegistration<T>): () => void {
    const byOwner = this.entries.get(registration.id) ?? new Map<string, ContributionEntry<T>>()
    if (byOwner.has(registration.owner)) throw new Error(`${registration.owner} already contributes ${registration.id}.`)
    const entry: ContributionEntry<T> = {
      owner: registration.owner,
      id: registration.id,
      priority: Number.isFinite(registration.priority) ? registration.priority! : 0,
      value: registration.value
    }
    byOwner.set(registration.owner, entry)
    this.entries.set(registration.id, byOwner)
    this.emitChange()

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.entries.get(registration.id)
      if (current?.get(registration.owner) !== entry) return
      current.delete(registration.owner)
      if (current.size === 0) this.entries.delete(registration.id)
      this.emitChange()
    }
  }

  get(id: string): ContributionEntry<T> | undefined {
    const entries = this.entries.get(id)
    return entries ? this.sort(entries.values())[0] : undefined
  }

  list(): ContributionEntry<T>[] {
    return [...this.entries.keys()]
      .map((id) => this.get(id))
      .filter((entry): entry is ContributionEntry<T> => Boolean(entry))
      .sort((left, right) => compareText(left.id, right.id))
  }

  candidates(id: string): ContributionEntry<T>[] {
    return this.sort(this.entries.get(id)?.values() ?? [])
  }

  conflicts(): ContributionConflict<T>[] {
    return [...this.entries.keys()].sort().flatMap((id) => {
      const candidates = this.candidates(id)
      return candidates.length > 1 ? [{ id, winner: candidates[0]!, shadowed: candidates.slice(1) }] : []
    })
  }

  disposeOwner(owner: string): void {
    let changed = false
    for (const [id, entries] of this.entries) {
      changed = entries.delete(owner) || changed
      if (entries.size === 0) this.entries.delete(id)
    }
    if (changed) this.emitChange()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRevision(): number {
    return this.revision
  }

  private sort(entries: Iterable<ContributionEntry<T>>): ContributionEntry<T>[] {
    return [...entries].sort((left, right) => right.priority - left.priority || compareText(left.owner, right.owner))
  }

  private emitChange(): void {
    this.revision += 1
    this.listeners.forEach((listener) => listener())
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export interface ResolvedSchemaContribution extends SchemaContribution {
  schema: Record<string, unknown>
}

export const commandContributionRegistry = new ContributionRegistry<CommandContribution>()
export const panelContributionRegistry = new ContributionRegistry<PanelContribution>()
export const fileHandlerContributionRegistry = new ContributionRegistry<FileHandlerContribution>()
export const componentProviderContributionRegistry = new ContributionRegistry<ComponentProviderContribution>()
export const schemaContributionRegistry = new ContributionRegistry<ResolvedSchemaContribution>()
